# Sauvegarde et reprise de partie — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sauvegarde automatique de la partie en cours dans le `localStorage` à chaque tour, avec choix « Reprendre / Nouvelle partie » à l'accueil.

**Architecture:** Le moteur (`Game`) gagne `serialize()` (état pur) et `Game.fromSnapshot()` (restauration sans re-mélange). Un module `storage.js` enveloppe le `localStorage` (clé unique, version, date, try/catch). `main.js` branche l'auto-save sur la boucle de jeu, affiche l'encart de reprise à l'accueil et restaure la scène 3D via les méthodes existantes.

**Tech Stack:** JavaScript vanilla (ESM), Three.js, Vite. Tests : script Node pur avec `node:assert` (pas de framework — `node tests/save.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-07-08-sauvegarde-design.md`

## Global Constraints

- Clé de stockage : `monopoly3d.save.v1` ; version de schéma : `1`.
- `Game.serialize()` retourne l'**état pur** du jeu ; c'est `storage.js` qui ajoute l'enveloppe `{ version, savedAt, state }` (raffinement de la spec, comportement identique : le JSON stocké contient bien version + date).
- Sauvegarde au **début** de chaque tour, avant l'incrément de `turnCount` ⇒ le tour affiché à la reprise est `turnCount + 1`.
- Toute interaction avec `localStorage` est dans un try/catch : stockage indisponible ⇒ le jeu tourne sans sauvegarde, sans erreur visible.
- Le journal n'est pas sauvegardé.
- Tout texte visible par le joueur est en français.
- Commits fréquents, un par tâche minimum.

---

### Task 1 : Pioches sérialisables (`cards.js`)

`makeDeck()` cache l'ordre des cartes et le pointeur dans une closure. On mélange
désormais des **indices** (et non les cartes), on expose `state()` et on ajoute
`restoreDeck()`. Comportement de tirage inchangé (circulaire).

**Files:**
- Modify: `src/game/cards.js:33-47` (fonction `makeDeck`)
- Test: `tests/save.test.mjs` (créé ici)
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: rien (tâche racine).
- Produces:
  - `makeDeck(cards, rng)` → `{ draw(): card, state(): { order: number[], pointer: number } }`
  - `restoreDeck(cards, state)` → même objet deck, repartant de `state`. Suppose un
    `state` valide (garanti en amont par le contrôle de version du stockage).

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `tests/save.test.mjs` :

```js
// Tests de la sauvegarde — exécutable avec : node tests/save.test.mjs
import assert from 'node:assert/strict';
import { CHANCE_CARDS, makeDeck, restoreDeck } from '../src/game/cards.js';

// RNG déterministe pour des tests reproductibles
function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// --- Pioches : state() / restoreDeck() ------------------------------------
{
  const deck = makeDeck(CHANCE_CARDS, seededRng(1));
  deck.draw();
  deck.draw();
  const state = deck.state();
  assert.equal(state.pointer, 2);
  assert.equal(state.order.length, CHANCE_CARDS.length);
  // l'ordre est une permutation des indices 0..n-1
  assert.deepEqual([...state.order].sort((a, b) => a - b), CHANCE_CARDS.map((_, i) => i));

  // le deck restauré tire exactement la même suite (y compris le rebouclage)
  const restored = restoreDeck(CHANCE_CARDS, state);
  for (let i = 0; i < CHANCE_CARDS.length + 3; i++) {
    assert.equal(restored.draw().text, deck.draw().text);
  }
  // state() ne partage pas son tableau interne (copie défensive)
  const s2 = restored.state();
  s2.order[0] = 999;
  assert.notEqual(restored.state().order[0], 999);
}

console.log('✅ cards.js : pioches sérialisables OK');
```

Ajouter le script dans `package.json` (bloc `scripts`) :

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "node tests/save.test.mjs"
}
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run : `npm test`
Attendu : ÉCHEC — `SyntaxError: ... does not provide an export named 'restoreDeck'`.

- [ ] **Step 3 : Implémenter dans `src/game/cards.js`**

