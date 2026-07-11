# Raccourcis clavier dans les modales — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Jouer un tour complet au clavier : Espace déclenche le bouton principal de toute modale (acheter, OK des cartes, prison, enchérir), R/Échap refuse l'achat.

**Architecture :** Mécanisme déclaratif dans `UI.showModal` (`src/ui/ui.js`) — chaque descripteur de bouton peut déclarer `keys`, le bouton `primary` reçoit Espace implicitement ; un écouteur `keydown` par modale, posé à l'ouverture, retiré à la fermeture. La modale d'enchère (`promptAuction`, DOM construit à la main) reçoit son propre écouteur minimal (Espace = enchérir, rien d'autre).

**Tech Stack :** Vanilla JS (modules ES), Vite, DOM natif. Aucune dépendance nouvelle.

**Spec :** `docs/superpowers/specs/2026-07-11-raccourcis-clavier-modales-design.md`

## Global Constraints

- Libellés et commentaires en français, accents corrects (comme l'existant).
- Aucune nouvelle dépendance ; pas de nouveau fichier.
- Réutiliser le markup de pastille existant `<span class="key-hint"><kbd>…</kbd></span>` (déjà stylé dans `src/ui/styles.css:154` et utilisé dans `setActions`, `src/ui/ui.js:102`) — **aucun ajout CSS**.
- `npm test` (5 fichiers de tests moteur en node) doit rester vert : `ui.js` n'est importé par aucun test node (il touche `document`), il doit le rester — ne rien exporter de nouveau, ne pas accéder au DOM au niveau module.
- L'UI DOM n'a pas de harnais de test : chaque tâche se vérifie manuellement via `npm run dev` (scénarios précis donnés dans les étapes), plus `npm test` en non-régression moteur.
- Délai d'armement des raccourcis de modale : **300 ms** exactement (constante `MODAL_KEY_ARM_MS`).

---

### Task 1 : Mécanisme clavier générique de `showModal` + achat/refus au clavier

**Files:**
- Modify: `src/ui/ui.js:8-10` (ajout de helpers module après `tileColor`)
- Modify: `src/ui/ui.js:22-34` (constructeur — factorisation de la garde de saisie)
- Modify: `src/ui/ui.js:148-173` (`showModal`)
- Modify: `src/ui/ui.js:235-245` (`promptBuy`)

**Interfaces:**
- Consumes: markup `.key-hint kbd` existant (`styles.css:154`, même rendu que `setActions`).
- Produces (réutilisés par Task 2) :
  - `MODAL_KEY_ARM_MS` : `number` (constante module, 300).
  - `isTypingTarget(el: Element) → boolean` (constante module).
  - `keyHintHtml(key: string) → string` (constante module ; `key` est une valeur de `e.key` en minuscules, ex. `' '`, `'r'`, `'escape'`).
  - Contrat de `showModal(html, buttons, opts)` : chaque élément de `buttons` accepte désormais `keys?: string[]` (valeurs de `e.key`, casse ignorée) en plus de `label`/`value`/`cls` ; le bouton `cls: 'primary'` répond aussi à Espace ; la première touche (Espace pour le primary) s'affiche en pastille dans le libellé.

- [ ] **Step 1 : Ajouter les helpers module**

Dans `src/ui/ui.js`, juste après la déclaration de `tileColor` (lignes 8-10), insérer :

```js
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
```

- [ ] **Step 2 : Factoriser la garde de saisie du raccourci global**

Dans le constructeur (`src/ui/ui.js:23-34`), remplacer :

```js
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
```

par :

```js
      if (isTypingTarget(e.target)) return;
```

- [ ] **Step 3 : Remplacer `showModal` par la version avec clavier**

Remplacer intégralement la méthode `showModal` (`src/ui/ui.js:148-173`) par :

```js
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
```

Notes pour l'exécutant :
- `done` référence `onKey` déclarée plus bas : correct, `done` n'est appelée qu'après l'initialisation de `onKey` (même différé que dans les gestionnaires de clic). Ne pas « réordonner ».
- Le chemin « clic extérieur » passe désormais par `done(null)` (au lieu de `overlay.remove(); resolve(null)`) précisément pour retirer l'écouteur clavier — comportement rendu identique par ailleurs.

- [ ] **Step 4 : Déclarer R/Échap sur « Passer » dans `promptBuy`**

Dans `promptBuy` (`src/ui/ui.js:241`), remplacer :

```js
        { label: 'Passer', value: false },
```

par :

```js
        { label: 'Passer', value: false, keys: ['r', 'Escape'] },
```

(Le bouton « Acheter » est déjà `cls: 'primary'` : il reçoit Espace et sa pastille sans modification.)

- [ ] **Step 5 : Non-régression moteur**

Run : `npm test`
Attendu : les 5 fichiers de tests passent (lignes `✅ …`), aucun échec — ces tests n'importent pas `ui.js`, ils garantissent qu'on n'a rien cassé côté moteur/imports.

- [ ] **Step 6 : Vérification manuelle**

Run : `npm run dev` puis ouvrir l'URL locale (http://localhost:5173). Créer une partie avec **2 joueurs humains** (aucune IA : toutes les cases restent achetables et on contrôle chaque décision).

1. Espace lance les dés (raccourci existant, inchangé).
2. À l'arrivée sur une case libre, la modale d'achat affiche « Acheter (prix) ⎵Espace⎵ » et « Passer ⎵R⎵ » (pastilles `kbd`).
3. Marteler Espace pendant l'animation des dés : la modale qui s'ouvre n'achète PAS (délai d'armement). Après une courte pause, Espace achète : la modale se ferme, le joueur devient propriétaire (pastille couleur dans son panneau).
4. Au tour suivant, sur une autre case libre : R → la modale se ferme et l'enchère se lance. Recommencer plus tard avec Échap : même effet.
5. Tomber sur Chance/Caisse de communauté : Espace valide « OK ».
6. Cliquer une case du plateau 3D (hors modale) : la fiche s'ouvre ; Échap la ferme.

- [ ] **Step 7 : Commit**

```bash
git add src/ui/ui.js
git commit -m "feat: raccourcis clavier dans les modales (Espace = action principale, R/Échap = refuser l'achat)"
```

---

### Task 2 : Espace = « Enchérir » dans la modale d'enchère

**Files:**
- Modify: `src/ui/ui.js:250-310` (`promptAuction` — les numéros de lignes auront glissé après la Task 1 ; se repérer sur le code cité)

**Interfaces:**
- Consumes: `MODAL_KEY_ARM_MS`, `isTypingTarget`, `keyHintHtml` (helpers module de la Task 1).
- Produces: rien de nouveau — comportement seulement.

- [ ] **Step 1 : Armement, nettoyage d'écouteur et pastille**

Dans `promptAuction`, trois retouches :

a) En tête du corps de la Promise (juste avant `const t = this.game.tiles[idx];`), ajouter :

