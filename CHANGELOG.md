# Journal des modifications

Toutes les évolutions notables de PidiElf sont consignées ici, phase par phase.

## 0.1.0 — en cours

### Phase 0 — Socle
- Projet Vite + React + TypeScript, Tailwind CSS 4 et jetons de couleur en variables CSS.
- Thèmes clair, sombre et automatique ; palette pastel par catégorie ; contraste WCAG AA vérifié par un test.
- Navigation : barre latérale repliable (bureau), onglets bas (mobile), routage par hash.
- Traductions française et anglaise (français par défaut), formats de dates, nombres et tailles.
- PWA : manifeste, service worker (hors ligne), bandeau de mise à jour, invitation à installer, partage entrant, « Ouvrir avec ».
- Workflow GitHub Actions de test, de construction et de publication sur GitHub Pages.

### Phase 1 — Bibliothèque et lecteur
- Bibliothèque locale (IndexedDB) : import (sélecteur, glisser-déposer, partage entrant), grille ou liste, recherche, tri, filtres, favoris, étagères, sélection multiple, doublons signalés, versions dérivées.
- Lecteur, mode Page : rendu virtualisé, défilement continu ou page par page, double page, ajustement, zoom (pincement, double appui sur un paragraphe, molette), rognage des marges, thèmes de papier, voile de luminosité et de chaleur.
- Immersion : appui au centre, zones de bord, balayage, clavier, plein écran, écran maintenu allumé.
- Repères : reprise à la dernière page lue, sommaire, miniatures, marque-pages, curseur de progression, liens cliquables, recherche plein texte.
- PDF protégés : mot de passe demandé à l'ouverture, jamais enregistré.

### Phase 2 — Outils essentiels
- Cadre commun Choisir → Régler → Récupérer, worker de traitement avec progression et annulation.
- Fusionner, Diviser, Organiser les pages, Pivoter, PDF en images, Images en PDF.
- Écran d'export : renommer, télécharger (« Enregistrer sous » sur bureau compatible), partager, ZIP, enregistrer dans la bibliothèque, ouvrir dans le lecteur, enchaîner un autre outil.

### Phase 3 — Annoter et éditer
- Lecteur : surlignage, soulignement, notes, dessin libre ; export en PDF annoté, texte ou Markdown.
- Éditer, Signer, Filigrane, Numéros de page.

### Phase 4 — Outils avancés
- Compresser, Protéger (AES 256 bits), Déverrouiller, OCR (français, anglais), Scanner.

### Phase 5 — Finitions
- Mode Texte recomposé (police, taille, interligne, marges, justification, images replacées dans le fil).
- Sauvegarde et restauration de la bibliothèque en ZIP ; jauge de stockage ; « Tout effacer ».
- Accessibilité : contrôle axe (WCAG 2.1 AA) en clair et en sombre, aide des raccourcis (touche « ? »).
- Tests de parcours sur mobile et bureau pour chaque espace et chaque outil.

### Après la première mise en ligne
- Lecteur : surligneur libre aux couleurs pastel (trait redressé quand il suit une ligne), à côté du dessin.
- Lecteur : historique des annotations — Ctrl+Z annule, Ctrl+Y ou Ctrl+Maj+Z rétablit (ajout, suppression, couleur, note) ; boutons Annuler et Rétablir dans la barre d'annotation et le menu Annoter.
- Mises à jour automatiques : une nouvelle version s'installe et s'applique seule, y compris sur une application déjà installée ; pendant un travail dans un outil, elle attend qu'on en sorte. Recherche d'une nouvelle version au retour dans l'application et toutes les heures.
