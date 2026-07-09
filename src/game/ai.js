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
    case 'auction': {
      // Mêmes signaux que l'achat direct : l'IA se fixe un plafond privé
      // selon la valeur stratégique de la case, puis surenchérit au minimum
      // (pas de « sniping » : +10 € à chaque tour) tant que le plafond tient.
      const { tile, currentBid, minRaise } = data;
      let cap;
      if (completesGroup(game, p, tile)) cap = Math.round(tile.price * 1.4);
      else if (blocksOpponent(game, p, tile)) cap = Math.round(tile.price * 1.1);
      else cap = Math.round(tile.price * 0.85);
      // Réserve de liquidités : gares et compagnies méritent moins de sacrifice
      const floor = (tile.type === 'station' || tile.type === 'utility') ? 100 : 150;
      cap = Math.min(cap, p.money - floor);
      const next = currentBid + minRaise;
      return next <= cap ? next : null; // null = passe (définitif)
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

// Évalue une proposition d'échange du point de vue de l'IA `aiPlayer`.
// Fonction pure (aucune mutation) : retourne true si l'IA accepte.
// Heuristique transparente :
//   - chaque case vaut son prix d'achat ; hypothéquée → moitié du prix,
//     moins les 10 % de frais de levée d'hypothèque ;
//   - +50 % si une case reçue complète un groupe de couleur pour l'IA ;
//   - +30 % sur le « coût » d'une case cédée si cela casse un monopole de l'IA
//     ou offre un groupe complet à l'adversaire (céder coûte alors plus cher) ;
//   - l'IA exige une marge de 10 % et refuse de descendre sous 100 € de liquidités.
export function aiEvaluateTrade(game, aiPlayer, offer) {
  // Normalise l'offre du point de vue de l'IA, quel que soit son côté
  const aiIsTo = offer.toId === aiPlayer.id;
  const receivedTiles = (aiIsTo ? offer.giveTiles : offer.takeTiles) ?? [];
  const givenTiles = (aiIsTo ? offer.takeTiles : offer.giveTiles) ?? [];
  const receivedMoney = (aiIsTo ? offer.giveMoney : offer.takeMoney) ?? 0;
  const givenMoney = (aiIsTo ? offer.takeMoney : offer.giveMoney) ?? 0;
  const otherId = aiIsTo ? offer.fromId : offer.toId;

  // Jamais descendre sous 100 € de liquidités
  if (aiPlayer.money + receivedMoney - givenMoney < 100) return false;

  const baseValue = (t) => (t.mortgaged
    ? t.price / 2 - Math.round((t.price / 2) * 0.1)
    : t.price);

  let received = receivedMoney;
  for (const i of receivedTiles) {
    const t = game.tiles[i];
    let v = baseValue(t);
    // Bonus : la case complète un groupe pour l'IA (loyers doublés, constructions)
    if (t.type === 'property'
      && GROUPS[t.group].every((j) => j === i || receivedTiles.includes(j)
        || game.tiles[j].owner === aiPlayer.id)) {
      v *= 1.5;
    }
    received += v;
  }

  let given = givenMoney;
  for (const i of givenTiles) {
    const t = game.tiles[i];
    let v = baseValue(t);
    if (t.type === 'property') {
      const breaksOwnGroup = game.ownsFullGroup(aiPlayer.id, t.group);
      const completesOpponent = GROUPS[t.group].every((j) => j === i
        || givenTiles.includes(j) || game.tiles[j].owner === otherId);
      // Malus : céder cette case coûte 30 % plus cher que sa valeur nominale
      if (breaksOwnGroup || completesOpponent) v *= 1.3;
    }
    given += v;
  }

  // L'IA n'accepte qu'avec une marge de 10 % en sa faveur
  return received >= given * 1.1;
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
