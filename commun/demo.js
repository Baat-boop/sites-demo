/* Petits comportements communs aux démos.
   1. Formulaires [data-demo] : vérifiés comme un vrai formulaire, mais rien n'est envoyé.
   2. [data-horaires] : affiche « Ouvert maintenant » ou la prochaine ouverture, à l'heure de Paris. */
(() => {
  "use strict";

  document.querySelectorAll("form[data-demo]").forEach((form) => {
    form.noValidate = true;
    const retour = form.querySelector(".retour-demo");
    form.addEventListener("input", (e) => {
      const champ = e.target;
      if (champ.getAttribute("aria-invalid") === "true" && champ.checkValidity()) montrer(champ, "");
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      let premier = null;
      form.querySelectorAll("input, textarea, select").forEach((champ) => {
        if (champ.checkValidity()) { montrer(champ, ""); return; }
        montrer(champ, champ.dataset.erreur || "Ce champ est à remplir.");
        premier = premier || champ;
      });
      if (premier) { premier.focus(); if (retour) retour.hidden = true; return; }
      form.reset();
      if (retour) { retour.hidden = false; retour.focus(); }
    });
  });

  function montrer(champ, message) {
    const id = champ.id + "-erreur";
    let el = document.getElementById(id);
    if (!message) { champ.removeAttribute("aria-invalid"); if (el) el.remove(); return; }
    champ.setAttribute("aria-invalid", "true");
    if (!el) {
      el = document.createElement("p");
      el.className = "erreur"; el.id = id;
      champ.insertAdjacentElement("afterend", el);
      champ.setAttribute("aria-describedby", ((champ.getAttribute("aria-describedby") || "") + " " + id).trim());
    }
    el.textContent = message;
  }

  /* Horaires : data-horaires='{"2":[["12:00","14:00"],["19:00","21:30"]], ...}' (0 = dimanche) */
  const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  document.querySelectorAll("[data-horaires]").forEach((el) => {
    let h; try { h = JSON.parse(el.dataset.horaires); } catch { return; }
    const p = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
    const jour = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."].indexOf(p.weekday);
    if (jour < 0) return;
    const maintenant = p.hour + ":" + p.minute;
    const lisible = (t) => t.replace(/^0/, "").replace(":00", " h").replace(":", " h ");
    const creneau = (h[jour] || []).find(([a, b]) => maintenant >= a && maintenant < b);
    if (creneau) { el.textContent = "Ouvert maintenant, jusqu'à " + lisible(creneau[1]); el.dataset.etat = "ouvert"; return; }
    for (let k = 0; k < 8; k++) {
      const j = (jour + k) % 7;
      const suivant = (h[j] || []).find(([a]) => k > 0 || a > maintenant);
      if (suivant) {
        const quand = k === 0 ? "aujourd'hui" : k === 1 ? "demain" : JOURS[j];
        el.textContent = "Fermé pour le moment, ouvre " + quand + " à " + lisible(suivant[0]);
        el.dataset.etat = "ferme";
        return;
      }
    }
  });
})();
