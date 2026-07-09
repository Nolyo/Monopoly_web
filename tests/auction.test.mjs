// Tests des enchères (règle officielle) — exécutable avec : node tests/auction.test.mjs
import assert from 'node:assert/strict';
import { GROUPS } from '../src/game/data.js';
import { Game } from '../src/game/engine.js';

// RNG déterministe pour des tests reproductibles
function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Vue factice qui enregistre les appels à setOwner (et journalise) ;
// `extra` permet d'injecter un promptHuman scripté, tout le reste est no-op.
function makeView(extra = {}) {
  const calls = { setOwner: [], logs: [] };
  const target = {
    setOwner: (idx, player) => calls.setOwner.push([idx, player ? player.id : null]),
    log: (msg) => calls.logs.push(msg),
    ...extra,
  };
  const view = new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : () => {}),
  });
  return { view, calls };
}

const BROWN = GROUPS.brown; // [1, 3] — 60 € chacune
const PAIX = 39; // Rue de la Paix (darkblue, 400 €)

function makeGame(view, configs) {
  return new Game(
    configs ?? [
      { name: 'Alice', color: '#e0453a', isAI: true },
      { name: 'Bob', color: '#3a7de0', isAI: true },
    ],
    view,
    seededRng(1),
  );
}

// --- 1. Une IA motivée remporte l'enchère, paie sa mise ---------------------
{
  const { view, calls } = makeView();
  const g = makeGame(view);
  g.tiles[BROWN[0]].owner = 0; // la case aux enchères complèterait le marron d'Alice
  g.players[1].money = 150; // Bob : plafond nul (réserve de liquidités) → passe
  await g.runAuction(BROWN[1]);
  assert.equal(g.tiles[BROWN[1]].owner, 0);
  assert.equal(g.players[0].money, 1500 - 10); // première mise minimale : 10 €
  assert.equal(g.players[1].money, 150); // le perdant ne paie rien
  assert.deepEqual(calls.setOwner, [[BROWN[1], 0]]);
  assert.ok(calls.logs.some((m) => m.includes('mis aux enchères')));
  assert.ok(calls.logs.some((m) => m.includes('Alice remporte') && m.includes('10')));
}

console.log('✅ engine.js : le gagnant de l\'enchère paie sa mise et devient propriétaire');

// --- 2. Personne n'enchérit : la case reste à la banque ---------------------
{
  const { view, calls } = makeView();
  const g = makeGame(view);
  g.players[0].money = 150;
  g.players[1].money = 150; // plafonds nuls des deux côtés → tout le monde passe
  await g.runAuction(BROWN[1]);
  assert.equal(g.tiles[BROWN[1]].owner, null);
  assert.equal(g.players[0].money, 150);
  assert.equal(g.players[1].money, 150);
  assert.deepEqual(calls.setOwner, []);
  assert.ok(calls.logs.some((m) => m.includes('reste à la banque')));
}

console.log('✅ engine.js : aucune mise → la propriété reste à la banque, aucun débit');

// --- 3. Guerre d'enchères : mises strictement croissantes, terminaison ------
{
  const { view } = makeView();
  const g = makeGame(view);
  // Alice complèterait le groupe (plafond 60 × 1,4 = 84 €) ;
  // Bob veut la bloquer (plafond 60 × 1,1 = 66 €) → Alice doit l'emporter.
  g.tiles[BROWN[0]].owner = 0;
  const bids = [];
  const orig = g.decide.bind(g);
  g.decide = async (q, type, data) => {
    const r = await orig(q, type, data);
    if (type === 'auction' && Number.isInteger(r)) bids.push([q.id, r]);
    return r;
  };
  await g.runAuction(BROWN[1]);
  assert.equal(g.tiles[BROWN[1]].owner, 0); // le plafond le plus haut gagne
  // Mises strictement croissantes (garantie de terminaison)
  for (let i = 1; i < bids.length; i++) assert.ok(bids[i][1] > bids[i - 1][1]);
  const winningBid = bids[bids.length - 1][1];
  assert.equal(bids[bids.length - 1][0], 0);
  assert.ok(winningBid <= 84); // jamais au-dessus de son plafond
  assert.ok(winningBid > 66); // il a fallu dépasser le plafond de Bob
  assert.equal(g.players[0].money, 1500 - winningBid);
  assert.equal(g.players[1].money, 1500);
}

console.log('✅ engine.js : guerre d\'enchères — mises croissantes, le plus offrant gagne');

