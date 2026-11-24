/* Tableau de bord privé. Connexion par lien magique Supabase (sans bibliothèque), puis lecture des tables
   protégées par la RLS : seul un compte de public.admins voit quelque chose.
   Toutes les données sont insérées avec textContent (jamais innerHTML) : un texte piégé reste du texte. */
(() => {
  "use strict";
  const SUPA = "https://adlswvqcxltxxubxztnp.supabase.co";
  const CLE_PUBLIQUE = "sb_publishable_J8MAc47oDxw8gi2vy51mIw_kSIswdei"; // clé publique, faite pour le navigateur
  const SESSION = "tableau-session";
  const STATUTS = { nouveau: "Nouveau", contacte: "Contacté", devis: "Devis envoyé", signe: "Signé", perdu: "Perdu" };
  const DEMOS = { "/couvreur/": "Couvreur", "/restaurant/": "Bistrot", "/coiffeur/": "Salon de coiffure" };

  const $ = (s) => document.querySelector(s);
  const etat = (t) => { $("#etat").textContent = t; };
  function el(tag, props = {}, ...enfants) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === "texte") e.textContent = v;
      else if (k === "classe") e.className = v;
      else if (k.startsWith("au")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of enfants) if (c != null && c !== false) e.append(c);
    return e;
  }

  // ------------------------------------------------------------------ Session
  const lire = () => { try { return JSON.parse(sessionStorage.getItem(SESSION) || "null"); } catch { return null; } };
  const garder = (s) => { try { sessionStorage.setItem(SESSION, JSON.stringify(s)); } catch {} };
  const oublier = () => { try { sessionStorage.removeItem(SESSION); } catch {} };

  // Connexion PKCE : le lien du mail revient avec ?code=…, échangé contre une session grâce au vérificateur
  // gardé dans ce navigateur (localStorage, une heure au plus, effacé après usage). Le code seul ne sert à rien.
  const PKCE = "tableau-pkce";
  const b64url = (o) => btoa(String.fromCharCode(...new Uint8Array(o))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  async function nouveauPkce() {
    const verificateur = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const defi = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificateur)));
    try { localStorage.setItem(PKCE, JSON.stringify({ v: verificateur, t: Date.now() })); } catch {}
    return defi;
  }
  async function depuisCode() {
    const p = new URLSearchParams(location.search);
    const code = p.get("code"), erreurLien = p.get("error_description") || p.get("error");
    if (!code && !erreurLien) return null;
    history.replaceState(null, "", location.pathname); // retire le code de la barre d'adresse
    let gard = null;
    try { gard = JSON.parse(localStorage.getItem(PKCE) || "null"); localStorage.removeItem(PKCE); } catch {}
    if (erreurLien || !gard || Date.now() - gard.t > 3600000) {
      $("#message-connexion").textContent = "Ce lien n'est plus valable, ou il a été ouvert dans un autre navigateur. Demandez-en un nouveau ici.";
      return null;
    }
    const r = await fetch(SUPA + "/auth/v1/token?grant_type=pkce", {
      method: "POST", headers: { apikey: CLE_PUBLIQUE, "Content-Type": "application/json" },
      body: JSON.stringify({ auth_code: code, code_verifier: gard.v }),
    });
    if (!r.ok) { $("#message-connexion").textContent = "Ce lien n'est plus valable. Demandez-en un nouveau."; return null; }
    const j = await r.json();
    const s = { access_token: j.access_token, refresh_token: j.refresh_token, expire: Date.now() + j.expires_in * 1000 };
    garder(s);
    return s;
  }

  function depuisLien() {
    if (!location.hash.includes("access_token") && !location.hash.includes("error")) return null;
    const p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname); // retire les jetons de la barre d'adresse
    if (p.get("error")) { $("#message-connexion").textContent = "Le lien n'est plus valable. Demandez-en un nouveau."; return null; }
    const s = { access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), expire: Date.now() + Number(p.get("expires_in") || 3600) * 1000 };
    garder(s);
    return s;
  }

  async function session() {
    let s = lire();
    if (!s) return null;
    if (Date.now() > s.expire - 60000) {
      const r = await fetch(SUPA + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST", headers: { apikey: CLE_PUBLIQUE, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      });
      if (!r.ok) { oublier(); return null; }
      const j = await r.json();
      s = { access_token: j.access_token, refresh_token: j.refresh_token, expire: Date.now() + j.expires_in * 1000 };
      garder(s);
    }
    return s;
  }

  async function api(chemin, options = {}) {
    const s = await session();
    if (!s) throw new Error("session");
    const r = await fetch(SUPA + "/rest/v1/" + chemin, {
      ...options,
      headers: { apikey: CLE_PUBLIQUE, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json", ...(options.headers || {}) },
    });
    if (r.status === 401) { oublier(); throw new Error("session"); }
    if (!r.ok) throw new Error("erreur " + r.status);
    return r;
  }

  // ------------------------------------------------------------------ Connexion
  function afficherConnexion() {
    $("#connexion").hidden = false; $("#donnees").hidden = true; $("#actions").hidden = true; etat("");
  }
  $("#form-connexion").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim().toLowerCase();
    const msg = $("#message-connexion");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = "Écrivez une adresse mail complète."; return; }
    const bouton = e.submitter; bouton.disabled = true;
    try {
      const defi = await nouveauPkce();
      await fetch(SUPA + "/auth/v1/otp?redirect_to=" + encodeURIComponent(location.origin + "/dashboard/"), {
        method: "POST", headers: { apikey: CLE_PUBLIQUE, "Content-Type": "application/json" },
        body: JSON.stringify({ email, create_user: false, code_challenge: defi, code_challenge_method: "s256" }),
      });
    } catch {}
    // Même message dans tous les cas : on ne révèle pas si l'adresse est autorisée.
    msg.textContent = "Si cette adresse est autorisée, un lien vient d'être envoyé. Ouvrez-le dans ce navigateur.";
    setTimeout(() => { bouton.disabled = false; }, 30000);
  });
  $("#deconnexion").addEventListener("click", async () => {
    const s = lire();
    if (s) fetch(SUPA + "/auth/v1/logout", { method: "POST", headers: { apikey: CLE_PUBLIQUE, Authorization: "Bearer " + s.access_token } }).catch(() => {});
    oublier(); afficherConnexion();
  });

  // ------------------------------------------------------------------ Chargement des données
  let reponsesCache = [];
  async function charger() {
    etat("Chargement…");
    const admin = await (await api("rpc/est_admin", { method: "POST", body: "{}" })).json();
    if (admin !== true) { oublier(); afficherConnexion(); $("#message-connexion").textContent = "Ce compte n'a pas accès au tableau de bord."; return; }
    $("#connexion").hidden = true; $("#actions").hidden = false;

    const jours = Number($("#periode").value), site = $("#site").value;
    const depuis = new Date(Date.now() - jours * 86400000).toISOString();
    const evenements = [];
    for (let debut = 0; debut < 50000; debut += 1000) {
      const r = await api(`evenements?select=cree_le,type,page,cible,source,appareil,prospect,visiteur&site=eq.${site}&cree_le=gte.${encodeURIComponent(depuis)}&order=id.asc`,
        { headers: { Range: `${debut}-${debut + 999}` } });
      const lot = await r.json(); evenements.push(...lot);
      if (lot.length < 1000) break;
    }
    reponsesCache = await (await api(`reponses?select=*&site=eq.${site}&order=cree_le.desc`)).json();
    const reponsesPeriode = reponsesCache.filter((x) => x.cree_le >= depuis);
    afficher(evenements, reponsesPeriode, jours);
    afficherReponses(reponsesCache);
    $("#donnees").hidden = false; etat("");
  }

  const jourParis = (iso) => new Date(iso).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  const compter = (liste, cle) => { const m = new Map(); for (const x of liste) { const k = cle(x); m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
  const nombre = (n) => n.toLocaleString("fr-FR");

  function afficher(ev, reponses, jours) {
    const vues = ev.filter((x) => x.type === "vue");
    const visiteurs = new Set(vues.map((x) => jourParis(x.cree_le) + x.visiteur)).size;
    const clicsQ = ev.filter((x) => x.type === "clic" && x.cible === "questionnaire").length;
    const debuts = ev.filter((x) => x.type === "questionnaire_debut").length;
    const fiches = reponses.filter((x) => x.fiche).length;

    const chiffres = $("#chiffres"); chiffres.replaceChildren();
    for (const [n, l] of [[vues.length, "pages vues"], [visiteurs, "visiteurs (par jour)"], [clicsQ, "clics vers le questionnaire"], [reponses.length, "questionnaires reçus"], [fiches, "fiches détaillées"]])
      chiffres.append(el("li", {}, el("b", { texte: nombre(n) }), el("span", { texte: l })));

    // Entonnoir
    const ent = $("#entonnoir"); ent.replaceChildren();
    const pc = (a, b) => (b ? " (" + Math.round((a / b) * 100) + " %)" : "");
    for (const [n, l] of [[clicsQ, "clics vers le questionnaire"], [debuts, "questionnaires commencés"], [reponses.length, "envoyés" + pc(reponses.length, debuts)], [fiches, "fiches remplies" + pc(fiches, reponses.length)]])
      ent.append(el("li", {}, el("b", { texte: nombre(n) }), el("span", { texte: l })));

    graphique(vues, jours);
    tableau("#t-pages", ["Page", "Vues"], compter(vues, (x) => x.page).slice(0, 15));
    tableau("#t-sources", ["Provenance", "Vues"], compter(vues, (x) => x.source || "Accès direct ou inconnu").slice(0, 15));
    tableau("#t-appareils", ["Appareil", "Vues"], compter(vues, (x) => x.appareil || "Inconnu"));
    const demos = Object.entries(DEMOS).map(([p, nom]) => [nom, vues.filter((x) => x.page === p).length, ev.filter((x) => x.type === "clic" && x.cible === "demo-" + p.slice(1, -1)).length]).sort((a, b) => b[1] - a[1]);
    tableau("#t-demos", ["Démo", "Vues", "Clics depuis l'accueil"], demos);

    const pros = new Map();
    for (const x of ev) {
      if (!x.prospect) continue;
      const p = pros.get(x.prospect) || { vues: 0, pages: new Set(), dernier: "" };
      if (x.type === "vue") { p.vues++; p.pages.add(x.page); }
      if (x.cree_le > p.dernier) p.dernier = x.cree_le;
      pros.set(x.prospect, p);
    }
    const repondu = new Set(reponsesCache.map((r) => r.prospect).filter(Boolean));
    tableau("#t-prospects", ["Prospect", "Pages vues", "Pages", "Dernière visite", "A répondu"],
      [...pros].sort((a, b) => (a[1].dernier < b[1].dernier ? 1 : -1)).map(([nom, p]) => [nom, p.vues, [...p.pages].join(", "), new Date(p.dernier).toLocaleString("fr-FR"), repondu.has(nom) ? "Oui" : "—"]));
  }

  function tableau(sel, titres, lignes) {
    const t = $(sel); t.replaceChildren();
    t.append(el("thead", {}, el("tr", {}, ...titres.map((x, i) => el("th", { texte: x, classe: i && typeof lignes[0]?.[i] === "number" ? "n" : null, scope: "col" })))));
    const corps = el("tbody");
    if (!lignes.length) corps.append(el("tr", {}, el("td", { texte: "Rien sur cette période.", classe: "vide", colspan: String(titres.length) })));
    const max = Math.max(1, ...lignes.map((l) => (typeof l[1] === "number" ? l[1] : 0)));
    for (const l of lignes) {
      corps.append(el("tr", {}, ...l.map((v, i) => {
        const td = el("td", { texte: typeof v === "number" ? nombre(v) : String(v), classe: typeof v === "number" ? "n" : null });
        if (i === 0 && typeof l[1] === "number") td.append(el("span", { classe: "part", style: `width:${Math.round((l[1] / max) * 100)}%` }));
        return td;
      })));
    }
    t.append(corps);
  }

  function graphique(vues, jours) {
    const ns = "http://www.w3.org/2000/svg", L = 900, H = 220, n = Math.min(jours, 90);
    const parJour = new Map(compter(vues, (x) => jourParis(x.cree_le)));
    const dates = [...Array(n)].map((_, i) => jourParis(new Date(Date.now() - (n - 1 - i) * 86400000).toISOString()));
    const valeurs = dates.map((d) => parJour.get(d) || 0), max = Math.max(1, ...valeurs);
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${L} ${H}`); svg.setAttribute("role", "img"); svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-label", `Pages vues par jour sur ${n} jours, maximum ${max} par jour, total ${valeurs.reduce((a, b) => a + b, 0)}.`);
    const w = L / n;
    valeurs.forEach((v, i) => {
      const h = Math.round((v / max) * (H - 30)), r = document.createElementNS(ns, "rect");
      r.setAttribute("x", (i * w + 1).toFixed(1)); r.setAttribute("y", String(H - 20 - h)); r.setAttribute("width", Math.max(1, w - 2).toFixed(1)); r.setAttribute("height", String(h)); r.setAttribute("fill", "#c9876d");
      const titre = document.createElementNS(ns, "title"); titre.textContent = `${dates[i]} : ${v} vue${v > 1 ? "s" : ""}`; r.append(titre);
      svg.append(r);
    });
    for (const i of [0, n - 1]) {
      const t = document.createElementNS(ns, "text"); t.setAttribute("x", i ? String(L) : "0"); t.setAttribute("y", String(H - 4)); t.setAttribute("text-anchor", i ? "end" : "start"); t.setAttribute("class", "axe"); t.textContent = dates[i]; svg.append(t);
    }
    const t = document.createElementNS(ns, "text"); t.setAttribute("x", "0"); t.setAttribute("y", "12"); t.setAttribute("class", "axe"); t.textContent = `max ${max}`; svg.append(t);
    $("#graphique").replaceChildren(svg);
  }

  // ------------------------------------------------------------------ Réponses
  function afficherReponses(liste) {
    const zone = $("#reponses"); zone.replaceChildren();
    if (!liste.length) { zone.append(el("p", { texte: "Aucune réponse pour l'instant.", classe: "etat" })); return; }
    for (const r of liste) {
      const date = new Date(r.cree_le).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
      const pastille = el("span", { classe: "statut", "data-statut": r.statut, texte: STATUTS[r.statut] || r.statut });
      const infos = el("dl");
      const ligne = (t, v) => { if (v) infos.append(el("dt", { texte: t }), el("dd", {}, v)); };
      ligne("Prénom", r.prenom);
      ligne("Mail", r.email ? el("a", { href: "mailto:" + r.email, texte: r.email }) : null);
      ligne("Téléphone", r.telephone);
      ligne("Métier", r.metier); ligne("Profil", r.profil); ligne("Lien prospect", r.prospect);
      ligne("Message", r.reponses?.message);

      const choix = el("select", { "aria-label": "Statut" }, ...Object.entries(STATUTS).map(([k, l]) => { const o = el("option", { value: k, texte: l }); if (k === r.statut) o.selected = true; return o; }));
      const note = el("textarea", { "aria-label": "Note", maxlength: "2000", placeholder: "Note (relance, devis…)" }); note.value = r.note || "";
      const retour = el("span", { role: "status", classe: "note" });
      const enregistrer = el("button", { type: "button", classe: "bouton bouton--petit", texte: "Enregistrer", auclick: async () => {
        try {
          await api(`reponses?id=eq.${r.id}`, { method: "PATCH", body: JSON.stringify({ statut: choix.value, note: note.value.slice(0, 2000) || null, maj_le: new Date().toISOString() }), headers: { Prefer: "return=minimal" } });
          r.statut = choix.value; r.note = note.value; pastille.dataset.statut = r.statut; pastille.textContent = STATUTS[r.statut]; retour.textContent = "Enregistré.";
        } catch { retour.textContent = "Échec de l'enregistrement."; }
      } });
      const copier = el("button", { type: "button", classe: "bouton bouton--petit bouton--clair", texte: "Copier le prompt Claude", auclick: async () => {
        try { await navigator.clipboard.writeText(r.prompt_claude || ""); retour.textContent = "Prompt copié."; } catch { retour.textContent = "Copie impossible : sélectionnez le texte ci-dessous."; }
      } });

      const corps = el("div", { classe: "reponse__corps" }, infos,
        el("div", { classe: "suivi" }, el("label", {}, "Statut ", choix), el("label", {}, "Note", note), enregistrer),
        el("div", { classe: "actions-reponse" }, copier, retour),
        r.reponses?.resume ? el("details", {}, el("summary", { texte: "Réponses et profil" }), el("pre", { texte: r.reponses.resume })) : null,
        r.fiche ? el("details", {}, el("summary", { texte: "Fiche détaillée" }), el("pre", { texte: r.fiche })) : null,
        r.prompt_claude ? el("details", {}, el("summary", { texte: "Prompt Claude" }), el("pre", { texte: r.prompt_claude })) : null);

      zone.append(el("details", { classe: "reponse" },
        el("summary", {}, el("b", { texte: r.entreprise || "(sans nom)" }), pastille, el("span", { texte: `${date} · ${r.metier || "métier ?"}${r.fiche ? " · fiche remplie" : ""}` })),
        corps));
    }
  }

  // Export CSV (les cellules qui commencent par = + - @ sont neutralisées pour Excel).
  $("#export").addEventListener("click", () => {
    const col = ["cree_le", "entreprise", "prenom", "email", "telephone", "metier", "profil", "prospect", "statut", "note"];
    const cellule = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const csv = "﻿" + [col.join(";"), ...reponsesCache.map((r) => col.map((c) => cellule(r[c])).join(";"))].join("\r\n");
    const a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: "reponses-" + new Date().toISOString().slice(0, 10) + ".csv" });
    document.body.append(a); a.click(); a.remove();
  });

  for (const id of ["#periode", "#site"]) $(id).addEventListener("change", () => charger().catch(erreur));
  function erreur(e) { if (e && e.message === "session") afficherConnexion(); else etat("Impossible de charger les données. Réessayez dans un instant."); }

  // ------------------------------------------------------------------ Démarrage
  (async () => {
    depuisLien();
    await depuisCode().catch(() => null);
    if (!lire()) afficherConnexion(); else charger().catch(erreur);
  })();
})();
