// Sauvegarde de la partie en cours dans le localStorage.
// Un seul emplacement ; tout échec de stockage est silencieux : le jeu
// fonctionne alors simplement sans sauvegarde.
//
// Tout changement de la forme de `state` doit s'accompagner d'une
// incrémentation de VERSION : c'est l'hypothèse sur laquelle reposent
// `restoreDeck` (cards.js) et `Game.fromSnapshot` (engine.js), qui font
// confiance à la forme des données une fois `loadGame()` passé et ne
// re-valident rien elles-mêmes.

const KEY = 'monopoly3d.save.v1';
const VERSION = 1;

export function saveGame(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      version: VERSION,
      savedAt: new Date().toISOString(),
      state,
    }));
  } catch { /* stockage indisponible */ }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const st = data?.state;
    if (data?.version !== VERSION
        || !Array.isArray(st?.players) || !Array.isArray(st?.tiles) || !st?.decks) {
      clearSave();
      return null;
    }
    return data;
  } catch {
    clearSave();
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* stockage indisponible */ }
}
