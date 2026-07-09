// Tests des échanges entre joueurs — exécutable avec : node tests/trade.test.mjs
import assert from 'node:assert/strict';
import { GROUPS } from '../src/game/data.js';
import { Game } from '../src/game/engine.js';
import { aiEvaluateTrade } from '../src/game/ai.js';

// RNG déterministe pour des tests reproductibles
function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Vue factice qui enregistre les appels à setOwner (et journalise),
// toute autre méthode appelée par le moteur est un no-op.
function makeView() {
  const calls = { setOwner: [], logs: [] };
  const target = {
    setOwner: (idx, player) => calls.setOwner.push([idx, player ? player.id : null]),
    log: (msg) => calls.logs.push(msg),
  };
  const view = new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : () => {}),
  });
  return { view, calls };
}

const BROWN = GROUPS.brown; // [1, 3]
const ORANGE = GROUPS.orange; // [16, 18, 19]
const PAIX = 39; // Rue de la Paix (darkblue, 400 €)
const GARE = 5; // Gare Montparnasse (station, 200 €)

function makeGame(view) {
  return new Game(
    [{ name: 'Alice', color: '#e0453a', isAI: false }, { name: 'Bob', color: '#3a7de0', isAI: true }],
    view,
    seededRng(1),
  );
}

// --- 1. Échange complet : cases + argent dans les deux sens ----------------
{
  const { view, calls } = makeView();
  const g = makeGame(view);
  g.tiles[BROWN[0]].owner = 0;
  g.tiles[PAIX].owner = 1;
  const offer = {
    fromId: 0, toId: 1, giveTiles: [BROWN[0]], giveMoney: 200, takeTiles: [PAIX], takeMoney: 50,
  };
  assert.equal(g.tradeBlockReason(offer), null);
  assert.equal(g.canTrade(offer), true);
  assert.equal(g.executeTrade(offer), true);
  assert.equal(g.tiles[BROWN[0]].owner, 1);
  assert.equal(g.tiles[PAIX].owner, 0);
  assert.equal(g.players[0].money, 1500 - 200 + 50);
  assert.equal(g.players[1].money, 1500 + 200 - 50);
  // La vue est prévenue avec le NOUVEAU propriétaire de chaque case déplacée
  assert.deepEqual(calls.setOwner, [[BROWN[0], 1], [PAIX, 0]]);
  // Le journal contient un résumé de l'échange
  assert.ok(calls.logs.some((m) => m.includes('échange') && m.includes('Alice') && m.includes('Bob')));
}

console.log('✅ engine.js : executeTrade transfère cases + argent dans les deux sens');

// --- 2. Refus : case non possédée par le donneur ---------------------------
{
  const { view } = makeView();
  const g = makeGame(view);
  g.tiles[BROWN[0]].owner = 1; // appartient à Bob, pas à Alice
  const offer = { fromId: 0, toId: 1, giveTiles: [BROWN[0]], giveMoney: 0, takeTiles: [], takeMoney: 0 };
  assert.notEqual(g.tradeBlockReason(offer), null);
  assert.equal(g.canTrade(offer), false);
  assert.equal(g.executeTrade(offer), false);
  assert.equal(g.tiles[BROWN[0]].owner, 1);
  // Idem côté receveur : takeTiles doit appartenir à toId
  const offer2 = { fromId: 0, toId: 1, giveTiles: [], giveMoney: 0, takeTiles: [PAIX], takeMoney: 0 };
  assert.equal(g.canTrade(offer2), false); // Rue de la Paix est à la banque
}

console.log('✅ engine.js : case non possédée → échange refusé');

// --- 3. Refus : constructions sur le groupe --------------------------------
{
  const { view } = makeView();
  const g = makeGame(view);
  g.tiles[BROWN[0]].owner = 0;
  g.tiles[BROWN[1]].owner = 0;
  g.tiles[BROWN[1]].houses = 2; // maisons sur l'AUTRE case du groupe
  const offer = { fromId: 0, toId: 1, giveTiles: [BROWN[0]], giveMoney: 0, takeTiles: [], takeMoney: 100 };
  assert.equal(g.canTrade(offer), false);
  assert.equal(g.executeTrade(offer), false);
  // et bien sûr avec des maisons sur la case elle-même
  g.tiles[BROWN[1]].houses = 0;
  g.tiles[BROWN[0]].houses = 1;
  assert.equal(g.canTrade(offer), false);
  // sans aucune construction, l'échange redevient possible
  g.tiles[BROWN[0]].houses = 0;
  assert.equal(g.canTrade(offer), true);
}

console.log('✅ engine.js : constructions dans le groupe → échange refusé');

// --- 4. Refus : fonds insuffisants, offre vide, faillite, soi-même ---------
{
  const { view } = makeView();
  const g = makeGame(view);
  g.tiles[BROWN[0]].owner = 0;
  // Fonds insuffisants côté donneur
  assert.equal(g.canTrade({ fromId: 0, toId: 1, giveTiles: [], giveMoney: 2000, takeTiles: [], takeMoney: 0 }), false);
  // Fonds insuffisants côté receveur
  assert.equal(g.canTrade({ fromId: 0, toId: 1, giveTiles: [BROWN[0]], giveMoney: 0, takeTiles: [], takeMoney: 2000 }), false);
  // Montants invalides (négatif, non entier)
  assert.equal(g.canTrade({ fromId: 0, toId: 1, giveTiles: [BROWN[0]], giveMoney: -50, takeTiles: [], takeMoney: 0 }), false);
  assert.equal(g.canTrade({ fromId: 0, toId: 1, giveTiles: [BROWN[0]], giveMoney: 10.5, takeTiles: [], takeMoney: 0 }), false);
  // Offre vide
  assert.equal(g.canTrade({ fromId: 0, toId: 1, giveTiles: [], giveMoney: 0, takeTiles: [], takeMoney: 0 }), false);
  // Échange avec soi-même
  assert.equal(g.canTrade({ fromId: 0, toId: 0, giveTiles: [BROWN[0]], giveMoney: 0, takeTiles: [], takeMoney: 100 }), false);
  // Case non échangeable (case Départ)
  assert.equal(g.canTrade({ fromId: 0, toId: 1, giveTiles: [0], giveMoney: 0, takeTiles: [], takeMoney: 0 }), false);
  // Partenaire en faillite
  g.players[1].bankrupt = true;
  assert.equal(g.canTrade({ fromId: 0, toId: 1, giveTiles: [BROWN[0]], giveMoney: 0, takeTiles: [], takeMoney: 0 }), false);
}

