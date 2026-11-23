/* Anciennes adresses : sur baat-boop.github.io/sites-demo/…, on renvoie vers la même page sur le nouveau site,
   en gardant le paramètre ?n= des liens envoyés aux prospects. Sans effet sur le nouveau site. */
(function () {
  var NOUVEAU = "https://batiste-masson.pages.dev"; // même valeur que DOMAINE dans scripts/build.mjs
  if (location.hostname !== "baat-boop.github.io") return;
  location.replace(NOUVEAU + location.pathname.replace(/^\/sites-demo/, "") + location.search + location.hash);
})();
