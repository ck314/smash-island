import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mulberry32 } from './prng.js';

// Boots artifacts/V1/index.html (the UNTOUCHED reference monolith) inside jsdom so the golden
// recorder can drive the REAL game loop + REAL updateHUD headlessly. This file is the harness's
// jsdom adapter; it never edits the monolith and never stubs HUD/game-state logic — the only shim
// is a minimal 2D-canvas context so draw() doesn't throw in jsdom (explicitly sanctioned).
//
// NOTE (why this deviates from the brief's illustrative snippet): the monolith is one classic
// <script>. Its top-level state (`const SETTINGS`, `let fighters`, `const down`, `let TOURNEY`, …)
// lives in the global LEXICAL environment, which — unlike `function` declarations — is NOT exposed
// as window properties. Empirically `dom.window.SETTINGS === undefined`. So we (a) install the
// canvas shim in `beforeParse` (the eval-time `const ctx = cv.getContext('2d')` runs DURING parse,
// so a post-construction assignment is too late), (b) seed the monolith's OWN realm Math.random
// (jsdom runs scripts in a separate realm; Node-global Math.random never reaches it), (c) neutralize
// requestAnimationFrame so the monolith's self-driven loop doesn't fire in the background — the
// recorder drives step() synchronously and deterministically, and (d) bridge the lexical globals
// onto the window as LIVE accessors (reads/writes go through eval in the same realm, so they hit
// the real bindings and re-read after any internal reassignment of `fighters`). None of this
// touches HUD or game logic — updateHUD/draw/updateStandings run as the monolith wrote them.

// Minimal 2D-canvas-context shim: no-op for drawing calls; the few methods draw() dereferences a
// RETURN value from (gradients, measureText, getImageData) hand back a benign object so the REAL
// draw() runs to completion instead of throwing. HUD DOM text is still produced by the real code.
function stub2d() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get: (_t, p) => (
      p === 'measureText' ? () => ({ width: 0 })
        : p === 'canvas' ? { width: 1100, height: 720 }
        : p === 'getImageData' ? () => ({ data: [] })
        : (p === 'createLinearGradient' || p === 'createRadialGradient'
          || p === 'createConicGradient' || p === 'createPattern') ? () => grad
        : () => {}),
    set: () => true,
  });
}

// The monolith's top-level lexical bindings the recorder reads/mutates. Exposed as live getters so
// `w.fighters` (used by the verbatim checksum/snapshot) and `w.SETTINGS`/`w.down`/`w.TOURNEY`
// (mutated/read by dispatchStep) resolve to the real, current values.
const BRIDGE = ['SETTINGS', 'fighters', 'down', 'TOURNEY', 'running', 'stage', 'STAGES'];

export function loadMonolith(seed = 0xC0FFEE) {
  const html = readFileSync('artifacts/V1/index.html', 'utf8');
  const dom = new JSDOM(html, {
    // A real origin, not the default opaque one. Without `url`, localStorage is absent, BStore
    // swallows the failure, and NOTHING persists — which made the whole progression layer
    // (profile:v1, unlocks, grandfathering) structurally invisible to the goldens. Each JSDOM
    // gets its own empty localStorage, so scenarios stay isolated and reproducible.
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => stub2d();
      window.Math.random = mulberry32(seed);           // deterministic in the monolith's own realm
      window.requestAnimationFrame = () => 0;          // recorder drives step() itself
      window.cancelAnimationFrame = () => {};
    },
  });
  const w = dom.window;
  for (const name of BRIDGE) {
    if (name in w) continue;                           // never shadow a real window property
    Object.defineProperty(w, name, {
      configurable: true,
      get: () => w.eval(name),
    });
  }
  // Set the monolith's lexical `stage` to STAGES[index] (used by scenarios' start.stage).
  w.setStage = (i) => w.eval(`stage = STAGES[${Number(i)}]`);
  return { window: w, restore() {} };
}
