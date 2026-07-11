# Règles maison configurables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quatre règles maison configurables à la création d'une partie : double salaire sur arrêt pile sur Départ, cagnotte du Parc Gratuit, enchères désactivables, argent de départ en presets.

**Architecture:** Un objet `rules` plat (`DEFAULT_RULES` dans `data.js`) est injecté dans le constructeur de `Game` et mergé avec les défauts. Cinq points de branchement localisés dans `engine.js` ; l'UI de configuration vit dans `index.html`/`main.js` ; un badge HUD affiche la cagnotte via la méthode de vue optionnelle `view.setPot?.()`.

**Tech Stack:** JavaScript ES modules (navigateur, sans framework), three.js pour la 3D (non touché ici), Vite pour le build, tests = scripts Node purs (`node tests/x.test.mjs`) chaînés dans `npm test`.

**Spec:** `docs/superpowers/specs/2026-07-11-regles-maison-design.md`

## Global Constraints

- Tout texte visible (logs, libellés UI, commentaires) est en français, accents corrects.
- `DEFAULT_RULES` reproduit EXACTEMENT le comportement actuel : une partie sans configuration se comporte comme avant (`doubleGoSalary: false`, `freeParkingPot: false`, `auctions: true`, `startingMoney: 1500`).
- Pas de bump de `VERSION` dans `storage.js` : les nouveaux champs (`rules`, `pot`) sont optionnels avec valeur de repli dans `Game.fromSnapshot` — une vieille sauvegarde doit se charger sans erreur.
- Les tests sont des scripts Node à `assert` nu, sans framework, avec RNG seedé et vues factices en `Proxy` (voir `tests/auction.test.mjs` pour le style).
- Style du code existant : commentaires sobres expliquant les contraintes, pas de JSDoc, virgules finales, 2 espaces d'indentation.
- Commits fréquents en français, préfixes `feat:`/`test:`/`docs:`.

---

### Task 1: Objet de règles + injection dans le moteur

**Files:**
- Modify: `src/game/data.js` (après `STARTING_MONEY`, ligne ~85)
- Modify: `src/game/engine.js:1-32` (import + constructeur)
- Modify: `package.json:10` (chaîne de tests)
- Create: `tests/rules.test.mjs`

**Interfaces:**
- Consumes: `STARTING_MONEY` (data.js), constructeur `Game` existant.
- Produces: `DEFAULT_RULES` et `STARTING_MONEY_PRESETS` (exports de `data.js`) ; constructeur `new Game(playerConfigs, view, rng = Math.random, rules = {})` ; propriétés `game.rules` (objet mergé) et `game.pot` (nombre, 0 au départ). Les tâches 2-7 s'appuient sur `this.rules.<clé>` et `this.pot`.

- [ ] **Step 1: Créer le fichier de test avec ses helpers et le premier bloc**

Créer `tests/rules.test.mjs` :

```js
// Tests des règles maison — exécutable avec : node tests/rules.test.mjs
import assert from 'node:assert/strict';
import { DEFAULT_RULES, STARTING_MONEY_PRESETS } from '../src/game/data.js';
import { Game } from '../src/game/engine.js';

// RNG déterministe pour des tests reproductibles
function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Vue factice : journalise log() et setPot(), tout le reste est no-op ;
// `extra` permet d'injecter des méthodes scriptées (promptHuman…).
function makeView(extra = {}) {
  const calls = { logs: [], setPot: [] };
  const target = {
    log: (msg) => calls.logs.push(msg),
    setPot: (v) => calls.setPot.push(v),
    ...extra,
  };
  const view = new Proxy(target, { get: (t, k) => (k in t ? t[k] : () => {}) });
  return { view, calls };
}

function makeGame(view, rules, configs) {
  return new Game(
    configs ?? [
      { name: 'Alice', color: '#e0453a', isAI: false },
      { name: 'Bob', color: '#3a7de0', isAI: false },
    ],
    view,
    seededRng(1),
    rules,
  );
}

// --- 1. Défauts officiels, merge des règles partielles ----------------------
{
  const { view } = makeView();
  const g = makeGame(view);
  assert.deepEqual(g.rules, DEFAULT_RULES);
  assert.equal(g.pot, 0);
  assert.equal(g.players[0].money, 1500);
}
{
  const { view } = makeView();
  const g = makeGame(view, { startingMoney: 2500 });
  assert.equal(g.players[0].money, 2500);
  assert.equal(g.players[1].money, 2500);
  assert.equal(g.rules.doubleGoSalary, false); // les clés absentes gardent leur défaut
  assert.equal(g.rules.auctions, true);
}
assert.ok(STARTING_MONEY_PRESETS.includes(DEFAULT_RULES.startingMoney));

console.log('✅ engine.js : règles par défaut et argent de départ configurable OK');
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `node tests/rules.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../src/game/data.js' does not provide an export named 'DEFAULT_RULES'`

