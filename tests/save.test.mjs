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
  const fakeState = {
    turnCount: 4, current: 1, players: [], tiles: [], decks: {},
  };
  saveGame(fakeState);
  const loaded = loadGame();
  assert.equal(loaded.version, 1);
  assert.ok(typeof loaded.savedAt === 'string' && loaded.savedAt.length > 0);
  assert.deepEqual(loaded.state, fakeState);

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

  // version correcte mais state mal formé → null + clé nettoyée
  mem.set(KEY, JSON.stringify({ version: 1, savedAt: 'x', state: {} }));
  assert.equal(loadGame(), null);
  assert.equal(mem.has(KEY), false);
  mem.set(KEY, JSON.stringify({ version: 1, savedAt: 'x', state: { players: [], tiles: [] } }));
  assert.equal(loadGame(), null); // decks manquant
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

// --- Moteur : le hook onAutoSave est appelé à chaque tour dans run() -------
{
  const { Game } = await import('../src/game/engine.js');
  // le hook est appelé à chaque tour pendant run(), avant l'incrément de turnCount
  const stubView = new Proxy({}, { get: () => () => {} });
  const g3 = new Game(
    [{ name: 'IA 1', color: '#e0453a', isAI: true }, { name: 'IA 2', color: '#3a7de0', isAI: true }],
    stubView,
    seededRng(42),
  );
  const saves = [];
  g3.onAutoSave = (state) => {
    saves.push(state);
    if (saves.length >= 4) g3.over = true;
  };
  await g3.run();
  assert.equal(saves.length, 4);
  saves.forEach((s, i) => {
    assert.equal(s.turnCount, i); // snapshot pris avant l'incrément
    assert.equal(s.players[s.current].bankrupt, false); // current toujours vivant
  });
}

console.log('✅ engine.js : hook onAutoSave appelé à chaque tour de run() OK');
