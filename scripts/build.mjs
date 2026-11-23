// Prépare le dossier dist/ publié par Cloudflare Pages (commande de build : node scripts/build.mjs).
// Aucune dépendance : on copie seulement les fichiers du site (pas docs/, assets/, scripts/…),
// on ajoute les liens canoniques, robots.txt et sitemap.xml.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

export const DOMAINE = "https://batiste-masson.pages.dev"; // à changer ici (et dans commun/vers-cloudflare.js) si le nom diffère

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(racine, "dist");
const A_PUBLIER = [
  "index.html", "404.html", "favicon.svg", "_headers", "_redirects",
  "commun", "portfolio-img", "mentions-legales", "questionnaire",
  "couvreur", "restaurant", "coiffeur", "dashboard",
];
const EXCLUS = new Set([".json", ".md", ".mjs"]); // ex. names.json laissés par l'ancien outil

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const nom of A_PUBLIER) {
  const src = join(racine, nom);
  if (!existsSync(src)) continue;
  cpSync(src, join(dist, nom), { recursive: true, filter: (f) => statSync(f).isDirectory() || !EXCLUS.has(extname(f)) });
}

// Lien canonique sur chaque page HTML (sans toucher aux sources).
const pages = [];
(function parcours(dossier) {
  for (const nom of readdirSync(dossier)) {
    const f = join(dossier, nom);
    if (statSync(f).isDirectory()) { parcours(f); continue; }
    if (extname(f) !== ".html" || nom === "404.html") continue;
    let chemin = "/" + relative(dist, f).split("\\").join("/");
    chemin = chemin.replace(/index\.html$/, "");
    let html = readFileSync(f, "utf8");
    if (!html.includes('rel="canonical"')) {
      html = html.replace("</title>", `</title>\n<link rel="canonical" href="${DOMAINE}${chemin}">`);
      writeFileSync(f, html);
    }
    if (!/name="robots" content="noindex"/.test(html)) pages.push(chemin);
  }
})(dist);

writeFileSync(join(dist, "robots.txt"), `User-agent: *\nDisallow: /dashboard/\nDisallow: /api/\n\nSitemap: ${DOMAINE}/sitemap.xml\n`);
writeFileSync(join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  pages.sort().map((p) => `  <url><loc>${DOMAINE}${p}</loc></url>`).join("\n") + `\n</urlset>\n`);

console.log(`dist/ prêt : ${pages.length} pages indexables`, pages);