```js
      const openedAt = performance.now();
```

b) Remplacer la ligne :

```js
      const done = (value) => { overlay.remove(); resolve(value); };
```

par :

```js
      const done = (value) => {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        resolve(value);
      };
```

c) Remplacer la ligne :

```js
      bidBtn.textContent = 'Enchérir';
```

par :

```js
      bidBtn.innerHTML = `Enchérir${keyHintHtml(' ')}`;
```

- [ ] **Step 2 : Écouteur clavier de l'enchère**

Toujours dans `promptAuction`, juste après le bloc :

```js
      box.querySelectorAll('.auction-raise').forEach((btn) => {
        btn.onclick = () => done(Number(btn.dataset.bid));
      });
```

ajouter :

```js
      // Espace = enchérir à la mise affichée. Volontairement AUCUN raccourci
      // pour « Passer (définitif) » : geste irréversible, réservé à la souris.
      const onKey = (e) => {
        if (e.repeat || performance.now() - openedAt < MODAL_KEY_ARM_MS) return;
        if (isTypingTarget(e.target) || e.key !== ' ') return;
        e.preventDefault();
        if (!bidBtn.disabled) bidBtn.click();
      };
      document.addEventListener('keydown', onKey);
```

(Même différé `done`→`onKey` que dans `showModal` : correct, ne pas réordonner.)

- [ ] **Step 3 : Non-régression moteur**

Run : `npm test`
Attendu : les 5 fichiers passent (`✅ …`), notamment `tests/auction.test.mjs` qui couvre `runAuction` côté moteur.

- [ ] **Step 4 : Vérification manuelle**

`npm run dev`, partie à 2 humains :

1. Tomber sur une case libre, refuser avec R → la modale d'enchère s'ouvre pour le premier enchérisseur.
2. Le bouton affiche « Enchérir ⎵Espace⎵ ». Espace → mise à la valeur affichée dans le champ (mise minimale par défaut), l'enchère passe au joueur suivant.
3. Cliquer dans le champ « Mise libre » puis appuyer sur Espace : rien ne se déclenche (focus dans l'input).
4. Vérifier qu'aucune touche ne déclenche « Passer (définitif) » (essayer R, Échap, Entrée : sans effet).
5. Marteler Espace au moment où la modale d'enchère apparaît : pas de mise pendant les 300 premières millisecondes.

- [ ] **Step 5 : Commit**

```bash
git add src/ui/ui.js
git commit -m "feat: Espace pour enchérir dans la modale d'enchère"
```

---

### Task 3 : Validation de la checklist du spec

**Files:** aucun (validation ; corriger dans `src/ui/ui.js` si un point échoue).

- [ ] **Step 1 : Dérouler la checklist « Tests » du spec, point par point**

`npm run dev`, partie à 2 humains, puis vérifier dans l'ordre les 6 points de la section « Tests » du spec (`docs/superpowers/specs/2026-07-11-raccourcis-clavier-modales-design.md`) :

1. Espace pour lancer les dés → tomber sur une propriété libre → Espace achète.
2. Même flux → R (puis Échap, sur une autre case) refuse et l'enchère se lance.
3. Pendant l'enchère : Espace enchérit à la mise affichée ; Espace dans le champ de saisie ne déclenche rien ; « Passer » reste souris uniquement.
4. Carte Chance/Caisse : Espace valide « OK ».
5. Fiche de propriété (clic sur une case du plateau) : Échap ferme.
6. Espace martelé pendant l'animation des dés ne déclenche pas d'achat accidentel.

Vérifier aussi les modales restantes servies par `showModal` : prison (Espace = bouton principal : carte si disponible, sinon payer), faillite (Espace = Continuer), confirmation d'échange humain (Espace = Accepter — le délai d'armement protège d'un appui hérité du tour), victoire (Espace = Rejouer, recharge la page).

- [ ] **Step 2 : Corriger tout écart puis re-vérifier**

Si un point échoue : corriger dans `src/ui/ui.js`, relancer `npm test` + le point de checklist concerné, puis committer la correction :

```bash
git add src/ui/ui.js
git commit -m "fix: <point de checklist corrigé>"
```
