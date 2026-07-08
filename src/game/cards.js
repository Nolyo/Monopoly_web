// Cartes Chance et Caisse de Communauté

export const CHANCE_CARDS = [
  { text: "Avancez jusqu'à la case Départ. (Recevez 200 €)", effect: { kind: 'moveTo', tile: 0 } },
  { text: 'Rendez-vous Rue de la Paix.', effect: { kind: 'moveTo', tile: 39 } },
  { text: 'Avancez au Boulevard de la Villette. Si vous passez par la case Départ, recevez 200 €.', effect: { kind: 'moveTo', tile: 11 } },
  { text: 'Prenez le train à la Gare Montparnasse. Si vous passez par la case Départ, recevez 200 €.', effect: { kind: 'moveTo', tile: 5 } },
  { text: 'Reculez de trois cases.', effect: { kind: 'moveBack', steps: 3 } },
  { text: 'Allez en prison. Ne passez pas par la case Départ, ne recevez pas 200 €.', effect: { kind: 'jail' } },
  { text: 'La banque vous verse un dividende de 50 €.', effect: { kind: 'money', amount: 50 } },
  { text: 'Amende pour excès de vitesse : payez 15 €.', effect: { kind: 'money', amount: -15 } },
  { text: 'Payez les frais de scolarité : 150 €.', effect: { kind: 'money', amount: -150 } },
  { text: 'Votre immeuble et votre prêt rapportent : recevez 150 €.', effect: { kind: 'money', amount: 150 } },
  { text: 'Faites des réparations dans toutes vos maisons : payez 25 € par maison et 100 € par hôtel.', effect: { kind: 'repairs', perHouse: 25, perHotel: 100 } },
  { text: 'Vous êtes libéré de prison. Cette carte peut être conservée.', effect: { kind: 'getout' } },
];

export const CHEST_CARDS = [
  { text: 'Erreur de la banque en votre faveur : recevez 200 €.', effect: { kind: 'money', amount: 200 } },
  { text: 'Les contributions vous remboursent la somme de 20 €.', effect: { kind: 'money', amount: 20 } },
  { text: 'Vous héritez de 100 €.', effect: { kind: 'money', amount: 100 } },
  { text: 'Recevez votre revenu annuel : 100 €.', effect: { kind: 'money', amount: 100 } },
  { text: 'La vente de votre stock vous rapporte 50 €.', effect: { kind: 'money', amount: 50 } },
  { text: 'Payez la note du médecin : 50 €.', effect: { kind: 'money', amount: -50 } },
  { text: "Payez l'hôpital : 100 €.", effect: { kind: 'money', amount: -100 } },
  { text: 'Retournez à la case Départ. (Recevez 200 €)', effect: { kind: 'moveTo', tile: 0 } },
  { text: 'Allez en prison. Ne passez pas par la case Départ, ne recevez pas 200 €.', effect: { kind: 'jail' } },
  { text: "C'est votre anniversaire : chaque joueur vous offre 10 €.", effect: { kind: 'collectEach', amount: 10 } },
  { text: 'Frais de réparation : payez 40 € par maison et 115 € par hôtel.', effect: { kind: 'repairs', perHouse: 40, perHotel: 115 } },
  { text: 'Vous êtes libéré de prison. Cette carte peut être conservée.', effect: { kind: 'getout' } },
];

export function makeDeck(cards, rng = Math.random) {
  const order = cards.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return deckFrom(cards, order, 0);
}

// Reconstruit une pioche depuis un état sauvegardé (suppose un état valide,
// garanti en amont par le contrôle de version du stockage).
export function restoreDeck(cards, state) {
  return deckFrom(cards, state.order, state.pointer);
}

function deckFrom(cards, order, pointer) {
  let ptr = pointer;
  const seq = [...order];
  return {
    draw() {
      const card = cards[seq[ptr]];
      ptr = (ptr + 1) % seq.length;
      return card;
    },
    state() {
      return { order: [...seq], pointer: ptr };
    },
  };
}
