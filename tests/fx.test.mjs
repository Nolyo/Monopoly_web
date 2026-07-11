// Tests des émissions view.fx du moteur (effets visuels 3D). Node pur.
// La vue enregistreuse capture TOUS les appels pour vérifier aussi l'ordre
// (le marqueur doit être posé avant que l'effet ne l'anime, etc.).
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { CHANCE_CARDS, restoreDeck } from '../src/game/cards.js';
import { TILES, GROUPS, GO_SALARY } from '../src/game/data.js';

const recordingView = (calls) => new Proxy({}, {
  get: (_, prop) => (...args) => { calls.push({ method: prop, args }); },
});

const fxEvents = (calls) => calls.filter((c) => c.method === 'fx').map((c) => c.args);
const methodIndex = (calls, name) => calls.findIndex((c) => c.method === name);

const configs = [
  { name: 'A', color: '#e0453a', isAI: false },
  { name: 'B', color: '#3a7de0', isAI: false },
  { name: 'C', color: '#3ae07d', isAI: false },
];

// Loyer joueur → joueur
{
  const calls = [];
  const g = new Game(configs, recordingView(calls));
  await g.charge(g.players[0], 50, g.players[1], 'le loyer');
  assert.deepEqual(fxEvents(calls), [['pay', { fromId: 0, toId: 1, amount: 50 }]]);
}

// Taxe (banque) → toId null ; faillite → PAS de fx('pay')
{
  const calls = [];
  const g = new Game(configs, recordingView(calls));
  await g.charge(g.players[0], 100, null, 'la taxe');
  assert.deepEqual(fxEvents(calls), [['pay', { fromId: 0, toId: null, amount: 100 }]]);
  calls.length = 0;
  g.players[1].money = 10; // sans patrimoine : faillite inévitable
  await g.charge(g.players[1], 500, g.players[2], 'le loyer');
  assert.equal(g.players[1].bankrupt, true);
  assert.deepEqual(fxEvents(calls), [], "pas de fx pay quand le paiement échoue");
}

// Achat direct → fx('buy'), émis APRÈS setOwner (le marqueur existe déjà)
{
  const calls = [];
  const g = new Game(configs, recordingView(calls));
  const idx = TILES.findIndex((t) => t.type === 'property');
  await g.buyTile(g.players[0], idx);
  assert.deepEqual(fxEvents(calls), [['buy', { playerId: 0, idx }]]);
  assert.ok(methodIndex(calls, 'setOwner') < methodIndex(calls, 'fx'),
    "setOwner doit précéder le fx buy qui anime le marqueur");
}

// Enchère remportée → fx('buy'), après setOwner
{
  const calls = [];
  const g = new Game(configs, recordingView(calls));
  const idx = TILES.findIndex((t) => t.type === 'property');
  g.decide = async (p) => (p.id === 0 ? 60 : null); // P0 enchérit 60, les autres passent
  await g.runAuction(idx);
  assert.equal(g.tiles[idx].owner, 0);
  assert.deepEqual(fxEvents(calls), [['buy', { playerId: 0, idx }]]);
  assert.ok(methodIndex(calls, 'setOwner') < methodIndex(calls, 'fx'));
}

// Construction → fx('build') après setHouses ; revente sans effet
{
  const calls = [];
  const g = new Game(configs, recordingView(calls));
  const grp = TILES.find((t) => t.type === 'property').group;
  for (const i of GROUPS[grp]) g.tiles[i].owner = 0;
  g.players[0].money = 10000;
  const idx = GROUPS[grp][0];
  assert.equal(g.build(0, idx), true);
  assert.deepEqual(fxEvents(calls), [['build', { idx }]]);
  assert.ok(methodIndex(calls, 'setHouses') < methodIndex(calls, 'fx'),
    "setHouses doit précéder le fx build qui anime la chute");
  calls.length = 0;
  assert.equal(g.sellHouse(0, idx), true);
  assert.deepEqual(fxEvents(calls), [], "la revente est sans effet visuel");
}

// Prison → fx('jail') après l'arrivée du pion (teleportToken)
{
  const calls = [];
  const g = new Game(configs, recordingView(calls));
  await g.sendToJail(g.players[1]);
  assert.deepEqual(fxEvents(calls), [['jail', { playerId: 1 }]]);
  assert.ok(methodIndex(calls, 'teleportToken') < methodIndex(calls, 'fx'),
    "les barres tombent après l'arrivée du pion");
}

// Salaire de la case Départ → fx('gain')
{
  const calls = [];
  const g = new Game(configs, recordingView(calls));
  g.players[0].pos = 38;
  await g.moveBy(g.players[0], 4);
  assert.deepEqual(fxEvents(calls), [['gain', { playerId: 0, amount: GO_SALARY }]]);
}

// Carte « recevez de l'argent » → fx('gain') (deck forcé)
{
  const calls = [];
  const g = new Game(configs, recordingView(calls));
  const iGain = CHANCE_CARDS.findIndex((c) => c.effect.kind === 'money' && c.effect.amount > 0);
  assert.ok(iGain >= 0, "il existe une carte Chance qui rapporte");
  g.chance = restoreDeck(CHANCE_CARDS, { order: [iGain], pointer: 0 });
  await g.drawCard(g.players[0], 'chance');
  assert.deepEqual(fxEvents(calls),
    [['gain', { playerId: 0, amount: CHANCE_CARDS[iGain].effect.amount }]]);
}

// Anniversaire (collectEach) → un fx('pay') par payeur, vers le fêté
{
  const calls = [];
  const g = new Game(configs, recordingView(calls));
  g.chest = { draw: () => ({ text: 'Anniversaire', effect: { kind: 'collectEach', amount: 10 } }) };
  await g.drawCard(g.players[0], 'chest');
  assert.deepEqual(fxEvents(calls), [
    ['pay', { fromId: 1, toId: 0, amount: 10 }],
    ['pay', { fromId: 2, toId: 0, amount: 10 }],
  ]);
}

// Échange avec argent → un fx('pay') par flux non nul
{
  const calls = [];
  const g = new Game(configs, recordingView(calls));
  assert.equal(g.executeTrade({ fromId: 0, toId: 1, giveMoney: 100, takeMoney: 40 }), true);
  assert.deepEqual(fxEvents(calls), [
    ['pay', { fromId: 0, toId: 1, amount: 100 }],
    ['pay', { fromId: 1, toId: 0, amount: 40 }],
  ]);
}

console.log('✅ moteur : fx émis pour pay/gain/buy/build/jail, ordres corrects, silencieux en faillite');
