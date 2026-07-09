import {
  TILES, GROUPS, GO_SALARY, JAIL_FINE, JAIL_INDEX, STARTING_MONEY,
} from './data.js';
import { CHANCE_CARDS, CHEST_CARDS, makeDeck, restoreDeck } from './cards.js';
import { aiDecide, aiManage } from './ai.js';

// Moteur de jeu. Toute l'interaction (3D + UI) passe par l'interface `view`,
// dont les méthodes retournent des promesses (animations, choix du joueur).
export class Game {
  constructor(playerConfigs, view, rng = Math.random) {
    this.view = view;
    this.rng = rng;
    this.tiles = TILES.map((t) => ({ ...t, owner: null, houses: 0, mortgaged: false }));
    this.players = playerConfigs.map((cfg, i) => ({
      id: i,
      name: cfg.name,
      color: cfg.color,
      isAI: cfg.isAI,
      money: STARTING_MONEY,
      pos: 0,
      inJail: false,
      jailTurns: 0,
      getOutCards: 0,
      bankrupt: false,
    }));
    this.chance = makeDeck(CHANCE_CARDS, rng);
    this.chest = makeDeck(CHEST_CARDS, rng);
    this.current = 0;
    this.over = false;
    this.turnCount = 0;
    this.onAutoSave = null; // hook de sauvegarde automatique (branché par main.js)
  }

  // État pur de la partie, sérialisable en JSON. L'enveloppe (version, date)
  // est ajoutée par storage.js.
  serialize() {
    return {
      turnCount: this.turnCount,
      current: this.current,
      players: this.players.map((p) => ({
        name: p.name,
        color: p.color,
        isAI: p.isAI,
        money: p.money,
        pos: p.pos,
        inJail: p.inJail,
        jailTurns: p.jailTurns,
        getOutCards: p.getOutCards,
        bankrupt: p.bankrupt,
      })),
      tiles: this.tiles.map((t) => ({
        owner: t.owner,
        houses: t.houses,
        mortgaged: t.mortgaged,
      })),
      decks: { chance: this.chance.state(), chest: this.chest.state() },
    };
  }

  static fromSnapshot(snap, view, rng = Math.random) {
    const configs = snap.players.map(({ name, color, isAI }) => ({ name, color, isAI }));
    const game = new Game(configs, view, rng);
    snap.players.forEach((sp, i) => Object.assign(game.players[i], sp));
    snap.tiles.forEach((st, i) => Object.assign(game.tiles[i], st));
    game.chance = restoreDeck(CHANCE_CARDS, snap.decks.chance);
    game.chest = restoreDeck(CHEST_CARDS, snap.decks.chest);
    game.current = snap.current;
    game.turnCount = snap.turnCount;
    return game;
  }

  alivePlayers() {
    return this.players.filter((p) => !p.bankrupt);
  }

  async run() {
    while (!this.over) {
      const p = this.players[this.current];
      if (!p.bankrupt) {
        this.onAutoSave?.(this.serialize());
        this.turnCount++;
        await this.playTurn(p);
      }
      if (this.checkEnd()) break;
      this.current = (this.current + 1) % this.players.length;
    }
    const winner = this.alivePlayers()[0];
    await this.view.announceWinner(winner);
  }

  checkEnd() {
    if (this.alivePlayers().length <= 1) {
      this.over = true;
      return true;
    }
    return false;
  }

  rollDie() {
    return 1 + Math.floor(this.rng() * 6);
  }

