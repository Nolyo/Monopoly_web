// Fumigation du module d'effets 3D : Node pur, sans WebGL ni DOM réel.
// Un plateau factice fournit une vraie THREE.Scene et un tween instantané ;
// on vérifie que chaque effet aboutit et nettoie la scène derrière lui.
import assert from 'node:assert/strict';
import * as THREE from 'three';

// document factice : effects.js n'y touche qu'à l'exécution (textures canvas)
const fakeCtx = new Proxy({}, { get: () => () => {}, set: () => true });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }),
};

const { Effects } = await import('../src/3d/effects.js');

function fakeBoard() {
  const scene = new THREE.Scene();
  const mkToken = (x, z) => {
    const g = new THREE.Group();
    g.position.set(x, 0.03, z);
    scene.add(g);
    return g;
  };
  const mkDie = () => new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7));
  const board = {
    scene,
    tokens: [mkToken(4, 4), mkToken(-4, -4)],
    dice: [mkDie(), mkDie()],
    houseMeshes: new Map(),
    ownerMarkers: new Map(),
    tween: (duration, update) => { update(0, 0); update(0.5, 0.5); update(1, 1); return Promise.resolve(); },
    delay: () => Promise.resolve(),
  };
  board.dice.forEach((d) => scene.add(d));
  return board;
}

// Effets argent : création, animation, nettoyage complet de la scène
{
  const board = fakeBoard();
  const fx = new Effects(board);
  const base = board.scene.children.length;
  assert.ok(fx.tokenPos(0) instanceof THREE.Vector3);
  await fx.moneyTransfer(fx.tokenPos(0), fx.tokenPos(1), 75);
  await fx.bankPayment(fx.tokenPos(0), 1500); // gros montant : plafond de pièces
  await fx.gainBurst(fx.tokenPos(1), 200);
  await fx.floatingText(fx.tokenPos(0), '−50 €', '#ff5a4e');
  assert.equal(board.scene.children.length, base, 'les effets argent nettoient la scène');
  assert.equal(fx.coinCount(1e9), 10, 'plafond de pièces par transfert');
  board.scene.remove(board.tokens[1]);
  assert.equal(fx.tokenPos(1), null, 'pion hors scène → null');
  console.log('✅ effects.js : effets argent — création, animation, nettoyage OK');
}
