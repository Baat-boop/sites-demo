// Endpoint public POST /api/collect (Cloudflare Pages Function).
// Reçoit les événements de mesure d'audience et les réponses au questionnaire, les vérifie champ par champ,
// limite le débit, puis les enregistre dans Supabase avec la clé secrète (jamais envoyée au navigateur).
//
// Variables d'environnement (réglages du projet Cloudflare, chiffrées) :
//   SUPABASE_URL          ex. https://xxxx.supabase.co
//   SUPABASE_SECRET_KEY   clé secrète Supabase (sb_secret_… ou service_role)
//   AUTORISER_LOCAL       "1" seulement pour un test local (accepte l'origine http://127.0.0.1 / localhost)

const DOMAINE = "batiste-masson.pages.dev";
const TAILLE_MAX = 60_000; // octets
const TYPES = new Set(["vue", "clic", "questionnaire_debut", "questionnaire_envoye", "fiche_envoyee"]);
const APPAREILS = new Set(["mobile", "tablette", "ordinateur"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const reponse = (statut, message) =>
  new Response(message ? JSON.stringify({ erreur: message }) : null, {
    status: statut,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const onRequest = async (contexte) => {
  if (contexte.request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  try {
    return await traiter(contexte);
  } catch (e) {
    return reponse(500, "erreur interne");
  }
};

async function traiter({ request, env }) {
  // 1. Origine : seulement le site lui-même (production ou aperçus).
  const site = siteDe(request.headers.get("Origin"), env);
  if (!site) return reponse(403, "origine refusée");

  // 2. Corps JSON de taille raisonnable.
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) return reponse(415, "JSON attendu");
  if (Number(request.headers.get("Content-Length") || 0) > TAILLE_MAX) return reponse(413, "trop gros");
  const texte = await request.text();
  if (texte.length > TAILLE_MAX) return reponse(413, "trop gros");
  let corps;
  try { corps = JSON.parse(texte); } catch { return reponse(400, "JSON invalide"); }
  if (!corps || typeof corps !== "object" || Array.isArray(corps)) return reponse(400, "format invalide");

  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return reponse(503, "stockage non configuré");
  const db = base(env);

  // 3. Empreinte du visiteur : sel aléatoire du jour + IP + navigateur, réduite à 16 caractères. L'IP n'est jamais stockée.
  const ip = request.headers.get("CF-Connecting-IP") || "inconnue";
  const visiteur = (await sha256((await selDuJour(db)) + "|" + ip + "|" + (request.headers.get("User-Agent") || ""))).slice(0, 16);

  // 4. Limites de débit.
  if (!(await db.rpc("prendre_jeton", { p_cle: "tout", p_max: 3000, p_secondes: 60 }))) return reponse(429, "trop de requêtes");

  if (corps.genre === "evenement") {
    if (!(await db.rpc("prendre_jeton", { p_cle: "e:" + visiteur, p_max: 120, p_secondes: 600 }))) return reponse(429, "trop de requêtes");
    const ligne = evenement(corps, site, visiteur);
    if (!ligne) return reponse(400, "événement invalide");
    await db.inserer("evenements", ligne);
    return reponse(204);
  }

  if (corps.genre === "reponse" || corps.genre === "fiche") {
    if (!(await db.rpc("prendre_jeton", { p_cle: "r:" + visiteur, p_max: 6, p_secondes: 3600 }))) return reponse(429, "trop de requêtes");
    const ligne = reponseQuestionnaire(corps, site);
    if (!ligne) return reponse(400, "réponse invalide");
    if (corps.genre === "reponse") {
      await db.inserer("reponses", ligne, "id"); // un renvoi du même questionnaire est ignoré
    } else {
      // La fiche complète une réponse existante, une seule fois ; sinon on crée la ligne.
      const maj = await db.modifier("reponses", `id=eq.${ligne.id}&fiche=is.null`,
        { fiche: ligne.fiche, prompt_claude: ligne.prompt_claude, maj_le: new Date().toISOString() });
      if (maj === 0) await db.inserer("reponses", ligne, "id");
    }
    return reponse(204);
  }

  return reponse(400, "genre inconnu");
}

// ---------------------------------------------------------------- Validation
export function siteDe(origine, env = {}) {
  if (!origine) return null;
  let u;
  try { u = new URL(origine); } catch { return null; }
  if (u.origin !== origine) return null;
  if (u.protocol === "https:" && u.hostname === DOMAINE) return "prod";
  if (u.protocol === "https:" && /^[a-z0-9-]+\.batiste-masson\.pages\.dev$/.test(u.hostname)) return "apercu";
  if (env.AUTORISER_LOCAL === "1" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return "local";
  return null;
}

// Texte : chaîne, caractères de contrôle et chevrons retirés, espaces réduits, longueur bornée.
export function texte(v, max, multiligne = false) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  let s = v.normalize("NFC").replace(multiligne ? /[\u0000-\u0008\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, " ").replace(/[<>]/g, "");
  s = multiligne ? s.replace(/[ \t]+/g, " ").trim() : s.replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? undefined : s;
}

export function evenement(c, site, visiteur) {
  if (!TYPES.has(c.type)) return null;
  const page = texte(c.page, 200);
  if (!page || !page.startsWith("/") || /[?#\s]/.test(page)) return null;
  const cible = c.cible == null ? null : (/^[a-z0-9-]{1,60}$/.test(c.cible) ? c.cible : undefined);
  const source = c.source == null || c.source === "" ? null : (/^[a-z0-9.:_-]{1,100}$/i.test(c.source) ? c.source.toLowerCase() : undefined);
  const appareil = c.appareil == null ? null : (APPAREILS.has(c.appareil) ? c.appareil : undefined);
  const prospect = texte(c.prospect, 80);
  if ([cible, source, appareil, prospect].includes(undefined)) return null;
  return { site, type: c.type, page, cible, source, appareil, prospect, visiteur };
}

export function reponseQuestionnaire(c, site) {
  if (typeof c.id !== "string" || !UUID.test(c.id)) return null;
  const champs = {
    entreprise: texte(c.entreprise, 120), prenom: texte(c.prenom, 80), email: texte(c.email, 200),
    telephone: texte(c.telephone, 40), metier: texte(c.metier, 120), profil: texte(c.profil, 120),
    prospect: texte(c.prospect, 80),
  };
  if (Object.values(champs).includes(undefined)) return null;
  // Une adresse ou un numéro mal formé n'est pas gardé, mais la réponse l'est (FormSubmit l'a reçue telle quelle).
  if (champs.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(champs.email)) champs.email = null;
  if (champs.telephone && !/^[0-9+ ().-]{4,40}$/.test(champs.telephone)) champs.telephone = null;
  const resume = texte(c.resume, 15000, true), message = texte(c.message, 3000, true);
  const fiche = texte(c.fiche, 20000, true), prompt_claude = texte(c.prompt, 30000, true);
  if ([resume, message, fiche, prompt_claude].includes(undefined)) return null;
  if (c.genre === "fiche" && !fiche) return null;
  if (c.genre === "reponse" && !champs.entreprise) return null;
  const reponses = {};
  if (resume) reponses.resume = resume;
  if (message) reponses.message = message;
  return { id: c.id, site, ...champs, reponses, fiche, prompt_claude };
}

// ---------------------------------------------------------------- Supabase (API REST, sans bibliothèque)
function base(env) {
  const url = env.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/";
  const cle = env.SUPABASE_SECRET_KEY;
  const entetes = { apikey: cle, "Content-Type": "application/json" };
  if (cle.startsWith("eyJ")) entetes.Authorization = "Bearer " + cle; // ancienne clé service_role (JWT)
  const appel = async (chemin, options) => {
    const r = await fetch(url + chemin, { ...options, headers: { ...entetes, ...options.headers } });
    if (!r.ok) throw new Error("supabase " + r.status);
    return r;
  };
  return {
    rpc: async (nom, args) => (await appel("rpc/" + nom, { method: "POST", body: JSON.stringify(args), headers: {} })).json(),
    inserer: (table, ligne, conflit) => appel(table + (conflit ? "?on_conflict=" + conflit : ""), {
      method: "POST", body: JSON.stringify(ligne),
      headers: { Prefer: "return=minimal" + (conflit ? ",resolution=ignore-duplicates" : "") },
    }),
    modifier: async (table, filtre, valeurs) => {
      const r = await appel(table + "?" + filtre, { method: "PATCH", body: JSON.stringify(valeurs), headers: { Prefer: "return=representation" } });
      return (await r.json()).length;
    },
  };
}

let selCache = { jour: "", sel: "" };
async function selDuJour(db) {
  const jour = new Date().toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  if (selCache.jour !== jour) selCache = { jour, sel: await db.rpc("sel_du_jour", {}) };
  return selCache.sel;
}

async function sha256(s) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
