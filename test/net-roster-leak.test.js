import { describe, it, expect } from 'vitest';
import { loadMonolith } from './helpers/load-monolith.js';

// Unit 3 — pre-existing blockers that would make Unit 9's progression hooks silently wrong.
//
// window.__netRoster is set by NET.beginMatch() and was never cleared anywhere. buildFighters()
// branches on it, and inside that branch `f.you` is assigned only via `role==="host"` (slot 0) or
// `role==="client" && myIdx===i`. NET.leave() resets role to "solo", so after ANY LAN session the
// stale roster keeps buildFighters on the net path while neither predicate can ever be true —
// leaving a solo match with NO fighter marked `you`. showResult()'s youWon check and every future
// progression hook keyed on `f.you` then silently do nothing until a page reload.

function startSoloMatch(w) {
  w.eval('SETTINGS.mode="ffa"; SETTINGS.count=2; SETTINGS.stocks=1; startMatch();');
  return [...w.fighters];
}

describe('Unit 3 — stale LAN roster does not break solo play', () => {
  it('a clean solo match marks exactly one fighter as the player', () => {
    const { window: w } = loadMonolith();
    const fighters = startSoloMatch(w);
    expect(fighters.length).toBeGreaterThan(1);
    expect(fighters.filter((f) => f.you)).toHaveLength(1);
  });

  it('leaving a LAN game to the title restores solo player identity', () => {
    const { window: w } = loadMonolith();
    // Simulate the state NET.beginMatch() leaves behind, then leave the way the Back button does.
    w.eval('window.__netRoster = ["Firey","Leafy"]; window.__netHumanCount = 2;');
    w.eval('NET.leave(); go("title");');
    const fighters = startSoloMatch(w);
    expect(fighters.filter((f) => f.you), 'no fighter is `you` after a LAN session').toHaveLength(1);
  });

  it('going to the title clears the roster override even without NET.leave()', () => {
    const { window: w } = loadMonolith();
    w.eval('window.__netRoster = ["Firey","Leafy"]; window.__netHumanCount = 2;');
    w.eval('go("title");');
    expect(w.eval('window.__netRoster')).toBeFalsy();
    expect(w.eval('window.__netHumanCount')).toBeFalsy();
  });

  it('going to the title ends the network session, not just the roster', () => {
    const { window: w } = loadMonolith();
    // A host can reach the result screen and click "Title", which never routed through leave().
    // role stayed "host" with the socket open, and loop() broadcasts on `role==="host"` — so the
    // next SOLO match was streamed into the old room at ~22 frames/sec.
    w.eval('NET.role="host"; window.__netRoster=["Firey","Leafy"]; window.__netHumanCount=2;');
    w.eval('go("title");');
    expect(w.eval('NET.role')).toBe('solo');
    expect(w.eval('NET.ws')).toBeFalsy();
  });
});

describe('Unit 3 — storage probing never throws', () => {
  it('BStore.available() returns false rather than propagating a blocked-storage error', () => {
    const { window: w } = loadMonolith();
    // The real failure mode is Chrome with site data blocked, where the localStorage GETTER
    // throws SecurityError. A plain jsdom realm leaves localStorage merely undefined, so
    // `typeof localStorage` shields it and this test would be vacuous without installing the
    // throwing getter explicitly.
    w.eval(`Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get(){ throw new DOMException('denied', 'SecurityError'); }
    });`);
    expect(() => w.eval('BStore.available()')).not.toThrow();
    expect(w.eval('BStore.available()')).toBe(false);
  });
});
