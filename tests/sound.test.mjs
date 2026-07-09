// Tests du module audio. Node pur : pas d'AudioContext ni de fetch réels —
// on vérifie l'API publique, la persistance du mute et l'innocuité sans DOM.
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Module sound.js : importable sans DOM, mute persisté, no-op sans init
// ---------------------------------------------------------------------------
{
  // localStorage factice AVANT initSounds (le module ne doit rien lire à l'import)
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const { SOUNDS, initSounds, playSound, toggleMute, isMuted } = await import('../src/ui/sound.js');

  // La table couvre exactement les 10 sons de la spec
  assert.deepEqual(
    Object.keys(SOUNDS).sort(),
    ['bankrupt', 'build', 'buy', 'card', 'cash', 'dice', 'hop', 'jail', 'pay', 'win'],
  );
  for (const def of Object.values(SOUNDS)) {
    assert.match(def.file, /^[a-z]+\.ogg$/);
    assert.ok(def.volume > 0 && def.volume <= 1);
  }

  // Sans init : playSound est un no-op silencieux
  playSound('dice');

  // Node n'a pas d'AudioContext : initSounds doit s'en accommoder sans lever.
  // Sans clé stockée, le son est actif par défaut.
  initSounds();
  assert.equal(isMuted(), false, 'clé absente → non muet par défaut');

  store.set('monopoly3d.muted', '1');
  initSounds();
  assert.equal(isMuted(), true, 'état mute lu depuis localStorage à init');
  playSound('dice'); // toujours inoffensif

  // toggleMute bascule et persiste
  assert.equal(toggleMute(), false);
  assert.equal(store.get('monopoly3d.muted'), '0');
  assert.equal(toggleMute(), true);
  assert.equal(store.get('monopoly3d.muted'), '1');
  assert.equal(isMuted(), true);

  // localStorage qui lève : toggleMute bascule quand même, sans exception
  globalThis.localStorage = {
    getItem: () => { throw new Error('indisponible'); },
    setItem: () => { throw new Error('indisponible'); },
  };
  assert.equal(toggleMute(), false, 'bascule malgré un stockage cassé');

  console.log('✅ sound.js : table complète, mute persisté, inoffensif sans DOM');
}

// ---------------------------------------------------------------------------
// Moteur : émissions view.sfx aux bons moments
// ---------------------------------------------------------------------------
{
  const { Game } = await import('../src/game/engine.js');
  const { CHANCE_CARDS, restoreDeck } = await import('../src/game/cards.js');
  const { TILES, GROUPS } = await import('../src/game/data.js');

  // Vue enregistreuse : capture les sfx, no-op pour tout le reste
  const recordingView = (events) => new Proxy({}, {
    get: (_, prop) => (prop === 'sfx' ? (n) => events.push(n) : () => {}),
  });

  const configs = [
    { name: 'A', color: '#e0453a', isAI: false },
    { name: 'B', color: '#3a7de0', isAI: false },
  ];

  // Achat → 'buy'
  {
    const events = [];
    const g = new Game(configs, recordingView(events));
    const idx = TILES.findIndex((t) => t.type === 'property');
    await g.buyTile(g.players[0], idx);
    assert.deepEqual(events, ['buy']);
  }

  // Paiement réussi → 'pay' ; paiement en faillite → PAS de 'pay'
  {
    const events = [];
    const g = new Game(configs, recordingView(events));
    await g.charge(g.players[0], 100, g.players[1], 'test');
    assert.deepEqual(events, ['pay']);
    g.players[0].money = 10; // sans patrimoine : faillite inévitable
    await g.charge(g.players[0], 500, null, 'test');
    assert.deepEqual(events, ['pay'], 'pas de son de paiement quand le paiement échoue');
    assert.equal(g.players[0].bankrupt, true);
  }

  // Passage par la case Départ → 'cash'
  {
    const events = [];
    const g = new Game(configs, recordingView(events));
    g.players[0].pos = 38;
    await g.moveBy(g.players[0], 4);
    assert.deepEqual(events, ['cash']);
  }

  // Carte « recevez de l'argent » → 'cash' (deck forcé sur une carte gain)
  {
    const events = [];
    const g = new Game(configs, recordingView(events));
    const iGain = CHANCE_CARDS.findIndex((c) => c.effect.kind === 'money' && c.effect.amount > 0);
    assert.ok(iGain >= 0, 'il existe une carte Chance qui rapporte');
    g.chance = restoreDeck(CHANCE_CARDS, { order: [iGain], pointer: 0 });
    const before = g.players[0].money;
    await g.drawCard(g.players[0], 'chance');
    assert.deepEqual(events, ['cash']);
    assert.ok(g.players[0].money > before);
  }

  // Envoi en prison → 'jail'
  {
    const events = [];
    const g = new Game(configs, recordingView(events));
    await g.sendToJail(g.players[0]);
    assert.deepEqual(events, ['jail']);
  }

  // Construction → 'build' ; revente → aucun son
  {
    const events = [];
    const g = new Game(configs, recordingView(events));
    const grp = TILES.find((t) => t.type === 'property').group;
    for (const i of GROUPS[grp]) g.tiles[i].owner = 0;
    g.players[0].money = 10000;
    assert.equal(g.build(0, GROUPS[grp][0]), true);
    assert.deepEqual(events, ['build']);
    assert.equal(g.sellHouse(0, GROUPS[grp][0]), true);
    assert.deepEqual(events, ['build'], 'la revente est silencieuse');
  }

  console.log('✅ moteur : sfx émis pour buy/pay/cash/jail/build, silencieux ailleurs');
}