// --- 4. Un joueur qui passe n'est plus jamais sollicité ----------------------
{
  const { view } = makeView();
  const g = makeGame(view, [
    { name: 'P0', color: '#e0453a', isAI: true },
    { name: 'P1', color: '#3a7de0', isAI: true },
    { name: 'P2', color: '#3ae07d', isAI: true },
  ]);
  const asked = [];
  g.decide = async (q, type, data) => {
    asked.push(q.id);
    if (q.id === 0) return null; // P0 passe dès la première demande
    if (q.id === 1) return data.currentBid + 10; // P1 surenchérit toujours
    return data.currentBid < 40 ? data.currentBid + 10 : null; // P2 lâche à 40 €
  };
  await g.runAuction(PAIX);
  // Séquence attendue : P0 passe, P1 10, P2 20, P1 30, P2 40, P1 50, P2 passe
  assert.equal(asked.filter((id) => id === 0).length, 1); // plus jamais re-sollicité
  assert.equal(g.tiles[PAIX].owner, 1);
  assert.equal(g.players[1].money, 1500 - 50);
  assert.equal(g.players[0].money, 1500);
  assert.equal(g.players[2].money, 1500);
}

console.log('✅ engine.js : passer est définitif — le joueur sort de l\'enchère');

// --- 5. Parcours humain : mises libres via promptHuman -----------------------
{
  const humanBids = [100, 300, 350];
  const prompts = [];
  const { view } = makeView({
    promptHuman: (p, type, data) => {
      assert.equal(type, 'auction');
      prompts.push({ ...data });
      return Promise.resolve(humanBids.shift() ?? null);
    },
  });
  const g = makeGame(view, [
    { name: 'Alice', color: '#e0453a', isAI: false },
    { name: 'Bob', color: '#3a7de0', isAI: true },
  ]);
  // Bob (IA) : plafond 400 × 0,85 = 340 € → l'humaine gagne à 350 €
  await g.runAuction(PAIX);
  assert.equal(g.tiles[PAIX].owner, 0);
  assert.equal(g.players[0].money, 1500 - 350); // en dessous du prix (400 €)
  assert.equal(g.players[1].money, 1500);
  // La première demande part de zéro, les suivantes reflètent la mise de Bob
  assert.equal(prompts[0].currentBid, 0);
  assert.equal(prompts[0].minRaise, 10);
  assert.equal(prompts[1].currentBid, 110);
  assert.equal(prompts[1].highestBidder, 'Bob');
}

console.log('✅ engine.js : un humain enchérit librement (mises via promptHuman)');

// --- 6. resolveOwnable : refus / fonds insuffisants → enchère, achat → non --
{
  // a) Refus d'achat par un humain → la case part aux enchères
  const { view, calls } = makeView({
    promptHuman: (p, type) => Promise.resolve(type === 'buy' ? false : null),
  });
  const g = makeGame(view, [
    { name: 'Alice', color: '#e0453a', isAI: false },
    { name: 'Bob', color: '#3a7de0', isAI: true },
  ]);
  g.players[1].money = 150; // Bob passe aussi
  await g.resolveOwnable(g.players[0], BROWN[1], 7);
  assert.ok(calls.logs.some((m) => m.includes('mis aux enchères')));
  assert.equal(g.tiles[BROWN[1]].owner, null);

  // b) Fonds insuffisants → enchère quand même (l'adversaire peut en profiter)
  const { view: view2, calls: calls2 } = makeView({
    promptHuman: (p, type) => {
      assert.notEqual(type, 'buy'); // pas de proposition d'achat sans les fonds
      return Promise.resolve(null);
    },
  });
  const g2 = makeGame(view2, [
    { name: 'Alice', color: '#e0453a', isAI: false },
    { name: 'Bob', color: '#3a7de0', isAI: true },
  ]);
  g2.players[0].money = 50; // moins que les 60 € de la case
  await g2.resolveOwnable(g2.players[0], BROWN[1], 7);
  assert.ok(calls2.logs.some((m) => m.includes("n'a pas les moyens")));
  assert.equal(g2.tiles[BROWN[1]].owner, 1); // Bob rafle la case à 10 €
  assert.equal(g2.players[1].money, 1500 - 10);

  // c) Achat accepté → AUCUNE enchère
  const { view: view3, calls: calls3 } = makeView({
    promptHuman: (p, type) => Promise.resolve(type === 'buy'),
  });
  const g3 = makeGame(view3, [
    { name: 'Alice', color: '#e0453a', isAI: false },
    { name: 'Bob', color: '#3a7de0', isAI: true },
  ]);
  await g3.resolveOwnable(g3.players[0], BROWN[1], 7);
  assert.equal(g3.tiles[BROWN[1]].owner, 0);
  assert.equal(g3.players[0].money, 1500 - 60); // prix affiché, pas une mise
  assert.ok(!calls3.logs.some((m) => m.includes('enchères')));
}

console.log('✅ engine.js : refus ou fonds insuffisants → enchère ; achat → pas d\'enchère');