Remplacer la fonction `makeDeck` existante (lignes 33-47) par :

```js
export function makeDeck(cards, rng = Math.random) {
  const order = cards.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return deckFrom(cards, order, 0);
}

// Reconstruit une pioche depuis un état sauvegardé (suppose un état valide,
// garanti en amont par le contrôle de version du stockage).
export function restoreDeck(cards, state) {
  return deckFrom(cards, state.order, state.pointer);
}

function deckFrom(cards, order, pointer) {
  let ptr = pointer;
  const seq = [...order];
  return {
    draw() {
      const card = cards[seq[ptr]];
      ptr = (ptr + 1) % seq.length;
      return card;
    },
    state() {
      return { order: [...seq], pointer: ptr };
    },
  };
}
```

- [ ] **Step 4 : Vérifier que le test passe**

Run : `npm test`
Attendu : `✅ cards.js : pioches sérialisables OK`

- [ ] **Step 5 : Vérifier que le jeu tourne toujours**

Run : `npm run dev`, ouvrir la partie, tirer une carte Chance ou Caisse.
Attendu : comportement identique à avant (mélange, tirage circulaire).

- [ ] **Step 6 : Commit**

```bash
git add src/game/cards.js tests/save.test.mjs package.json
git commit -m "feat: pioches sérialisables (state/restoreDeck)"
```

---

### Task 2 : Module de stockage (`storage.js`)

Enveloppe `localStorage` : clé unique, version de schéma, date, tolérance aux
pannes (stockage indisponible, JSON corrompu, version incompatible).

