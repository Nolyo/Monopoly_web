import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Effets visuels : pièces qui volent, textes flottants, particules, confettis.
// Toutes les animations passent par board.tween() et respectent donc le
// réglage de vitesse. Les méthodes retournent des promesses mais sont conçues
// pour être appelées fire-and-forget : le moteur de jeu ne les attend pas.
// Géométries partagées au niveau module ; les matériaux animés en opacité
// sont clonés par instance puis libérés (dispose) en fin d'effet.
// ---------------------------------------------------------------------------

const COIN_GEO = new THREE.CylinderGeometry(0.09, 0.09, 0.03, 16);
const COIN_MAT = new THREE.MeshStandardMaterial({
  color: '#f4c542', roughness: 0.25, metalness: 0.85,
  emissive: '#8a6a1a', emissiveIntensity: 0.45,
});

export class Effects {
  constructor(board) {
    this.board = board;
  }

  get scene() { return this.board.scene; }

  tween(duration, update, ease) { return this.board.tween(duration, update, ease); }

  // Position monde actuelle du pion, ou null s'il a quitté la scène (faillite)
  tokenPos(playerIdx) {
    const token = this.board.tokens[playerIdx];
    return token && token.parent ? token.position.clone() : null;
  }

  coinCount(amount) {
    return Math.min(10, 3 + Math.ceil(amount / 60));
  }

  // Texte flottant orienté caméra (« −50 € ») : monte puis s'estompe
  floatingText(pos, text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 80px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 256, 64, 480);
    ctx.fillStyle = color;
    ctx.fillText(text, 256, 64, 480);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.4, 0.6, 1);
    sprite.position.set(pos.x, pos.y + 0.9, pos.z);
    this.scene.add(sprite);
    return this.tween(1200, (t) => {
      sprite.position.y = pos.y + 0.9 + t * 0.9;
      mat.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    }).then(() => {
      this.scene.remove(sprite);
      mat.dispose();
      texture.dispose();
    });
  }

  // Une pièce en arc de cloche entre deux points (départ décalé de delayMs),
  // qui s'enfonce et disparaît à l'arrivée
  async coinArc(from, to, delayMs) {
    if (delayMs) await this.board.delay(delayMs);
    const coin = new THREE.Mesh(COIN_GEO, COIN_MAT);
    coin.castShadow = true;
    const mid = from.clone().lerp(to, 0.5);
    mid.y = Math.max(from.y, to.y) + 1.4 + Math.random() * 0.9;
    mid.x += (Math.random() - 0.5) * 1.1;
    mid.z += (Math.random() - 0.5) * 1.1;
    const rx = Math.random() * 8;
    const rz = Math.random() * 8;
    coin.position.copy(from);
    this.scene.add(coin);
    await this.tween(620, (t) => {
      const a = from.clone().lerp(mid, t);
      const b = mid.clone().lerp(to, t);
      coin.position.copy(a.lerp(b, t));
      coin.rotation.x = rx * t;
      coin.rotation.z = rz * t;
    });
    const y0 = coin.position.y;
    await this.tween(180, (t) => {
      coin.scale.setScalar(Math.max(0.001, 1 - t));
      coin.position.y = y0 - t * 0.12;
    });
    this.scene.remove(coin);
  }

  // Une pièce projetée en cloche balistique depuis un point (gerbe de gain)
  async coinBurst(origin, dir, delayMs) {
    if (delayMs) await this.board.delay(delayMs);
    const coin = new THREE.Mesh(COIN_GEO, COIN_MAT);
    coin.castShadow = true;
    const rx = Math.random() * 10;
    coin.position.copy(origin);
    this.scene.add(coin);
    await this.tween(700, (t) => {
      coin.position.set(
        origin.x + dir.x * t,
        origin.y + dir.y * t - 2.6 * t * t,
        origin.z + dir.z * t,
      );
      coin.rotation.x = rx * t;
      coin.scale.setScalar(t > 0.75 ? Math.max(0.001, (1 - t) / 0.25) : 1);
    }, null); // linéaire : la gravité fait la courbe
    this.scene.remove(coin);
  }

  // Paiement joueur → joueur : pièces en arcs étagés + « −X € » / « +X € »
  moneyTransfer(fromPos, toPos, amount) {
    const flights = [];
    for (let i = 0; i < this.coinCount(amount); i++) flights.push(this.coinArc(fromPos, toPos, i * 70));
    return Promise.all([
      ...flights,
      this.floatingText(fromPos, `−${amount} €`, '#ff5a4e'),
      this.floatingText(toPos, `+${amount} €`, '#5bd75b'),
    ]);
  }

  // Paiement à la banque : les pièces plongent vers le centre du plateau
  bankPayment(fromPos, amount) {
    const center = new THREE.Vector3(0, 0.05, 0);
    const flights = [];
    for (let i = 0; i < this.coinCount(amount); i++) flights.push(this.coinArc(fromPos, center, i * 70));
    return Promise.all([
      ...flights,
      this.floatingText(fromPos, `−${amount} €`, '#ff5a4e'),
    ]);
  }

  // Gain : gerbe de pièces au-dessus du pion + « +X € » doré
  gainBurst(pos, amount) {
    const bursts = [];
    for (let i = 0; i < this.coinCount(amount); i++) {
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 1.4,
        1.6 + Math.random() * 0.9,
        (Math.random() - 0.5) * 1.4,
      );
      bursts.push(this.coinBurst(pos, dir, i * 40));
    }
    return Promise.all([
      ...bursts,
      this.floatingText(pos, `+${amount} €`, '#ffd75e'),
    ]);
  }
}
