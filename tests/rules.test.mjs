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
