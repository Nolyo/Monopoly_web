import { Board3D } from './3d/scene.js';
import { Game } from './game/engine.js';
import { UI } from './ui/ui.js';
import { PLAYER_COLORS } from './game/data.js';

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

$('#start-btn').onclick = () => {
  const configs = [...document.querySelectorAll('.player-row')].map((row, i) => ({
    name: row.querySelector('input').value.trim() || `Joueur ${i + 1}`,
    isAI: row.querySelector('select').value === 'ai',
    color: PLAYER_COLORS[i].hex,
  }));
  $('#setup').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  startGame(configs);
};

// ---------------------------------------------------------------------------
// Lancement de la partie : moteur ↔ scène 3D ↔ UI
// ---------------------------------------------------------------------------

async function startGame(configs) {
  const scene = new Board3D($('#app'));
  const ui = new UI();

  $('#speed').onchange = (e) => { scene.speed = Number(e.target.value); };

  const view = {
    log: (msg, cls) => ui.log(msg, cls),
    updatePlayers: () => ui.updatePlayers(),

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
      ui.log(`🎲 ${d1} + ${d2} = ${d1 + d2}`);
      await scene.rollDice(d1, d2);
    },

    moveTokenSteps: (p, from, steps) => scene.moveTokenSteps(p.id, from, steps),
    teleportToken: (p, idx) => scene.teleportToken(p.id, idx),
    setOwner: (idx, player) => scene.setOwner(idx, player ? player.color : null),
    setHouses: (idx, n) => scene.setHouses(idx, n),
    setMortgaged: (idx, m) => scene.setMortgaged(idx, m),

    async showCard(deckName, text, p) {
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
      if (type === 'jail') return ui.promptJail(p, data);
      return Promise.resolve(null);
    },

    promptRaiseMoney: (p, amount) => ui.promptRaiseMoney(p, amount),

    async onBankruptcy(p, creditor) {
      scene.removeToken(p.id);
      await ui.onBankruptcy(p, creditor);
    },

    managePhase: (p) => ui.managePhase(p),
    aiThink: () => scene.delay(450),
    announceWinner: (p) => ui.announceWinner(p),
  };

  const game = new Game(configs, view);
  ui.bind(game);

  scene.onTileClick = (idx) => {
    if ($('#modal-root').childElementCount > 0) return;
    ui.showDeed(idx);
  };

  scene.createTokens(game.players);
  ui.updatePlayers();
  ui.log('🎩 La partie commence ! Chaque joueur reçoit 1 500 €.');
  await scene.introCamera();
  game.run();
}
