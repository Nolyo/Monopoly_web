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
console.log('✅ cards.js : pioches sérialisables OK');
