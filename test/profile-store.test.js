import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mulberry32 } from './helpers/prng.js';

// Unit 8 — the persistence layer behind progression.
//
// loadMonolith() boots with no `url`, which yields an opaque origin where localStorage is absent.
// That makes the whole of Workstream A invisible to it. Boot with a real origin here so storage
// behaviour is actually exercised (this is the Unit 12 harness fix, applied where it is needed).

function boot({ seed = {}, breakStorage = false } = {}) {
  const html = readFileSync('artifacts/V1/index.html', 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
        get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 })
          : p === 'canvas' ? { width: 1100, height: 720 }
          : p === 'getImageData' ? () => ({ data: [] }) : () => {}),
        set: () => true,
      });
      window.Math.random = mulberry32(7);
      window.requestAnimationFrame = () => 0;
      window.cancelAnimationFrame = () => {};
      for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
      if (breakStorage) {
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          get() { throw new DOMException('denied', 'SecurityError'); },
        });
      }
    },
  });
  return dom.window;
}

const settle = (w) => w.eval('typeof profileReady!=="undefined" ? profileReady : Promise.resolve()');

describe('Unit 8 — profile lifecycle', () => {
  it('a fresh install starts with only the starters unlocked', async () => {
    const w = boot();
    await settle(w);
    expect(w.eval('PROFILE.matches')).toBe(0);
    expect(w.eval('PROFILE.unlocked.slice().sort().join(",")'))
      .toBe(w.eval('STARTERS.slice().sort().join(",")'));
  });

  it('persists across a reload', async () => {
    const w = boot();
    await settle(w);
    await w.eval('(async()=>{ PROFILE.matches=4; PROFILE.wins=2; unlockFighter("Bomby"); await saveProfile(); })()');
    const stored = JSON.parse(w.localStorage.getItem('profile:v1'));
    expect(stored.matches).toBe(4);
    expect(stored.unlocked).toContain('Bomby');

    const w2 = boot({ seed: { 'profile:v1': JSON.stringify(stored) } });
    await settle(w2);
    expect(w2.eval('PROFILE.matches')).toBe(4);
    expect(w2.eval('isUnlocked({name:"Bomby"})')).toBe(true);
  });
});

describe('Unit 8 — no existing player is ever demoted', () => {
  it('grandfathers an install that has prior play evidence', async () => {
    // resetStats() deletes both balance:* keys, so a returning player who ever pressed
    // "Reset" is otherwise indistinguishable from a brand-new one.
    const w = boot({ seed: { 'bfsi:tutorialDone': '1' } });
    await settle(w);
    expect(w.eval('PROFILE.unlocked.length')).toBe(w.eval('ROSTER.length'));
    expect(w.eval('PROFILE.migratedFrom')).toBeTruthy();
  });

  it('grandfathers on levels:custom too, not just balance:*', async () => {
    const w = boot({ seed: { 'levels:custom': '{"my level":{}}' } });
    await settle(w);
    expect(w.eval('PROFILE.unlocked.length')).toBe(w.eval('ROSTER.length'));
  });

  it('runs the migration heuristic once, then never again', async () => {
    const prior = { version: 1, matches: 0, wins: 0, kos: 0, bossesCleared: {}, bestRushLoop: 0,
      wcTitles: 0, unlocked: ['Firey'], viewMode: 'starters', migratedFrom: 'pre-A' };
    const w = boot({ seed: { 'profile:v1': JSON.stringify(prior), 'bfsi:tutorialDone': '1' } });
    await settle(w);
    // migratedFrom already set => do not re-grandfather and re-expand the roster
    expect(w.eval('PROFILE.unlocked.length')).toBe(1);
  });

  it('treats a corrupt profile as MISSING, not as an empty profile', async () => {
    // The existing try{JSON.parse}catch{} pattern yields {}, which would skip the grandfather
    // check entirely and silently drop a returning player from 59 fighters to 8.
    const w = boot({ seed: { 'profile:v1': '{ this is not json', 'bfsi:tutorialDone': '1' } });
    await settle(w);
    expect(w.eval('PROFILE.unlocked.length')).toBe(w.eval('ROSTER.length'));
  });

  it('unlocks everything when storage is unavailable', async () => {
    // A locked-down school Chromebook must not leave a player permanently stuck at 8 fighters
    // with no error. Degrade open, never closed.
    const w = boot({ breakStorage: true });
    await settle(w);
    expect(w.eval('PROFILE.unlocked.length')).toBe(w.eval('ROSTER.length'));
    expect(w.eval('PROFILE_STORAGE_OK')).toBe(false);
  });
});

describe('Unit 8 — concurrent writers do not lose unlocks', () => {
  it('merges rather than overwriting, so another tab\'s unlock survives', async () => {
    const w = boot();
    await settle(w);
    await w.eval('(async()=>{ unlockFighter("Bomby"); await saveProfile(); })()');
    // Simulate a second tab that hydrated earlier and has just written its own unlock.
    const other = JSON.parse(w.localStorage.getItem('profile:v1'));
    other.unlocked = [...new Set([...other.unlocked, 'Pillow'])];
    other.matches = 9;
    w.localStorage.setItem('profile:v1', JSON.stringify(other));
    // Now this tab saves again from its own (stale) in-memory copy.
    await w.eval('(async()=>{ unlockFighter("Naily"); await saveProfile(); })()');
    const final = JSON.parse(w.localStorage.getItem('profile:v1'));
    expect(final.unlocked).toContain('Pillow');   // the other tab's unlock survived
    expect(final.unlocked).toContain('Naily');
    expect(final.unlocked).toContain('Bomby');
    expect(final.matches).toBe(9);                // counters take the max, never regress
  });

  it('preserves unlocked names it does not recognise', async () => {
    const prior = { version: 1, matches: 1, wins: 0, kos: 0, bossesCleared: {}, bestRushLoop: 0,
      wcTitles: 0, unlocked: ['Firey', 'SomeFutureFighter'], viewMode: 'starters', migratedFrom: 'pre-A' };
    const w = boot({ seed: { 'profile:v1': JSON.stringify(prior) } });
    await settle(w);
    await w.eval('saveProfile()');
    expect(JSON.parse(w.localStorage.getItem('profile:v1')).unlocked).toContain('SomeFutureFighter');
  });
});
