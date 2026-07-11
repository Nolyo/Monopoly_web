import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TILES, GROUP_COLORS } from '../game/data.js';
import { Effects } from './effects.js';

// ---------------------------------------------------------------------------
// Géométrie du plateau : 12×12 unités, cases normales 1×1.5, coins 1.5×1.5.
// Case 0 (Départ) en bas à droite, déplacement dans le sens anti-horaire.
// ---------------------------------------------------------------------------

const BOARD = 13; // taille du plateau (avec bordure)
const H = 6; // demi-taille de la zone des cases

// Rectangle de la case i en coordonnées monde {x0,z0,x1,z1}, + côté (0=bas,1=gauche,2=haut,3=droite)
export function tileRect(i) {
  if (i === 0) return { x0: 4.5, z0: 4.5, x1: 6, z1: 6, side: 0, corner: true };
  if (i < 10) return { x0: 4.5 - i, z0: 4.5, x1: 5.5 - i, z1: 6, side: 0 };
  if (i === 10) return { x0: -6, z0: 4.5, x1: -4.5, z1: 6, side: 1, corner: true };
  if (i < 20) return { x0: -6, z0: 4.5 - (i - 10), x1: -4.5, z1: 5.5 - (i - 10), side: 1 };
  if (i === 20) return { x0: -6, z0: -6, x1: -4.5, z1: -4.5, side: 2, corner: true };
  if (i < 30) return { x0: (i - 21) - 4.5, z0: -6, x1: (i - 21) - 3.5, z1: -4.5, side: 2 };
  if (i === 30) return { x0: 4.5, z0: -6, x1: 6, z1: -4.5, side: 3, corner: true };
  return { x0: 4.5, z0: (i - 31) - 4.5, x1: 6, z1: (i - 31) - 3.5, side: 3 };
}

export function tileCenter(i) {
  const r = tileRect(i);
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
}

// Angle (autour de Y) orientant le repère local d'une case : +z local → bord extérieur
const SIDE_ANGLE = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

function tileLocalToWorld(i, lx, lz) {
  const c = tileCenter(i);
  const a = SIDE_ANGLE[tileRect(i).side];
  return {
    x: c.x + lx * Math.cos(a) + lz * Math.sin(a),
    z: c.z - lx * Math.sin(a) + lz * Math.cos(a),
  };
}

// ---------------------------------------------------------------------------
// Texture du plateau dessinée sur canvas
// ---------------------------------------------------------------------------

const TEX_SIZE = 2560;
const S = TEX_SIZE / BOARD;
const wx = (x) => (x + BOARD / 2) * S;

function wrapText(ctx, text, maxWidth) {
  const words = text.toUpperCase().split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawBoardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');

  // Fond et centre
  ctx.fillStyle = '#0f3d2e';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  ctx.fillStyle = '#cfe3cd';
  ctx.fillRect(wx(-H), wx(-H), 12 * S, 12 * S);

  // Cases
  for (let i = 0; i < 40; i++) drawTile(ctx, i);

  // Bandeau central MONOPOLY
  ctx.save();
  ctx.translate(wx(0), wx(0));
  ctx.rotate(-Math.PI / 4);
  const bw = 7.4 * S; const bh = 1.5 * S;
  ctx.fillStyle = '#d8362a';
  ctx.beginPath();
  ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 18);
  ctx.fill();
  ctx.strokeStyle = '#8f1f16';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${0.92 * S}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MONOPOLY', 0, 6);
  ctx.restore();

  // Zones décoratives Chance / Caisse au centre
  drawCenterCard(ctx, -2.6, 2.4, Math.PI / 4, '#f39422', 'CHANCE', '?');
  drawCenterCard(ctx, 2.6, -2.4, Math.PI / 4, '#5aa2d8', 'CAISSE DE', 'COMMUNAUTÉ');

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawCenterCard(ctx, x, z, angle, color, line1, line2) {
  ctx.save();
  ctx.translate(wx(x), wx(z));
  ctx.rotate(angle);
  const w = 2.4 * S; const h = 1.5 * S;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (line2 === '?') {
    ctx.font = `bold ${0.28 * S}px Arial`;
    ctx.fillText(line1, 0, -0.35 * S);
    ctx.font = `bold ${0.85 * S}px Georgia`;
    ctx.fillText('?', 0, 0.22 * S);
  } else {
    ctx.font = `bold ${0.26 * S}px Arial`;
    ctx.fillText(line1, 0, -0.2 * S);
    ctx.fillText(line2, 0, 0.2 * S);
  }
  ctx.restore();
}