- [ ] **Step 3: Ajouter les exports dans data.js**

Dans `src/game/data.js`, juste après `export const STARTING_MONEY = 1500;` :

```js
// Règles maison. DEFAULT_RULES reproduit exactement les règles officielles :
// une partie créée sans configuration se comporte comme avant.
export const DEFAULT_RULES = {
  doubleGoSalary: false, // s'arrêter pile sur Départ rapporte un second salaire
  freeParkingPot: false, // les pénalités alimentent une cagnotte gagnée sur Parc Gratuit
  auctions: true, // règle officielle : refus d'achat → mise aux enchères
  startingMoney: STARTING_MONEY,
};

export const STARTING_MONEY_PRESETS = [1000, 1500, 2000, 2500];
```

- [ ] **Step 4: Injecter les règles dans le constructeur de Game**

Dans `src/game/engine.js`, remplacer l'import (lignes 1-3) :

```js
import {
  TILES, GROUPS, GO_SALARY, JAIL_FINE, JAIL_INDEX, DEFAULT_RULES, formatMoney,
} from './data.js';
```

(`STARTING_MONEY` n'est plus utilisé par le moteur.)

Remplacer le début du constructeur (lignes 10-13) :

```js
constructor(playerConfigs, view, rng = Math.random, rules = {}) {
  this.view = view;
  this.rng = rng;
  // Merge avec les défauts : tolère les objets partiels (vieilles sauvegardes)
  this.rules = { ...DEFAULT_RULES, ...rules };
  this.pot = 0; // cagnotte du Parc Gratuit (reste à 0 si la règle est inactive)
  this.tiles = TILES.map((t) => ({ ...t, owner: null, houses: 0, mortgaged: false }));
```

Et dans le map des joueurs, remplacer `money: STARTING_MONEY,` par :

```js
money: this.rules.startingMoney,
```

- [ ] **Step 5: Vérifier que le test passe**

Run: `node tests/rules.test.mjs`
Expected: PASS — `✅ engine.js : règles par défaut et argent de départ configurable OK`

- [ ] **Step 6: Ajouter le fichier à la chaîne npm test et lancer toute la suite**

Dans `package.json`, ajouter `&& node tests/rules.test.mjs` à la fin du script `test` :

```json
"test": "node tests/save.test.mjs && node tests/sound.test.mjs && node tests/build.test.mjs && node tests/trade.test.mjs && node tests/auction.test.mjs && node tests/fx.test.mjs && node tests/effects.test.mjs && node tests/rules.test.mjs"
```

Run: `npm test`
Expected: PASS — tous les ✅ existants + le nouveau, aucune régression.

- [ ] **Step 7: Commit**

```bash
git add src/game/data.js src/game/engine.js package.json tests/rules.test.mjs
git commit -m "feat: objet de règles maison injecté dans le moteur (argent de départ configurable)"
```

---

### Task 2: Double salaire sur arrêt pile sur Départ

**Files:**
- Modify: `src/game/engine.js` (`resolveTile()`, switch ligne ~219)
- Test: `tests/rules.test.mjs` (append)

**Interfaces:**
- Consumes: `this.rules.doubleGoSalary` (Task 1), `GO_SALARY` (200), `resolveTile(p, diceSum)`.
- Produces: nouveau `case 'go'` dans le switch de `resolveTile()`. Aucun nouveau symbole public.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `tests/rules.test.mjs` :

```js
// --- 2. Double salaire : arrêt pile sur Départ -------------------------------
{
  const { view } = makeView();
  const g = makeGame(view, { doubleGoSalary: true });
  const p = g.players[0];
  p.pos = 35;
  await g.moveBy(p, 5); // passe ET s'arrête sur Départ
  await g.resolveTile(p, 5);
  assert.equal(p.money, 1500 + 400); // 200 (passage) + 200 (bonus)
}
{
  const { view } = makeView();
  const g = makeGame(view, { doubleGoSalary: true });
  const p = g.players[0];
  p.pos = 30;
  await g.moveBy(p, 20); // passe Départ, s'arrête sur Prison (simple visite)
  await g.resolveTile(p, 20);
  assert.equal(p.pos, 10);
  assert.equal(p.money, 1500 + 200); // passage simple : pas de bonus
}
{
  const { view } = makeView();
  const g = makeGame(view); // règle inactive
  const p = g.players[0];
  p.pos = 35;
  await g.moveBy(p, 5);
  await g.resolveTile(p, 5);
  assert.equal(p.money, 1500 + 200);
}
// Arrivée par carte « Avancez jusqu'à la case Départ » : même chemin (moveTo)
{
  const { view } = makeView();
  const g = makeGame(view, { doubleGoSalary: true });
  const p = g.players[0];
  p.pos = 24;
  await g.moveTo(p, 0);
  await g.resolveTile(p, 7);
  assert.equal(p.money, 1500 + 400);
}

console.log('✅ engine.js : double salaire sur arrêt pile OK');
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `node tests/rules.test.mjs`
Expected: FAIL — `AssertionError` sur le premier bloc : `1700 !== 1900` (le bonus n'existe pas encore).

- [ ] **Step 3: Implémenter le case 'go' dans resolveTile**

Dans `src/game/engine.js`, dans le `switch (tile.type)` de `resolveTile()`, ajouter avant le `default:` :

```js
case 'go':
  if (this.rules.doubleGoSalary) {
    p.money += GO_SALARY;
    this.view.sfx?.('cash');
    this.view.fx?.('gain', { playerId: p.id, amount: GO_SALARY });
    this.view.log(`${p.name} s'arrête pile sur la case Départ : salaire doublé (+${GO_SALARY} €) !`, 'good');
  }
  break;
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `node tests/rules.test.mjs`
Expected: PASS — les deux ✅.

Run: `npm test`
Expected: PASS — aucune régression.

- [ ] **Step 5: Commit**

```bash
git add src/game/engine.js tests/rules.test.mjs
git commit -m "feat: règle maison — double salaire sur arrêt pile sur la case Départ"
```

---

### Task 3: Cagnotte du Parc Gratuit (alimentation, gain, faillite)

**Files:**
- Modify: `src/game/engine.js` (`charge()` ligne ~445, `resolveTile()` switch, `declareBankruptcy()` ligne ~470)
- Test: `tests/rules.test.mjs` (append)

**Interfaces:**
- Consumes: `this.rules.freeParkingPot`, `this.pot` (Task 1), `formatMoney` (déjà importé dans engine.js).
- Produces: appels `this.view.setPot?.(montant)` à chaque variation de la cagnotte (consommé par la Task 7) ; nouveau `case 'parking'` dans `resolveTile()`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `tests/rules.test.mjs` :

```js
// --- 3. Cagnotte : alimentée par les pénalités uniquement --------------------
{
  const { view, calls } = makeView();
  const g = makeGame(view, { freeParkingPot: true });
  const p = g.players[0];
  p.pos = 4; // Impôts sur le revenu (200 €)
  await g.resolveTile(p, 3);
  assert.equal(p.money, 1300);
  assert.equal(g.pot, 200);
  assert.deepEqual(calls.setPot, [200]);
  assert.ok(calls.logs.some((m) => m.includes('cagnotte')));
}
// un loyer joueur → joueur ne va PAS dans la cagnotte
{
  const { view } = makeView();
  const g = makeGame(view, { freeParkingPot: true });
  await g.charge(g.players[0], 50, g.players[1], 'le loyer');
  assert.equal(g.pot, 0);
  assert.equal(g.players[1].money, 1550);
}
// règle inactive : la taxe disparaît à la banque comme avant
{
  const { view, calls } = makeView();
  const g = makeGame(view);
  const p = g.players[0];
  p.pos = 4;
  await g.resolveTile(p, 3);
  assert.equal(p.money, 1300);
  assert.equal(g.pot, 0);
  assert.deepEqual(calls.setPot, []);
}

console.log('✅ engine.js : cagnotte alimentée par les pénalités uniquement OK');

// --- 4. Cagnotte : gain sur Parc Gratuit -------------------------------------
{
  const { view, calls } = makeView();
  const g = makeGame(view, { freeParkingPot: true });
  const p = g.players[0];
  g.pot = 350;
  p.pos = 20; // Parc Gratuit
  await g.resolveTile(p, 5);
  assert.equal(p.money, 1850);
  assert.equal(g.pot, 0);
  assert.deepEqual(calls.setPot, [0]);
  assert.ok(calls.logs.some((m) => m.includes('remporte la cagnotte')));
}
// cagnotte vide : rien ne se passe
{
  const { view, calls } = makeView();
  const g = makeGame(view, { freeParkingPot: true });
  const p = g.players[0];
  p.pos = 20;
  await g.resolveTile(p, 5);
  assert.equal(p.money, 1500);
  assert.deepEqual(calls.setPot, []);
}
// règle inactive : Parc Gratuit reste une case neutre
{
  const { view } = makeView();
  const g = makeGame(view);
  g.pot = 0;
  const p = g.players[0];
  p.pos = 20;
  await g.resolveTile(p, 5);
  assert.equal(p.money, 1500);
}

console.log('✅ engine.js : gain de la cagnotte sur Parc Gratuit OK');

// --- 5. Cagnotte : faillite envers la banque ----------------------------------
{
  const { view } = makeView();
  const g = makeGame(view, { freeParkingPot: true });
  const p = g.players[0];
  p.money = 80; // sans patrimoine : faillite inévitable
  await g.charge(p, 200, null, 'la taxe');
  assert.equal(p.bankrupt, true);
  assert.equal(p.money, 0);
  assert.equal(g.pot, 80); // le liquide restant va dans la cagnotte
}

console.log('✅ engine.js : faillite envers la banque → liquide dans la cagnotte OK');
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `node tests/rules.test.mjs`
Expected: FAIL — `AssertionError` au bloc 3 : `g.pot` vaut `0` au lieu de `200`.

- [ ] **Step 3: Implémenter les trois branchements**

Dans `src/game/engine.js` :

**a)** Dans `charge()`, remplacer :

```js
if (p.money >= amount) {
  p.money -= amount;
  if (toPlayer) toPlayer.money += amount;
```

par :

```js
if (p.money >= amount) {
  p.money -= amount;
  if (toPlayer) {
    toPlayer.money += amount;
  } else if (this.rules.freeParkingPot) {
    // Règle maison : les pénalités versées à la banque alimentent la cagnotte
    this.pot += amount;
    this.view.setPot?.(this.pot);
    this.view.log(`💰 ${formatMoney(amount)} rejoignent la cagnotte du Parc Gratuit (total : ${formatMoney(this.pot)}).`);
  }
```

**b)** Dans le `switch (tile.type)` de `resolveTile()`, ajouter avant le `default:` (après le `case 'go'` de la Task 2) :

```js
case 'parking':
  if (this.rules.freeParkingPot && this.pot > 0) {
    const won = this.pot;
    this.pot = 0;
    p.money += won;
    this.view.sfx?.('cash');
    this.view.fx?.('gain', { playerId: p.id, amount: won });
    this.view.setPot?.(0);
    this.view.log(`🅿️ ${p.name} remporte la cagnotte du Parc Gratuit : ${formatMoney(won)} !`, 'good');
  }
  break;
```

**c)** Dans `declareBankruptcy()`, remplacer :

```js
if (creditor) creditor.money += p.money;
p.money = 0;
```

par :

```js
if (creditor) {
  creditor.money += p.money;
} else if (this.rules.freeParkingPot && p.money > 0) {
  // La dette était destinée à la cagnotte : le liquide restant y va aussi
  this.pot += p.money;
  this.view.setPot?.(this.pot);
  this.view.log(`💰 Les ${formatMoney(p.money)} restants rejoignent la cagnotte du Parc Gratuit.`);
}
p.money = 0;
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `node tests/rules.test.mjs`
Expected: PASS — les cinq ✅.

Run: `npm test`
Expected: PASS — aucune régression (notamment `fx.test.mjs` : le fx `pay` avec `toId: null` doit rester émis).

- [ ] **Step 5: Commit**

```bash
git add src/game/engine.js tests/rules.test.mjs
git commit -m "feat: règle maison — cagnotte du Parc Gratuit"
```

---

### Task 4: Enchères désactivables

**Files:**
- Modify: `src/game/engine.js` (`resolveOwnable()`, lignes ~258-260)
- Test: `tests/rules.test.mjs` (append)

**Interfaces:**
- Consumes: `this.rules.auctions` (Task 1), `runAuction(idx)` existant.
- Produces: aucun nouveau symbole — comportement conditionnel de `resolveOwnable()`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `tests/rules.test.mjs` :

```js
// --- 6. Enchères désactivables ------------------------------------------------
{
  const { view, calls } = makeView({ promptHuman: async () => false });
  const g = makeGame(view, { auctions: false });
  const p = g.players[0]; // humain : refuse l'achat
  await g.resolveOwnable(p, 1, 7);
  assert.equal(g.tiles[1].owner, null);
  assert.equal(p.money, 1500);
  assert.ok(!calls.logs.some((m) => m.includes('mis aux enchères')));
  assert.ok(calls.logs.some((m) => m.includes('reste à la banque')));
}
// règle officielle (défaut) : le refus déclenche bien l'enchère
{
  const { view, calls } = makeView({ promptHuman: async () => false });
  const g = makeGame(view);
  await g.resolveOwnable(g.players[0], 1, 7);
  assert.ok(calls.logs.some((m) => m.includes('mis aux enchères')));
}

console.log('✅ engine.js : enchères désactivables OK');
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `node tests/rules.test.mjs`
Expected: FAIL — `AssertionError` : le log `mis aux enchères` est présent alors que `auctions: false`.

- [ ] **Step 3: Conditionner l'enchère dans resolveOwnable**

Dans `src/game/engine.js`, remplacer :

```js
// Règle officielle : refus (ou fonds insuffisants) → mise aux enchères
await this.runAuction(idx);
return;
```

par :

```js
// Règle officielle : refus (ou fonds insuffisants) → mise aux enchères.
// Règle maison : sans enchères, la case reste simplement à la banque.
if (this.rules.auctions) {
  await this.runAuction(idx);
} else {
  this.view.log(`${tile.name} reste à la banque.`);
}
return;
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `node tests/rules.test.mjs`
Expected: PASS — les six ✅.

Run: `npm test`
Expected: PASS — `auction.test.mjs` inchangé (il appelle `runAuction` directement).

- [ ] **Step 5: Commit**

```bash
git add src/game/engine.js tests/rules.test.mjs
git commit -m "feat: règle maison — enchères désactivables"
```

---

### Task 5: Sérialisation des règles et de la cagnotte

**Files:**
- Modify: `src/game/engine.js` (`serialize()` ligne ~36, `fromSnapshot()` ligne ~60)
- Modify: `src/game/storage.js:5-9` (commentaire de tête uniquement)
- Test: `tests/rules.test.mjs` (append)

**Interfaces:**
- Consumes: `serialize()`/`fromSnapshot()` existants, `DEFAULT_RULES`.
- Produces: champs `rules` (objet) et `pot` (nombre) dans le snapshot. La Task 6 s'appuie sur le fait qu'une reprise de sauvegarde restaure les règles sans passer par l'écran de configuration.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `tests/rules.test.mjs` :

```js
// --- 7. Sérialisation : rules et pot survivent au round-trip ------------------
{
  const { view } = makeView();
  const rules = { doubleGoSalary: true, freeParkingPot: true, auctions: false, startingMoney: 2000 };
  const g = makeGame(view, rules);
  g.pot = 130;
  const snap = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = Game.fromSnapshot(snap, view);
  assert.deepEqual(g2.rules, rules);
  assert.equal(g2.pot, 130);
}
// vieille sauvegarde sans rules/pot → défauts officiels, pot vide
{
  const { view } = makeView();
  const g = makeGame(view);
  const snap = JSON.parse(JSON.stringify(g.serialize()));
  delete snap.rules;
  delete snap.pot;
  const g2 = Game.fromSnapshot(snap, view);
  assert.deepEqual(g2.rules, DEFAULT_RULES);
  assert.equal(g2.pot, 0);
}

console.log('✅ engine.js : sérialisation des règles et de la cagnotte OK');
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `node tests/rules.test.mjs`
Expected: FAIL — `AssertionError` : `g2.rules` vaut `DEFAULT_RULES` au lieu des règles personnalisées (le snapshot ne les transporte pas encore).

- [ ] **Step 3: Étendre serialize() et fromSnapshot()**

Dans `src/game/engine.js`, dans l'objet retourné par `serialize()`, ajouter après `turnCount` :

```js
rules: { ...this.rules },
pot: this.pot,
```

Dans `fromSnapshot()`, remplacer :

```js
const game = new Game(configs, view, rng);
```

par :

```js
// snap.rules absent (vieille sauvegarde) → le défaut `rules = {}` s'applique
const game = new Game(configs, view, rng, snap.rules);
```

et ajouter après `game.turnCount = snap.turnCount;` :

```js
game.pot = snap.pot ?? 0;
```

- [ ] **Step 4: Documenter l'exception de version dans storage.js**

Dans `src/game/storage.js`, compléter le commentaire de tête (après la phrase sur l'incrémentation de VERSION) :

```js
// Exception : l'ajout de champs OPTIONNELS munis d'une valeur de repli dans
// Game.fromSnapshot (ex. `rules`, `pot`) reste compatible dans les deux sens
// et ne nécessite pas de bump.
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `node tests/rules.test.mjs`
Expected: PASS — les sept ✅.

Run: `npm test`
Expected: PASS — `save.test.mjs` inchangé (il compare `players`/`tiles`/`decks`, pas l'objet snapshot entier).

- [ ] **Step 6: Commit**

```bash
git add src/game/engine.js src/game/storage.js tests/rules.test.mjs
git commit -m "feat: sérialisation des règles maison et de la cagnotte"
```

---

### Task 6: Écran de configuration — section « Règles maison »

**Files:**
- Modify: `index.html:53-54` (entre `#player-rows` et `#start-btn`)
- Modify: `src/main.js` (imports, rendu du select, lecture des règles, message de départ)
- Modify: `src/ui/styles.css` (styles de la section)

**Interfaces:**
- Consumes: `STARTING_MONEY_PRESETS`, `DEFAULT_RULES`, `formatMoney` (data.js) ; constructeur `new Game(configs, view, rng, rules)` (Task 1) ; restauration des règles par `fromSnapshot` (Task 5).
- Produces: éléments DOM `#rule-double-go`, `#rule-parking-pot`, `#rule-auctions` (checkboxes), `#rule-starting-money` (select) ; `startGame(configs, snapshot, rules)`. La Task 7 réutilise ce `startGame` élargi.

- [ ] **Step 1: Ajouter la section dans index.html**

Dans `index.html`, entre `<div id="player-rows"></div>` et le bouton `#start-btn`, insérer :

```html
<div id="rules-box">
  <div class="rules-title">🏠 Règles maison</div>
  <label class="rule-row"><input type="checkbox" id="rule-double-go" /><span>💰 Double salaire si arrêt pile sur Départ</span></label>
  <label class="rule-row"><input type="checkbox" id="rule-parking-pot" /><span>🅿️ Cagnotte du Parc Gratuit</span></label>
  <label class="rule-row"><input type="checkbox" id="rule-auctions" checked /><span>🔨 Enchères en cas de refus d'achat</span></label>
  <label class="rule-row"><span>💵 Argent de départ</span><select id="rule-starting-money"></select></label>
</div>
```

- [ ] **Step 2: Câbler main.js**

Dans `src/main.js` :

**a)** Étendre l'import de data.js (ligne 4) :

```js
import {
  PLAYER_COLORS, STARTING_MONEY_PRESETS, DEFAULT_RULES, formatMoney,
} from './game/data.js';
```

**b)** Après l'appel `renderPlayerRows();` (ligne ~60), ajouter :

```js
// Remplit le sélecteur d'argent de départ (préréglages, défaut officiel)
function renderMoneySelect() {
  const sel = $('#rule-starting-money');
  for (const amount of STARTING_MONEY_PRESETS) {
    const opt = document.createElement('option');
    opt.value = amount;
    opt.textContent = amount === DEFAULT_RULES.startingMoney
      ? `${formatMoney(amount)} (officiel)` : formatMoney(amount);
    if (amount === DEFAULT_RULES.startingMoney) opt.selected = true;
    sel.appendChild(opt);
  }
}
renderMoneySelect();
```

**c)** Dans le handler `$('#start-btn').onclick`, avant `startGame(configs);`, lire les règles et les passer :

```js
const rules = {
  doubleGoSalary: $('#rule-double-go').checked,
  freeParkingPot: $('#rule-parking-pot').checked,
  auctions: $('#rule-auctions').checked,
  startingMoney: Number($('#rule-starting-money').value),
};
$('#setup').classList.add('hidden');
$('#hud').classList.remove('hidden');
startGame(configs, null, rules);
```

**d)** Élargir la signature de `startGame` :

