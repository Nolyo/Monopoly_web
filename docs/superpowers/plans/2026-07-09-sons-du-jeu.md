# Sons du jeu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner une identité sonore au jeu : 10 bruitages CC0 (Kenney) joués via Web Audio sur les événements marquants, avec bouton mute persisté.

**Architecture:** Un module `src/ui/sound.js` (préchargement `AudioContext`, `playSound(nom)`, mute persisté en localStorage). Le moteur émet un hook optionnel `this.view.sfx?.(nom)` pour 5 événements ; 4 autres sons se branchent dans les wrappers de vue existants de `main.js` ; le pas du pion passe par un nouveau hook `scene.onHop`.

**Tech Stack:** JavaScript vanilla ESM, Web Audio API (aucune dépendance nouvelle), Vite 7 (sert `public/` à la racine), tests Node purs `node:assert/strict`.

## Global Constraints

- Aucune dépendance npm nouvelle : Web Audio API nue uniquement.
- Les 10 noms de sons canoniques, exactement : `dice`, `hop`, `buy`, `pay`, `cash`, `card`, `jail`, `build`, `bankrupt`, `win`. Fichiers : `public/sounds/<nom>.ogg`.
- Clé localStorage du mute : `monopoly3d.muted` (valeur `'1'` = coupé, `'0'` = actif).
- `src/ui/sound.js` n'instancie RIEN au chargement du module (pas d'`AudioContext`, pas d'accès `localStorage` au top-level) : il doit rester importable en Node sans DOM.
- Tout accès audio / localStorage / fetch est en try/catch (ou `.catch`) silencieux : un échec ne casse jamais le jeu (même philosophie que `src/game/storage.js`).
- Dans le moteur, les émissions de son passent exclusivement par `this.view.sfx?.(…)` (optional chaining) : les vues et stubs existants continuent de fonctionner sans modification.
- Aucun changement de la forme du snapshot de sauvegarde ⇒ pas de bump de `VERSION` dans `storage.js`.
- Sons sous licence CC0 (Kenney) ; `public/sounds/CREDITS.md` obligatoire.
- Tous les textes visibles par l'utilisateur sont en français.

---

### Task 1: Banque de sons (assets Kenney CC0)

> **Exécution : par le CONTRÔLEUR, pas par un sous-agent.** Le téléchargement des
> packs doit être validé par l'utilisateur (noms, source, tailles) au moment de
> l'exécution, et la sélection des fichiers demande un jugement au vu du contenu
> réel des archives.

**Files:**
- Create: `public/sounds/dice.ogg`, `hop.ogg`, `buy.ogg`, `pay.ogg`, `cash.ogg`, `card.ogg`, `jail.ogg`, `build.ogg`, `bankrupt.ogg`, `win.ogg`
- Create: `public/sounds/CREDITS.md`

**Interfaces:**
- Produces: les 10 fichiers `.ogg` aux noms canoniques que `sound.js` (Task 2) chargera via `fetch('sounds/<nom>.ogg')`.

- [ ] **Step 1 : Demander l'accord de téléchargement à l'utilisateur** — packs visés (zips, quelques Mo chacun, source kenney.nl) : « Casino Audio », « Impact Sounds », « Music Jingles », « RPG Audio » (+ « Interface Sounds » en secours si un son manque).

- [ ] **Step 2 : Télécharger et extraire dans le scratchpad** (pas dans le projet). Les pages des packs sont `https://kenney.nl/assets/casino-audio`, `.../impact-sounds`, `.../music-jingles`, `.../rpg-audio` ; suivre le lien « Download » de chaque page.

