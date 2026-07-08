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
