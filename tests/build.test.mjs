// Tests de la construction de maisons — exécutable avec : node tests/build.test.mjs
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

// Vue factice : toute méthode appelée par le moteur est un no-op
const stubView = new Proxy({}, { get: () => () => {} });

const ORANGE = GROUPS.orange; // groupe de 3 cases (16, 18, 19), houseCost 100

function makeGame() {
  return new Game(
    [{ name: 'Alice', color: '#e0453a', isAI: false }, { name: 'Bob', color: '#3a7de0', isAI: false }],
    stubView,
    seededRng(1),
  );
}

function giveGroup(g, playerId, indices) {
  for (const i of indices) g.tiles[i].owner = playerId;
}

// --- 1. Groupe complet, sans hypothèque, fonds suffisants → construction OK
{
  const g = makeGame();
  giveGroup(g, 0, ORANGE);
  const [a] = ORANGE;
  assert.equal(g.canBuild(0, a), true);
  const before = g.players[0].money;
  assert.equal(g.build(0, a), true);
  assert.equal(g.players[0].money, before - g.tiles[a].houseCost);
  assert.equal(g.tiles[a].houses, 1);
}

console.log('✅ engine.js : construction possible sur un groupe complet');

// --- 2. Groupe incomplet → construction refusée --------------------------
{
  const g = makeGame();
  const [a, b, c] = ORANGE;
  giveGroup(g, 0, [a, b]); // c reste à la banque
  assert.equal(g.canBuild(0, a), false);
  assert.equal(g.build(0, a), false);
  assert.equal(g.tiles[a].houses, 0);
  // même avec c détenu par un adversaire
  g.tiles[c].owner = 1;
  assert.equal(g.canBuild(0, a), false);
  // et l'adversaire ne peut pas construire sur la case d'autrui
  assert.equal(g.canBuild(1, a), false);
}

console.log('✅ engine.js : groupe incomplet → pas de construction');

// --- 3. Une case du groupe hypothéquée → rien de constructible -----------
{
  const g = makeGame();
  giveGroup(g, 0, ORANGE);
  g.tiles[ORANGE[1]].mortgaged = true;
  for (const i of ORANGE) {
    assert.equal(g.canBuild(0, i), false);
    assert.equal(g.build(0, i), false);
  }
  g.tiles[ORANGE[1]].mortgaged = false;
  assert.equal(g.canBuild(0, ORANGE[0]), true);
}

console.log('✅ engine.js : hypothèque dans le groupe → pas de construction');

// --- 4. Construction uniforme : pas de 2e maison avant les voisines ------
{
  const g = makeGame();
  giveGroup(g, 0, ORANGE);
  g.players[0].money = 10000;
  const [a, b, c] = ORANGE;
  assert.equal(g.build(0, a), true); // a = 1
  assert.equal(g.canBuild(0, a), false); // b et c sont encore à 0
  assert.equal(g.canBuild(0, b), true);
  assert.equal(g.canBuild(0, c), true);
  assert.equal(g.build(0, b), true); // b = 1
  assert.equal(g.canBuild(0, a), false); // c toujours à 0
  assert.equal(g.build(0, c), true); // c = 1
  assert.equal(g.canBuild(0, a), true); // niveau uniforme atteint
}

console.log('✅ engine.js : règle de construction uniforme respectée');

// --- 5. Fonds insuffisants → construction refusée -------------------------
{
  const g = makeGame();
  giveGroup(g, 0, ORANGE);
  const [a] = ORANGE;
  g.players[0].money = g.tiles[a].houseCost - 1;
  assert.equal(g.canBuild(0, a), false);
  assert.equal(g.build(0, a), false);
  g.players[0].money = g.tiles[a].houseCost; // le montant exact suffit
  assert.equal(g.canBuild(0, a), true);
}

console.log('✅ engine.js : fonds insuffisants → pas de construction');