**Files:**
- Create: `src/game/storage.js`
- Test: `tests/save.test.mjs` (ajout d'une section)

**Interfaces:**
- Consumes: rien.
- Produces:
  - `saveGame(state)` — écrit `{ version: 1, savedAt: ISO string, state }` sous la
    clé `monopoly3d.save.v1`. Silencieux en cas d'échec.
  - `loadGame()` → `{ version, savedAt, state }` ou `null` (absent, corrompu ou
    mauvaise version — nettoie la clé dans ces deux derniers cas).
  - `clearSave()` — supprime la sauvegarde, silencieux en cas d'échec.

- [ ] **Step 1 : Ajouter le test qui échoue**

Ajouter à la fin de `tests/save.test.mjs` (avant le dernier `console.log` s'il est
en fin de fichier — sinon simplement à la suite) :

```js
// --- Stockage : save/load/clear -------------------------------------------
{
  // Faux localStorage pour Node
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const { saveGame, loadGame, clearSave } = await import('../src/game/storage.js');
  const KEY = 'monopoly3d.save.v1';

  // aller-retour
  saveGame({ turnCount: 4, current: 1 });
  const loaded = loadGame();
  assert.equal(loaded.version, 1);
  assert.ok(typeof loaded.savedAt === 'string' && loaded.savedAt.length > 0);
  assert.deepEqual(loaded.state, { turnCount: 4, current: 1 });

  // clearSave
  clearSave();
  assert.equal(loadGame(), null);

  // JSON corrompu → null + clé nettoyée
  mem.set(KEY, '{pas du json');
  assert.equal(loadGame(), null);
  assert.equal(mem.has(KEY), false);

  // version incompatible → null + clé nettoyée
  mem.set(KEY, JSON.stringify({ version: 99, savedAt: 'x', state: {} }));
  assert.equal(loadGame(), null);
  assert.equal(mem.has(KEY), false);

  // stockage qui lève (mode privé…) → aucune exception
  globalThis.localStorage = {
    getItem: () => { throw new Error('indisponible'); },
    setItem: () => { throw new Error('indisponible'); },
    removeItem: () => { throw new Error('indisponible'); },
  };
  saveGame({ a: 1 });
  assert.equal(loadGame(), null);
  clearSave();
}

console.log('✅ storage.js : stockage OK');
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run : `npm test`
Attendu : ÉCHEC — `Cannot find module ... src/game/storage.js`.

- [ ] **Step 3 : Créer `src/game/storage.js`**

```js
// Sauvegarde de la partie en cours dans le localStorage.
// Un seul emplacement ; tout échec de stockage est silencieux : le jeu
// fonctionne alors simplement sans sauvegarde.

const KEY = 'monopoly3d.save.v1';
const VERSION = 1;

export function saveGame(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      version: VERSION,
      savedAt: new Date().toISOString(),
      state,
    }));
  } catch { /* stockage indisponible */ }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.version !== VERSION || !data.state) {
      clearSave();
      return null;
    }
    return data;
  } catch {
    clearSave();
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* stockage indisponible */ }
}
```

- [ ] **Step 4 : Vérifier que le test passe**

Run : `npm test`
Attendu :
```
✅ cards.js : pioches sérialisables OK
✅ storage.js : stockage OK
```

- [ ] **Step 5 : Commit**

```bash
git add src/game/storage.js tests/save.test.mjs
git commit -m "feat: module de stockage localStorage (save/load/clear)"
```

---

### Task 3 : Sérialisation du moteur (`engine.js`)

`Game` gagne `serialize()` (état pur), la fabrique statique `Game.fromSnapshot()`
et le hook `onAutoSave` appelé au début de chaque tour dans `run()`.

**Files:**
- Modify: `src/game/engine.js` (constructeur l.10-31, boucle `run()` l.37-49, nouvelles méthodes)
- Test: `tests/save.test.mjs` (ajout d'une section)

**Interfaces:**
- Consumes: `restoreDeck(cards, state)` de la Task 1.
- Produces:
  - `game.serialize()` → `{ turnCount, current, players: [{ name, color, isAI, money, pos, inJail, jailTurns, getOutCards, bankrupt }], tiles: [{ owner, houses, mortgaged }], decks: { chance, chest } }` (états de pioche au format Task 1).
  - `Game.fromSnapshot(snap, view, rng = Math.random)` → instance de `Game` restaurée.
  - `game.onAutoSave` : `null` par défaut ; si défini, appelé avec `serialize()` au
    début de chaque tour (avant l'incrément de `turnCount`, uniquement pour un
    joueur non failli — `current` désigne donc toujours un joueur vivant dans un
    snapshot).

- [ ] **Step 1 : Ajouter le test qui échoue**

Ajouter à la fin de `tests/save.test.mjs` :

```js
// --- Moteur : serialize() / fromSnapshot() ---------------------------------
{
  const { Game } = await import('../src/game/engine.js');
  const configs = [
    { name: 'Alice', color: '#e0453a', isAI: false },
    { name: 'IA 2', color: '#3a7de0', isAI: true },
    { name: 'IA 3', color: '#33b559', isAI: true },
  ];
  const g = new Game(configs, {}, seededRng(7));

  // On simule une partie avancée
  g.players[0].money = 940;
  g.players[0].pos = 14;
  g.players[1].inJail = true;
  g.players[1].jailTurns = 2;
  g.players[1].getOutCards = 1;
  g.players[2].bankrupt = true;
  g.players[2].money = 0;
  g.tiles[1].owner = 0;
  g.tiles[1].houses = 3;
  g.tiles[3].owner = 0;
  g.tiles[3].mortgaged = true;
  g.current = 1;
  g.turnCount = 12;
  g.chance.draw();
  g.chest.draw();
  g.chest.draw();

  // Aller-retour par JSON, comme le fera le localStorage
  const snap = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = Game.fromSnapshot(snap, {});

  assert.deepEqual(g2.players, g.players);
  assert.deepEqual(g2.tiles, g.tiles);
  assert.equal(g2.current, 1);
  assert.equal(g2.turnCount, 12);
  assert.equal(g2.over, false);
  // les pioches reprennent exactement où elles en étaient
  for (let i = 0; i < 15; i++) {
    assert.equal(g2.chance.draw().text, g.chance.draw().text);
    assert.equal(g2.chest.draw().text, g.chest.draw().text);
  }
  // le hook existe et vaut null par défaut
  assert.equal(g2.onAutoSave, null);
}

