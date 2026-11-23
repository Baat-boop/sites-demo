// Tests de l'endpoint /api/collect sans réseau : Supabase est remplacé par une fausse base en mémoire.
// Lancer : node scripts/test-collect.mjs
import { onRequest } from "../functions/api/collect.js";

const env = { SUPABASE_URL: "https://faux.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test" };
let appels = [], jetonOk = true, patchVide = true;
globalThis.fetch = async (url, o = {}) => {
  appels.push({ url: String(url), methode: o.method, corps: o.body, entetes: o.headers });
  const u = String(url);
  if (u.includes("rpc/sel_du_jour")) return new Response(JSON.stringify("sel-de-test"), { status: 200 });
  if (u.includes("rpc/prendre_jeton")) return new Response(JSON.stringify(jetonOk), { status: 200 });
  if (o.method === "PATCH") return new Response(patchVide ? "[]" : '[{"id":1}]', { status: 200 });
  return new Response(null, { status: 201 });
};

const ORIGINE = "https://batiste-masson.pages.dev";
const req = (corps, { origine = ORIGINE, type = "application/json", methode = "POST", ip = "203.0.113.7" } = {}) => {
  const h = { "Content-Type": type, "User-Agent": "test", "CF-Connecting-IP": ip };
  if (origine) h.Origin = origine;
  return new Request("https://batiste-masson.pages.dev/api/collect", { method: methode, headers: h, body: methode === "POST" ? (typeof corps === "string" ? corps : JSON.stringify(corps)) : undefined });
};
const appel = async (r, e = env) => { appels = []; return onRequest({ request: r, env: e }); };
const ev = (x = {}) => ({ genre: "evenement", type: "vue", page: "/couvreur/", appareil: "mobile", source: "google.com", ...x });
const id = "3f2b8c1e-9a4d-4c2b-8e1f-0a1b2c3d4e5f";

let ok = 0, ko = 0;
const verifier = async (nom, promesse, attendu, test) => {
  const r = await promesse;
  const bon = r.status === attendu && (!test || test(r));
  bon ? ok++ : ko++;
  console.log(`${bon ? "OK  " : "ÉCHEC"} ${String(r.status).padEnd(3)} ${nom}`);
};
const inseres = () => appels.filter((a) => a.methode === "POST" && !a.url.includes("rpc/")).map((a) => JSON.parse(a.corps));

console.log("-- Accès");
await verifier("GET refusé", appel(req(null, { methode: "GET" })), 405);
await verifier("sans origine (curl, robot)", appel(req(ev(), { origine: null })), 403);
await verifier("autre site", appel(req(ev(), { origine: "https://pirate.example" })), 403);
await verifier("faux sous-domaine", appel(req(ev(), { origine: "https://batiste-masson.pages.dev.pirate.com" })), 403);
await verifier("http non chiffré", appel(req(ev(), { origine: "http://batiste-masson.pages.dev" })), 403);
await verifier("localhost sans autorisation", appel(req(ev(), { origine: "http://127.0.0.1:8788" })), 403);
await verifier("aperçu refonte accepté", appel(req(ev(), { origine: "https://refonte.batiste-masson.pages.dev" })), 204, () => inseres()[0].site === "apercu");

console.log("-- Format");
await verifier("pas du JSON (text/plain)", appel(req(ev(), { type: "text/plain" })), 415);
await verifier("JSON cassé", appel(req("{pas du json")), 400);
await verifier("corps de 100 Ko", appel(req({ genre: "evenement", x: "a".repeat(100000) })), 413);
await verifier("tableau au lieu d'objet", appel(req([1, 2])), 400);
await verifier("genre inconnu", appel(req({ genre: "admin" })), 400);
await verifier("clé Supabase absente", appel(req(ev()), {}), 503);

console.log("-- Événements");
await verifier("vue valide", appel(req(ev())), 204, () => {
  const l = inseres()[0];
  return l.type === "vue" && l.site === "prod" && /^[0-9a-f]{16}$/.test(l.visiteur) && !JSON.stringify(appels).includes("203.0.113.7");
});
await verifier("type inventé", appel(req(ev({ type: "achat" }))), 400);
await verifier("page avec paramètres", appel(req(ev({ page: "/x?token=1" }))), 400);
await verifier("page sans /", appel(req(ev({ page: "javascript:alert(1)" }))), 400);
await verifier("appareil inventé", appel(req(ev({ appareil: "frigo" }))), 400);
await verifier("cible avec HTML", appel(req(ev({ type: "clic", cible: "<img onerror=alert(1)>" }))), 400);
await verifier("prospect XSS nettoyé", appel(req(ev({ prospect: '<script>alert("x")</script>Boulangerie' }))), 204,
  () => !/[<>]/.test(inseres()[0].prospect));
await verifier("injection SQL stockée comme simple texte", appel(req(ev({ prospect: "'; drop table evenements; --" }))), 204,
  () => inseres()[0].prospect === "'; drop table evenements; --" && !appels.some((a) => a.url.includes("drop")));
await verifier("champ en trop ignoré (pas d'écriture de colonnes interdites)", appel(req(ev({ statut: "signe", visiteur: "0000000000000000", site: "prod" }))), 204,
  () => { const l = inseres()[0]; return !("statut" in l) && l.visiteur !== "0000000000000000"; });

console.log("-- Limite de débit");
jetonOk = false;
await verifier("trop de requêtes → 429", appel(req(ev())), 429, () => inseres().length === 0);
jetonOk = true;

console.log("-- Questionnaire");
const rep = (x = {}) => ({ genre: "reponse", id, entreprise: "Boulangerie Test", prenom: "Léa", email: "lea@exemple.fr",
  telephone: "06 12 34 56 78", metier: "Commerce", profil: "L'équilibré", resume: "PROFIL : …\nRÉPONSES : …", prompt: "Crée le site…", ...x });
await verifier("réponse valide", appel(req(rep())), 204, () => {
  const a = appels.find((x) => x.url.includes("reponses"));
  return a.url.includes("on_conflict=id") && a.entetes.Prefer.includes("ignore-duplicates") && JSON.parse(a.corps).statut === undefined;
});
await verifier("identifiant non UUID", appel(req(rep({ id: "1 or 1=1" }))), 400);
await verifier("entreprise trop longue", appel(req(rep({ entreprise: "x".repeat(500) }))), 400);
await verifier("sans entreprise", appel(req(rep({ entreprise: "" }))), 400);
await verifier("mail invalide → non gardé, réponse gardée", appel(req(rep({ email: "pas-un-mail" }))), 204, () => inseres()[0].email === null);
await verifier("statut forcé par le visiteur ignoré", appel(req(rep({ statut: "signe", note: "pirate" }))), 204,
  () => { const l = inseres()[0]; return !("statut" in l) && !("note" in l); });
patchVide = true;
await verifier("fiche sans réponse existante → création", appel(req({ ...rep(), genre: "fiche", fiche: "Services : …" })), 204,
  () => appels.some((a) => a.methode === "PATCH" && a.url.includes("fiche=is.null")) && inseres().length === 1);
patchVide = false;
await verifier("fiche sur réponse existante → mise à jour seule", appel(req({ ...rep(), genre: "fiche", fiche: "Services : …" })), 204,
  () => inseres().length === 0);
await verifier("fiche vide", appel(req({ ...rep(), genre: "fiche", fiche: "" })), 400);

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
