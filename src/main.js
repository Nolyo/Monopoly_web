import { Board3D } from './3d/scene.js';
import { Game } from './game/engine.js';
import { UI, escapeHtml } from './ui/ui.js';
import {
  PLAYER_COLORS, STARTING_MONEY_PRESETS, DEFAULT_RULES, formatMoney,
} from './game/data.js';
import { saveGame, loadGame, clearSave } from './game/storage.js';
import { initSounds, playSound, toggleMute, isMuted } from './ui/sound.js';

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
// Écran de configuration
// ---------------------------------------------------------------------------

let playerCount = 4;

function renderCountButtons() {
  const wrap = $('#count-buttons');
  wrap.innerHTML = '';
  for (let n = 2; n <= 6; n++) {
    const btn = document.createElement('button');
    btn.className = `count-btn${n === playerCount ? ' selected' : ''}`;
    btn.textContent = n;
    btn.onclick = () => { playerCount = n; renderCountButtons(); renderPlayerRows(); };
    wrap.appendChild(btn);
  }
}

function renderPlayerRows() {
  const wrap = $('#player-rows');
  const previous = [...wrap.querySelectorAll('.player-row')].map((row) => ({
    name: row.querySelector('input').value,
    isAI: row.querySelector('select').value === 'ai',
  }));
  wrap.innerHTML = '';
  for (let i = 0; i < playerCount; i++) {
    const prev = previous[i];
    const isAI = prev ? prev.isAI : i > 0;
    const name = prev ? prev.name : (i === 0 ? 'Joueur 1' : `IA ${i + 1}`);
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <span class="token-dot big" style="background:${PLAYER_COLORS[i].hex}"></span>
      <input type="text" maxlength="16" value="${name}" />
      <select>
        <option value="human"${isAI ? '' : ' selected'}>🧑 Humain</option>
        <option value="ai"${isAI ? ' selected' : ''}>🤖 IA</option>
      </select>`;
    const input = row.querySelector('input');
    const select = row.querySelector('select');
    select.onchange = () => {
      if (/^(Joueur|IA) \d+$/.test(input.value)) {
        input.value = `${select.value === 'ai' ? 'IA' : 'Joueur'} ${i + 1}`;
      }
    };
    wrap.appendChild(row);
  }
}

renderCountButtons();
renderPlayerRows();

// Remplit le sélecteur d'argent de départ (préréglages, défaut officiel)
function renderMoneySelect() {
  const sel = $('#rule-starting-money');
  for (const amount of STARTING_MONEY_PRESETS) {
    const opt = document.createElement('option');
    opt.value = amount;
    opt.textContent = amount === DEFAULT_RULES.startingMoney
      ? `${formatMoney(amount)} (officiel)` : formatMoney(amount);
    if (amount === DEFAULT_RULES.startingMoney) opt.selected = true;
    sel.appendChild(opt);
  }
}
renderMoneySelect();

// S'il existe une partie sauvegardée, proposer de la reprendre
const save = loadGame();
if (save) {
  const box = $('#resume-box');
  const st = save.state;
  const date = new Date(save.savedAt).toLocaleString('fr-FR', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
  box.querySelector('.resume-meta').textContent = `Tour n°${st.turnCount + 1} — sauvegardée le ${date}`;
  box.querySelector('.resume-players').innerHTML = st.players.map((p) => (
    `<span class="resume-player${p.bankrupt ? ' out' : ''}">`
    + `<span class="token-dot" style="background:${p.color}"></span>${escapeHtml(p.name)}</span>`
  )).join('');
  box.classList.remove('hidden');
  $('#start-btn').textContent = '🎲 Nouvelle partie';
  $('#resume-btn').onclick = () => {
    $('#setup').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    startGame(null, st);
  };
}

$('#start-btn').onclick = () => {
  const configs = [...document.querySelectorAll('.player-row')].map((row, i) => ({
    name: row.querySelector('input').value.trim() || `Joueur ${i + 1}`,
    isAI: row.querySelector('select').value === 'ai',
    color: PLAYER_COLORS[i].hex,
  }));
  const rules = {
    doubleGoSalary: $('#rule-double-go').checked,
    freeParkingPot: $('#rule-parking-pot').checked,
    auctions: $('#rule-auctions').checked,
    startingMoney: Number($('#rule-starting-money').value),
  };
  $('#setup').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  startGame(configs, null, rules);
};

// ---------------------------------------------------------------------------
// Lancement de la partie : moteur ↔ scène 3D ↔ UI
// ---------------------------------------------------------------------------

async function startGame(configs, snapshot = null, rules = {}) {
  const scene = new Board3D($('#app'));
  const ui = new UI();

  initSounds(); // appelé après un clic utilisateur : l'audio est autorisé
  const muteBtn = $('#mute-btn');
  muteBtn.textContent = isMuted() ? '🔇' : '🔊';
  // blur après usage : sinon Espace re-déclencherait le contrôle au lieu des dés
  muteBtn.onclick = () => { muteBtn.textContent = toggleMute() ? '🔇' : '🔊'; muteBtn.blur(); };

  $('#speed').onchange = (e) => { scene.speed = Number(e.target.value); e.target.blur(); };

  // Effets visuels 3D — fire-and-forget : le jeu ne les attend jamais.
  // Garde : un pion retiré de la scène (faillite) annule l'effet en silence.
  // `game` est déclaré plus bas : les handlers ne tournent qu'en cours de partie.
  const fxHandlers = {
    pay({ fromId, toId, amount }) {
      const from = scene.effects.tokenPos(fromId);
      if (!from) return;
      if (toId === null) { scene.effects.bankPayment(from, amount); return; }
      const to = scene.effects.tokenPos(toId);
      if (to) scene.effects.moneyTransfer(from, to, amount);
    },
    gain({ playerId, amount }) {
      const pos = scene.effects.tokenPos(playerId);
      if (pos) scene.effects.gainBurst(pos, amount);
    },
    buy({ playerId, idx }) {
      scene.effects.purchase(idx, game.players[playerId].color);
    },
    build({ idx }) { scene.effects.buildDrop(idx); },
    jail({ playerId }) { scene.effects.jailFlash(playerId); },
  };

  const view = {
    log: (msg, cls) => ui.log(msg, cls),
    updatePlayers: () => ui.updatePlayers(),
    sfx: (name) => playSound(name),
    fx: (type, data) => { try { fxHandlers[type]?.(data); } catch (e) { console.error('fx', type, e); } },

    async onTurnStart(p) {
      ui.setTurnBanner(p);
      ui.updatePlayers();
      scene.hideDice();
      await scene.highlightToken(p.id);
    },

    async waitForRoll(p) {
      if (p.isAI) {
        ui.aiActions(p);
        await scene.delay(650);
      } else {
        await ui.waitForRoll(p);
      }
    },

    async showDice(d1, d2) {
      playSound('dice');
      ui.log(`🎲 ${d1} + ${d2} = ${d1 + d2}`);
      await scene.rollDice(d1, d2);
      if (d1 === d2) scene.effects.diceSparkles();
    },

    moveTokenSteps: (p, from, steps) => scene.moveTokenSteps(p.id, from, steps),
    teleportToken: (p, idx) => scene.teleportToken(p.id, idx),
    setOwner: (idx, player) => scene.setOwner(idx, player ? player.color : null),
    setHouses: (idx, n) => scene.setHouses(idx, n),
    setMortgaged: (idx, m) => scene.setMortgaged(idx, m),

    async showCard(deckName, text, p) {
      playSound('card');
      if (p.isAI) {
        const label = deckName === 'chance' ? '❓ Chance' : '🧰 Caisse';
        ui.log(`${label} (${p.name}) : ${text}`, 'card');
        ui.toast(`${label} — ${text}`);
        await scene.delay(1400);
      } else {
        await ui.showCard(deckName, text, p);
      }
    },

    promptHuman(p, type, data) {
      if (type === 'buy') return ui.promptBuy(p, data.idx);
      if (type === 'auction') return ui.promptAuction(p, data);
      if (type === 'jail') return ui.promptJail(p, data);
      return Promise.resolve(null);
    },

    promptRaiseMoney: (p, amount) => ui.promptRaiseMoney(p, amount),

    async onBankruptcy(p, creditor) {
      playSound('bankrupt');
      await scene.effects.bankruptcy(p.id);
      scene.removeToken(p.id);
      await ui.onBankruptcy(p, creditor);
    },

    managePhase: (p) => ui.managePhase(p),
    aiThink: (ms = 450) => scene.delay(ms),
    async announceWinner(p) {
      clearSave();
      playSound('win');
      scene.effects.confetti();
      await scene.delay(900);
      return ui.announceWinner(p);
    },
  };

  const game = snapshot ? Game.fromSnapshot(snapshot, view) : new Game(configs, view, Math.random, rules);
  game.onAutoSave = saveGame;
  ui.bind(game);

  scene.onTileClick = (idx) => {
    if ($('#modal-root').childElementCount > 0) return;
    ui.showDeed(idx);
  };
  scene.onHop = () => playSound('hop');

  scene.createTokens(game.players);
  if (snapshot) {
    // Replace pions, propriétaires, constructions et hypothèques
    for (const p of game.players) {
      if (p.bankrupt) scene.removeToken(p.id);
      else scene.placeToken(p.id, p.pos, game.players.length);
    }
    game.tiles.forEach((t, i) => {
      if (t.owner !== null) scene.setOwner(i, game.players[t.owner].color);
      if (t.houses > 0) scene.setHouses(i, t.houses);
      if (t.mortgaged) scene.setMortgaged(i, true);
    });
  }
  ui.updatePlayers();
  if (snapshot) {
    const cur = game.players[game.current];
    ui.log(`📂 Partie reprise — au tour de ${cur.name} (tour n°${game.turnCount + 1}).`);
  } else {
    ui.log(`🎩 La partie commence ! Chaque joueur reçoit ${formatMoney(game.rules.startingMoney)}.`);
  }
  await scene.introCamera();
  game.run();
}