```js
async function startGame(configs, snapshot = null, rules = {}) {
```

et remplacer la création du jeu (ligne ~207) :

```js
const game = snapshot ? Game.fromSnapshot(snapshot, view) : new Game(configs, view, Math.random, rules);
```

**e)** Remplacer le message de départ codé en dur (ligne ~235) :

```js
ui.log(`🎩 La partie commence ! Chaque joueur reçoit ${formatMoney(game.rules.startingMoney)}.`);
```

- [ ] **Step 3: Styler la section dans styles.css**

Dans `src/ui/styles.css`, après les styles de `.count-btn.selected` (ligne ~380) :

```css
#rules-box {
  margin: 4px 0 18px;
  text-align: left;
  display: flex; flex-direction: column; gap: 9px;
}
.rules-title { font-size: 13px; color: var(--muted); margin-bottom: 2px; }
.rule-row {
  display: flex; align-items: center; gap: 9px;
  font-size: 14px; cursor: pointer;
}
.rule-row input[type="checkbox"] { accent-color: #e0453a; width: 16px; height: 16px; }
.rule-row select {
  margin-left: auto;
  background: #1d2733; color: var(--text);
  border: 1px solid var(--panel-border); border-radius: 8px;
  padding: 5px 8px; font-family: inherit; font-size: 13px;
}
```