const CORNER_ANGLE = { 0: -Math.PI / 4, 10: Math.PI / 4, 20: (3 * Math.PI) / 4, 30: (-3 * Math.PI) / 4 };

function drawTile(ctx, i) {
  const r = tileRect(i);
  const tile = TILES[i];
  const px0 = wx(r.x0); const pz0 = wx(r.z0);
  const w = (r.x1 - r.x0) * S; const h = (r.z1 - r.z0) * S;

  ctx.fillStyle = '#f5f1e3';
  ctx.fillRect(px0, pz0, w, h);
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 4;
  ctx.strokeRect(px0, pz0, w, h);

  const cx = px0 + w / 2; const cy = pz0 + h / 2;
  ctx.save();
  ctx.translate(cx, cy);

  if (r.corner) {
    ctx.rotate(CORNER_ANGLE[i]);
    drawCornerContent(ctx, i);
    ctx.restore();
    return;
  }

  // Repère local : case de 1 (largeur) × 1.5 (profondeur), bord intérieur en haut
  const angle = [0, Math.PI / 2, Math.PI, -Math.PI / 2][r.side];
  ctx.rotate(angle);
  const W = 1 * S; const D = 1.5 * S;
  const top = -D / 2;

  if (tile.type === 'property') {
    ctx.fillStyle = GROUP_COLORS[tile.group];
    ctx.fillRect(-W / 2, top, W, 0.33 * S);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 4;
    ctx.strokeRect(-W / 2, top, W, 0.33 * S);
  }

  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const nameFont = `bold ${0.115 * S}px Arial`;
  ctx.font = nameFont;

  const nameY = tile.type === 'property' ? top + 0.48 * S : top + 0.3 * S;
  const lines = wrapText(ctx, tile.name, W * 0.9);
  lines.forEach((line, li) => {
    ctx.fillText(line, 0, nameY + li * 0.145 * S, W * 0.92);
  });

  // Icône
  const icons = { chance: '?', chest: '🧰', station: '🚂', utility: tile.icon, tax: '💰' };
  const icon = icons[tile.type];
  if (icon) {
    ctx.font = icon === '?' ? `bold ${0.62 * S}px Georgia` : `${0.42 * S}px Arial`;
    if (icon === '?') ctx.fillStyle = '#c44';
    ctx.fillText(icon, 0, 0.12 * S);
  }

  // Prix
  ctx.fillStyle = '#111';
  ctx.font = `${0.115 * S}px Arial`;
  if (tile.price) ctx.fillText(`${tile.price} €`, 0, D / 2 - 0.16 * S);
  if (tile.type === 'tax') ctx.fillText(`PAYEZ ${tile.amount} €`, 0, D / 2 - 0.16 * S);
  ctx.restore();
}

function drawCornerContent(ctx, i) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#111';
  const f = (size, weight = 'bold') => { ctx.font = `${weight} ${size * S}px Arial`; };
  if (i === 0) {
    f(0.22); ctx.fillText('DÉPART', 0, -0.42 * S);
    ctx.fillStyle = '#d8362a';
    f(0.6, 'bold'); ctx.fillText('⟵', 0, 0.12 * S);
    ctx.fillStyle = '#111';
    f(0.13, ''); ctx.fillText('RECEVEZ 200 €', 0, 0.5 * S);
  } else if (i === 10) {
    f(0.2); ctx.fillText('PRISON', 0, -0.45 * S);
    f(0.55, ''); ctx.fillText('👮', 0, 0.05 * S);
    f(0.13, ''); ctx.fillText('SIMPLE VISITE', 0, 0.48 * S);
  } else if (i === 20) {
    f(0.2); ctx.fillText('PARC', 0, -0.45 * S);
    f(0.55, ''); ctx.fillText('🅿️', 0, 0.05 * S);
    f(0.2); ctx.fillText('GRATUIT', 0, 0.48 * S);
  } else {
    f(0.2); ctx.fillText('ALLEZ EN', 0, -0.45 * S);
    f(0.55, ''); ctx.fillText('🚔', 0, 0.05 * S);
    f(0.2); ctx.fillText('PRISON', 0, 0.48 * S);
  }
}