console.log('✅ engine.js : fonds insuffisants / offre vide / faillite / soi-même refusés');

// --- 5. Case hypothéquée : transférée avec son hypothèque ------------------
{
  const { view, calls } = makeView();
  const g = makeGame(view);
  g.tiles[GARE].owner = 0;
  g.tiles[GARE].mortgaged = true;
  const offer = { fromId: 0, toId: 1, giveTiles: [GARE], giveMoney: 0, takeTiles: [], takeMoney: 100 };
  assert.equal(g.canTrade(offer), true); // l'hypothèque n'empêche pas l'échange
  assert.equal(g.executeTrade(offer), true);
  assert.equal(g.tiles[GARE].owner, 1);
  assert.equal(g.tiles[GARE].mortgaged, true); // l'hypothèque suit la propriété
  assert.deepEqual(calls.setOwner, [[GARE, 1]]);
  assert.ok(calls.logs.some((m) => m.includes('hypothèques')));
}

console.log('✅ engine.js : case hypothéquée transférée avec son hypothèque');

// --- 6. IA : accepte une bonne affaire (complète son groupe) ---------------
{
  const { view } = makeView();
  const g = makeGame(view);
  // Bob (IA, id 1) possède 2 des 3 oranges ; Alice a la troisième (180 €)
  g.tiles[ORANGE[1]].owner = 1;
  g.tiles[ORANGE[2]].owner = 1;
  g.tiles[ORANGE[0]].owner = 0;
  const offer = { fromId: 0, toId: 1, giveTiles: [ORANGE[0]], giveMoney: 0, takeTiles: [], takeMoney: 200 };
  // Reçu : 180 × 1,5 (complète le groupe) = 270 ≥ 200 × 1,1 = 220 → accepte
  assert.equal(aiEvaluateTrade(g, g.players[1], offer), true);
  // Mais jamais si ses liquidités tombaient sous 100 €
  g.players[1].money = 250;
  assert.equal(aiEvaluateTrade(g, g.players[1], offer), false);
}

console.log('✅ ai.js : accepte la case qui complète son groupe, garde 100 € de réserve');

// --- 7. IA : refuse de brader une case qui casse son monopole --------------
{
  const { view } = makeView();
  const g = makeGame(view);
  // Bob (IA) possède tout le groupe marron ; Alice offre 60 € pour une case
  g.tiles[BROWN[0]].owner = 1;
  g.tiles[BROWN[1]].owner = 1;
  const offer = { fromId: 0, toId: 1, giveTiles: [], giveMoney: 60, takeTiles: [BROWN[0]], takeMoney: 0 };
  // Reçu : 60 < donné : 60 × 1,3 (casse le monopole) × 1,1 de marge → refuse
  assert.equal(aiEvaluateTrade(g, g.players[1], offer), false);
  // Un prix généreux finit par le convaincre
  const offer2 = { ...offer, giveMoney: 200 };
  assert.equal(aiEvaluateTrade(g, g.players[1], offer2), true);
}

console.log('✅ ai.js : refuse de brader une case de son monopole');

// --- 8. Invariant : tradeBlockReason null ⇔ canTrade true ------------------
{
  const { view } = makeView();
  const g = makeGame(view);
  g.tiles[BROWN[0]].owner = 0;
  g.tiles[PAIX].owner = 1;
  g.tiles[GARE].owner = 0;
  g.tiles[ORANGE[0]].owner = 0;
  g.tiles[ORANGE[1]].owner = 0;
  g.tiles[ORANGE[1]].houses = 3;
  const offers = [
    { fromId: 0, toId: 1, giveTiles: [BROWN[0]], giveMoney: 0, takeTiles: [PAIX], takeMoney: 0 },
    { fromId: 0, toId: 1, giveTiles: [GARE], giveMoney: 100, takeTiles: [], takeMoney: 0 },
    { fromId: 0, toId: 1, giveTiles: [ORANGE[0]], giveMoney: 0, takeTiles: [], takeMoney: 50 }, // maisons dans le groupe
    { fromId: 0, toId: 1, giveTiles: [], giveMoney: 0, takeTiles: [], takeMoney: 0 }, // vide
    { fromId: 0, toId: 0, giveTiles: [BROWN[0]], giveMoney: 0, takeTiles: [], takeMoney: 0 }, // soi-même
    { fromId: 0, toId: 1, giveTiles: [], giveMoney: 9999, takeTiles: [], takeMoney: 0 }, // trop cher
  ];
  for (const o of offers) {
    assert.equal(g.tradeBlockReason(o) === null, g.canTrade(o));
  }
}

console.log('✅ engine.js : tradeBlockReason cohérent avec canTrade OK');