  async playTurn(p) {
    await this.view.onTurnStart(p);
    if (p.inJail) {
      const takesNormalTurn = await this.handleJail(p);
      if (!takesNormalTurn) {
        if (!p.bankrupt) await this.managePhase(p);
        return;
      }
    }
    let doubles = 0;
    for (;;) {
      await this.view.waitForRoll(p);
      const d1 = this.rollDie();
      const d2 = this.rollDie();
      await this.view.showDice(d1, d2);
      if (d1 === d2) doubles++;
      if (doubles === 3) {
        this.view.log(`${p.name} fait 3 doubles de suite : direction la prison !`, 'bad');
        await this.sendToJail(p);
        break;
      }
      await this.moveBy(p, d1 + d2);
      await this.resolveTile(p, d1 + d2);
      if (p.bankrupt || p.inJail || this.over) break;
      if (d1 !== d2) break;
      this.view.log(`${p.name} a fait un double et rejoue !`);
    }
    if (!p.bankrupt && !this.over) await this.managePhase(p);
  }

  // Retourne true si le joueur est libéré et joue un tour normal (lance les dés).
  async handleJail(p) {
    p.jailTurns++;
    const canPay = p.money >= JAIL_FINE;
    const choice = await this.decide(p, 'jail', { canPay, hasCard: p.getOutCards > 0, turn: p.jailTurns });
    if (choice === 'card' && p.getOutCards > 0) {
      p.getOutCards--;
      this.freeFromJail(p, 'utilise sa carte « Libéré de prison »');
      return true;
    }
    if (choice === 'pay' && canPay) {
      await this.charge(p, JAIL_FINE, null, "l'amende de prison");
      if (p.bankrupt) return false;
      this.freeFromJail(p, `paie ${JAIL_FINE} €`);
      return true;
    }
    // Tentative de double
    const d1 = this.rollDie();
    const d2 = this.rollDie();
    await this.view.showDice(d1, d2);
    if (d1 === d2) {
      this.freeFromJail(p, 'fait un double et sort de prison');
      await this.moveBy(p, d1 + d2);
      await this.resolveTile(p, d1 + d2);
      return false; // sorti par un double : pas de relance
    }
    if (p.jailTurns >= 3) {
      this.view.log(`${p.name} doit payer l'amende après 3 tentatives.`, 'bad');
      await this.charge(p, JAIL_FINE, null, "l'amende de prison");
      if (p.bankrupt) return false;
      this.freeFromJail(p, "paie l'amende");
      await this.moveBy(p, d1 + d2);
      await this.resolveTile(p, d1 + d2);
      return false;
    }
    this.view.log(`${p.name} reste en prison (tentative ${p.jailTurns}/3).`);
    return false;
  }

  freeFromJail(p, how) {
    p.inJail = false;
    p.jailTurns = 0;
    this.view.log(`${p.name} ${how} et sort de prison.`, 'good');
    this.view.updatePlayers();
  }

  async sendToJail(p) {
    p.inJail = true;
    p.jailTurns = 0;
    p.pos = JAIL_INDEX;
    this.view.sfx?.('jail');
    await this.view.teleportToken(p, JAIL_INDEX);
    this.view.updatePlayers();
  }

  async moveBy(p, steps) {
    const from = p.pos;
    const passesGo = from + steps >= 40;
    p.pos = (from + steps) % 40;
    await this.view.moveTokenSteps(p, from, steps);
    if (passesGo) {
      p.money += GO_SALARY;
      this.view.sfx?.('cash');
      this.view.log(`${p.name} passe par la case Départ et reçoit ${GO_SALARY} €.`, 'good');
      this.view.updatePlayers();
    }
  }

  async moveTo(p, tileIdx) {
    const steps = (tileIdx - p.pos + 40) % 40;
    if (steps === 0) return;
    await this.moveBy(p, steps);
  }

  async moveBackward(p, steps) {
    const from = p.pos;
    p.pos = (from - steps + 40) % 40;
    await this.view.moveTokenSteps(p, from, -steps);
  }