console.log('✅ engine.js : serialize/fromSnapshot OK');
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run : `npm test`
Attendu : ÉCHEC — `TypeError: g.serialize is not a function`.

- [ ] **Step 3 : Implémenter dans `src/game/engine.js`**

3a. Compléter l'import de `cards.js` (ligne 4) :

```js
import { CHANCE_CARDS, CHEST_CARDS, makeDeck, restoreDeck } from './cards.js';
```

3b. Dans le constructeur, après `this.turnCount = 0;` (ligne 30), ajouter :

```js
    this.onAutoSave = null; // hook de sauvegarde automatique (branché par main.js)
```

3c. Dans `run()`, ajouter l'appel au hook au début de chaque tour — le bloc
(lignes 38-46) devient :

```js
    while (!this.over) {
      const p = this.players[this.current];
      if (!p.bankrupt) {
        this.onAutoSave?.(this.serialize());
        this.turnCount++;
        await this.playTurn(p);
      }
      if (this.checkEnd()) break;
      this.current = (this.current + 1) % this.players.length;
    }
```

3d. Ajouter les deux méthodes après le constructeur (avant `alivePlayers()`) :

```js
  // État pur de la partie, sérialisable en JSON. L'enveloppe (version, date)
  // est ajoutée par storage.js.
  serialize() {
    return {
      turnCount: this.turnCount,
      current: this.current,
      players: this.players.map((p) => ({
        name: p.name,
        color: p.color,
        isAI: p.isAI,
        money: p.money,
        pos: p.pos,
        inJail: p.inJail,
        jailTurns: p.jailTurns,
        getOutCards: p.getOutCards,
        bankrupt: p.bankrupt,
      })),
      tiles: this.tiles.map((t) => ({
        owner: t.owner,
        houses: t.houses,
        mortgaged: t.mortgaged,
      })),
      decks: { chance: this.chance.state(), chest: this.chest.state() },
    };
  }

  static fromSnapshot(snap, view, rng = Math.random) {
    const configs = snap.players.map(({ name, color, isAI }) => ({ name, color, isAI }));
    const game = new Game(configs, view, rng);
    snap.players.forEach((sp, i) => Object.assign(game.players[i], sp));
    snap.tiles.forEach((st, i) => Object.assign(game.tiles[i], st));
    game.chance = restoreDeck(CHANCE_CARDS, snap.decks.chance);
    game.chest = restoreDeck(CHEST_CARDS, snap.decks.chest);
    game.current = snap.current;
    game.turnCount = snap.turnCount;
    return game;
  }
```

- [ ] **Step 4 : Vérifier que le test passe**

Run : `npm test`
Attendu : les trois lignes `✅` s'affichent.

- [ ] **Step 5 : Vérifier que le jeu tourne toujours**

Run : `npm run dev`, jouer un tour complet.
Attendu : comportement identique (le hook vaut `null`, donc aucun effet).

- [ ] **Step 6 : Commit**

```bash
git add src/game/engine.js tests/save.test.mjs
git commit -m "feat: sérialisation du moteur (serialize/fromSnapshot/onAutoSave)"
```

---

### Task 4 : Accueil « Reprendre / Nouvelle partie » et reprise 3D

Branche tout : encart de reprise à l'accueil, auto-save, restauration de la scène
3D, effacement de la sauvegarde en fin de partie.

