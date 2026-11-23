/* Mesure d'audience sans cookie : rien n'est écrit sur l'appareil du visiteur.
   Envoie à /api/collect : la page vue, le site d'origine, le type d'appareil, le ?n= des liens de prospection,
   les clics sur les éléments [data-suivi] et les étapes du questionnaire.
   Respecte « Global Privacy Control » et « Do Not Track » : dans ce cas, aucun événement n'est envoyé. */
(function () {
  "use strict";
  var h = location.hostname;
  var actif = /(^|\.)batiste-masson\.pages\.dev$/.test(h);
  var refus = navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";

  function poster(corps) {
    if (!actif) return;
    try {
      var b = new Blob([JSON.stringify(corps)], { type: "application/json" });
      if (navigator.sendBeacon && navigator.sendBeacon("/api/collect", b)) return;
      fetch("/api/collect", { method: "POST", body: b, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(function () {});
    } catch (e) { /* la mesure ne doit jamais gêner la page */ }
  }

  var params = new URLSearchParams(location.search);
  var prospect = (params.get("n") || "").slice(0, 80) || null;

  function source() {
    var utm = params.get("utm_source");
    if (utm && /^[a-z0-9._-]{1,60}$/i.test(utm)) return utm;
    try {
      var r = document.referrer ? new URL(document.referrer).hostname : "";
      if (r && r !== h) return r.replace(/^www\./, "");
    } catch (e) {}
    return null;
  }

  function appareil() {
    var l = Math.min(screen.width, screen.height), tactile = matchMedia("(pointer: coarse)").matches;
    if (tactile && l < 600) return "mobile";
    if (tactile && l < 1100) return "tablette";
    return innerWidth < 600 ? "mobile" : "ordinateur";
  }

  function evenement(type, cible) {
    if (refus) return;
    poster({ genre: "evenement", type: type, page: location.pathname.slice(0, 200), cible: cible || null,
      source: source(), appareil: appareil(), prospect: prospect });
  }

  window.mesure = {
    evenement: evenement,
    /* Réponses du questionnaire : envoyées même avec GPC/DNT, car c'est la personne qui les transmet. */
    questionnaire: function (genre, donnees) { donnees.genre = genre; donnees.prospect = prospect; poster(donnees); }
  };

  evenement("vue");
  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("[data-suivi]");
    if (el) evenement("clic", el.getAttribute("data-suivi"));
  });
})();