  async resolveTile(p, diceSum) {
    const idx = p.pos;
    const tile = this.tiles[idx];
    this.view.log(`${p.name} arrive sur « ${tile.name} ».`);
    switch (tile.type) {
      case 'property':
      case 'station':
      case 'utility':
        await this.resolveOwnable(p, idx, diceSum);
        break;
      case 'tax':
        this.view.log(`${p.name} doit payer ${tile.amount} € (${tile.name}).`, 'bad');
        await this.charge(p, tile.amount, null, tile.name);
        break;
      case 'chance':
        await this.drawCard(p, 'chance');
        break;
      case 'chest':
        await this.drawCard(p, 'chest');
        break;
      case 'gotojail':
        this.view.log(`${p.name} est envoyé en prison !`, 'bad');
        await this.sendToJail(p);
        break;
      default:
        break; // Départ, simple visite, parc gratuit
    }
    this.view.updatePlayers();
  }

  async resolveOwnable(p, idx, diceSum) {
    const tile = this.tiles[idx];
    if (tile.owner === null) {
      if (p.money >= tile.price) {
        const wants = await this.decide(p, 'buy', { idx, tile });
        if (wants) await this.buyTile(p, idx);
        else this.view.log(`${p.name} ne souhaite pas acheter ${tile.name}.`);
      } else {
        this.view.log(`${p.name} n'a pas les moyens d'acheter ${tile.name}.`);
      }
      return;
    }
    if (tile.owner === p.id) return;
    if (tile.mortgaged) {
      this.view.log(`${tile.name} est hypothéquée : pas de loyer.`);
      return;
    }
    const owner = this.players[tile.owner];
    const rent = this.rentOf(idx, diceSum);
    this.view.log(`${p.name} doit ${rent} € de loyer à ${owner.name}.`, 'bad');
    await this.charge(p, rent, owner, `le loyer de ${tile.name}`);
  }

  async buyTile(p, idx) {
    const tile = this.tiles[idx];
    p.money -= tile.price;
    tile.owner = p.id;
    this.view.sfx?.('buy');
    this.view.log(`${p.name} achète ${tile.name} pour ${tile.price} €.`, 'good');
    this.view.setOwner(idx, p);
    this.view.updatePlayers();
  }

  rentOf(idx, diceSum) {
    const tile = this.tiles[idx];
    const owner = this.players[tile.owner];
    if (tile.type === 'station') {
      const n = this.countOwned(owner.id, 'station');
      return 25 * 2 ** (n - 1);
    }
    if (tile.type === 'utility') {
      const n = this.countOwned(owner.id, 'utility');
      return (n === 2 ? 10 : 4) * (diceSum || 7);
    }
    if (tile.houses > 0) return tile.rents[tile.houses];
    const base = tile.rents[0];
    return this.ownsFullGroup(owner.id, tile.group) ? base * 2 : base;
  }

  countOwned(playerId, type) {
    return this.tiles.filter((t) => t.type === type && t.owner === playerId).length;
  }

  ownsFullGroup(playerId, group) {
    return GROUPS[group].every((i) => this.tiles[i].owner === playerId);
  }

  ownedTiles(playerId) {
    const out = [];
    this.tiles.forEach((t, i) => { if (t.owner === playerId) out.push(i); });
    return out;
  }

  netWorth(p) {
    let total = p.money;
    for (const i of this.ownedTiles(p.id)) {
      const t = this.tiles[i];
      if (!t.mortgaged) total += t.price / 2;
      if (t.houses > 0) total += t.houses * (t.houseCost / 2);
    }
    return total;
  }