**Files:**
- Modify: `index.html:36-47` (encart dans `.setup-box`)
- Modify: `src/ui/ui.js:346` (exporter `escapeHtml`)
- Modify: `src/ui/styles.css` (styles de l'encart, à la suite des styles setup, après la ligne 306)
- Modify: `src/main.js` (import storage, encart de reprise, `startGame(configs, snapshot)`)

**Interfaces:**
- Consumes: `saveGame` / `loadGame` / `clearSave` (Task 2), `Game.fromSnapshot` et
  `game.onAutoSave` (Task 3), méthodes existantes de `Board3D` : `createTokens`,
  `placeToken(playerIdx, tileIdx, count)`, `removeToken`, `setOwner(idx, colorHex)`,
  `setHouses(idx, n)`, `setMortgaged(idx, bool)`.
- Produces: rien (tâche feuille).

- [ ] **Step 1 : Exporter `escapeHtml` depuis `ui.js`**

Ligne 346 de `src/ui/ui.js`, remplacer :

```js
function escapeHtml(s) {
```

par :

```js
export function escapeHtml(s) {
```

- [ ] **Step 2 : Ajouter l'encart dans `index.html`**

Dans `.setup-box`, juste après `<p class="tagline">…</p>`, insérer :

```html
      <div id="resume-box" class="hidden">
        <h2>📂 Partie en cours</h2>
        <div class="resume-meta"></div>
        <div class="resume-players"></div>
        <button id="resume-btn" class="action-btn primary big">▶ Reprendre la partie</button>
      </div>
```

- [ ] **Step 3 : Ajouter les styles dans `src/ui/styles.css`**

À la suite des styles de l'écran de configuration (après `.player-row select`,
ligne 306, avant le bloc responsive) :

```css
#resume-box {
  border: 1px solid rgba(51, 181, 89, 0.45);
  background: rgba(51, 181, 89, 0.08);
  border-radius: 14px;
  padding: 16px 18px;
  margin-bottom: 22px;
}
#resume-box h2 { font-size: 16px; margin-bottom: 4px; }
#resume-box .resume-meta { color: var(--muted); font-size: 12.5px; margin-bottom: 10px; }
#resume-box .resume-players {
  display: flex; flex-wrap: wrap; gap: 6px 14px;
  margin-bottom: 14px; font-size: 13.5px;
}
.resume-player { display: inline-flex; align-items: center; gap: 6px; }
.resume-player.out { opacity: 0.45; text-decoration: line-through; }
```

- [ ] **Step 4 : Brancher la reprise dans `src/main.js`**

4a. Compléter les imports (lignes 1-4) :

```js
import { Board3D } from './3d/scene.js';
import { Game } from './game/engine.js';
import { UI, escapeHtml } from './ui/ui.js';
import { PLAYER_COLORS } from './game/data.js';
import { saveGame, loadGame, clearSave } from './game/storage.js';
```

4b. Après `renderCountButtons(); renderPlayerRows();` (lignes 57-58), ajouter
l'affichage de l'encart :

```js
// S'il existe une partie sauvegardée, proposer de la reprendre
const save = loadGame();
if (save) {
  const box = $('#resume-box');
  const st = save.state;
  const date = new Date(save.savedAt).toLocaleString('fr-FR', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
  box.querySelector('.resume-meta').textContent = `Tour n°${st.turnCount + 1} — sauvegardée le ${date}`;
  box.querySelector('.resume-players').innerHTML = st.players.map((p) => (
    `<span class="resume-player${p.bankrupt ? ' out' : ''}">`
    + `<span class="token-dot" style="background:${p.color}"></span>${escapeHtml(p.name)}</span>`
  )).join('');
  box.classList.remove('hidden');
  $('#start-btn').textContent = '🎲 Nouvelle partie';
  $('#resume-btn').onclick = () => {
    $('#setup').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    startGame(null, st);
  };
}
```

4c. Donner un second paramètre à `startGame` (ligne 75) :

```js
async function startGame(configs, snapshot = null) {
```

4d. Dans l'objet `view`, remplacer la ligne `announceWinner: (p) => ui.announceWinner(p),` par :

```js
    announceWinner: (p) => { clearSave(); return ui.announceWinner(p); },
```

4e. Remplacer la fin de `startGame` (à partir de `const game = new Game(configs, view);`) par :

