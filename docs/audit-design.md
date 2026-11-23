# Audit du design (phase 1, 2026-11-23)

Portée : portfolio, couvreur, restaurant, coiffeur, questionnaire (version en ligne sur github.io), à 1440 px et 390 px, plus lecture du code.

## Verdict
Les quatre pages sont faites avec le même gabarit (barre de navigation avec méga-menu, grande photo d'en-tête, « section-head » titre + phrase, listes « rows », pied de page sombre avec rappel du bouton, barre d'action collante, une animation au défilement par page). C'est ce gabarit unique, plus que les couleurs, qui donne l'impression « générée » : un couvreur, un bistrot et un coiffeur ont la même structure. À retirer d'abord : les animations de défilement et le méga-menu, puis les détails inventés trop précis (prix à centimes bizarres) et les faux formulaires.

## Constats
| Priorité | Type | Problème | Preuve | Effet | À retirer ou corriger |
|---|---|---|---|---|---|
| P0 | Défaut | Les formulaires des démos ne marchent pas | `couvreur/index.html:184` `action="mailto:devis@haubray.example"`, `restaurant/index.html:199`, boutons `mailto:rdv@ciselle.example` (coiffeur) | Un prospect qui teste « Demander un devis » ouvre sa messagerie vers une adresse fausse : la démo paraît cassée | Formulaire de démo qui affiche « Démo : rien n'est envoyé » au lieu d'ouvrir la messagerie |
| P1 | Défaut | Tarifs du portfolio différents des offres validées | `index.html:146-169` : 400 € + 15 €/mois ; offres validées : 250 / 400 / dès 700 €, suivi 15 / 29 / 59 € | Incohérence avec les devis et l'agent mail | Aligner sur les offres validées |
| P1 | Défaut | Aucune identité ni mention légale sur le portfolio | Pied de page : `© 2026 Batiste Masson` seul ; pas de qui, où, statut | Un artisan ne sait pas à qui il parle ; obligation légale (LCEN) | Bloc « qui je suis » court + page Mentions légales |
| P1 | Défaut | Photo d'en-tête vide plusieurs secondes au chargement | Captures à 3 s : couvreur et restaurant à 390 px, coiffeur à 1440 px montrent un cadre gris vide ; images d'en-tête de 287 à 359 Ko, 167-230vw sur mobile | Première impression ratée sur téléphone, LCP lent | Images plus légères, `sizes` corrigé, couleur de fond proche de la photo. À mesurer avec Lighthouse (phase 5) |
| P2 | Gabarit IA | Même squelette pour trois métiers | Mêmes classes `nav__menu`, `hero__bg`, `section-head`, `rows`, `closing__cta`, `actionbar` dans les 3 démos | Les démos se ressemblent ; rien de propre au métier | Une structure par métier : couvreur = zone + chantiers + devis ; bistrot = ardoise du jour + horaires ; coiffeur = tarifs + rendez-vous |
| P2 | Gabarit IA | Animations de défilement décoratives | `word-highlight` (portfolio : grand vide sous la phrase « Pourquoi un site »), `pinned-chapters` (couvreur, section de 2 écrans sur mobile), `photo-chapters`, `picture-develops` | Ralentit la lecture et le défilement, effet « démo de template » | Supprimer, garder des sections statiques |
| P2 | Gabarit IA | Méga-menu sur une page unique | `couvreur/index.html:79-92` : 4 liens qui pointent tous vers `#travaux` ; `restaurant/index.html:82-100` : 3 cartes photo dans le menu | Menu lourd pour 3 ancres | Liens simples |
| P2 | Faux détails | Prix inventés trop « calculés » | Coiffeur : 38,50 / 24,90 / 44,90 / 16,40 / 15,40 / 58,20 / 18,60 € ; restaurant : 15,80 / 14,20 / 8,40 € | Aucun salon ou bistrot du coin n'affiche ces prix ; ça sonne généré | Prix ronds réalistes (ex. 22 €, 35 €), mention « tarifs indicatifs » |
| P2 | Remplissage | Bandeau de 4 photos d'outils (coiffeur) | `coiffeur/index.html:145-150` : ciseaux, brosse, brosse, ciseaux | Photos interchangeables qui n'apprennent rien | Retirer ou remplacer par une vraie info (avant/après, équipe) |
| P3 | Défaut | Nombre de questions incohérent | Accueil : « Répondez à 13 questions », compteur : « Question 1 sur 14 » | Petite perte de confiance | Compter la dernière étape à part ou dire 14 |

Autres points :
- Le dossier `assets/` pèse 34 Mo (1 594 fichiers) ; les pages n'en utilisent qu'environ 340 Ko de CSS/JS (+ les photos des démos). Le reste (photos 11,8 Mo, objects 6,2 Mo, layout 5 Mo, icons 3,3 Mo, scenes 3 Mo…) est la bibliothèque du skill.
- 340 Ko de CSS/JS génériques chargés sur chaque page, dont la plupart des règles ne servent pas.
- Questionnaire : la structure est bonne (un choix par écran, gros boutons, progression). Il ne lui manque que l'habillage commun au futur site.

## Références retenues
Les galeries (Land-book, Lapa Ninja, One Page Love) proposent surtout des modèles Framer et des sites SaaS ; presque rien pour un artisan ou un commerce de bourg. Retenu :
- **The Devonshire** (pub à Londres, via One Page Love) : identité tirée de l'enseigne (lettrage d'époque, vert profond), menu réduit à Menus / Horaires / FAQ, un seul bouton « Réserver » fixe. → pour le bistrot.
- Principe pour le couvreur et le coiffeur : s'inspirer des vrais signes du métier plutôt que des galeries : devis papier, plaque d'artisan, carte de la zone, liste de tarifs affichée en vitrine.

## Inconnues
- Temps de chargement réel des photos d'en-tête (le navigateur intégré peut ralentir les captures) : à mesurer avec Lighthouse.
- Étapes du questionnaire après la question 1 et envoi : non rejoués (pour ne pas envoyer de faux mail à FormSubmit).