- [ ] **Step 3 : Sélectionner 10 fichiers et les copier sous les noms canoniques.** Table de correspondance (candidats — **adapter aux noms réels trouvés dans les zips**, en choisissant le fichier dont le nom décrit le mieux l'ambiance de la spec) :

| Cible | Pack | Candidat (ordre de préférence) |
|---|---|---|
| `dice.ogg` | Casino Audio | `dieThrow1/2/3` (dés qui roulent) |
| `hop.ogg` | Impact Sounds | `footstep_wood_000`, sinon `impactSoft_light_000` |
| `buy.ogg` | Casino Audio | `chipsStack1/2` (jetons empilés) |
| `pay.ogg` | Casino Audio | `chipLay1/2`, sinon RPG `handleCoins` |
| `cash.ogg` | RPG Audio | `handleCoins`/`handleCoins2` (pièces) |
| `card.ogg` | Casino Audio | `cardSlide1/2` (carte qui glisse) |
| `jail.ogg` | RPG Audio | `doorClose_4` (ou autre `doorClose_*` sec) |
| `build.ogg` | Impact Sounds | `impactWood_medium_000` (ou proche) |
| `bankrupt.ogg` | Music Jingles | un jingle court descendant (« lose ») |
| `win.ogg` | Music Jingles | un jingle court montant (fanfare « win ») |

Les deux jingles sont un choix « meilleure hypothèse » sans écoute : noter dans le rapport qu'ils sont ajustables après écoute par l'utilisateur.

- [ ] **Step 4 : Écrire `public/sounds/CREDITS.md`** :

```markdown
# Crédits audio

Tous les sons de ce dossier proviennent des packs audio de **Kenney**
(https://kenney.nl), publiés sous licence **Creative Commons Zero (CC0)** :

- Casino Audio — https://kenney.nl/assets/casino-audio
- Impact Sounds — https://kenney.nl/assets/impact-sounds
- Music Jingles — https://kenney.nl/assets/music-jingles
- RPG Audio — https://kenney.nl/assets/rpg-audio

Les fichiers ont été renommés d'après l'événement du jeu qu'ils accompagnent.
```

(Compléter la liste des packs si « Interface Sounds » a servi.)

- [ ] **Step 5 : Vérifier** — les 10 fichiers existent, taille > 0, total < 1 Mo :

Run: `Get-ChildItem public/sounds` — attendu : 10 `.ogg` + `CREDITS.md`, aucun fichier à 0 octet.

- [ ] **Step 6 : Commit**

```bash
git add public/sounds
git commit -m "feat: banque de 10 sons CC0 Kenney pour le jeu"
```

---

### Task 2: Module audio `src/ui/sound.js`

**Files:**
- Create: `src/ui/sound.js`
- Create: `tests/sound.test.mjs`
- Modify: `package.json:10` (script `test`)

**Interfaces:**
- Consumes: les fichiers `public/sounds/<nom>.ogg` de la Task 1 (à l'exécution navigateur seulement — les tests Node n'en ont pas besoin).
- Produces: `export const SOUNDS` (table `{ nom: { file, volume } }`) ; `export function initSounds()` ; `export function playSound(name)` ; `export function toggleMute()` → boolean (nouvel état) ; `export function isMuted()` → boolean. Consommés par `main.js` en Task 4.

- [ ] **Step 1 : Écrire le test qui échoue** — créer `tests/sound.test.mjs` :

```js
// Tests du module audio. Node pur : pas d'AudioContext ni de fetch réels —
// on vérifie l'API publique, la persistance du mute et l'innocuité sans DOM.
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Module sound.js : importable sans DOM, mute persisté, no-op sans init
// ---------------------------------------------------------------------------
{
  // localStorage factice AVANT initSounds (le module ne doit rien lire à l'import)
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const { SOUNDS, initSounds, playSound, toggleMute, isMuted } = await import('../src/ui/sound.js');

  // La table couvre exactement les 10 sons de la spec
  assert.deepEqual(
    Object.keys(SOUNDS).sort(),
    ['bankrupt', 'build', 'buy', 'card', 'cash', 'dice', 'hop', 'jail', 'pay', 'win'],
  );
  for (const def of Object.values(SOUNDS)) {
    assert.match(def.file, /^[a-z]+\.ogg$/);
    assert.ok(def.volume > 0 && def.volume <= 1);
  }

  // Sans init : playSound est un no-op silencieux
  playSound('dice');

  // Node n'a pas d'AudioContext : initSounds doit s'en accommoder sans lever
  store.set('monopoly3d.muted', '1');
  initSounds();
  assert.equal(isMuted(), true, 'état mute lu depuis localStorage à init');
  playSound('dice'); // toujours inoffensif

  // toggleMute bascule et persiste
  assert.equal(toggleMute(), false);
  assert.equal(store.get('monopoly3d.muted'), '0');
  assert.equal(toggleMute(), true);
  assert.equal(store.get('monopoly3d.muted'), '1');
  assert.equal(isMuted(), true);

  // localStorage qui lève : toggleMute bascule quand même, sans exception
  globalThis.localStorage = {
    getItem: () => { throw new Error('indisponible'); },
    setItem: () => { throw new Error('indisponible'); },
  };
  assert.equal(toggleMute(), false, 'bascule malgré un stockage cassé');

  console.log('✅ sound.js : table complète, mute persisté, inoffensif sans DOM');
}
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run: `node tests/sound.test.mjs`
Expected: FAIL — `Cannot find module '.../src/ui/sound.js'`

- [ ] **Step 3 : Créer `src/ui/sound.js`** :

```js
// Bruitages du jeu — Web Audio API, sans dépendance.
// Rien n'est instancié au chargement du module : initSounds() est appelée au
// premier clic utilisateur (autorisation audio des navigateurs), et tout échec
// (fichier manquant, API absente, stockage indisponible) est silencieux : le
// jeu fonctionne simplement sans son, comme storage.js pour la sauvegarde.

export const SOUNDS = {
  dice:     { file: 'dice.ogg',     volume: 0.9 },  // dés qui roulent
  hop:      { file: 'hop.ogg',      volume: 0.35 }, // pas du pion, discret
  buy:      { file: 'buy.ogg',      volume: 0.8 },  // achat de propriété
  pay:      { file: 'pay.ogg',      volume: 0.8 },  // argent qui sort
  cash:     { file: 'cash.ogg',     volume: 0.8 },  // argent qui rentre
  card:     { file: 'card.ogg',     volume: 0.9 },  // carte retournée
  jail:     { file: 'jail.ogg',     volume: 0.9 },  // porte de prison
  build:    { file: 'build.ogg',    volume: 0.8 },  // construction
  bankrupt: { file: 'bankrupt.ogg', volume: 0.9 },  // jingle de faillite
  win:      { file: 'win.ogg',      volume: 1.0 },  // fanfare de victoire
};

const MUTE_KEY = 'monopoly3d.muted';

let ctx = null;      // AudioContext (null tant qu'initSounds n'a pas réussi)
let master = null;   // gain maître (0 quand le son est coupé)
const buffers = {};  // nom → AudioBuffer décodé
let muted = false;

export function isMuted() {
  return muted;
}

export function initSounds() {
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { muted = false; }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    return;
  }
  for (const [name, def] of Object.entries(SOUNDS)) {
    fetch(`sounds/${def.file}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((data) => ctx.decodeAudioData(data))
      .then((audio) => { buffers[name] = audio; })
      .catch(() => {}); // fichier manquant : le jeu tourne sans ce son
  }
}

export function playSound(name) {
  try {
    if (!ctx || !buffers[name] || muted) return;
    if (ctx.state === 'suspended') ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buffers[name];
    const gain = ctx.createGain();
    gain.gain.value = SOUNDS[name].volume;
    src.connect(gain).connect(master);
    src.start();
  } catch { /* le son ne doit jamais casser le jeu */ }
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 1;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* non persisté */ }
  return muted;
}
```

- [ ] **Step 4 : Vérifier que le test passe**

Run: `node tests/sound.test.mjs`
Expected: PASS — `✅ sound.js : table complète, mute persisté, inoffensif sans DOM`

- [ ] **Step 5 : Brancher le fichier dans `npm test`** — dans `package.json`, remplacer :

```json
    "test": "node tests/save.test.mjs"
```

par :

```json
    "test": "node tests/save.test.mjs && node tests/sound.test.mjs"
```

- [ ] **Step 6 : Vérifier la suite complète**

Run: `npm test`
Expected: PASS — les 4 ✅ de `save.test.mjs` puis le ✅ de `sound.test.mjs`.

- [ ] **Step 7 : Commit**

```bash
git add src/ui/sound.js tests/sound.test.mjs package.json
git commit -m "feat: module audio Web Audio (préchargement, volumes, mute persisté)"
```

---

### Task 3: Émissions `view.sfx` dans le moteur

**Files:**
- Modify: `src/game/engine.js` — `sendToJail` (l.179), `moveBy` (l.187), `buyTile` (l.264), `drawCard` cas `money` (l.318), `charge` (l.368), `build` (l.451)
- Test: `tests/sound.test.mjs` (nouvelle section)

**Interfaces:**
- Consumes: `Game`, vues stub existantes (les appels passent par `this.view.sfx?.(…)` — aucun stub à modifier).
- Produces: le moteur émet `sfx('buy')`, `sfx('pay')`, `sfx('cash')`, `sfx('jail')`, `sfx('build')` ; `main.js` (Task 4) mappera `sfx` → `playSound`.

- [ ] **Step 1 : Écrire les tests qui échouent** — ajouter à la fin de `tests/sound.test.mjs` :

```js
// ---------------------------------------------------------------------------
// Moteur : émissions view.sfx aux bons moments
// ---------------------------------------------------------------------------
{
  const { Game } = await import('../src/game/engine.js');
  const { CHANCE_CARDS, restoreDeck } = await import('../src/game/cards.js');
  const { TILES, GROUPS } = await import('../src/game/data.js');

  // Vue enregistreuse : capture les sfx, no-op pour tout le reste
  const recordingView = (events) => new Proxy({}, {
    get: (_, prop) => (prop === 'sfx' ? (n) => events.push(n) : () => {}),
  });

  const configs = [
    { name: 'A', color: '#e0453a', isAI: false },
    { name: 'B', color: '#3a7de0', isAI: false },
  ];

  // Achat → 'buy'
  {
    const events = [];
    const g = new Game(configs, recordingView(events));
    const idx = TILES.findIndex((t) => t.type === 'property');
    await g.buyTile(g.players[0], idx);
    assert.deepEqual(events, ['buy']);
  }

  // Paiement réussi → 'pay' ; paiement en faillite → PAS de 'pay'
  {
    const events = [];
    const g = new Game(configs, recordingView(events));
    await g.charge(g.players[0], 100, g.players[1], 'test');
    assert.deepEqual(events, ['pay']);
    g.players[0].money = 10; // sans patrimoine : faillite inévitable
    await g.charge(g.players[0], 500, null, 'test');
    assert.deepEqual(events, ['pay'], 'pas de son de paiement quand le paiement échoue');
    assert.equal(g.players[0].bankrupt, true);
  }

  // Passage par la case Départ → 'cash'
  {
    const events = [];
    const g = new Game(configs, recordingView(events));
    g.players[0].pos = 38;
    await g.moveBy(g.players[0], 4);
    assert.deepEqual(events, ['cash']);
  }

  // Carte « recevez de l'argent » → 'cash' (deck forcé sur une carte gain)
  {
    const events = [];
    const g = new Game(configs, recordingView(events));
    const iGain = CHANCE_CARDS.findIndex((c) => c.effect.kind === 'money' && c.effect.amount > 0);
    assert.ok(iGain >= 0, 'il existe une carte Chance qui rapporte');
    g.chance = restoreDeck(CHANCE_CARDS, { order: [iGain], pointer: 0 });
    const before = g.players[0].money;
    await g.drawCard(g.players[0], 'chance');
    assert.deepEqual(events, ['cash']);
    assert.ok(g.players[0].money > before);
  }

  // Envoi en prison → 'jail'
  {
    const events = [];
    const g = new Game(configs, recordingView(events));
    await g.sendToJail(g.players[0]);
    assert.deepEqual(events, ['jail']);
  }

  // Construction → 'build' ; revente → aucun son
  {
    const events = [];
    const g = new Game(configs, recordingView(events));
    const grp = TILES.find((t) => t.type === 'property').group;
    for (const i of GROUPS[grp]) g.tiles[i].owner = 0;
    g.players[0].money = 10000;
    assert.equal(g.build(0, GROUPS[grp][0]), true);
    assert.deepEqual(events, ['build']);
    assert.equal(g.sellHouse(0, GROUPS[grp][0]), true);
    assert.deepEqual(events, ['build'], 'la revente est silencieuse');
  }

  console.log('✅ moteur : sfx émis pour buy/pay/cash/jail/build, silencieux ailleurs');
}
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run: `node tests/sound.test.mjs`
Expected: FAIL — premier `assert.deepEqual(events, ['buy'])` : `[] !== ['buy']`.

- [ ] **Step 3 : Ajouter les 6 émissions dans `src/game/engine.js`** :

Dans `sendToJail` (l.179-185), après `p.pos = JAIL_INDEX;` :

```js
  async sendToJail(p) {
    p.inJail = true;
    p.jailTurns = 0;
    p.pos = JAIL_INDEX;
    this.view.sfx?.('jail');
    await this.view.teleportToken(p, JAIL_INDEX);
    this.view.updatePlayers();
  }
```

Dans `moveBy` (l.187-197), dans le bloc `if (passesGo)` :

```js
    if (passesGo) {
      p.money += GO_SALARY;
      this.view.sfx?.('cash');
      this.view.log(`${p.name} passe par la case Départ et reçoit ${GO_SALARY} €.`, 'good');
      this.view.updatePlayers();
    }
```

Dans `buyTile` (l.264-271), après `tile.owner = p.id;` :

```js
  async buyTile(p, idx) {
    const tile = this.tiles[idx];
    p.money -= tile.price;
    tile.owner = p.id;
    this.view.sfx?.('buy');
    this.view.log(`${p.name} achète ${tile.name} pour ${tile.price} €.`, 'good');
    this.view.setOwner(idx, p);
    this.view.updatePlayers();
  }
```

Dans `drawCard`, cas `'money'` avec gain (l.318-326) :

```js
      case 'money':
        if (e.amount >= 0) {
          p.money += e.amount;
          this.view.sfx?.('cash');
          this.view.log(`${p.name} reçoit ${e.amount} €.`, 'good');
        } else {
          await this.charge(p, -e.amount, null, 'la carte');
        }
        break;
```

Dans `charge` (l.368-380), dans le bloc du paiement réussi :

```js
    if (p.money >= amount) {
      p.money -= amount;
      if (toPlayer) toPlayer.money += amount;
      this.view.sfx?.('pay');
      this.view.updatePlayers();
      return;
    }
```

Dans `build` (l.451-461), après `t.houses++;` :

```js
    p.money -= t.houseCost;
    t.houses++;
    this.view.sfx?.('build');
    this.view.log(`${p.name} construit ${t.houses === 5 ? 'un hôtel' : 'une maison'} sur ${t.name}.`, 'good');
```

(Rien dans `sellHouse`, `mortgage`, `unmortgage` : la spec ne sonorise que la construction.)

- [ ] **Step 4 : Vérifier que tout passe (y compris la non-régression)**

Run: `npm test`
Expected: PASS — 4 ✅ de `save.test.mjs`, puis les 2 ✅ de `sound.test.mjs`.

- [ ] **Step 5 : Commit**

```bash
git add src/game/engine.js tests/sound.test.mjs
git commit -m "feat: le moteur émet view.sfx pour achat, paiement, gain, prison, construction"
```

---

### Task 4: Intégration — scène, accueil, bouton mute, README

**Files:**
- Modify: `src/3d/scene.js:277` (hook `onHop`), `src/3d/scene.js:494-503` (`hopToken`)
- Modify: `src/main.js` (imports, `startGame`, wrappers de vue, bouton mute)
- Modify: `index.html:21-30` (bouton `#mute-btn` dans `#bottom-right`)
- Modify: `src/ui/styles.css:115-120` (styles `#ctrl-row`, `#mute-btn`)
- Modify: `README.md` (ligne fonctionnalité)

Pas de cycle TDD : c'est de l'intégration navigateur (scène Three.js et DOM,
non testables en Node). Filet : `npm test` (non-régression) + `npm run build`.

- [ ] **Step 1 : Hook `onHop` dans `src/3d/scene.js`.** Au constructeur, après `this.onTileClick = null;` (l.277) :

```js
    this.onTileClick = null;
    this.onHop = null; // son de pas, branché par main.js
```

Dans `hopToken` (l.494), première ligne du corps :

```js
  async hopToken(playerIdx, fromTile, toTile) {
    this.onHop?.();
    const token = this.tokens[playerIdx];
```

- [ ] **Step 2 : Bouton mute dans `index.html`.** Dans `#bottom-right` (l.21-30), envelopper le label vitesse existant dans une ligne avec le bouton :

```html
    <div id="bottom-right">
      <div id="ctrl-row">
        <button id="mute-btn" title="Couper / rétablir le son">🔊</button>
        <label id="speed-label">Vitesse
          <select id="speed">
            <option value="1">×1</option>
            <option value="2">×2</option>
            <option value="3">×3</option>
          </select>
        </label>
      </div>
      <div id="hint">🖱️ Glissez pour tourner la caméra · molette pour zoomer · cliquez sur une case pour voir son titre</div>
    </div>
```

- [ ] **Step 3 : Styles dans `src/ui/styles.css`.** Sous la règle `#speed-label` (l.115-118), ajouter :

```css
#ctrl-row { display: flex; gap: 6px; align-items: stretch; }
#mute-btn {
  background: var(--panel); border: 1px solid var(--panel-border);
  border-radius: 8px; padding: 5px 10px; font-size: 14px;
  color: var(--text); cursor: pointer;
}
#mute-btn:hover { background: #223041; }
```

- [ ] **Step 4 : Branchements dans `src/main.js`.**

Import (en tête, avec les autres imports) :

```js
import { initSounds, playSound, toggleMute, isMuted } from './ui/sound.js';
```

Au début de `startGame` (après `const ui = new UI();`) :

```js
  initSounds(); // appelé après un clic utilisateur : l'audio est autorisé
  const muteBtn = $('#mute-btn');
  muteBtn.textContent = isMuted() ? '🔇' : '🔊';
  muteBtn.onclick = () => { muteBtn.textContent = toggleMute() ? '🔇' : '🔊'; };
```

Dans l'objet `view`, ajouter le mapping (à côté de `log` / `updatePlayers`) :

```js
    sfx: (name) => playSound(name),
```

Wrapper `showDice` — jouer les dés avant l'animation :

```js
    async showDice(d1, d2) {
      playSound('dice');
      ui.log(`🎲 ${d1} + ${d2} = ${d1 + d2}`);
      await scene.rollDice(d1, d2);
    },
```

Wrapper `showCard` — première ligne du corps : `playSound('card');`

Wrapper `onBankruptcy` — première ligne du corps : `playSound('bankrupt');`

Wrapper `announceWinner` :

```js
    announceWinner: (p) => { clearSave(); playSound('win'); return ui.announceWinner(p); },
```

Après `scene.onTileClick = …`, brancher le pas du pion :

```js
  scene.onHop = () => playSound('hop');
```

- [ ] **Step 5 : README.** Dans la liste des fonctionnalités de `README.md`, après la ligne « 💾 Sauvegarde automatique », ajouter :

```markdown
- 🔊 **Bruitages** — dés, déplacements, argent, prison, victoire… (sons CC0 de [Kenney](https://kenney.nl)) ; bouton 🔊/🔇 pour couper le son, choix mémorisé
```

- [ ] **Step 6 : Non-régression et build**

Run: `npm test`
Expected: PASS — 4 ✅ + 2 ✅.

Run: `npm run build`
Expected: build Vite sans erreur ; `dist/sounds/` contient les 10 `.ogg` (copiés depuis `public/`).

- [ ] **Step 7 : Commit**

```bash
git add src/3d/scene.js src/main.js index.html src/ui/styles.css README.md
git commit -m "feat: branchement des sons (scène, moteur, UI) et bouton mute"
```