```js
  const game = snapshot ? Game.fromSnapshot(snapshot, view) : new Game(configs, view);
  game.onAutoSave = saveGame;
  ui.bind(game);

  scene.onTileClick = (idx) => {
    if ($('#modal-root').childElementCount > 0) return;
    ui.showDeed(idx);
  };

  scene.createTokens(game.players);
  if (snapshot) {
    // Replace pions, propriétaires, constructions et hypothèques
    for (const p of game.players) {
      if (p.bankrupt) scene.removeToken(p.id);
      else scene.placeToken(p.id, p.pos, game.players.length);
    }
    game.tiles.forEach((t, i) => {
      if (t.owner !== null) scene.setOwner(i, game.players[t.owner].color);
      if (t.houses > 0) scene.setHouses(i, t.houses);
      if (t.mortgaged) scene.setMortgaged(i, true);
    });
  }
  ui.updatePlayers();
  if (snapshot) {
    const cur = game.players[game.current];
    ui.log(`📂 Partie reprise — au tour de ${cur.name} (tour n°${game.turnCount + 1}).`);
  } else {
    ui.log('🎩 La partie commence ! Chaque joueur reçoit 1 500 €.');
  }
  await scene.introCamera();
  game.run();
}
```

- [ ] **Step 5 : Vérifier dans le navigateur**

Run : `npm run dev`, puis dans le navigateur :

1. Accueil sans sauvegarde : écran identique à avant (pas d'encart).
2. Lancer une partie (1 humain + 1 IA), jouer 2-3 tours, acheter une propriété.
3. Recharger la page : l'encart « 📂 Partie en cours » apparaît avec les joueurs,
   le n° de tour et la date ; le bouton du formulaire affiche « 🎲 Nouvelle partie ».
4. Cliquer « ▶ Reprendre la partie » : pions aux bonnes positions, propriété avec
   son marqueur de couleur, argent correct, journal « 📂 Partie reprise… », c'est
   au bon joueur de jouer.

Attendu : les quatre points ci-dessus, sans erreur dans la console.

- [ ] **Step 6 : Commit**

```bash
git add index.html src/main.js src/ui/ui.js src/ui/styles.css
git commit -m "feat: reprise de partie à l'accueil + auto-save branchée"
```

---

### Task 5 : Vérification de bout en bout et documentation

Déroule le parcours complet de la spec (section « Vérification ») et documente la
fonctionnalité dans le README.

**Files:**
- Modify: `README.md` (section fonctionnalités)

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: rien.

- [ ] **Step 1 : Tests logiques**

Run : `npm test`
Attendu : les trois lignes `✅`.

- [ ] **Step 2 : Parcours complet dans le navigateur**

Avec `npm run dev` :

1. **État riche** : jouer plusieurs tours avec constructions (groupe complet),
   une hypothèque et un passage en prison. Recharger, reprendre : maisons 3D,
   hypothèque (marqueur), statut prison (🔒 + position) et ordre des cartes
   conservés — noter la prochaine carte Chance avant rechargement via une partie
   test, ou vérifier simplement qu'aucune carte ne se répète anormalement.
2. **Nouvelle partie** : recharger, cliquer « 🎲 Nouvelle partie », configurer et
   lancer. Recharger à nouveau : l'encart propose bien la **nouvelle** partie
   (noms/tour du nouveau snapshot, écrasé au 1er tour).
3. **Fin de partie** : en partie à 2 joueurs, mener un joueur à la faillite
   (au besoin, réduire son argent via la console : la partie de test est jetable).
   Après l'écran « 🏆 … remporte la partie ! » et le rechargement automatique :
   plus d'encart de reprise à l'accueil.
4. **Sauvegarde corrompue** : dans la console, `localStorage.setItem('monopoly3d.save.v1', '{oops')`,
   recharger : accueil normal, clé nettoyée (`localStorage.getItem('monopoly3d.save.v1')` → `null`).

Attendu : les quatre scénarios passent sans erreur console.

- [ ] **Step 3 : Documenter dans le README**

Dans `README.md`, ajouter à la liste des fonctionnalités (adapter au format
existant du fichier) :

```markdown
- 💾 **Sauvegarde automatique** : la partie en cours est sauvegardée dans le
  navigateur à chaque tour. Au retour, choisissez « Reprendre la partie » ou
  « Nouvelle partie ».
```

- [ ] **Step 4 : Commit final**

```bash
git add README.md
git commit -m "docs: sauvegarde automatique dans le README"
```
