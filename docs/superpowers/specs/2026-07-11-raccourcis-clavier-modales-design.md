# Raccourcis clavier dans les modales (achat, refus, et modales génériques)

**Date :** 2026-07-11
**Statut :** validé

## Contexte

Un raccourci Espace existe déjà (`src/ui/ui.js`, constructeur de `UI`) : il déclenche
le bouton principal du panneau d'actions (lancer les dés, fin de tour), mais il est
volontairement inactif quand une modale est ouverte. Or l'achat de propriété passe par
une modale (`promptBuy`) : le joueur doit reprendre la souris à chaque acquisition,
alors que la stratégie dominante est d'acheter presque systématiquement.

## Objectif

Permettre de jouer un tour complet au clavier : acheter (ou refuser) une propriété,
valider les cartes Chance/Caisse, choisir en prison, enchérir — sans toucher la souris.

## Décisions

- **Périmètre : toutes les modales** passant par `showModal`, pas seulement l'achat.
- **Touches de refus : R et Échap** (les deux) pour le bouton « Passer » de la modale
  d'achat. Refuser a des conséquences (lance une enchère), d'où une touche dédiée
  plutôt qu'Espace.
- **Mécanisme déclaratif dans `showModal`** (approche retenue face à l'extension de
  l'écouteur global) : la logique vit avec les boutons, chaque future modale en
  profite, les hints affichés découlent de la déclaration.

## Conception

### `showModal`

- Chaque descripteur de bouton accepte une propriété optionnelle `keys` : liste de
  touches (valeurs de `e.key`, ex. `['r', 'Escape']`) qui déclenchent ce bouton.
- Le bouton `cls: 'primary'` reçoit implicitement Espace.
- Un écouteur `keydown` est posé sur `document` à l'ouverture de la modale et retiré
  à sa fermeture (quelle que soit la voie de sortie : bouton ou clic extérieur).
- Les modales `dismissable` se ferment aussi avec Échap (cohérent avec le clic à
  l'extérieur), sauf si Échap est déjà revendiqué par un bouton.

### Garde-fous

- **Délai d'armement ~300 ms** après ouverture : les touches sont ignorées pendant ce
  délai, pour éviter qu'un Espace destiné au panneau d'actions (dés/fin de tour)
  n'achète une propriété par accident.
- Touches ignorées si `e.repeat`, ou si le focus est dans un `input`, `select`,
  `textarea` ou `button` (mêmes gardes que le raccourci global existant — un bouton
  focalisé répond déjà nativement à Espace/Entrée).

### Modale d'achat (`promptBuy`)

- Espace = « Acheter » (bouton primary, implicite).
- R ou Échap = « Passer » (via `keys: ['r', 'Escape']`).
- Les libellés affichent le hint : « Acheter (Espace) », « Passer (R) ».

### Modale d'enchère (`promptAuction`, DOM construit à la main)

- Espace = « Enchérir » à la mise affichée dans le champ, seulement si elle est valide
  (≥ mise minimale, ≤ liquidités) et si le focus n'est pas dans le champ de saisie.
- **Aucun raccourci** pour « Passer (définitif) » : passer est irréversible, on évite
  l'appui réflexe. La souris reste requise pour ce geste.
- Mêmes garde-fous (délai d'armement, `e.repeat`, focus).

### Hors périmètre

- Le raccourci Espace existant du panneau d'actions reste inchangé.
- Pas de configuration des touches par l'utilisateur.
- Pas de raccourcis dans l'écran de configuration de partie ni dans les panneaux de
  gestion/échange.

## Tests

Vérification manuelle du flux complet au clavier (la suite de tests node du projet
couvre le moteur de jeu, pas l'UI DOM ; `npm test` sert de non-régression moteur) :

1. Espace pour lancer les dés → tomber sur une propriété libre → Espace achète.
2. Même flux → R (puis Échap) refuse et l'enchère se lance.
3. Pendant l'enchère : Espace enchérit à la mise affichée ; Espace dans le champ de
   saisie ne déclenche rien ; « Passer » reste souris uniquement.
4. Carte Chance/Caisse : Espace valide « OK ».
5. Fiche de propriété (`showDeed`) : Échap ferme.
6. Espace martelé pendant l'animation des dés ne déclenche pas d'achat accidentel
   (délai d'armement).