- [ ] **Step 4: Vérifier build et tests**

Run: `npm run build`
Expected: PASS — build Vite sans erreur (valide la syntaxe de main.js et index.html).

Run: `npm test`
Expected: PASS — aucune régression.

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.js src/ui/styles.css
git commit -m "feat: écran de configuration — section règles maison"
```

---

### Task 7: Badge HUD de la cagnotte

**Files:**
- Modify: `index.html:14` (après `#turn-banner`)
- Modify: `src/ui/ui.js` (constructeur + nouvelle méthode `setPot`)
- Modify: `src/main.js` (vue : `setPot` ; affichage initial)
- Modify: `src/ui/styles.css` (style du badge)
- Test: `tests/rules.test.mjs` (append, fake-DOM)

**Interfaces:**
- Consumes: appels `view.setPot?.(montant)` émis par le moteur (Task 3) ; `game.rules.freeParkingPot` et `game.pot` (Tasks 1/5) ; `formatMoney` (déjà importé dans ui.js).
- Produces: `UI.setPot(amount)` — met à jour le texte du badge `#pot-badge` et le rend visible.

- [ ] **Step 1: Écrire le test fake-DOM qui échoue**

Ajouter à la fin de `tests/rules.test.mjs` :

```js
// --- 8. UI : badge de cagnotte (fake-DOM) --------------------------------------
{
  // DOM minimal : ui.js ne touche au vrai DOM qu'à travers querySelector,
  // createElement et addEventListener.
  const makeEl = () => ({
    textContent: '',
    innerHTML: '',
    style: {},
    classList: {
      set: new Set(['hidden']),
      add(c) { this.set.add(c); },
      remove(c) { this.set.delete(c); },
      contains(c) { return this.set.has(c); },
    },
    addEventListener: () => {},
    appendChild: () => {},
    querySelector: () => null,
    childElementCount: 0,
  });
  const els = new Map();
  globalThis.document = {
    querySelector: (sel) => {
      if (!els.has(sel)) els.set(sel, makeEl());
      return els.get(sel);
    },
    addEventListener: () => {},
    createElement: () => makeEl(),
  };
  const { UI } = await import('../src/ui/ui.js');
  const ui = new UI();
  const badge = document.querySelector('#pot-badge');
  assert.equal(badge.classList.contains('hidden'), true);
  ui.setPot(350);
  assert.equal(badge.textContent, '🅿️ Cagnotte : 350 €');
  assert.equal(badge.classList.contains('hidden'), false);
  ui.setPot(0);
  assert.equal(badge.textContent, '🅿️ Cagnotte : 0 €');
}

console.log('✅ ui.js : badge de cagnotte OK');
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `node tests/rules.test.mjs`
Expected: FAIL — `TypeError: ui.setPot is not a function`.

- [ ] **Step 3: Implémenter le badge**

**a)** Dans `index.html`, après `<div id="turn-banner"></div>` :

```html
<div id="pot-badge" class="hidden" title="Cagnotte du Parc Gratuit"></div>
```

**b)** Dans `src/ui/ui.js`, dans le constructeur après `this.turnBanner = $('#turn-banner');` :

```js
this.potBadge = $('#pot-badge');
```

et après la méthode `setTurnBanner` :

```js
// ------------------------------------------------- cagnotte du Parc Gratuit
setPot(amount) {
  this.potBadge.textContent = `🅿️ Cagnotte : ${formatMoney(amount)}`;
  this.potBadge.classList.remove('hidden');
}
```

**c)** Dans `src/main.js`, dans l'objet `view`, après `updatePlayers` :

```js
setPot: (amount) => ui.setPot(amount),
```

et après le premier `ui.updatePlayers();` (ligne ~230), afficher l'état initial (0 en partie neuve, montant restauré en reprise) :

```js
if (game.rules.freeParkingPot) ui.setPot(game.pot);
```

**d)** Dans `src/ui/styles.css`, après le bloc `#turn-banner` :

```css
#pot-badge {
  top: 62px; left: 50%; transform: translateX(-50%);
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: 999px;
  padding: 5px 16px;
  font-size: 13px;
  backdrop-filter: blur(10px);
  white-space: nowrap;
}
```

- [ ] **Step 4: Vérifier tests et build**

Run: `node tests/rules.test.mjs`
Expected: PASS — les huit ✅.

Run: `npm test && npm run build`
Expected: PASS — suite complète et build sans erreur.

- [ ] **Step 5: Commit**

```bash
git add index.html src/ui/ui.js src/main.js src/ui/styles.css tests/rules.test.mjs
git commit -m "feat: badge HUD de la cagnotte du Parc Gratuit"
```
