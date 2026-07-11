import {
  GROUP_COLORS, GROUP_NAMES, formatMoney,
} from '../game/data.js';
import { aiEvaluateTrade } from '../game/ai.js';

const $ = (sel) => document.querySelector(sel);

// Couleur de pastille d'une case possédable (gestion et échanges)
const tileColor = (t) => (t.type === 'property' ? GROUP_COLORS[t.group]
  : t.type === 'station' ? '#2b2b2b' : '#6b6b3a');

// Raccourcis clavier des modales : délai d'armement après ouverture, pour
// qu'un appui destiné au panneau d'actions (dés, fin de tour) ne déclenche
// pas un bouton de la modale qui vient d'apparaître.
const MODAL_KEY_ARM_MS = 300;

// Éléments qui consomment le clavier : aucun raccourci ne s'y applique
// (un bouton focalisé répond déjà nativement à Espace/Entrée).
const isTypingTarget = (el) => ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName);

// Pastille « touche » d'un bouton (même rendu que la barre d'actions)
const KEY_NAMES = { ' ': 'Espace', escape: 'Échap' };
const keyHintHtml = (key) => ` <span class="key-hint"><kbd>${KEY_NAMES[key] || key.toUpperCase()}</kbd></span>`;

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
      if (isTypingTarget(e.target)) return;
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
      btn.onclick = () => { btn.blur(); b.onClick?.(); };
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
        { label: '🔁 Échanger', onClick: () => this.openTradeModal(p) },
      ]);
    });
  }

  managePhase(p) {
    return new Promise((resolve) => {
      this.setActions([
        { label: '🏘️ Gérer mes propriétés', onClick: () => this.openManageModal(p) },
        { label: '🔁 Échanger', onClick: () => this.openTradeModal(p) },
        {
          label: '✅ Fin du tour',
          cls: 'primary',
          onClick: () => { this.clearActions(); resolve(); },
        },
      ]);
    });
  }

  // ------------------------------------------------- modales
  // Chaque bouton peut déclarer `keys` (valeurs de e.key, casse ignorée) ;
  // le bouton `primary` répond aussi à Espace. Délai d'armement : voir
  // MODAL_KEY_ARM_MS. L'écouteur clavier est retiré à la fermeture,
  // quelle que soit la voie de sortie (bouton, touche, clic extérieur).
  showModal(html, buttons, { dismissable = false } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      const box = document.createElement('div');
      box.className = 'modal-box';
      box.innerHTML = html;
      const bar = document.createElement('div');
      bar.className = 'modal-buttons';
      const openedAt = performance.now();
      const done = (value) => {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        resolve(value);
      };
      const byKey = new Map();
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.className = `action-btn ${b.cls || ''}`;
        const keys = (b.keys || []).map((k) => k.toLowerCase());
        if (b.cls === 'primary') keys.unshift(' ');
        btn.innerHTML = b.label + (keys.length ? keyHintHtml(keys[0]) : '');
        btn.onclick = () => done(b.value);
        for (const k of keys) byKey.set(k, btn);
        bar.appendChild(btn);
      }
      const onKey = (e) => {
        if (e.repeat || performance.now() - openedAt < MODAL_KEY_ARM_MS) return;
        if (isTypingTarget(e.target)) return;
        const btn = byKey.get(e.key.toLowerCase());
        if (btn) { e.preventDefault(); btn.click(); return; }
        if (dismissable && e.key === 'Escape') { e.preventDefault(); done(null); }
      };
      document.addEventListener('keydown', onKey);
      box.appendChild(bar);
      overlay.appendChild(box);
      if (dismissable) {
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) done(null);
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
        { label: 'Passer', value: false, keys: ['r', 'Escape'] },
      ],
    );
    return res === true;
  }

  // Modale d'enchère : boutons de relance rapide (×1/×5/×10 la relance
  // minimale) qui misent immédiatement, ou mise libre via le champ numérique.
  // Résout avec le montant misé (entier) ou null si le joueur passe (définitif).
  promptAuction(p, { idx, currentBid, minRaise, highestBidder }) {
    return new Promise((resolve) => {
      const openedAt = performance.now();
      const t = this.game.tiles[idx];
      const minBid = currentBid + minRaise;
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      const box = document.createElement('div');
      box.className = 'modal-box auction-box';
      const statusLine = highestBidder !== null
        ? `Mise actuelle : <b>${formatMoney(currentBid)}</b> par <b>${escapeHtml(highestBidder)}</b>`
        : 'Aucune mise pour le moment.';
      const quick = [minRaise, minRaise * 5, minRaise * 10].map((n) => {
        const bid = currentBid + n;
        return `<button class="mini-btn auction-raise" data-bid="${bid}"${bid > p.money ? ' disabled' : ''}>+${n} € → ${formatMoney(bid)}</button>`;
      }).join('');
      box.innerHTML = `
        <h2>🔨 Enchère — ${escapeHtml(t.name)}</h2>
        ${this.deedHtml(idx)}
        <div class="auction-status">${statusLine}</div>
        <div class="auction-player">
          <span class="token-dot" style="background:${p.color}"></span>
          À vous, <b>${escapeHtml(p.name)}</b> — liquidités : <b>${formatMoney(p.money)}</b>
        </div>
        <div class="auction-quick">${quick}</div>
        <label class="trade-money-label">Mise libre
          <input type="number" class="trade-money auction-input"
            min="${minBid}" max="${p.money}" step="10" value="${minBid}"> €
        </label>`;
      const bar = document.createElement('div');
      bar.className = 'modal-buttons';
      const done = (value) => {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        resolve(value);
      };
      const passBtn = document.createElement('button');
      passBtn.className = 'action-btn';
      passBtn.textContent = 'Passer (définitif)';
      passBtn.onclick = () => done(null);
      bar.appendChild(passBtn);
      const bidBtn = document.createElement('button');
      bidBtn.className = 'action-btn primary';
      bidBtn.innerHTML = `Enchérir${keyHintHtml(' ')}`;
      bar.appendChild(bidBtn);
      box.appendChild(bar);

      const input = box.querySelector('.auction-input');
      const readBid = () => Math.floor(Number(input.value) || 0);
      const update = () => {
        const bid = readBid();
        bidBtn.disabled = bid < minBid || bid > p.money;
      };
      input.oninput = update;
      update();
      bidBtn.onclick = () => {
        const bid = readBid();
        if (bid >= minBid && bid <= p.money) done(bid);
      };
      box.querySelectorAll('.auction-raise').forEach((btn) => {
        btn.onclick = () => done(Number(btn.dataset.bid));
      });
      // Espace = enchérir à la mise affichée. Volontairement AUCUN raccourci
      // pour « Passer (définitif) » : geste irréversible, réservé à la souris.
      const onKey = (e) => {
        if (e.repeat || performance.now() - openedAt < MODAL_KEY_ARM_MS) return;
        if (isTypingTarget(e.target) || e.key !== ' ') return;
        e.preventDefault();
        if (!bidBtn.disabled) bidBtn.click();
      };
      document.addEventListener('keydown', onKey);
      overlay.appendChild(box);
      this.modalRoot.appendChild(overlay);
    });
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
          const houses = t.houses === 5 ? '🏨' : '🏠'.repeat(t.houses);
          // Bouton de construction dérivé d'une seule source (buildBlockReason) :
          // raison nulle → bouton actif ; groupe incomplet (ou case non
          // constructible) → pas de bouton ; autre blocage → bouton grisé + raison.
          const buildReason = g.buildBlockReason(p.id, i);
          const buildBtn = (t.type !== 'property' || buildReason === 'Groupe incomplet') ? ''
            : `<button data-act="build" class="mini-btn"${buildReason ? ` disabled title="${buildReason}"` : ''}>🏠 +${formatMoney(t.houseCost)}</button>${buildReason ? `<span class="manage-hint">${buildReason}</span>` : ''}`;
          html += `<div class="manage-row${t.mortgaged ? ' mortgaged' : ''}">
            <span class="swatch big" style="background:${tileColor(t)}"></span>
            <span class="manage-name">${escapeHtml(t.name)} ${houses}${t.mortgaged ? ' <i>(hyp.)</i>' : ''}</span>
            <span class="manage-actions" data-idx="${i}">
              ${buildBtn}
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

  // ------------------------------------------------- échanges
  // Modale à état (comme openManageModal) : étape 1 = choix du partenaire,
  // étape 2 = composition de l'offre (deux colonnes + argent), puis proposition.
  openTradeModal(p) {
    const g = this.game;
    const partners = g.players.filter((q) => q.id !== p.id && !q.bankrupt);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal-box manage-box trade-box';
    overlay.appendChild(box);
    this.modalRoot.appendChild(overlay);

    const state = { partnerId: null, give: new Set(), take: new Set(), giveMoney: 0, takeMoney: 0 };
    const close = () => overlay.remove();

    const offer = () => ({
      fromId: p.id,
      toId: state.partnerId,
      giveTiles: [...state.give],
      giveMoney: state.giveMoney,
      takeTiles: [...state.take],
      takeMoney: state.takeMoney,
    });

    const summaryText = () => {
      const partner = g.players[state.partnerId];
      return `${p.name} donne ${g.formatTradeSide([...state.give], state.giveMoney)} et reçoit `
        + `${g.formatTradeSide([...state.take], state.takeMoney)} de ${partner.name}.`;
    };

    const addButton = (bar, label, cls, onClick) => {
      const btn = document.createElement('button');
      btn.className = `action-btn ${cls}`;
      btn.textContent = label;
      btn.onclick = onClick;
      bar.appendChild(btn);
      return btn;
    };

    // --- Étape 1 : choix du partenaire ---
    const renderPartnerChoice = () => {
      let html = `<h2>🔁 Échanger — ${escapeHtml(p.name)}</h2>`;
      if (partners.length === 0) {
        html += '<p>Aucun partenaire disponible.</p>';
      } else {
        html += '<p>Avec qui souhaitez-vous échanger ?</p><div class="trade-partners">'
          + partners.map((q) => `
            <button class="trade-partner-btn" data-id="${q.id}">
              <span class="token-dot" style="background:${q.color}"></span>
              <span>${escapeHtml(q.name)}${q.isAI ? ' 🤖' : ''}</span>
              <span class="trade-partner-money">${formatMoney(q.money)}</span>
            </button>`).join('')
          + '</div>';
      }
      box.innerHTML = html;
      const bar = document.createElement('div');
      bar.className = 'modal-buttons';
      addButton(bar, 'Annuler', '', close);
      box.appendChild(bar);
      box.querySelectorAll('.trade-partner-btn').forEach((btn) => {
        btn.onclick = () => { state.partnerId = Number(btn.dataset.id); renderTrade(); };
      });
    };

    // --- Étape 2 : composition de l'offre ---
    const colHtml = (player, side) => {
      const sel = side === 'give' ? state.give : state.take;
      const owned = g.ownedTiles(player.id);
      let rows = owned.map((i) => {
        const t = g.tiles[i];
        // Règle classique : le groupe doit être libre de constructions
        const blocked = g.groupHasBuildings(i);
        return `<div class="trade-row${sel.has(i) ? ' selected' : ''}${blocked ? ' blocked' : ''}"
            data-idx="${i}" data-side="${side}"${blocked ? ' title="Vendez les constructions d\'abord"' : ''}>
          <span class="swatch big" style="background:${tileColor(t)}"></span>
          <span class="trade-name">${escapeHtml(t.name)}${t.mortgaged ? ' <i>(hyp.)</i>' : ''}</span>
          <span class="trade-price">${formatMoney(t.price)}</span>
        </div>`;
      }).join('');
      if (owned.length === 0) rows = '<div class="trade-empty">Aucune propriété</div>';
      return `<div class="trade-col">
        <div class="trade-col-head">
          <span class="token-dot" style="background:${player.color}"></span>
          ${escapeHtml(player.name)} donne
        </div>
        <div class="trade-list">${rows}</div>
        <label class="trade-money-label">Argent
          <input type="number" class="trade-money" data-side="${side}"
            min="0" step="10" max="${player.money}"
            value="${side === 'give' ? state.giveMoney : state.takeMoney}"> €
        </label>
      </div>`;
    };

    const renderTrade = () => {
      const partner = g.players[state.partnerId];
      box.innerHTML = `<h2>🔁 Échange avec ${escapeHtml(partner.name)}</h2>
        <div class="trade-cols">${colHtml(p, 'give')}${colHtml(partner, 'take')}</div>
        <div class="trade-summary"></div>
        <div class="trade-reason"></div>`;
      const bar = document.createElement('div');
      bar.className = 'modal-buttons';
      if (partners.length > 1) {
        addButton(bar, '↩️ Partenaire', '', () => {
          state.partnerId = null;
          state.give.clear();
          state.take.clear();
          state.giveMoney = 0;
          state.takeMoney = 0;
          renderPartnerChoice();
        });
      }
      addButton(bar, 'Annuler', '', close);
      const proposeBtn = addButton(bar, 'Proposer', 'primary', () => propose());
      box.appendChild(bar);

      const summaryEl = box.querySelector('.trade-summary');
      const reasonEl = box.querySelector('.trade-reason');
      const update = () => {
        const reason = g.tradeBlockReason(offer());
        summaryEl.textContent = summaryText();
        reasonEl.textContent = reason ?? '';
        proposeBtn.disabled = reason !== null;
      };

      box.querySelectorAll('.trade-row:not(.blocked)').forEach((row) => {
        row.onclick = () => {
          const idx = Number(row.dataset.idx);
          const sel = row.dataset.side === 'give' ? state.give : state.take;
          if (sel.has(idx)) sel.delete(idx);
          else sel.add(idx);
          row.classList.toggle('selected');
          update();
        };
      });
      box.querySelectorAll('.trade-money').forEach((input) => {
        input.oninput = () => {
          const v = Math.max(0, Math.floor(Number(input.value) || 0));
          if (input.dataset.side === 'give') state.giveMoney = v;
          else state.takeMoney = v;
          update();
        };
      });
      update();
    };

    const propose = async () => {
      const o = offer();
      if (g.tradeBlockReason(o) !== null) return;
      const partner = g.players[state.partnerId];
      if (partner.isAI) {
        if (aiEvaluateTrade(g, partner, o)) {
          close();
          g.executeTrade(o);
          this.toast(`🤝 ${partner.name} accepte l'échange !`);
        } else {
          this.toast(`❌ ${partner.name} refuse l'échange.`);
        }
        return;
      }
      // Partenaire humain (même appareil) : on lui adresse la confirmation
      const res = await this.showModal(
        `<h2>🤝 Proposition d'échange</h2>
         <p><b>${escapeHtml(partner.name)}</b>, acceptes-tu cet échange ?</p>
         <div class="trade-summary">${escapeHtml(summaryText())}</div>`,
        [
          { label: 'Refuser', value: false },
          { label: 'Accepter', value: true, cls: 'primary' },
        ],
      );
      if (res === true) {
        close();
        g.executeTrade(o);
      }
      // Refus : la modale d'échange reste ouverte, sélections conservées
    };

    // Un seul adversaire possible : on saute l'étape de sélection
    if (partners.length === 1) {
      state.partnerId = partners[0].id;
      renderTrade();
    } else {
      renderPartnerChoice();
    }
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
