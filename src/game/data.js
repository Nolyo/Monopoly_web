// Plateau Monopoly — édition française classique (40 cases)

export const GROUP_COLORS = {
  brown: '#7a4a2b',
  lightblue: '#a8dcf0',
  pink: '#d84a91',
  orange: '#f39422',
  red: '#e02f2f',
  yellow: '#f2d21f',
  green: '#1faa4e',
  darkblue: '#2650a8',
};

export const GROUP_NAMES = {
  brown: 'Marron',
  lightblue: 'Bleu clair',
  pink: 'Rose',
  orange: 'Orange',
  red: 'Rouge',
  yellow: 'Jaune',
  green: 'Vert',
  darkblue: 'Bleu foncé',
};

const P = (name, group, price, rents, houseCost) => ({
  type: 'property', name, group, price, rents, houseCost,
});
const STATION = (name) => ({ type: 'station', name, price: 200 });
const UTILITY = (name, icon) => ({ type: 'utility', name, price: 150, icon });

export const TILES = [
  { type: 'go', name: 'Départ' },
  P('Boulevard de Belleville', 'brown', 60, [2, 10, 30, 90, 160, 250], 50),
  { type: 'chest', name: 'Caisse de Communauté' },
  P('Rue Lecourbe', 'brown', 60, [4, 20, 60, 180, 320, 450], 50),
  { type: 'tax', name: 'Impôts sur le revenu', amount: 200 },
  STATION('Gare Montparnasse'),
  P('Rue de Vaugirard', 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50),
  { type: 'chance', name: 'Chance' },
  P('Rue de Courcelles', 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50),
  P('Avenue de la République', 'lightblue', 120, [8, 40, 100, 300, 450, 600], 50),
  { type: 'jail', name: 'Prison' },
  P('Boulevard de la Villette', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  UTILITY("Compagnie d'Électricité", '💡'),
  P('Avenue de Neuilly', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  P('Rue de Paradis', 'pink', 160, [12, 60, 180, 500, 700, 900], 100),
  STATION('Gare de Lyon'),
  P('Avenue Mozart', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  { type: 'chest', name: 'Caisse de Communauté' },
  P('Boulevard Saint-Michel', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  P('Place Pigalle', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  { type: 'parking', name: 'Parc Gratuit' },
  P('Avenue Matignon', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  { type: 'chance', name: 'Chance' },
  P('Boulevard Malesherbes', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  P('Avenue Henri-Martin', 'red', 240, [20, 100, 300, 750, 925, 1100], 150),
  STATION('Gare du Nord'),
  P('Faubourg Saint-Honoré', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  P('Place de la Bourse', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  UTILITY('Compagnie des Eaux', '🚰'),
  P('Rue La Fayette', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150),
  { type: 'gotojail', name: 'Allez en Prison' },
  P('Avenue de Breteuil', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  P('Avenue Foch', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  { type: 'chest', name: 'Caisse de Communauté' },
  P('Boulevard des Capucines', 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  STATION('Gare Saint-Lazare'),
  { type: 'chance', name: 'Chance' },
  P('Avenue des Champs-Élysées', 'darkblue', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { type: 'tax', name: 'Taxe de luxe', amount: 100 },
  P('Rue de la Paix', 'darkblue', 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

// Indices des cases par groupe de couleur
export const GROUPS = {};
TILES.forEach((t, i) => {
  if (t.type === 'property') {
    (GROUPS[t.group] ??= []).push(i);
  }
});

export const GO_SALARY = 200;
export const JAIL_FINE = 50;
export const JAIL_INDEX = 10;
export const STARTING_MONEY = 1500;

// Règles maison. DEFAULT_RULES reproduit exactement les règles officielles :
// une partie créée sans configuration se comporte comme avant.
export const DEFAULT_RULES = {
  doubleGoSalary: false, // s'arrêter pile sur Départ rapporte un second salaire
  freeParkingPot: false, // les pénalités alimentent une cagnotte gagnée sur Parc Gratuit
  auctions: true, // règle officielle : refus d'achat → mise aux enchères
  startingMoney: STARTING_MONEY,
};

export const STARTING_MONEY_PRESETS = [1000, 1500, 2000, 2500];

export const PLAYER_COLORS = [
  { name: 'Rouge', hex: '#e0453a' },
  { name: 'Bleu', hex: '#3a7de0' },
  { name: 'Vert', hex: '#33b559' },
  { name: 'Jaune', hex: '#e8c020' },
  { name: 'Violet', hex: '#9b59d0' },
  { name: 'Cyan', hex: '#28c4c4' },
];

export const TOKEN_SHAPES = ['pawn', 'hat', 'car', 'dog', 'ship', 'boot'];

export function formatMoney(n) {
  return `${n.toLocaleString('fr-FR')} €`;
}
