# Sons du jeu — Design

**Date** : 2026-07-09
**Statut** : validé par l'utilisateur

## Objectif

Donner une identité sonore au jeu, comme un vrai jeu vidéo : bruitages de qualité sur
les moments marquants d'une partie (dés, déplacement, argent, prison, victoire…).
Pas de sons synthétisés au bip : de vrais fichiers audio.

## Décisions retenues

- **Source** : packs audio CC0 de Kenney (kenney.nl) — gratuits, sans attribution
  obligatoire, qualité professionnelle. Packs visés : « Casino Audio » (dés, jetons,
  cartes), « Impact Sounds » (pas du pion), « Music Jingles » (victoire, faillite),
  « RPG Audio » (porte de prison), « Interface Sounds » en complément si besoin.
  Le téléchargement des packs sera soumis à validation (noms, tailles) au moment de
  l'implémentation.
- **Étendue** : kit complet de 10 sons (liste ci-dessous). Pas de musique d'ambiance.
- **Lecture** : Web Audio API nue, sons préchargés et décodés en mémoire
  (`AudioContext` + `AudioBuffer`). Lecture instantanée, superposition possible,
  gain maître pour le mute. Aucune dépendance externe.
  Approches écartées : objets `Audio` (latence, rejeu pénible), Howler.js
  (dépendance injustifiée pour ~60 lignes de Web Audio).
- **Contrôle** : un bouton 🔊/🔇 dans le bandeau du haut, à côté du sélecteur de
  vitesse. Choix persisté dans `localStorage` (clé `monopoly3d.muted`), conservé
  d'une session à l'autre.

## Les 10 sons

| Nom | Événement | Ambiance recherchée |
|---|---|---|
| `dice` | Lancer de dés | Dés qui roulent sur la table |
| `hop` | Chaque case traversée par le pion | Petit « toc » discret (volume bas) |
| `buy` | Achat d'une propriété | Jetons posés / caisse |
| `pay` | Argent qui sort (loyer, taxe, amende, réparations) | Pièces / jeton qui tombe |
| `cash` | Argent qui rentre (case Départ, cartes gain) | Pièces encaissées, positif |
| `card` | Carte Chance / Caisse retournée | Carte qui glisse |
| `jail` | Envoi en prison | Porte / verrou qui claque |
| `build` | Construction maison ou hôtel (pas la revente) | Petit impact bois |
| `bankrupt` | Faillite d'un joueur | Jingle descendant |
| `win` | Annonce du vainqueur | Fanfare de victoire |

## Architecture

### Fichiers audio — `public/sounds/`

- ~10 fichiers `.ogg` courts (format lu par Chrome, Edge, Firefox ; Safari n'existe
  plus sur Windows — limite assumée), total < 1 Mo, committés dans le dépôt.
- `public/sounds/CREDITS.md` : crédit Kenney (kenney.nl), licence CC0, liste des
  packs d'origine.

### Nouveau module `src/ui/sound.js`

Trois fonctions publiques ; **rien ne s'instancie au chargement du module** (pas
d'`AudioContext` au top-level), pour qu'il reste importable dans les tests Node.

- `initSounds()` — appelée au clic « Lancer la partie » / « Reprendre la partie »
  (le geste utilisateur qui autorise l'audio dans les navigateurs). Crée
  l'`AudioContext` et le gain maître, charge et décode les 10 fichiers en parallèle
  (`fetch` + `decodeAudioData`). Un fichier qui échoue est ignoré : le jeu tourne
  sans ce son. Tout est en try/catch silencieux (même philosophie que `storage.js`).
- `playSound(nom)` — joue le buffer via un `BufferSource` → gain du son → gain
  maître. Chaque son a un volume propre (table interne : `hop` discret, `win` plus
  présent). No-op si le son n'est pas chargé, si l'audio est coupé ou indisponible.
  Appelle `resume()` sur le contexte s'il est suspendu.
- `toggleMute()` — bascule le gain maître entre 0 et 1, persiste le choix dans
  `localStorage` sous `monopoly3d.muted` ; l'état initial est lu à `initSounds()`.

### Branchement des sons

**Via les hooks de vue existants dans `main.js`** (aucune modification du moteur) :

- `dice` → wrapper `view.showDice`, avant l'animation des dés ;
- `card` → wrapper `view.showCard` ;
- `bankrupt` → wrapper `view.onBankruptcy` ;
- `win` → wrapper `view.announceWinner` (avant l'écran de victoire).

**Via un nouveau hook optionnel `view.sfx` émis par le moteur** (`engine.js`),
appelé `this.view.sfx?.(nom)` aux moments sémantiques — l'opérateur `?.` garantit
que les vues et stubs existants continuent de fonctionner sans changement :

- `buy` → dans l'achat de propriété ;
- `pay` → à chaque sortie d'argent effective (loyer, taxe, amende, réparations) ;
- `cash` → à chaque gain (salaire de la case Départ, cartes qui rapportent) ;
- `jail` → à l'envoi en prison ;
- `build` → à la construction d'une maison/hôtel (pas à la revente).

`main.js` mappe simplement `sfx: (nom) => playSound(nom)`.

**Via un nouveau hook de scène `scene.onHop`** (même pattern que l'actuel
`scene.onTileClick`) : `hopToken()` appelle `this.onHop?.()` à chaque saut de case ;
`main.js` branche `scene.onHop = () => playSound('hop')`.

### Interface (`index.html`, `src/ui/styles.css`)

Bouton `#mute-btn` dans le bandeau du haut, à côté de `#speed`. Icône 🔊 ou 🔇 selon
l'état, mise à jour au clic.

## Cas limites

| Cas | Comportement |
|---|---|
| Autoplay bloqué par le navigateur | Contexte créé après un clic utilisateur ; `resume()` de secours au premier `playSound`. |
| Fichier audio manquant / réseau en échec | Son ignoré silencieusement, jeu normal. |
| `localStorage` indisponible | Mute non persisté, mais fonctionnel pendant la session. |
| Sons rapprochés (vitesse ×3, `hop` en rafale) | Web Audio superpose sans coupure ; volume du `hop` bas pour rester discret. |
| Sauvegarde/reprise | Aucun impact : le mute est une préférence globale, pas un état de partie ; rien n'entre dans le snapshot (pas de bump de VERSION). |

## Vérification

- `npm test` : un test Node vérifie que le moteur émet les bons `sfx` sur un
  scénario contrôlé (achat → `buy`, loyer → `pay`, prison → `jail`…) via une vue
  enregistreuse, et que la persistance du mute fonctionne (localStorage factice).
- Dans le navigateur (serveur de dev) : écoute réelle — dés, pas du pion, achat,
  loyer, carte, prison, construction, faillite, victoire ; bouton mute (effet
  immédiat + persistance après rechargement).
