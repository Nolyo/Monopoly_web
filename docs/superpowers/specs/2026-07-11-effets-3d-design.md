# Effets visuels 3D — Design

**Date** : 2026-07-11
**Statut** : validé par l'utilisateur

## Objectif

Rendre les moments forts d'une partie lisibles d'un coup d'œil dans la scène 3D,
sans dépendre du journal : quand un joueur paie un loyer, on doit *voir* l'argent
partir vers le propriétaire. Autour de cet effet star, un kit complet d'effets
« juicy » : achat, construction, prison, faillite, doubles, victoire.

## Décisions retenues

- **Approche** : effets dans la scène Three.js uniquement (nouveau module
  `src/3d/effects.js`), animés par le moteur de tweens existant de `Board3D`
  (`board.tween()`), donc respectant automatiquement le réglage de vitesse ⚡ du
  HUD. Aucune dépendance nouvelle.
  Approches écartées : post-processing bloom (coût GPU, change le rendu global —
  les lueurs se font via matériaux émissifs) ; effets 2D DOM (pas vraiment « 3D »).
- **Branchement moteur** : un seul hook structuré `view.fx?.(type, data)`,
  optionnel et **fire-and-forget** (jamais awaité par le moteur : le rythme du jeu
  ne change pas, l'animation se joue par-dessus). Même philosophie que `sfx`.
  Exception : l'effet de faillite est joué (et attendu) par la vue dans
  `onBankruptcy`, car il remplace la disparition sèche du pion.
- **Performance** : géométries et matériaux partagés au niveau module, textures
  canvas des textes flottants libérées après usage (`dispose()`), quantités
  plafonnées (≤ 10 pièces par transfert, ~150 confettis).
- **Travail sur branche dédiée** `feature/effets-3d` (choix utilisateur).

## Les effets

| Événement | Effet |
|---|---|
| Paiement à un joueur (loyer, anniversaire) | ~8 pièces d'or en arcs étagés du pion payeur vers le pion bénéficiaire + textes flottants « −X € » rouge au-dessus du payeur, « +X € » vert au-dessus du bénéficiaire |
| Paiement à la banque (taxe, amende, réparations) | Mêmes pièces, mais elles plongent vers le centre du plateau et s'y enfoncent + « −X € » rouge |
| Gain (salaire Départ, cartes) | Gerbe de pièces jaillissant au-dessus du pion + « +X € » doré |
| Échange avec argent | Pièces entre les deux pions (pour chaque flux d'argent non nul) |
| Achat / enchère gagnée | Onde circulaire de la couleur du joueur qui se propage sur la case + apparition « pop » rebondissante du marqueur propriétaire |
| Construction | La maison/l'hôtel qui vient d'être posé tombe du ciel avec un rebond + bouffée de poussière |
| Envoi en prison | Flash gyrophare rouge/bleu sur la case prison + barres qui tombent devant le pion puis s'estompent |
| Faillite | Le pion s'enfonce dans le plateau en tournant sur lui-même + fumée grise, avant la modale « Faillite ! » |
| Doubles | Étincelles dorées sur les deux dés |
| Victoire | Pluie de ~150 confettis 3D colorés sur le plateau, lancée ~1 s avant la modale de victoire |

Textes flottants : `THREE.Sprite` à texture canvas (gros chiffres avec contour,
lisibles de loin), montée + fondu en ~1,2 s, orientés caméra (comportement natif
des sprites).

## Architecture

### Nouveau module `src/3d/effects.js`

Classe `Effects` construite avec le `Board3D` (`new Effects(board)`), qui utilise
`board.scene`, `board.tween()`, `board.tokens`, `tileCenter()`. Méthodes (toutes
retournent des promesses mais sont appelables fire-and-forget) :

- `moneyTransfer(fromPos, toPos, amount)` — pièces en arc + les deux textes ;
- `bankPayment(fromPos, amount)` — variante vers le centre du plateau ;
- `gainBurst(pos, amount)` — gerbe + texte doré ;
- `floatingText(pos, text, color)` — brique commune des textes ;
- `purchase(idx, colorHex)` — onde sur la case + pop du marqueur (rejoue un
  scale-bounce sur le mesh déjà posé par `setOwner`) ;
- `buildDrop(idx)` — anime le groupe déjà posé par `setHouses` (chute + rebond
  + poussière) ;
- `jailFlash(playerIdx)` — gyrophare + barres devant le pion ;
- `bankruptcy(playerIdx)` — enfoncement + fumée (awaité par la vue) ;
- `diceSparkles()` — étincelles aux positions des dés ;
- `confetti()` — pluie sur le plateau.

Les positions des pions sont lues en direct dans `board.tokens[id].position`
(robuste même si un pion est en cours d'animation).

### Émissions moteur (`engine.js`)

`this.view.fx?.(type, data)` aux moments sémantiques, en miroir des `sfx`
existants :

- `fx('pay', { fromId, toId, amount })` dans `charge()`, uniquement quand le
  paiement aboutit (`toId: null` = banque). Jamais émis si le joueur fait
  faillite à la place ;
- `fx('gain', { playerId, amount })` au salaire de la case Départ et aux cartes
  qui rapportent ;
- `fx('buy', { playerId, idx })` à l'achat direct et à l'enchère remportée ;
- `fx('build', { idx })` après `setHouses` dans `build()` ;
- `fx('jail', { playerId })` dans `sendToJail()`, **après** le `teleportToken`
  awaité (les barres tombent quand le pion est arrivé sur la case, pas avant) ;
- `fx('pay', …)` aussi dans `executeTrade()` pour chaque flux d'argent non nul
  (giveMoney : from→to, takeMoney : to→from).

### Câblage (`main.js`)

- `view.fx: (type, data) => …` : dispatch vers les méthodes d'`Effects` (résolution
  des positions via `scene.tokens`) ;
- doubles : dans `view.showDice`, si `d1 === d2`, `effects.diceSparkles()` après
  `scene.rollDice` ;
- faillite : dans `view.onBankruptcy`, `await effects.bankruptcy(p.id)` **avant**
  `scene.removeToken(p.id)` et la modale ;
- victoire : dans `view.announceWinner`, lancer `effects.confetti()` puis ~1 s de
  délai avant la modale.

### `scene.js`

Instancie `Effects` et l'expose (`this.effects`). Aucune autre modification :
`setOwner`/`setHouses` restent instantanés — les animations d'apparition sont
rejouées par-dessus via `fx`, ce qui garantit qu'**une reprise de sauvegarde
replace tout sans le moindre effet parasite** (aucun `fx` n'est émis à la
restauration).

## Cas limites

| Cas | Comportement |
|---|---|
| Reprise de sauvegarde | `setOwner`/`setHouses` instantanés, aucun `fx` émis → aucun pop/chute parasite. |
| Faillite pendant un paiement | Pas de `fx('pay')` (le paiement n'aboutit pas) ; l'effet faillite est joué par `onBankruptcy`. |
| Anniversaire multi-payeurs | Plusieurs `fx('pay')` rapprochés : effets superposés sans conflit (matériaux partagés, instances indépendantes). |
| Bénéficiaire en faillite (pion retiré) | Garde dans le câblage : si un pion n'existe plus, l'effet est ignoré silencieusement. |
| Vitesse ×3 | Toutes les durées passent par `board.tween()` → divisées par `speed`, comme le reste. |
| Vue factice des tests moteur | Hook optionnel `?.` : les stubs existants fonctionnent sans changement. |

## Vérification

- `npm test` + nouveau `tests/fx.test.mjs` (Node pur, vue enregistreuse Proxy,
  comme `sound.test.mjs`) : le moteur émet les bons `fx` sur un scénario contrôlé —
  loyer (`pay` avec bons ids/montant), taxe (`toId` null), achat (`buy`), enchère
  (`buy`), construction (`build`), prison (`jail`), anniversaire (un `pay` par
  payeur), salaire Départ (`gain`), échange avec argent (`pay`) ; et n'émet **pas**
  `pay` quand le payeur fait faillite.
- Nouveau `tests/effects.test.mjs` (fumigation) : `effects.js` n'accédant au DOM
  qu'à l'exécution (jamais au niveau module), il est importable en Node avec un
  `document` factice. Un plateau factice (vraie `THREE.Scene`, tween instantané)
  permet de vérifier que chaque effet aboutit et **nettoie la scène** derrière
  lui — seule couverture automatique possible de ce code avant la passe visuelle.
  `ui.js` reste, lui, hors des tests.
- Dans le navigateur (serveur de dev) : passe visuelle utilisateur — loyer entre
  joueurs, taxe, achat, construction, prison, doubles, faillite, victoire, reprise
  de sauvegarde sans effet parasite.
