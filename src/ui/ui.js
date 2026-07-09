import {
  GROUPS, GROUP_COLORS, GROUP_NAMES, formatMoney,
} from '../game/data.js';

const $ = (sel) => document.querySelector(sel);

export class UI {
  constructor() {
    this.logEl = $('#log');
    this.playersEl = $('#players');
    this.actionsEl = $('#actions');
    this.modalRoot = $('#modal-root');
    this.turnBanner = $('#turn-banner');
    this.game = null;
    this.speed = 1;

    // Raccourci clavier : Espace déclenche l'action principale (lancer les dés, fin du tour)
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      if (this.modalRoot.childElementCount > 0) return; // les modales ont leurs propres boutons
      const setup = document.querySelector('#setup');
      if (setup && !setup.classList.contains('hidden')) return; // partie non commencée
      const primary = this.actionsEl.querySelector('.action-btn.primary');
      if (!primary || primary.disabled) return;
      e.preventDefault(); // évite le défilement de la page
      primary.click();
    });
  }

  bind(game) {
    this.game = game;
  }

  // ------------------------------------------------- journal
  log(msg, cls = '') {
    const div = document.createElement('div');
    div.className = `log-entry ${cls}`;
    div.textContent = msg;
    this.logEl.appendChild(div);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    while (this.logEl.children.length > 120) this.logEl.firstChild.remove();
  }

  toast(msg) {
    const root = $('#toast-root');
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = msg;
    root.appendChild(div);
    setTimeout(() => div.classList.add('fade'), 2600);
    setTimeout(() => div.remove(), 3200);
  }

  // ------------------------------------------------- panneau joueurs
  updatePlayers() {
    const g = this.game;
    this.playersEl.innerHTML = '';
    for (const p of g.players) {
      const owned = g.ownedTiles(p.id);
      const div = document.createElement('div');
      div.className = `player-card${g.players[g.current] === p && !g.over ? ' active' : ''}${p.bankrupt ? ' bankrupt' : ''}`;
      const swatches = owned.map((i) => {
        const t = g.tiles[i];
        const color = t.type === 'property' ? GROUP_COLORS[t.group]
          : t.type === 'station' ? '#444' : '#8a8a5a';
        return `<span class="swatch${t.mortgaged ? ' mortgaged' : ''}" style="background:${color}" title="${t.name}"></span>`;
      }).join('');
      div.innerHTML = `
        <div class="player-head">
          <span class="token-dot" style="background:${p.color}"></span>
          <span class="player-name">${escapeHtml(p.name)}</span>
          ${p.isAI ? '<span class="ai-badge">IA</span>' : ''}
          ${p.inJail ? '<span class="jail-badge">🔒</span>' : ''}
          ${p.getOutCards > 0 ? `<span class="card-badge">🎫${p.getOutCards}</span>` : ''}
        </div>
        <div class="player-money">${p.bankrupt ? '💀 Faillite' : formatMoney(p.money)}</div>
        <div class="player-props">${swatches}</div>`;
      this.playersEl.appendChild(div);
    }
  }

  setTurnBanner(p) {
    this.turnBanner.innerHTML = `<span class="token-dot" style="background:${p.color}"></span> Tour de <b>${escapeHtml(p.name)}</b>`;
    this.turnBanner.style.borderColor = p.color;
  }

  // ------------------------------------------------- barre d'actions
  setActions(buttons) {
    this.actionsEl.innerHTML = '';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = `action-btn ${b.cls || ''}`;
      btn.innerHTML = b.label;
      if (b.cls === 'primary' && !b.disabled) {
        btn.innerHTML += ' <span class="key-hint"><kbd>Espace</kbd></span>';
      }
      btn.disabled = !!b.disabled;
      // blur après clic : sinon Espace réactiverait le bouton resté focalisé
      btn.onclick = () => { btn.blur(); b.onClick(); };
      this.actionsEl.appendChild(btn);
    }
  }

  clearActions() {
    this.actionsEl.innerHTML = '';
  }

  aiActions(p) {
    this.setActions([{ label: `🤖 ${escapeHtml(p.name)} joue…`, disabled: true }]);
  }

  waitForRoll(p) {
    return new Promise((resolve) => {
      this.setActions([
        {
          label: '🎲 Lancer les dés',
          cls: 'primary',
          onClick: () => { this.clearActions(); resolve(); },
        },
        { label: '🏘️ Gérer', onClick: () => this.openManageModal(p) },
      ]);
    });
  }

  managePhase(p) {
    return new Promise((resolve) => {
      this.setActions([
        { label: '🏘️ Gérer mes propriétés', onClick: () => this.openManageModal(p) },
        {
          label: '✅ Fin du tour',
          cls: 'primary',
          onClick: () => { this.clearActions(); resolve(); },
        },
      ]);
    });
  }

  // ------------------------------------------------- modales
  showModal(html, buttons, { dismissable = false } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      const box = document.createElement('div');
      box.className = 'modal-box';
      box.innerHTML = html;
      const bar = document.createElement('div');
      bar.className = 'modal-buttons';
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.className = `action-btn ${b.cls || ''}`;
        btn.innerHTML = b.label;
        btn.onclick = () => { overlay.remove(); resolve(b.value); };
        bar.appendChild(btn);
      }
      box.appendChild(bar);
      overlay.appendChild(box);
      if (dismissable) {
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) { overlay.remove(); resolve(null); }
        });
      }
      this.modalRoot.appendChild(overlay);
    });
  }

  deedHtml(idx) {
    const g = this.game;
    const t = g.tiles[idx];
    const owner = t.owner !== null ? g.players[t.owner] : null;
    const ownerLine = owner
      ? `<div class="deed-owner"><span class="token-dot" style="background:${owner.color}"></span> ${escapeHtml(owner.name)}${t.mortgaged ? ' — <i>hypothéquée</i>' : ''}</div>`
      : '<div class="deed-owner">À vendre</div>';
    if (t.type === 'property') {
      const rows = [
        ['Loyer terrain nu', t.rents[0]],
        ['— avec groupe complet', t.rents[0] * 2],
        ['Avec 1 maison', t.rents[1]],
        ['Avec 2 maisons', t.rents[2]],
        ['Avec 3 maisons', t.rents[3]],
        ['Avec 4 maisons', t.rents[4]],
        ['Avec un HÔTEL', t.rents[5]],
      ].map(([l, v]) => `<tr><td>${l}</td><td>${formatMoney(v)}</td></tr>`).join('');
      return `
        <div class="deed">
          <div class="deed-band" style="background:${GROUP_COLORS[t.group]}">
            <small>TITRE DE PROPRIÉTÉ — ${GROUP_NAMES[t.group].toUpperCase()}</small>
            <h3>${escapeHtml(t.name)}</h3>
          </div>
          <table class="deed-table">${rows}</table>
          <div class="deed-foot">
            Maison : ${formatMoney(t.houseCost)} · Hôtel : ${formatMoney(t.houseCost)} + 4 maisons<br>
            Hypothèque : ${formatMoney(t.price / 2)} · Prix : <b>${formatMoney(t.price)}</b>
          </div>
          ${ownerLine}
        </div>`;
    }
    if (t.type === 'station') {
      return `
        <div class="deed">
          <div class="deed-band" style="background:#2b2b2b"><small>GARE</small><h3>🚂 ${escapeHtml(t.name)}</h3></div>
          <table class="deed-table">
            <tr><td>1 gare possédée</td><td>25 €</td></tr>
            <tr><td>2 gares</td><td>50 €</td></tr>
            <tr><td>3 gares</td><td>100 €</td></tr>
            <tr><td>4 gares</td><td>200 €</td></tr>
          </table>
          <div class="deed-foot">Hypothèque : 100 € · Prix : <b>200 €</b></div>
          ${ownerLine}
        </div>`;
    }
    if (t.type === 'utility') {
      return `
        <div class="deed">
          <div class="deed-band" style="background:#6b6b3a"><small>SERVICE PUBLIC</small><h3>${t.icon} ${escapeHtml(t.name)}</h3></div>
          <table class="deed-table">
            <tr><td>1 compagnie</td><td>4 × le jet de dés</td></tr>
            <tr><td>2 compagnies</td><td>10 × le jet de dés</td></tr>
          </table>
          <div class="deed-foot">Hypothèque : 75 € · Prix : <b>150 €</b></div>
          ${ownerLine}
        </div>`;
    }
    return `<div class="deed"><div class="deed-band" style="background:#456"><h3>${escapeHtml(t.name)}</h3></div></div>`;
  }

  async promptBuy(p, idx) {
    const t = this.game.tiles[idx];
    const res = await this.showModal(
      `<h2>💼 ${escapeHtml(p.name)}, voulez-vous acheter ?</h2>${this.deedHtml(idx)}`,
      [
        { label: `Acheter (${formatMoney(t.price)})`, value: true, cls: 'primary' },
        { label: 'Passer', value: false },
      ],
    );
    return res === true;
  }

  async promptJail(p, data) {
    const buttons = [];
    if (data.hasCard) buttons.push({ label: '🎫 Utiliser ma carte', value: 'card', cls: 'primary' });
    if (data.canPay) buttons.push({ label: '💶 Payer 50 €', value: 'pay', cls: data.hasCard ? '' : 'primary' });
    buttons.push({ label: '🎲 Tenter un double', value: 'roll' });
    const res = await this.showModal(
      `<h2>🔒 ${escapeHtml(p.name)}, vous êtes en prison</h2>
       <p>Tentative ${data.turn}/3. Comment voulez-vous sortir ?</p>`,
      buttons,
    );
    return res || 'roll';
  }

  async showCard(deckName, text, p) {
    const isChance = deckName === 'chance';
    await this.showModal(
      `<div class="draw-card ${isChance ? 'chance' : 'chest'}">
        <div class="draw-card-head">${isChance ? '❓ CHANCE' : '🧰 CAISSE DE COMMUNAUTÉ'}</div>
        <div class="draw-card-body">${escapeHtml(text)}</div>
        <div class="draw-card-player"><span class="token-dot" style="background:${p.color}"></span> ${escapeHtml(p.name)}</div>
      </div>`,
      [{ label: 'OK', value: true, cls: 'primary' }],
    );
  }

  showDeed(idx) {
    return this.showModal(this.deedHtml(idx), [{ label: 'Fermer', value: null }], { dismissable: true });
  }

  // ------------------------------------------------- gestion des propriétés
  openManageModal(p, opts = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      const box = document.createElement('div');
      box.className = 'modal-box manage-box';
      overlay.appendChild(box);
      this.modalRoot.appendChild(overlay);

      const render = () => {
        const g = this.game;
        const target = opts.target || 0;
        const owned = g.ownedTiles(p.id);
        const done = !target || p.money >= target;
        let html = `<h2>🏘️ Propriétés de ${escapeHtml(p.name)}</h2>
          <div class="manage-money">Liquidités : <b>${formatMoney(p.money)}</b>${target ? ` — objectif : <b class="${done ? 'ok' : 'ko'}">${formatMoney(target)}</b>` : ''}</div>`;
        if (owned.length === 0) html += '<p>Aucune propriété pour le moment.</p>';
        html += '<div class="manage-list">';
        for (const i of owned) {
          const t = g.tiles[i];
          const color = t.type === 'property' ? GROUP_COLORS[t.group] : t.type === 'station' ? '#2b2b2b' : '#6b6b3a';
          const houses = t.houses === 5 ? '🏨' : '🏠'.repeat(t.houses);
          // Groupe complet mais construction bloquée → bouton désactivé + raison
          const buildReason = t.type === 'property' && g.ownsFullGroup(p.id, t.group)
            ? g.buildBlockReason(p.id, i) : null;
          html += `<div class="manage-row${t.mortgaged ? ' mortgaged' : ''}">
            <span class="swatch big" style="background:${color}"></span>
            <span class="manage-name">${escapeHtml(t.name)} ${houses}${t.mortgaged ? ' <i>(hyp.)</i>' : ''}</span>
            <span class="manage-actions" data-idx="${i}">
              ${g.canBuild(p.id, i) ? `<button data-act="build" class="mini-btn">🏠 +${formatMoney(t.houseCost)}</button>` : ''}
              ${buildReason ? `<button class="mini-btn" disabled title="${buildReason}">🏠 +${formatMoney(t.houseCost)}</button><span class="manage-hint">${buildReason}</span>` : ''}
              ${g.canSellHouse(p.id, i) ? `<button data-act="sellHouse" class="mini-btn">Vendre 🏠 (+${formatMoney(t.houseCost / 2)})</button>` : ''}
              ${g.canMortgage(p.id, i) ? `<button data-act="mortgage" class="mini-btn">Hypothéquer (+${formatMoney(t.price / 2)})</button>` : ''}
              ${g.canUnmortgage(p.id, i) ? `<button data-act="unmortgage" class="mini-btn">Lever (−${formatMoney(g.unmortgageCost(i))})</button>` : ''}
            </span>
          </div>`;
        }
        html += '</div>';
        box.innerHTML = html;

        const bar = document.createElement('div');
        bar.className = 'modal-buttons';
        if (target && !done) {
          const bkBtn = document.createElement('button');
          bkBtn.className = 'action-btn danger';
          bkBtn.textContent = '💀 Déclarer faillite';
          bkBtn.onclick = () => { overlay.remove(); resolve('bankrupt'); };
          bar.appendChild(bkBtn);
        }
        const closeBtn = document.createElement('button');
        closeBtn.className = 'action-btn primary';
        closeBtn.textContent = target ? (done ? 'Payer et continuer' : 'Payer…') : 'Fermer';
        closeBtn.disabled = !done;
        closeBtn.onclick = () => { overlay.remove(); resolve('done'); };
        bar.appendChild(closeBtn);
        box.appendChild(bar);

        box.querySelectorAll('.manage-actions button').forEach((btn) => {
          btn.onclick = () => {
            const idx = Number(btn.parentElement.dataset.idx);
            const act = btn.dataset.act;
            this.game[act](p.id, idx);
            render();
          };
        });
      };
      render();
    });
  }

  async promptRaiseMoney(p, amount) {
    this.log(`${p.name} doit réunir ${formatMoney(amount)} !`, 'bad');
    const res = await this.openManageModal(p, { target: amount });
    return res;
  }

  async onBankruptcy(p, creditor) {
    await this.showModal(
      `<h2>💀 Faillite !</h2>
       <p><b>${escapeHtml(p.name)}</b> est en faillite.
       ${creditor ? `Ses biens reviennent à <b>${escapeHtml(creditor.name)}</b>.` : 'Ses propriétés retournent à la banque.'}</p>`,
      [{ label: 'Continuer', value: true, cls: 'primary' }],
    );
  }

  async announceWinner(p) {
    await this.showModal(
      `<div class="winner">
        <div class="winner-emoji">🏆</div>
        <h1>${escapeHtml(p.name)} remporte la partie !</h1>
        <p>Fortune finale : <b>${formatMoney(p.money)}</b></p>
      </div>`,
      [{ label: '🔄 Rejouer', value: true, cls: 'primary' }],
    );
    window.location.reload();
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