// --- 6. Plafond hôtel : 5 niveaux maximum ---------------------------------
{
  const g = makeGame();
  giveGroup(g, 0, ORANGE);
  g.players[0].money = 10000;
  const [a, b, c] = ORANGE;
  for (let niveau = 1; niveau <= 5; niveau++) {
    for (const i of [a, b, c]) assert.equal(g.build(0, i), true);
  }
  assert.equal(g.tiles[a].houses, 5); // hôtel
  assert.equal(g.canBuild(0, a), false);
  assert.equal(g.build(0, a), false);
  assert.equal(g.tiles[a].houses, 5);
}

console.log('✅ engine.js : plafond hôtel (5 niveaux) respecté');

// --- 7. serialize/fromSnapshot : canBuild survit à la restauration -------
{
  const g = makeGame();
  giveGroup(g, 0, ORANGE);
  g.tiles[ORANGE[0]].houses = 1;
  g.tiles[ORANGE[1]].houses = 1;
  g.tiles[ORANGE[2]].houses = 1;
  // Aller-retour par JSON, comme le fera le localStorage
  const snap = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = Game.fromSnapshot(snap, stubView);
  for (const i of ORANGE) {
    assert.equal(g2.tiles[i].owner, 0); // owner reste un nombre, pas une chaîne
    assert.equal(g2.canBuild(0, i), true);
  }
  assert.equal(g2.build(0, ORANGE[0]), true);
  assert.equal(g2.tiles[ORANGE[0]].houses, 2);
}

console.log('✅ engine.js : canBuild après serialize/fromSnapshot OK');

// --- 8. Vente uniforme et remboursement (moitié du prix de la maison) -----
{
  const g = makeGame();
  giveGroup(g, 0, ORANGE);
  g.players[0].money = 10000;
  const [a, b, c] = ORANGE;
  g.build(0, a);
  g.build(0, b);
  g.build(0, c);
  g.build(0, a); // a = 2, b = 1, c = 1
  assert.equal(g.canSellHouse(0, a), true); // a est au maximum du groupe
  assert.equal(g.canSellHouse(0, b), false); // vente uniforme
  assert.equal(g.canSellHouse(0, c), false);
  const before = g.players[0].money;
  assert.equal(g.sellHouse(0, a), true);
  assert.equal(g.players[0].money, before + g.tiles[a].houseCost / 2);
  assert.equal(g.tiles[a].houses, 1);
  // niveau uniforme retrouvé : tout le monde peut vendre
  for (const i of [a, b, c]) assert.equal(g.canSellHouse(0, i), true);
  // sans maison, rien à vendre
  g.sellHouse(0, a);
  assert.equal(g.canSellHouse(0, a), false);
  assert.equal(g.sellHouse(0, a), false);
}

console.log('✅ engine.js : vente uniforme et remboursement OK');

// --- 9. buildBlockReason : cohérent avec canBuild --------------------------
{
  const g = makeGame();
  const [a, b, c] = ORANGE;
  assert.equal(g.buildBlockReason(0, a), null); // case non possédée → pas de bouton
  assert.equal(g.buildBlockReason(0, 0), null); // case Départ (pas une propriété)
  giveGroup(g, 0, [a, b]);
  assert.equal(g.buildBlockReason(0, a), 'Groupe incomplet');
  g.tiles[c].owner = 0;
  assert.equal(g.buildBlockReason(0, a), null); // constructible → pas de raison
  g.tiles[b].mortgaged = true;
  assert.equal(g.buildBlockReason(0, a), 'Hypothèque dans le groupe');
  g.tiles[b].mortgaged = false;
  g.tiles[a].houses = 1;
  assert.equal(g.buildBlockReason(0, a), 'Construction uniforme requise');
  g.tiles[a].houses = 0;
  g.players[0].money = 50;
  assert.equal(g.buildBlockReason(0, a), 'Fonds insuffisants');
  g.players[0].money = 1500;
  for (const i of ORANGE) g.tiles[i].houses = 5;
  assert.equal(g.buildBlockReason(0, a), 'Hôtel déjà construit');
  // invariant : raison nulle ⇔ canBuild vrai (pour une propriété possédée)
  for (const i of ORANGE) {
    assert.equal(g.buildBlockReason(0, i) === null, g.canBuild(0, i));
  }
}

console.log('✅ engine.js : buildBlockReason cohérent avec canBuild OK');
