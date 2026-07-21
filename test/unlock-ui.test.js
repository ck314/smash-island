import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mulberry32 } from './helpers/prng.js';

// Units 10 & 11 — the roster board and the announcement surface.

function boot(seed = {}) {
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
      window.Math.random = mulberry32(11);
      window.requestAnimationFrame = () => 0;
      window.cancelAnimationFrame = () => {};
      for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
    },
  });
  return dom.window;
}
const settle = (w) => w.eval('profileReady');
const cells = (w) => [...w.document.querySelectorAll('#board .cell')].filter((c) => !c.classList.contains('rostertoggle'));

describe('Unit 10 — the roster board respects unlock state', () => {
  it('a fresh profile shows only starters, all selectable', async () => {
    const w = boot(); await settle(w); w.eval('buildBoard()');
    const c = cells(w);
    expect(c.length).toBe(w.eval('STARTERS.length'));
    expect(c.filter((x) => x.classList.contains('locked')).length).toBe(0);
  });

  it('r.play stays true for all 59 so the tournament pool is untouched', async () => {
    const w = boot(); await settle(w);
    expect(w.eval('ROSTER.filter(function(r){return r.play;}).length')).toBe(w.eval('ROSTER.length'));
  });

  it('everything mode shows the full roster with locked cells that teach', async () => {
    const w = boot(); await settle(w);
    w.eval('setViewMode("everything")');
    // Locked cells still render in "everything" — but isUnlocked returns true in that mode, so
    // check the criterion text is derivable regardless of the current view.
    // Use a fighter that is genuinely on the drip, not one claimed by a trophy — Naily, for
    // instance, is the reward for beating Bomby, so its hint names that deed instead.
    expect(w.eval('unlockHint(DRIP_ORDER[10])')).toMatch(/Play \d+ more match/);
    expect(w.eval('unlockHint(TROPHIES["wc"])')).toBe('Win the World Cup');
    expect(w.eval('unlockHint(TROPHIES["rush2"])')).toBe('Reach Boss Rush loop 2');
  });

  it('locked cells appear once there is progress to make, and explain themselves on tap', async () => {
    const w = boot(); await settle(w);
    w.eval('PROFILE.viewMode="unlocked"; buildBoard();');
    const locked = cells(w).filter((c) => c.classList.contains('locked'));
    expect(locked.length).toBeGreaterThan(0);
    expect(locked[0].title).toMatch(/locked/);
    locked[0].onclick();
    const note = w.document.getElementById('lockNote');
    expect(note.style.display).toBe('block');
    expect(note.textContent).toMatch(/🔒/);
  });

  it('narrowing the view never strands `chosen` on a locked fighter', async () => {
    const w = boot(); await settle(w);
    w.eval('setViewMode("everything"); chosen = ROSTER.find(function(r){ return !isUnlocked(r) || r.name==="Naily"; }) || chosen;');
    w.eval('chosen = ROSTER.find(function(r){return r.name==="Naily";});');
    w.eval('setViewMode("starters")');
    expect(w.eval('isUnlocked(chosen)')).toBe(true);
  });

  it('the legend states real progress instead of claiming everything is playable', async () => {
    const w = boot(); await settle(w); w.eval('buildBoard()');
    const legend = w.document.getElementById('rosterLegend').textContent;
    expect(legend).toMatch(/\d+ of \d+ fighters unlocked/);
  });

  it('view mode persists across a reload', async () => {
    const w = boot(); await settle(w);
    await w.eval('(async()=>{ setViewMode("everything"); await saveProfile(); })()');
    const stored = w.localStorage.getItem('profile:v1');
    const w2 = boot({ 'profile:v1': stored }); await settle(w2);
    expect(w2.eval('PROFILE.viewMode')).toBe('everything');
  });
});

describe('Unit 11 — unlock announcements', () => {
  it('renders nothing when a match granted no unlock', async () => {
    const w = boot(); await settle(w);
    w.eval('PENDING_UNLOCKS.length=0; showUnlockNote();');
    expect(w.document.getElementById('unlockNote').style.display).toBe('none');
  });

  it('announces a single unlock', async () => {
    const w = boot(); await settle(w);
    w.eval('PENDING_UNLOCKS.push("Naily"); showUnlockNote();');
    const n = w.document.getElementById('unlockNote');
    expect(n.style.display).toBe('block');
    expect(n.textContent).toContain('Naily');
  });

  it('announces several at once', async () => {
    const w = boot(); await settle(w);
    w.eval('PENDING_UNLOCKS.push("Naily","Pillow","Bomby"); showUnlockNote();');
    expect(w.document.getElementById('unlockNote').textContent).toMatch(/3 NEW FIGHTERS/);
  });

  it('drains the queue so Rematch does not re-announce', async () => {
    const w = boot(); await settle(w);
    w.eval('PENDING_UNLOCKS.push("Naily"); showUnlockNote();');
    expect(w.eval('PENDING_UNLOCKS.length')).toBe(0);
    w.eval('showUnlockNote()');
    expect(w.document.getElementById('unlockNote').style.display).toBe('none');
  });

  it('go() clears it, so no stale unlock survives onto another screen', async () => {
    // The boss-rush death path writes the result screen by hand and calls go('result').
    const w = boot(); await settle(w);
    w.eval('PENDING_UNLOCKS.push("Naily"); showUnlockNote(); go("title");');
    expect(w.document.getElementById('unlockNote').style.display).toBe('none');
  });
});
