import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mulberry32 } from './helpers/prng.js';

// Unit 5 — hardening applied before the game is ever publicly reachable.
//
// 1. autoJoinFromLink() ran at boot, parsed #room=CODE from the URL, and called NET.join() on a
//    60ms timer with no confirmation. Room codes are 4 alphanumeric characters. On a public URL
//    aimed at children, any link a stranger sends drops them into a shared session before they
//    have seen a single screen. It is inert today only because no relay is deployed at the
//    same-origin /api/ws path — it goes live the moment Plan D ships one, with no gate in between.
//
// 2. The title screen had no statement of what the game is or who made it. The adversarial
//    review's "nervous adult" persona is the gatekeeper who decides whether a school allows the
//    domain at all, and BFDI is jacknjellify's IP, so a fan-work disclaimer is both honest and
//    load-bearing for adoption.

// loadMonolith() hardcodes no `url`, so it cannot carry a hash fragment. Boot with one here.
function loadWithHash(hash) {
  const html = readFileSync('artifacts/V1/index.html', 'utf8');
  const dom = new JSDOM(html, {
    url: `http://localhost/${hash}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
        get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 })
          : p === 'canvas' ? { width: 1100, height: 720 }
          : p === 'getImageData' ? () => ({ data: [] })
          : () => {}),
        set: () => true,
      });
      window.Math.random = mulberry32(1);
      window.requestAnimationFrame = () => 0;
      window.cancelAnimationFrame = () => {};
    },
  });
  return dom.window;
}

describe('Unit 5 — an invite link never connects without consent', () => {
  it('prefills the room code but does not join', async () => {
    const w = loadWithHash('#room=ABCD');
    // The original bug was a deferred call, so wait past the 60ms timer it used.
    await new Promise((r) => setTimeout(r, 150));
    expect(w.document.getElementById('joinAddr').value).toBe('ABCD');
    expect(w.eval('NET.role')).toBe('solo');
    expect(w.eval('NET.ws')).toBeFalsy();
  });

  it('lands on the lobby and names the room so the code is not a mystery', () => {
    const w = loadWithHash('#room=WXYZ');
    expect(w.document.getElementById('lobby').classList.contains('active')).toBe(true);
    expect(w.document.getElementById('lobbyStatus').textContent).toContain('WXYZ');
  });

  it('leaves a normal boot on the title screen untouched', () => {
    const w = loadWithHash('');
    expect(w.document.getElementById('title').classList.contains('active')).toBe(true);
    expect(w.document.getElementById('lobby').classList.contains('active')).toBe(false);
  });

  it('ignores a malformed room fragment', () => {
    const w = loadWithHash('#room=!!!!');
    expect(w.document.getElementById('title').classList.contains('active')).toBe(true);
  });
});

describe('Unit 5 — the title screen answers the gatekeeper', () => {
  const src = readFileSync('artifacts/V1/index.html', 'utf8');

  it('says what the game is in one line', () => {
    // The review's Tom persona blocks domains that do not explain themselves.
    expect(src).toMatch(/cartoon platform fighter/i);
  });

  it('carries an unaffiliated fan-work disclaimer naming the rights holder', () => {
    expect(src).toMatch(/fan(-| )(made|work)/i);
    expect(src).toMatch(/jacknjellify/i);
    expect(src).toMatch(/not affiliated/i);
  });

  it('keeps the existing no-account/no-ads trust claim', () => {
    expect(src).toMatch(/no account, no ads, nothing to install/);
  });
});
