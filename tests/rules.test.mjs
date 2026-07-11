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
