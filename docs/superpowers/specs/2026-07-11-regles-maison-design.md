# Règles maison configurables — Design

**Date** : 2026-07-11
**Statut** : validé

## Objectif

Permettre de configurer des « règles maison » populaires au lancement d'une
nouvelle partie, sans toucher au comportement par défaut (règles officielles).

Quatre règles pour cette version :

1. **Double salaire sur Départ** — s'arrêter pile sur la case Départ rapporte
   400 € (200 € de passage + 200 € de bonus) au lieu de 200 €.
2. **Cagnotte du Parc Gratuit** — tous les paiements de pénalité destinés à la
   banque (taxes, amende de prison, paiements de cartes) alimentent une
   cagnotte ; le joueur qui s'arrête sur Parc Gratuit la remporte entièrement.
   La cagnotte part de 0 (pas d'amorce par la banque).
3. **Enchères désactivables** — si un joueur refuse d'acheter (ou n'en a pas
   les moyens), la case reste à la banque au lieu d'être mise aux enchères.
4. **Argent de départ configurable** — presets : 1000 / 1500 (officiel) /
   2000 / 2500 €.

## Architecture retenue

Objet `rules` plat injecté dans le moteur (approche « A », validée face à un
système de hooks jugé sur-dimensionné et à des constantes mutables jugées
fragiles).

### Données (`src/game/data.js`)

```js
export const DEFAULT_RULES = {
  doubleGoSalary: false,   // arrêt pile sur Départ → +200 € de bonus
  freeParkingPot: false,   // cagnotte du Parc Gratuit
  auctions: true,          // enchères officielles en cas de refus d'achat
  startingMoney: 1500,
};
export const STARTING_MONEY_PRESETS = [1000, 1500, 2000, 2500];
```

`DEFAULT_RULES` reproduit exactement le comportement actuel du jeu.

### Moteur (`src/game/engine.js`)

Le constructeur devient `new Game(playerConfigs, view, rng, rules)` avec
`this.rules = { ...DEFAULT_RULES, ...rules }` (le merge neutralise les
sauvegardes partielles) et `this.pot = 0`. L'argent initial des joueurs vient
de `this.rules.startingMoney`.

Cinq points de branchement, tous localisés :

1. **Double salaire** — `resolveTile()` : la case `go` (aujourd'hui dans le
   `default`) obtient son propre `case`. Si `doubleGoSalary`, le joueur reçoit
   un second `GO_SALARY` (le passage dans `moveBy()` a déjà versé le premier).
   S'applique aussi à l'arrivée par carte « Avancez jusqu'à la case Départ »
   (même chemin `moveTo` → `resolveTile`).
2. **Alimentation de la cagnotte** — `charge()` : quand `toPlayer === null`
   (banque) et `freeParkingPot` actif, `this.pot += amount` et
   `view.setPot?.(this.pot)`. Couvre automatiquement les taxes, l'amende de
   prison et les paiements de cartes. Les achats (propriétés, enchères,
   maisons, levée d'hypothèque) ne passent pas par `charge()` et ne sont donc
   jamais concernés — vérifié dans le code.
3. **Gain de la cagnotte** — `resolveTile()`, case `parking` : si la règle est
   active et `pot > 0`, le joueur empoche tout, la cagnotte repasse à 0
   (log + effet 3D `gain` + son `cash` + `setPot`).
4. **Faillite envers la banque** — `declareBankruptcy()` sans créancier : si
   `freeParkingPot` actif, le liquide restant du failli va dans la cagnotte
   (la dette lui était destinée) au lieu de disparaître.
5. **Enchères désactivables** — `resolveOwnable()` : si `auctions: false`,
   refus d'achat ou fonds insuffisants → simple log, `runAuction()` n'est pas
   appelé, la case reste à la banque.

### Sauvegarde (`serialize()` / `fromSnapshot()`)

- `serialize()` ajoute `rules: { ...this.rules }` et `pot: this.pot`.
- `fromSnapshot()` passe `snap.rules` au constructeur et restaure
  `game.pot = snap.pot ?? 0`.
- Compatibilité : une vieille sauvegarde sans ces champs charge avec
  `DEFAULT_RULES` et `pot = 0` — exactement le comportement actuel, pas de
  migration ni de bump de version.

### UI (`index.html`, `src/main.js`, `src/ui/ui.js`)

**Écran de configuration** — nouvelle sous-section « Règles maison » dans la
`.setup-box`, sous les lignes de joueurs :

- ☑️ « 💰 Double salaire si arrêt pile sur Départ » (décochée par défaut)
- ☑️ « 🅿️ Cagnotte du Parc Gratuit » (décochée par défaut)
- ☑️ « 🔨 Enchères en cas de refus d'achat » (cochée par défaut)
- `<select>` « Argent de départ » : 1000 / 1500 (officiel, défaut) / 2000 /
  2500 €

`#start-btn` lit ces contrôles, construit `rules` et le passe à `startGame`
puis au constructeur du moteur. À la reprise d'une sauvegarde, les règles
viennent du snapshot, pas de l'écran.

**HUD** — badge « 🅿️ <montant> » visible uniquement si `freeParkingPot` est
actif, mis à jour par la méthode de vue optionnelle `view.setPot?.(montant)`
(style cohérent avec `view.fx?.()` / `view.sfx?.()` : les vues de test n'ont
rien à implémenter).

**Retours** — logs explicites (« …200 € partent dans la cagnotte (total :
350 €) », « 🅿️ X remporte la cagnotte : 350 € ! ») ; effets existants
réutilisés (`pay` au versement via `charge()`, `gain` + son `cash` au gain).

### IA (`src/game/ai.js`)

Aucune modification : les décisions IA (achat, prison, enchères) ne dépendent
d'aucune des quatre règles. Enchères désactivées → `runAuction()` n'est
simplement jamais appelé.

## Cas limites tranchés

- Arrêt sur Parc Gratuit avec cagnotte vide ou règle inactive → rien.
- Le double salaire ne concerne que l'arrêt **pile** (dés ou carte) ; le
  passage reste à 200 €.
- L'argent de la cagnotte n'appartient à personne tant qu'il n'est pas gagné
  (hors calcul de fortune).
- Faillite envers la banque avec cagnotte active → liquide restant dans la
  cagnotte.

## Tests (`tests/rules.test.mjs`)

Node fake-DOM avec rng seedé, comme les tests existants :

1. **Double salaire** : arrêt pile → +400 € ; passage simple → +200 € ; règle
   inactive → +200 € sur arrêt pile.
2. **Cagnotte** : taxe payée → `pot` incrémenté ; arrêt sur Parc Gratuit →
   joueur crédité du pot, `pot` remis à 0 ; règle inactive → `pot` reste à 0.
3. **Enchères désactivées** : refus d'achat → case sans propriétaire, aucune
   enchère lancée.
4. **Argent de départ** : `startingMoney: 2500` → joueurs à 2500 €.
5. **Sérialisation** : round-trip conserve `rules` et `pot` ; vieille
   sauvegarde sans ces champs → `DEFAULT_RULES` et `pot = 0`.

## Gestion d'erreurs

Merge `{ ...DEFAULT_RULES, ...rules }` au constructeur ; presets en UI (pas de
saisie libre) ; aucune autre surface d'erreur.