// ---------------------------------------------------------------------------
// Animation (mini-moteur de tweens)
// ---------------------------------------------------------------------------

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class Board3D {
  constructor(container) {
    this.container = container;
    this.tweens = [];
    this.speed = 1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#101418');
    this.scene.fog = new THREE.Fog('#101418', 30, 70);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(0, 26, 0.01);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 40;
    this.controls.target.set(0, 0, 0);

    this.buildLights();
    this.buildTable();
    this.buildBoard();
    this.buildDice();
    this.effects = new Effects(this);
    this.tokens = [];
    this.houseMeshes = new Map(); // idx -> Group
    this.ownerMarkers = new Map(); // idx -> Mesh
    this.mortgageMarkers = new Map(); // idx -> Mesh

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.onTileClick = null;
    this.onHop = null; // son de pas, branché par main.js
    this.buildHitboxes();
    this.renderer.domElement.addEventListener('pointerdown', (e) => { this.downXY = [e.clientX, e.clientY]; });
    this.renderer.domElement.addEventListener('pointerup', (e) => this.handleClick(e));

    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const now = performance.now();
    this.tweens = this.tweens.filter((tw) => {
      const t = Math.min(1, (now - tw.start) / tw.duration);
      tw.update(tw.ease ? tw.ease(t) : t, t);
      if (t >= 1) { tw.resolve(); return false; }
      return true;
    });
    this.controls.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  tween(duration, update, ease = easeInOut) {
    return new Promise((resolve) => {
      this.tweens.push({ start: performance.now(), duration: duration / this.speed, update, ease, resolve });
    });
  }

  delay(ms) {
    return this.tween(ms, () => {}, null);
  }

  // ----- Construction de la scène -----

  buildLights() {
    this.scene.add(new THREE.AmbientLight('#b8c4d6', 0.9));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    sun.position.set(10, 22, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 12;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#7f9fd4', 0.5);
    fill.position.set(-12, 10, -10);
    this.scene.add(fill);
  }

  buildTable() {
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(19, 19, 1.2, 64),
      new THREE.MeshStandardMaterial({ color: '#3a2a1c', roughness: 0.85 }),
    );
    table.position.y = -0.85;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  buildBoard() {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD + 0.3, 0.5, BOARD + 0.3),
      new THREE.MeshStandardMaterial({ color: '#173b2d', roughness: 0.6 }),
    );
    base.position.y = -0.26;
    base.castShadow = true;
    base.receiveShadow = true;
    this.scene.add(base);

    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD, BOARD),
      new THREE.MeshStandardMaterial({ map: drawBoardTexture(), roughness: 0.75 }),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.001;
    top.receiveShadow = true;
    this.scene.add(top);

    // Bandes de couleur légèrement en relief sur les propriétés
    for (let i = 0; i < 40; i++) {
      const tile = TILES[i];
      if (tile.type !== 'property') continue;
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.96, 0.05, 0.3),
        new THREE.MeshStandardMaterial({ color: GROUP_COLORS[tile.group], roughness: 0.5 }),
      );
      const pos = tileLocalToWorld(i, 0, -0.58);
      band.position.set(pos.x, 0.026, pos.z);
      band.rotation.y = -SIDE_ANGLE[tileRect(i).side];
      band.castShadow = true;
      band.receiveShadow = true;
      this.scene.add(band);
    }
  }

  buildHitboxes() {
    this.hitboxes = [];
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    for (let i = 0; i < 40; i++) {
      const r = tileRect(i);
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(r.x1 - r.x0, 0.3, r.z1 - r.z0), mat,
      );
      const c = tileCenter(i);
      box.position.set(c.x, 0.15, c.z);
      box.userData.tileIndex = i;
      this.scene.add(box);
      this.hitboxes.push(box);
    }
  }

  handleClick(e) {
    if (!this.onTileClick || !this.downXY) return;
    // Ignorer si la caméra a été déplacée (drag)
    if (Math.hypot(e.clientX - this.downXY[0], e.clientY - this.downXY[1]) > 6) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitboxes);
    if (hits.length > 0) this.onTileClick(hits[0].object.userData.tileIndex);
  }

  // ----- Pions -----

  createTokens(players) {
    this.playerCount = players.length;
    this.tokens = players.map((p, i) => {
      const token = this.makeToken(i, p.color);
      token.castShadow = true;
      this.scene.add(token);
      return token;
    });
    players.forEach((p, i) => this.placeToken(i, 0, players.length));
  }

  makeToken(shapeIdx, colorHex) {
    const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3, metalness: 0.45 });
    const g = new THREE.Group();
    const add = (geo, y, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.rotation.x = rx;
      m.castShadow = true;
      g.add(m);
      return m;
    };
    switch (shapeIdx % 6) {
      case 0: // pion classique
        add(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 24), 0.04);
        add(new THREE.ConeGeometry(0.13, 0.34, 24), 0.26);
        add(new THREE.SphereGeometry(0.1, 20, 16), 0.5);
        break;
      case 1: // haut-de-forme
        add(new THREE.CylinderGeometry(0.22, 0.24, 0.05, 24), 0.025);
        add(new THREE.CylinderGeometry(0.14, 0.15, 0.3, 24), 0.2);
        break;
      case 2: // voiture
        add(new THREE.BoxGeometry(0.42, 0.12, 0.2), 0.1);
        add(new THREE.BoxGeometry(0.22, 0.1, 0.17), 0.21);
        break;
      case 3: // chien (stylisé)
        add(new THREE.SphereGeometry(0.14, 18, 14), 0.14).scale.set(1.4, 1, 0.9);
        add(new THREE.SphereGeometry(0.09, 16, 12), 0.3).position.x = 0.16;
        add(new THREE.ConeGeometry(0.045, 0.1, 10), 0.38).position.x = 0.13;
        break;
      case 4: // bateau
        add(new THREE.CylinderGeometry(0.2, 0.09, 0.14, 4), 0.07).rotation.y = Math.PI / 4;
        add(new THREE.BoxGeometry(0.03, 0.34, 0.03), 0.3);
        add(new THREE.ConeGeometry(0.09, 0.2, 4), 0.36).rotation.y = Math.PI / 4;
        break;
      default: // dé à coudre
        add(new THREE.CylinderGeometry(0.12, 0.17, 0.3, 20), 0.15);
        add(new THREE.SphereGeometry(0.12, 16, 12), 0.3);
        break;
    }
    g.scale.setScalar(1.15);
    return g;
  }

  tokenSlotOffset(playerIdx, count) {
    if (count <= 1) return { dx: 0, dz: 0 };
    const cols = count <= 4 ? 2 : 3;
    const col = playerIdx % cols;
    const row = Math.floor(playerIdx / cols);
    const rows = Math.ceil(count / cols);
    return {
      dx: (col - (cols - 1) / 2) * 0.34,
      dz: (row - (rows - 1) / 2) * 0.34,
    };
  }

  tokenWorldPos(playerIdx, tileIdx) {
    const c = tileCenter(tileIdx);
    const { dx, dz } = this.tokenSlotOffset(playerIdx, this.playerCount || 1);
    return { x: c.x + dx, z: c.z + dz };
  }

  placeToken(playerIdx, tileIdx, count) {
    this.playerCount = count ?? this.playerCount;
    const p = this.tokenWorldPos(playerIdx, tileIdx);
    this.tokens[playerIdx].position.set(p.x, 0.03, p.z);
  }

  async hopToken(playerIdx, fromTile, toTile) {
    this.onHop?.();
    const token = this.tokens[playerIdx];
    const a = this.tokenWorldPos(playerIdx, fromTile);
    const b = this.tokenWorldPos(playerIdx, toTile);
    await this.tween(170, (t) => {
      token.position.x = a.x + (b.x - a.x) * t;
      token.position.z = a.z + (b.z - a.z) * t;
      token.position.y = 0.03 + Math.sin(t * Math.PI) * 0.45;
    }, easeInOut);
  }

  async moveTokenSteps(playerIdx, fromTile, steps) {
    const dir = steps >= 0 ? 1 : -1;
    let pos = fromTile;
    for (let s = 0; s < Math.abs(steps); s++) {
      const next = (pos + dir + 40) % 40;
      await this.hopToken(playerIdx, pos, next);
      pos = next;
    }
  }

  async teleportToken(playerIdx, tileIdx) {
    const token = this.tokens[playerIdx];
    const b = this.tokenWorldPos(playerIdx, tileIdx);
    const a = { x: token.position.x, z: token.position.z };
    await this.tween(650, (t) => {
      token.position.x = a.x + (b.x - a.x) * t;
      token.position.z = a.z + (b.z - a.z) * t;
      token.position.y = 0.03 + Math.sin(t * Math.PI) * 2.2;
    });
  }

  removeToken(playerIdx) {
    const token = this.tokens[playerIdx];
    if (token) this.scene.remove(token);
  }

  async highlightToken(playerIdx) {
    const token = this.tokens[playerIdx];
    if (!token) return;
    await this.tween(360, (t) => {
      token.position.y = 0.03 + Math.sin(t * Math.PI) * 0.3;
    });
  }

  // ----- Dés -----

  buildDice() {
    this.dice = [this.makeDie(), this.makeDie()];
    this.dice.forEach((d, i) => {
      d.position.set(i === 0 ? -1.2 : 1.2, 0.35, 3.2);
      d.visible = false;
      this.scene.add(d);
    });
  }

  makeDie() {
    // Matériaux dans l'ordre des faces : +x,-x,+y,-y,+z,-z → valeurs 2,5,1,6,3,4
    const values = [2, 5, 1, 6, 3, 4];
    const mats = values.map((v) => new THREE.MeshStandardMaterial({
      map: this.dieFaceTexture(v), roughness: 0.35,
    }));
    const die = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), mats);
    die.castShadow = true;
    return die;
  }

  dieFaceTexture(value) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f8f6f0';
    ctx.beginPath();
    ctx.roundRect(0, 0, 128, 128, 26);
    ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    const pip = (x, y) => { ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill(); };
    const L = 34; const M = 64; const R = 94;
    const layouts = {
      1: [[M, M]],
      2: [[L, L], [R, R]],
      3: [[L, L], [M, M], [R, R]],
      4: [[L, L], [L, R], [R, L], [R, R]],
      5: [[L, L], [L, R], [M, M], [R, L], [R, R]],
      6: [[L, L], [L, M], [L, R], [R, L], [R, M], [R, R]],
    };
    layouts[value].forEach(([x, y]) => pip(x, y));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Rotation amenant la valeur donnée sur le dessus
  dieOrientation(value) {
    const eulers = {
      1: [0, 0, 0],
      6: [Math.PI, 0, 0],
      2: [0, 0, Math.PI / 2],
      5: [0, 0, -Math.PI / 2],
      3: [-Math.PI / 2, 0, 0],
      4: [Math.PI / 2, 0, 0],
    };
    const [x, y, z] = eulers[value];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
    // Petite rotation aléatoire autour de Y pour un rendu naturel
    const spin = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 1.2,
    );
    return spin.multiply(q);
  }

  async rollDice(v1, v2) {
    const values = [v1, v2];
    const anims = this.dice.map((die, i) => {
      die.visible = true;
      const startQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2,
      ));
      const endQ = this.dieOrientation(values[i]);
      // Tours supplémentaires pour l'effet de roulement
      const axis = new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize();
      const preSpin = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI * 4);
      const midQ = endQ.clone().premultiply(preSpin);
      const x0 = (i === 0 ? -1.2 : 1.2) + (Math.random() - 0.5);
      const z0 = 3.0 + (Math.random() - 0.5);
      return this.tween(950, (t, rawT) => {
        die.position.x = x0;
        die.position.z = z0;
        // chute avec deux rebonds
        const bounce = Math.abs(Math.cos(rawT * Math.PI * 2.5)) * (1 - rawT) ** 1.6;
        die.position.y = 0.35 + bounce * 3.2;
        const q = startQ.clone();
        if (t < 0.75) q.slerp(midQ, t / 0.75);
        else q.copy(midQ).slerp(endQ, (t - 0.75) / 0.25);
        die.quaternion.copy(q);
      }, easeOutCubic);
    });
    await Promise.all(anims);
    await this.delay(450);
  }

  hideDice() {
    this.dice.forEach((d) => { d.visible = false; });
  }

  // ----- Maisons, propriétaires, hypothèques -----

  setHouses(idx, count) {
    const prev = this.houseMeshes.get(idx);
    if (prev) this.scene.remove(prev);
    this.houseMeshes.delete(idx);
    if (count === 0) return;
    const group = new THREE.Group();
    const angle = -SIDE_ANGLE[tileRect(idx).side];
    if (count === 5) {
      group.add(this.makeBuilding('#c0271d', 0.3, 0.22, 0.2));
      const pos = tileLocalToWorld(idx, 0, -0.58);
      group.position.set(pos.x, 0.05, pos.z);
    } else {
      for (let h = 0; h < count; h++) {
        const b = this.makeBuilding('#1d8f3c', 0.15, 0.13, 0.13);
        b.position.x = (h - (count - 1) / 2) * 0.23;
        group.add(b);
      }
      const pos = tileLocalToWorld(idx, 0, -0.58);
      group.position.set(pos.x, 0.05, pos.z);
    }
    group.rotation.y = angle;
    this.scene.add(group);
    this.houseMeshes.set(idx, group);
  }

  makeBuilding(color, w, h, d) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    body.position.y = h / 2;
    body.castShadow = true;
    g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.72, h * 0.7, 4), mat);
    roof.position.y = h + h * 0.33;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);
    return g;
  }

  setOwner(idx, colorHex) {
    const prev = this.ownerMarkers.get(idx);
    if (prev) this.scene.remove(prev);
    this.ownerMarkers.delete(idx);
    if (!colorHex) return;
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.08, 0.14),
      new THREE.MeshStandardMaterial({
        color: colorHex, roughness: 0.3, metalness: 0.3,
        emissive: colorHex, emissiveIntensity: 0.25,
      }),
    );
    const pos = tileLocalToWorld(idx, 0, 0.66);
    marker.position.set(pos.x, 0.04, pos.z);
    marker.rotation.y = -SIDE_ANGLE[tileRect(idx).side];
    marker.castShadow = true;
    this.scene.add(marker);
    this.ownerMarkers.set(idx, marker);
  }

  setMortgaged(idx, mortgaged) {
    const prev = this.mortgageMarkers.get(idx);
    if (prev) this.scene.remove(prev);
    this.mortgageMarkers.delete(idx);
    if (!mortgaged) return;
    const r = tileRect(idx);
    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(r.x1 - r.x0 - 0.08, r.z1 - r.z0 - 0.08),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.55 }),
    );
    const c = tileCenter(idx);
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.set(c.x, 0.015, c.z);
    this.scene.add(overlay);
    this.mortgageMarkers.set(idx, overlay);
  }

  // ----- Caméra -----

  async introCamera() {
    const from = new THREE.Vector3(0, 30, 0.01);
    const to = new THREE.Vector3(0, 10.5, 12.5);
    await this.tween(1800, (t) => {
      this.camera.position.lerpVectors(from, to, t);
      this.camera.lookAt(0, 0, 0);
    });
    this.controls.update();
  }

  async focusTile(idx) {
    const c = tileCenter(idx);
    const target = this.controls.target.clone();
    await this.tween(500, (t) => {
      this.controls.target.set(
        target.x + (c.x * 0.35 - target.x) * t,
        0,
        target.z + (c.z * 0.35 - target.z) * t,
      );
    });
  }
}