  async drawCard(p, deckName) {
    const deck = deckName === 'chance' ? this.chance : this.chest;
    const card = deck.draw();
    await this.view.showCard(deckName, card.text, p);
    const e = card.effect;
    switch (e.kind) {
      case 'money':
        if (e.amount >= 0) {
          p.money += e.amount;
          this.view.sfx?.('cash');
          this.view.log(`${p.name} reçoit ${e.amount} €.`, 'good');
        } else {
          await this.charge(p, -e.amount, null, 'la carte');
        }
        break;
      case 'moveTo':
        await this.moveTo(p, e.tile);
        await this.resolveTile(p, 7);
        break;
      case 'moveBack':
        await this.moveBackward(p, e.steps);
        await this.resolveTile(p, 7);
        break;
      case 'jail':
        await this.sendToJail(p);
        break;
      case 'getout':
        p.getOutCards++;
        break;
      case 'repairs': {
        let cost = 0;
        for (const i of this.ownedTiles(p.id)) {
          const t = this.tiles[i];
          if (t.houses === 5) cost += e.perHotel;
          else if (t.houses > 0) cost += t.houses * e.perHouse;
        }
        if (cost > 0) await this.charge(p, cost, null, 'les réparations');
        else this.view.log(`${p.name} n'a rien à réparer.`);
        break;
      }
      case 'collectEach': {
        for (const other of this.alivePlayers()) {
          if (other.id === p.id) continue;
          await this.charge(other, e.amount, p, "l'anniversaire");
          if (this.over) return;
        }
        break;
      }
      default:
        break;
    }
    this.view.updatePlayers();
  }

  // Fait payer `amount` à `p` (à `toPlayer`, ou à la banque si null).
  // Déclenche la liquidation / faillite si nécessaire.
  async charge(p, amount, toPlayer, reason) {
    if (p.money < amount) {
      await this.raiseMoney(p, amount);
    }
    if (p.money >= amount) {
      p.money -= amount;
      if (toPlayer) toPlayer.money += amount;
      this.view.sfx?.('pay');
      this.view.updatePlayers();
      return;
    }
    // Faillite : tout ce qui reste va au créancier
    await this.declareBankruptcy(p, toPlayer, reason);
  }

  async raiseMoney(p, amount) {
    if (p.isAI) {
      aiManage(this, p, { liquidateFor: amount });
      return;
    }
    if (this.netWorth(p) < amount) return; // faillite inévitable
    await this.view.promptRaiseMoney(p, amount);
  }

  async declareBankruptcy(p, creditor, reason) {
    p.bankrupt = true;
    this.view.log(`💀 ${p.name} est en faillite (impossible de payer ${reason}) !`, 'bad');
    if (creditor) creditor.money += p.money;
    p.money = 0;
    for (const i of this.ownedTiles(p.id)) {
      const t = this.tiles[i];
      if (t.houses > 0) {
        const refund = t.houses * (t.houseCost / 2);
        if (creditor) creditor.money += refund;
        t.houses = 0;
        this.view.setHouses(i, 0);
      }
      if (creditor) {
        t.owner = creditor.id;
        this.view.setOwner(i, creditor);
      } else {
        t.owner = null;
        t.mortgaged = false;
        this.view.setOwner(i, null);
        this.view.setMortgaged(i, false);
      }
    }
    if (creditor) p.getOutCards && (creditor.getOutCards += p.getOutCards);
    p.getOutCards = 0;
    await this.view.onBankruptcy(p, creditor);
    this.view.updatePlayers();
    this.checkEnd();
  }

  async managePhase(p) {
    if (p.isAI) {
      aiManage(this, p, {});
      this.view.updatePlayers();
      return;
    }
    await this.view.managePhase(p);
  }

  async decide(p, type, data) {
    if (p.isAI) {
      await this.view.aiThink();
      return aiDecide(this, p, type, data);
    }
    return this.view.promptHuman(p, type, data);
  }

  // ----- Actions de gestion (validées ici, appelées par l'UI ou l'IA) -----

  canBuild(playerId, idx) {
    const t = this.tiles[idx];
    if (t.type !== 'property' || t.owner !== playerId || t.houses >= 5) return false;
    if (!this.ownsFullGroup(playerId, t.group)) return false;
    const group = GROUPS[t.group].map((i) => this.tiles[i]);
    if (group.some((g) => g.mortgaged)) return false;
    const minHouses = Math.min(...group.map((g) => g.houses));
    if (t.houses > minHouses) return false; // construction uniforme
    return this.players[playerId].money >= t.houseCost;
  }

