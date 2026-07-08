// Sauvegarde de la partie en cours dans le localStorage.
// Un seul emplacement ; tout échec de stockage est silencieux : le jeu
// fonctionne alors simplement sans sauvegarde.

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
    if (data?.version !== VERSION || !data.state) {
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
