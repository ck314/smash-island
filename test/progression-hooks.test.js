import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mulberry32 } from './helpers/prng.js';

// Unit 9 — which match paths produce progression, and where each field comes from.
//
// The plan's "which paths count" table is the contract. The subtle part is that recordMatch()
// alone is NOT a sufficient hook: its only call site sits AFTER a tournament early-return, so no
// World Cup match ever reaches it, and three of the profile's fields have no source there at all.

function boot() {
  const html = readFileSync('artifacts/V1/index.html', 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
        get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 })
          : p === 'canvas' ? { width: 1100, height: 720 }
          : p === 'getImageData' ? () => ({ data: [] }) : () => {}),
        set: () => true,
      });
      window.Math.random = mulberry32(3);
      window.requestAnimationFrame = () => 0;
      window.cancelAnimationFrame = () => {};
    },
  });
  return dom.window;
}
const settle = (w) => w.eval('profileReady');

describe('Unit 9 — the drip cadence is reachable by a losing player', () => {
  it('grants the first unlock no later than match 2 and 3+ within 5 matches', async () => {
    const w = boot(); await settle(w);
    // Drip is keyed on matches PLAYED, not wins — a new player on Normal AI may win none of
    // their first five, and a win-keyed cadence would leave them with nothing.
    const at = (n) => w.eval(`dripCount(${n})`);
    expect(at(1)).toBeGreaterThanOrEqual(1);
    expect(at(5)).toBeGreaterThanOrEqual(3);
    expect(at(50)).toBeLessThanOrEqual(w.eval('UNLOCK_ORDER.length'));
  });

  it('never awards a starter as a drip unlock', async () => {
    const w = boot(); await settle(w);
    const overlap = w.eval('UNLOCK_ORDER.filter(function(n){return STARTERS.indexOf(n)>=0;}).length');
    expect(overlap).toBe(0);
  });

  it('the drip order plus starters covers the whole roster exactly once', async () => {
    const w = boot(); await settle(w);
    expect(w.eval('new Set(UNLOCK_ORDER.concat(STARTERS)).size')).toBe(w.eval('ROSTER.length'));
  });
});

describe('Unit 9 — which paths count', () => {
  it('a finished match increments matches and stages any new unlocks', async () => {
    const w = boot(); await settle(w);
    w.eval('SETTINGS.mode="ffa"; SETTINGS.count=2; SETTINGS.stocks=1; startMatch();');
    w.eval('awardMatchProgress(0)');
    expect(w.eval('PROFILE.matches')).toBe(1);
    expect(w.eval('PENDING_UNLOCKS.length')).toBeGreaterThan(0);
  });

  it('a LOSS still advances the drip', async () => {
    const w = boot(); await settle(w);
    w.eval('SETTINGS.mode="ffa"; SETTINGS.count=2; SETTINGS.stocks=1; startMatch();');
    w.eval('fighters.forEach(function(f){ f.you=false; }); awardMatchProgress(0)');
    expect(w.eval('PROFILE.matches')).toBe(1);
    expect(w.eval('PROFILE.wins')).toBe(0);
  });

  it('a level-editor playtest counts for nothing', async () => {
    // edTestPlay() sets TESTMODE.active=false, so the sandbox guard does not apply. A floorless
    // custom level ends in one frame, which would be unlimited unlock farming.
    const w = boot(); await settle(w);
    w.eval('SETTINGS.mode="ffa"; SETTINGS.count=2; startMatch(); CUSTOM_LEVEL={spawns:[]};');
    w.eval('awardMatchProgress(0)');
    expect(w.eval('PROFILE.matches')).toBe(0);
  });

  it('completing the tutorial grants exactly one unlock, once', async () => {
    const w = boot(); await settle(w);
    const before = w.eval('PROFILE.unlocked.length');
    w.eval('awardTutorialUnlock(); awardTutorialUnlock();');
    expect(w.eval('PROFILE.unlocked.length')).toBe(before + 1);
  });
});

describe('Unit 9 — trophies fire only on the real deed', () => {
  it('a World Cup title is not awarded in spectate mode', async () => {
    const w = boot(); await settle(w);
    w.eval('startTournament(1,"spectate"); TOURNEY.champion=TOURNEY.teams[0]; awardWorldCup(TOURNEY.teams[0]);');
    expect(w.eval('PROFILE.wcTitles')).toBe(0);
  });

  it('a World Cup title is awarded once when the player actually wins', async () => {
    const w = boot(); await settle(w);
    w.eval('startTournament(1,"normal"); var t=TOURNEY.myTeam; awardWorldCup(t); awardWorldCup(t);');
    expect(w.eval('PROFILE.wcTitles')).toBe(1);   // idempotent: hub re-renders must not double-count
  });

  it('boss rush progress persists at the moment it is earned, not at run end', async () => {
    // go('title') sets BOSSRUSH.active=false and the only "proper" ending is death, so a player
    // who clears four bosses and quits would otherwise record nothing.
    const w = boot(); await settle(w);
    w.eval('awardBossCleared("Announcer"); awardRushLoop(2);');
    expect(w.eval('PROFILE.bossesCleared["Announcer"]')).toBeTruthy();
    expect(w.eval('PROFILE.bestRushLoop')).toBe(2);
    w.eval('awardRushLoop(1)');
    expect(w.eval('PROFILE.bestRushLoop')).toBe(2);   // best, never regresses
  });
});
