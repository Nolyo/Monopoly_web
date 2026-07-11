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
