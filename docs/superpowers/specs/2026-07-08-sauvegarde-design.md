# Sauvegarde et reprise de partie — Design

**Date** : 2026-07-08
**Statut** : validé par l'utilisateur

## Objectif

Permettre de fermer le jeu à tout moment et, au retour, de choisir entre reprendre la
partie en cours ou en commencer une nouvelle. Sauvegarde automatique, un seul
emplacement (la dernière partie en cours), stockage dans le navigateur.

## Décisions retenues

- **Déclenchement** : automatique, au début de chaque tour. Aucun bouton manuel.
- **Emplacements** : un seul (clé unique dans `localStorage`).
- **Granularité** : frontière de tour. Fermer en plein tour ⇒ on reprend au début de
  ce tour (les dés sont relancés). Compromis assumé pour garder un état toujours
  cohérent (jamais de sauvegarde au milieu d'une animation ou d'un choix).
- **Journal** : non sauvegardé. À la reprise, il repart avec le message
  « 📂 Partie reprise — au tour de X (tour n°N) ».
- **Approches écartées** : rejeu d'événements (fragile aux évolutions du moteur),
  reprise ultra-fine en plein tour (boucle async à rendre sérialisable, gain minime).

## Architecture

### Nouveau module `src/game/storage.js`

Encapsule `localStorage` sous la clé `monopoly3d.save.v1` :

- `saveGame(snapshot)` — écrit le snapshot en JSON. Silencieux en cas d'échec.
- `loadGame()` — retourne le snapshot, ou `null` si absent, corrompu (JSON invalide)
  ou de version différente de la version courante. Nettoie la clé dans ces deux
  derniers cas.
- `clearSave()` — supprime la sauvegarde.

Tout est entouré de try/catch : si `localStorage` est indisponible (navigation
privée…), le jeu fonctionne normalement, simplement sans sauvegarde.

### Sérialisation dans le moteur (`src/game/engine.js`)

- `Game.serialize()` retourne un objet JSON :
  - `version` (numéro de schéma, `1` au départ), `savedAt` (date ISO) ;
  - `turnCount`, `current` (index du joueur dont c'est le tour) ;
  - `players` : pour chaque joueur — `name`, `color`, `isAI`, `money`, `pos`,
    `inJail`, `jailTurns`, `getOutCards`, `bankrupt` ;
  - `tiles` : pour chaque case, uniquement les champs mutables — `owner`, `houses`,
    `mortgaged` (le reste vient toujours de `data.js`), tableau aligné sur `TILES` ;
  - `decks` : état des pioches Chance et Caisse (voir ci-dessous).
- Le constructeur de `Game` accepte un snapshot optionnel : au lieu de créer une
  partie neuve, il restaure joueurs, cases, pioches, `current` et `turnCount`
  (pas de re-mélange, pas de remise à zéro).
- Dans la boucle `run()`, au début de chaque tour, le moteur émet le snapshot via un
  hook (ex. `onAutoSave`) branché par `main.js` sur `storage.saveGame`.
- À la fin de partie (annonce du vainqueur), la sauvegarde est effacée.

### Pioches (`src/game/cards.js`)

`makeDeck()` cache actuellement l'ordre des cartes et le pointeur dans une closure.
Extension :

- le deck expose son état — ordre des cartes sous forme d'**indices** dans le tableau
  source (`CHANCE_CARDS` / `CHEST_CARDS`) et position du pointeur ;
- une fonction de restauration reconstruit un deck à partir de cet état.

Après reprise, les cartes continuent de sortir exactement dans le même ordre.

## Écran d'accueil (`index.html`, `src/main.js`)

Au chargement, si `loadGame()` retourne une sauvegarde valide, un encart
« Partie en cours » apparaît en haut de l'écran de configuration :

- résumé : noms des joueurs avec leurs pastilles de couleur, tour n°X, date de
  sauvegarde ;
- bouton principal **« ▶ Reprendre la partie »** ;
- le formulaire de nouvelle partie reste accessible en dessous (bouton
  « 🎲 Nouvelle partie »). La sauvegarde n'est écrasée qu'au premier tour de la
  nouvelle partie, pas au simple clic.

Sans sauvegarde, l'écran reste identique à aujourd'hui.

## Reprise (`src/main.js`, scène 3D)

`startGame()` accepte soit une config neuve, soit un snapshot. À la reprise :

- création des pions puis téléportation sur leurs cases (`teleportToken`) ; les
  joueurs en faillite n'ont pas de pion ;
- restauration case par case via les méthodes existantes de la scène : `setOwner`,
  `setHouses`, `setMortgaged` ;
- journal réinitialisé avec le message de reprise ;
- la boucle `run()` redémarre au tour du joueur sauvegardé.

## Cas limites

| Cas | Comportement |
|---|---|
| Sauvegarde corrompue ou version incompatible | Ignorée et nettoyée ; accueil normal. |
| `localStorage` indisponible | Le jeu tourne sans sauvegarde, sans erreur visible. |
| Partie terminée | Sauvegarde effacée à l'annonce du vainqueur. |
| Fermeture en plein tour | Reprise au début du tour sauvegardé. |

## Vérification

Pas de framework de tests dans le projet. Vérification en conditions réelles avec le
serveur de dev :

1. jouer plusieurs tours (achats, constructions, hypothèque, passage en prison) ;
2. recharger la page, reprendre : argent, positions, bâtiments 3D, hypothèques et
   ordre des cartes identiques ;
3. « Nouvelle partie » : la nouvelle partie démarre et remplace l'ancienne sauvegarde
   à son premier tour ;
4. finir une partie : plus de proposition de reprise au rechargement.
