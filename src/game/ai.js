import { GROUPS } from './data.js';

// IA à heuristiques : achète intelligemment, construit sur ses monopoles,
// gère ses liquidités (hypothèques, ventes) et ses sorties de prison.

const CASH_RESERVE = 200;

function completesGroup(game, p, tile) {
  if (tile.type !== 'property') return false;
  return GROUPS[tile.group].every((i) => {
    const t = game.tiles[i];
    return t === tile || t.owner === p.id;
  });
}

function blocksOpponent(game, p, tile) {
  if (tile.type !== 'property') return false;
  const owners = GROUPS[tile.group]
    .map((i) => game.tiles[i].owner)
    .filter((o) => o !== null && o !== p.id);
  if (owners.length === 0) return false;
  return owners.every((o) => o === owners[0])
    && owners.length === GROUPS[tile.group].length - 1;
}

export function aiDecide(game, p, type, data) {
  switch (type) {
    case 'buy': {
      const { tile } = data;
      const after = p.money - tile.price;
      if (completesGroup(game, p, tile) || blocksOpponent(game, p, tile)) return after >= 0;
      if (tile.type === 'station' || tile.type === 'utility') return after >= 100;
      return after >= CASH_RESERVE;
    }
    case 'jail': {
      if (data.hasCard) return 'card';
      // En début de partie, mieux vaut sortir vite pour acheter ;
      // en fin de partie, rester en prison évite les loyers.
      const unowned = game.tiles.filter((t) => t.price && t.owner === null).length;
      if (unowned > 8 && data.canPay && p.money > 150) return 'pay';
      return 'roll';
    }
    default:
      return null;
  }
}

export function aiManage(game, p, { liquidateFor = 0 }) {
  if (liquidateFor > 0) {
    liquidate(game, p, liquidateFor);
    return;
  }
  // 1. Lever les hypothèques si les finances le permettent
  for (const i of game.ownedTiles(p.id)) {
    if (game.tiles[i].mortgaged
      && p.money - game.unmortgageCost(i) >= CASH_RESERVE + 100
      && game.canUnmortgage(p.id, i)) {
      game.unmortgage(p.id, i);
    }
  }
  // 2. Construire sur les monopoles (uniformément, groupes les moins chers d'abord
  //    pour un meilleur retour sur investissement en début de partie)
  const myGroups = Object.keys(GROUPS)
    .filter((g) => game.ownsFullGroup(p.id, g))
    .sort((a, b) => game.tiles[GROUPS[a][0]].houseCost - game.tiles[GROUPS[b][0]].houseCost);
  let built = true;
  while (built) {
    built = false;
    for (const g of myGroups) {
      const candidates = GROUPS[g]
        .filter((i) => game.canBuild(p.id, i))
        .sort((a, b) => game.tiles[a].houses - game.tiles[b].houses);
      if (candidates.length === 0) continue;
      const idx = candidates[0];
      if (p.money - game.tiles[idx].houseCost >= CASH_RESERVE) {
        game.build(p.id, idx);
        built = true;
      }
    }
  }
}

function liquidate(game, p, target) {
  // a) Hypothéquer les propriétés isolées (hors monopoles) d'abord
  const owned = game.ownedTiles(p.id);
  const isolated = owned.filter((i) => {
    const t = game.tiles[i];
    if (t.mortgaged) return false;
    if (t.type !== 'property') return true;
    return !game.ownsFullGroup(p.id, t.group);
  }).sort((a, b) => game.tiles[a].price - game.tiles[b].price);
  for (const i of isolated) {
    if (p.money >= target) return;
    if (game.canMortgage(p.id, i)) game.mortgage(p.id, i);
  }
  // b) Vendre les constructions (les moins rentables d'abord)
  let sold = true;
  while (p.money < target && sold) {
    sold = false;
    const withHouses = owned
      .filter((i) => game.canSellHouse(p.id, i))
      .sort((a, b) => game.tiles[a].houseCost - game.tiles[b].houseCost);
    if (withHouses.length > 0) {
      game.sellHouse(p.id, withHouses[0]);
      sold = true;
    }
  }
  // c) Hypothéquer le reste
  for (const i of owned) {
    if (p.money >= target) return;
    if (game.canMortgage(p.id, i)) game.mortgage(p.id, i);
  }
}
