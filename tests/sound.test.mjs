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

  // Node n'a pas d'AudioContext : initSounds doit s'en accommoder sans lever
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