  // Explique pourquoi canBuild refuse : null si la construction est possible,
  // ou si la case n'est pas une propriété du joueur (aucun bouton dans ce cas).
  // Les vérifications doivent rester alignées sur celles de canBuild ci-dessus.
  buildBlockReason(playerId, idx) {
    const t = this.tiles[idx];
    if (t.type !== 'property' || t.owner !== playerId) return null;
    if (t.houses >= 5) return 'Hôtel déjà construit';
    if (!this.ownsFullGroup(playerId, t.group)) return 'Groupe incomplet';
    const group = GROUPS[t.group].map((i) => this.tiles[i]);
    if (group.some((g) => g.mortgaged)) return 'Hypothèque dans le groupe';
    const minHouses = Math.min(...group.map((g) => g.houses));
    if (t.houses > minHouses) return 'Construction uniforme requise';
    if (this.players[playerId].money < t.houseCost) return 'Fonds insuffisants';
    return null;
  }

  build(playerId, idx) {
    if (!this.canBuild(playerId, idx)) return false;
    const t = this.tiles[idx];
    const p = this.players[playerId];
    p.money -= t.houseCost;
    t.houses++;
    this.view.sfx?.('build');
    this.view.log(`${p.name} construit ${t.houses === 5 ? 'un hôtel' : 'une maison'} sur ${t.name}.`, 'good');
    this.view.setHouses(idx, t.houses);
    this.view.updatePlayers();
    return true;
  }

  canSellHouse(playerId, idx) {
    const t = this.tiles[idx];
    if (t.type !== 'property' || t.owner !== playerId || t.houses === 0) return false;
    const group = GROUPS[t.group].map((i) => this.tiles[i]);
    const maxHouses = Math.max(...group.map((g) => g.houses));
    return t.houses === maxHouses; // vente uniforme
  }

  sellHouse(playerId, idx) {
    if (!this.canSellHouse(playerId, idx)) return false;
    const t = this.tiles[idx];
    const p = this.players[playerId];
    t.houses--;
    p.money += t.houseCost / 2;
    this.view.log(`${p.name} revend une construction sur ${t.name} (+${t.houseCost / 2} €).`);
    this.view.setHouses(idx, t.houses);
    this.view.updatePlayers();
    return true;
  }

  canMortgage(playerId, idx) {
    const t = this.tiles[idx];
    if (t.owner !== playerId || t.mortgaged) return false;
    if (t.type === 'property' && GROUPS[t.group].some((i) => this.tiles[i].houses > 0)) return false;
    return true;
  }

  mortgage(playerId, idx) {
    if (!this.canMortgage(playerId, idx)) return false;
    const t = this.tiles[idx];
    const p = this.players[playerId];
    t.mortgaged = true;
    p.money += t.price / 2;
    this.view.log(`${p.name} hypothèque ${t.name} (+${t.price / 2} €).`);
    this.view.setMortgaged(idx, true);
    this.view.updatePlayers();
    return true;
  }

  unmortgageCost(idx) {
    return Math.round(this.tiles[idx].price / 2 * 1.1);
  }

  canUnmortgage(playerId, idx) {
    const t = this.tiles[idx];
    return t.owner === playerId && t.mortgaged
      && this.players[playerId].money >= this.unmortgageCost(idx);
  }

  unmortgage(playerId, idx) {
    if (!this.canUnmortgage(playerId, idx)) return false;
    const t = this.tiles[idx];
    const p = this.players[playerId];
    p.money -= this.unmortgageCost(idx);
    t.mortgaged = false;
    this.view.log(`${p.name} lève l'hypothèque de ${t.name}.`);
    this.view.setMortgaged(idx, false);
    this.view.updatePlayers();
    return true;
  }
}
