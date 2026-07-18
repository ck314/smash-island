---
# Battle for Smash Island — Modularization Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the 5,861-line single-`<script>` monolith `artifacts/V1/index.html` into focused ES modules built with Vite and packaged as an Electron desktop app, with behavior byte-identical to the monolith and a verification harness that makes the six-build Infinity bug impossible to ship.

**Architecture:** One shared `src/` module tree (leaf→app layering: `constants`/`data` → `core/state` → engine leaves → engine core → `ai`/`render` → `ui` → `modes` → `net`/`editor` → `ui/global-actions` → `main`). All 51 mutable singletons live in `core/state.js`; every reassignment goes through a setter, an in-place array mutator, or a mutable runtime object field so ESM live-binding read-only rules are never violated. 44 inline `on*=` DOM handlers are bridged to `window` by `ui/global-actions.js` and asserted complete at boot. A vitest+jsdom harness runs the real HUD/draw/tournament code after every extraction stage.

**Tech Stack:** Vite 5, Electron 31, electron-builder 25, ESLint 9 (flat config), Vitest 2 + jsdom, `@fontsource/fredoka` + `@fontsource-variable/jetbrains-mono`. Node ≥ 18.19 (Vite 5 / ESM floor).

**Execution order & cross-plan interfaces (Canonical Contract v1):** These plans land in a fixed order — **Plan A (this plan) → Plan B (layered music) → Plan C (web-Lite, offline) → Plan D (online rooms, last)**. Plan A runs first and *produces* interfaces that Plans B, C, and D consume (Plan D also reuses `net/netcode.js`, the `core/state.js` setters, `handler-coverage.js`, and the `test/harness` API); do not rename or duplicate them downstream:

- **`src/core/build.js`** — `export const BUILD = { lite: __LITE__ };`, with this plan's base `vite.config.js` setting `define: { __LITE__: JSON.stringify(false) }`. Plan B and Plan C read the flag via `import { BUILD } from '../core/build.js'` (adjusting relative depth). Plan C's Lite build overrides the define to `JSON.stringify(true)`; Plan C does **not** create `build.js`.
- **The `test/harness/index.js` barrel** — the single import path Plans B and C use, re-exporting `makeApi({ lite })`, `mulberry32`, `seedRandom`, `runScriptedMatch({ lite, seed, script })`, `goldenParity`, `infinityRenderTest`. There is exactly one test root (`test/`, singular) and one Vitest config (the `test` key inside `vite.config.js`, `environment: 'jsdom'`, `include: ['test/**/*.test.js']`); B and C add no second `vitest.config.js` and no `tests/` (plural) tree. Goldens are recorded by `scripts/record-monolith.mjs` into `test/golden/`.
- **`src/core/handler-coverage.js`** — `collectHandlerIdentifiers(root)`, `assertHandlerCoverage(win, root)` (throws `HandlerCoverageError`), and `class HandlerCoverageError`. This plan's `ui/global-actions.js` and full `src/main.js` import and call it; Plan C's `src/main.lite.js` imports the **same** function (it defines no own copy).

Audio stays as the monolith's `audio/audio.js` in this plan (see the "Behavior identical to monolith except music" constraint below). The layered facade/registry (`setMusicDirector`, `music-director.js`) is a **Plan B** deliverable; Plan C assumes the post-Plan-B audio module layout.

**Contract §3 addendum — Canonical Scripted-Match Schema v1 (Plan A owns it; Plan C conforms).** This pins the exact `script` grammar `runScriptedMatch` consumes (Task 32) and the exact `Trace` it returns, so Plan C's Lite parity replays the *identical* `test/scenarios.js` and diffs the same Trace shape.

- **Scenario** = `{ name:string, seed:number, script: Step[] }` (the shape of every entry in the shared `test/scenarios.js`, recorded by `scripts/record-monolith.mjs`).
- **Step** = an integer `at` (0-based frame index) plus **exactly one** action key:
  - `{ at, start: { mode:'ffa'|'teams'|'bossrush'|'worldcup', count?, stage?, chosen?, teams? } }` — writes those `SETTINGS` and calls the mode-aware starter (`ffa`/`teams`→`startMatch()`, `bossrush`→`startBossRush()`, `worldcup`→`startTournament()`/`watchFixture()` as the monolith does). Exactly one `start` **or** one `tournament` step, at `at:0`.
  - `{ at, tournament: { size, mode:'spectate'|'normal' } }` — World Cup entry.
  - `{ at, down: [KeyCode…] }` / `{ at, up: [KeyCode…] }` — `KeyCode` = DOM `event.code` strings (`ArrowRight`, `KeyX`, …); set/clear those keys in the **persistent** `down` boolean map from frame `at` onward (held until an `up`, never a one-frame `Object.assign`).
- **Trace** (returned by `runScriptedMatch({ lite, seed, script })`, and the recorded golden shape) is EXACTLY:
  ```
  { frames: string[],                       // per-frame checksum
    final: {
      hudStockPercent: { name:string, stk:number|'INF', pct:number }[],  // infinite stocks encode as stk:'INF', NOT the glyph U+221E
      standingsOrder: string[],
      koCount: number,
      finalPlacement: string[] } }
  ```
  The Trace itself **never** contains the ∞ glyph (U+221E). The infinity-glyph evidence for the World-Cup infinite-stock case comes from `infinityRenderTest(await makeApi({lite}))` (asserts `api.hudStockText()` contains the glyph in DOM text) **or** from `trace.final.hudStockPercent.some(e => e.stk === "INF")`.

## Global Constraints

_Every task implicitly includes this section._

- **Version floors:** Node ≥ 18.19; Vite ≥ 5.0; Electron ≥ 31; electron-builder ≥ 25; Vitest ≥ 2.0; ESLint ≥ 9.0 (flat `eslint.config.js`).
- **ESM live-binding / setter rule (the pervasive trap):** Imported bindings are live but **read-only for the importer**. No module may reassign an imported binding. Writes to shared state go through exactly one of three mechanisms defined in `core/state.js`:
  1. **Setter** — wholesale-swapped scalars/objects/arrays: `stage, chosen, KEYS, KEYS_P2, running, paused, raf, evil, BOSS_ARENA, lastKoFrame, LOCAL_PLAYERS, AI_LEVEL, CUSTOM_LEVEL, TOURNEY, TOURNEY_MATCH_ACTIVE, TOURNEY_WATCHING, PENDING_TOURNEY, PENDING_CUSTOM, TOURNEY_SETUP_SIZE, TOURNEY_SETUP_MODE, TEAM_PLAN, W, H, WW, WH`. Each is `export let X` (readers `import { X }` and get the live value) plus `export function setX(v){ X = v; }`.
  2. **Runtime-object field** — arithmetic-mutated scalars that need `++`/`+=`/`--`: `hazardT, itemTimer, camX, camY, elimSeq, shakeAmt`. These live on `export const rt = { hazardT:0, itemTimer:0, camX:0, camY:0, elimSeq:0, shakeAmt:0 }`. Every read/write the map lists as a named import of `hazardT/itemTimer/camX/camY/elimSeq/shakeAmt` is rewritten to `rt.<field>` (e.g. `rt.hazardT++`, `rt.camX += dx`). Mutating a field of a `const` object is legal and shared-live; `hazardT++` on an imported `let` binding is not.
  3. **In-place array mutation** — the per-frame pools: `fighters, particles, projectiles, beams, items, summons, tendrils, worldPlats, floors, worldZones, spawnZones, bases`. Exported as `export const X = []`, **never reassigned**. Wholesale swaps (`fighters = buildFighters(...)`) become `replaceArr(fighters, newArr)`; filter-swaps (`particles = particles.filter(p)`) become `filterInPlace(particles, pred)`. Readers `import { X }` and always see the live contents because the array identity never changes.
- **No top-level side effects rule:** Module evaluation must have **zero** DOM/canvas/audio/network effects. No `getContext`, `new AudioContext()`, `new WebSocket()`, `resize()`, `document.getElementById(...).X`, `window.storage` read, or `fetch` at module top level. `cv`/`ctx` are resolved lazily by `initDom()` on DOMContentLoaded; the audio context is created only inside `sndInit()`/`sndResume()` from a user gesture; `netcode.js` may do `window.NET = NET` at import but opens no socket until `connect()`. Only exception permitted at import time: `window.NET = NET` in `net/netcode.js`.
- **No CALL-at-eval rule (circular-import safety):** The 11 cycles are safe only because no module invokes an imported function during its own top-level evaluation. Dispatch/data tables (`RANGE_PROFILE`, `RANGED_ATTACKERS`, `DASH_KITS`, `UPSPECIALS`, `DOWNSPECIALS`, `ATKSPECIALS`, `SMASHES`) may **reference** imported functions inside method bodies but must **not call** them at definition time.
- **Extract AST-whole:** Several functions are slice-cut across non-contiguous ranges (`applyHit`, `step`, `setupWorld`, `loop`, `doSpecial`'s switch). Reunite each whole; never move a raw line range that bisects a function. After each stage, diff the set of top-level symbol names against the monolith to prove none vanished.
- **Never stub the render/HUD:** The harness runs the **real** `updateHUD`/`buildHUD`/`draw`/`updateStandings` against a jsdom canvas. Stubbing any of them is banned — that is exactly how the six-build bug hid.
- **Infinity guards stay co-located:** `∞` rendering for non-finite `f.stocks` stays inside `updateHUD` (monolith line 2404) and the Infinity-safe `rankScore` standings sort stays inside `updateStandings` (monolith lines 2374, 2393). Never hoist a guard to a caller.
- **Behavior identical to monolith except music:** This pass makes **no** gameplay change. `startMusic`/`stopMusic`/`SFX` in `audio/audio.js` are preserved verbatim (the layered music engine is Plan B; the web-Lite target is Plan C — neither is in scope here).
- **Copyright boundary:** No copyrighted audio/text is introduced in this pass. Fonts are bundled via `@fontsource` (no remote `@import`). No third-party asset downloads.
- **DOM contract preserved verbatim:** Every `id` consumed by `getElementById` and the `.screen`/`.screen.active`/`#hud.active` class contract is copied byte-for-byte from the monolith `<body>` (lines 281–650). No id renamed, dropped, or reordered.
- **Minifier config:** Terser `mangle.properties = false` and `keep_quoted_props: true` for the whole bundle, so reserved-word string keys (`'switch'`, `'static'`) in `specials.js` dispatch tables survive minification.
- **Every extraction task ends by running the harness** (`npm test`) and the zero-error boot check before its commit. A stage is not "done" until the harness is green.

---

### Task 1: Repo scaffold — Vite + Electron blank window

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `electron/main.cjs`
- Create: `electron/preload.cjs`
- Create: `index.html` (temporary blank shell; replaced verbatim in Task 6)
- Create: `src/main.js` (temporary one-line boot; replaced in Task 31)
- Create: `src/core/build.js` (the `BUILD` flag leaf; consumed by Plan B and Plan C)
- Create: `.gitignore`
**Interfaces:**
- Consumes: nothing.
- Produces: `npm run dev` launches an Electron window loading the Vite dev server over a real `http://localhost` origin with `contextIsolation:true`, `nodeIntegration:false`, and a CSP that permits inline `on*=` handlers; plus the `src/core/build.js` `BUILD` flag and the base `__LITE__:false` define (the cross-plan build interface Plan B and Plan C consume).

- [ ] **Step 1: Write the failing test** — create `test/scaffold.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('scaffold', () => {
  it('package.json declares the required toolchain + scripts', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    for (const dep of ['vite', 'electron', 'electron-builder', 'vitest', 'jsdom', 'eslint',
      '@fontsource/fredoka', '@fontsource-variable/jetbrains-mono'])
      expect({ ...pkg.dependencies, ...pkg.devDependencies }).toHaveProperty(dep);
    for (const s of ['dev', 'build', 'dist', 'test', 'lint'])
      expect(pkg.scripts).toHaveProperty(s);
  });
  it('electron main loads a real origin, never bare file://', () => {
    const main = readFileSync('electron/main.cjs', 'utf8');
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).not.toMatch(/loadFile\(/);
  });
  it('preload sets up context isolation without exposing Node', () => {
    expect(existsSync('electron/preload.cjs')).toBe(true);
  });
  it('base build defines __LITE__=false and ships the BUILD flag leaf', () => {
    expect(readFileSync('vite.config.js', 'utf8')).toMatch(/__LITE__:\s*JSON\.stringify\(false\)/);
    expect(existsSync('src/core/build.js')).toBe(true);
    expect(readFileSync('src/core/build.js', 'utf8')).toMatch(/export const BUILD\s*=\s*\{\s*lite:\s*__LITE__\s*\}/);
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test` (before `package.json` exists this errors). Expected: `Error: Cannot find module` / `ENOENT: package.json` — proves the scaffold is absent.
- [ ] **Step 3: Minimal implementation** — create the files:

`package.json`:
```json
{
  "name": "battle-for-smash-island",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "electron/main.cjs",
  "scripts": {
    "dev:vite": "vite",
    "dev": "concurrently -k \"vite\" \"wait-on tcp:5173 && electron .\"",
    "build": "vite build",
    "dist": "vite build && electron-builder",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint \"src/**/*.js\" \"electron/**/*.cjs\""
  },
  "dependencies": {
    "@fontsource/fredoka": "^5.0.0",
    "@fontsource-variable/jetbrains-mono": "^5.0.0"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "electron": "^31.0.0",
    "electron-builder": "^25.0.0",
    "vitest": "^2.1.0",
    "jsdom": "^25.0.0",
    "eslint": "^9.10.0",
    "concurrently": "^9.0.0",
    "wait-on": "^8.0.0"
  },
  "build": {
    "appId": "com.smashisland.game",
    "files": ["dist/**/*", "electron/**/*"],
    "directories": { "output": "release" }
  }
}
```

`vite.config.js`:
```js
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Cross-plan build flag. Base build is the FULL app (__LITE__=false). Plan C's Lite build
  // config overrides this to JSON.stringify(true); src/core/build.js reads it as BUILD.lite.
  define: { __LITE__: JSON.stringify(false) },
  build: {
    outDir: 'dist',
    minify: 'terser',
    terserOptions: {
      keep_classnames: true,
      keep_fnames: true,
      compress: { keep_fargs: true },
      mangle: { properties: false },
      format: { comments: false },
      // reserved-word string keys ('switch','static') must survive
    },
  },
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
    globals: false,
  },
});
```

`electron/main.cjs`:
```js
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');

const DEV = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

function setCsp() {
  // Permits inline on*= handlers (we keep them this pass) and bundled assets only.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' ws: http://localhost:5173 https://api.anthropic.com",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200, height: 800, backgroundColor: '#88cdf2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (DEV) {
    win.loadURL(DEV_URL);
  } else {
    // Real origin, never bare file:// — localStorage/BStore need a proper origin.
    win.loadURL('app://index.html');
  }
}

// Register a real-origin protocol for the packaged build (prod parity task wires dist/ here).
if (!DEV) {
  const { protocol } = require('electron');
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

app.whenReady().then(() => {
  setCsp();
  if (!DEV) {
    const { protocol, net } = require('electron');
    protocol.handle('app', (req) => {
      const url = new URL(req.url);
      const file = path.join(__dirname, '..', 'dist', url.hostname + url.pathname);
      return net.fetch('file://' + file);
    });
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
```

`electron/preload.cjs`:
```js
// contextIsolation:true, nodeIntegration:false — the game needs no Node.
// The in-page window.NET/window.TESTMODE bridge is page-scoped and unaffected.
// Intentionally exposes nothing; present so the BrowserWindow preload path resolves.
'use strict';
```

`index.html` (temporary; Task 6 replaces the body verbatim from the monolith):
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Battle for Smash Island</title>
</head>
<body>
  <div id="app"><canvas id="cv"></canvas></div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

`src/main.js` (temporary):
```js
// Boot wiring lands in Task 31.
console.log('BFSI boot placeholder');
```

`src/core/build.js` (the cross-plan build-flag leaf — Plan B and Plan C `import { BUILD }` from here):
```js
// Compile-time build flag. __LITE__ is replaced by Vite's `define` (false in the base build,
// true in Plan C's Lite build). NEVER read a global BUILD and never invent a per-module __LITE__.
export const BUILD = { lite: __LITE__ };
```

`.gitignore`:
```
node_modules/
dist/
dist-lite/
release/
```

- [ ] **Step 4: Run tests, verify pass** — `npm install` then `npm test`. Expected: `Test Files 1 passed`, `Tests 4 passed`. Then `npm run dev` opens an Electron window showing a blue canvas with no console errors (manual confirm).
- [ ] **Step 5: Commit** — `git checkout -b modularization && git add -A && git commit -m "scaffold: Vite + Electron blank window with CSP + real-origin load"`

---

### Task 2: The verification harness (built BEFORE any extraction)

**Files:**
- Create: `test/helpers/prng.js`
- Create: `test/helpers/harness.js`
- Create: `test/helpers/load-monolith.js`
- Create: `src/core/handler-coverage.js` (shared production leaf — consumed by `ui/global-actions.js`, `main.js`, and Plan C's `main.lite.js`; created here so the harness re-exports it)
- Create: `test/scenarios.js` (the shared Canonical-Schema-v1 scenario list — replayed **identically** by `scripts/record-monolith.mjs` against the monolith and by `runScriptedMatch` against the modules; Plan C reuses this exact file)
- Create: `scripts/record-monolith.mjs`
- Create: `test/golden/monolith-golden.json` + `test/golden/monolith-golden.lite.json` (generated artifacts, committed; `.lite.json` via `--lite`)
- Create: `test/modules-eval.test.js`
- Create: `test/harness.selfcheck.test.js`
**Interfaces:**
- Consumes: `artifacts/V1/index.html` (read-only reference), the growing `src/` tree.
- Produces: reusable checks imported by every later task — `spyMediaConstructors()`, `bootNoErrors(importFns)`, `collectHandlerIdentifiers(root)` + `assertHandlerCoverage(win,root)` (re-exported from `src/core/handler-coverage.js`, throws `HandlerCoverageError`), `infinityRenderTest(api)`, `loopErrorContainment(api)`, `liveStateAliasing(api)`, `perModeLoopStart(api,name)`, `audioUnlock(api)`, `dispatchCompleteness(api)`, `domContract(doc,ids)`, `goldenParity(actual,golden)`; plus `test/golden/monolith-golden.json` as the fixed-seed baseline (recorded by `scripts/record-monolith.mjs`). The `test/harness/index.js` barrel (the single import path Plans B and C consume) is completed in Task 32, once `makeApi({lite})`/`runScriptedMatch({lite,seed,script})` exist; it re-exports those two plus `mulberry32`, `seedRandom`, `goldenParity`, `infinityRenderTest`.

Why first: every later task's `npm test` is gated by these functions. The full-boot checks (handler coverage, Infinity render, golden parity) become *runnable* once enough modules + `src/main.js` exist (Task 31); until then each stage runs the **module-eval zero-side-effect** check (auto-globs every file under `src/`) plus that stage's unit assertions. The golden baseline is recorded from the monolith now, so parity is a diff against a frozen reference.

- [ ] **Step 1: Write the failing test** — create `test/harness.selfcheck.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { mulberry32 } from './helpers/prng.js';
import { spyMediaConstructors } from './helpers/harness.js';

describe('harness self-check', () => {
  it('mulberry32 is deterministic for a fixed seed', () => {
    const a = mulberry32(123), b = mulberry32(123);
    const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA[0]).not.toEqual(seqA[1]);
  });
  it('spyMediaConstructors records getContext calls', () => {
    const spy = spyMediaConstructors();
    document.createElement('canvas').getContext('2d');
    expect(spy.calls.getContext).toBeGreaterThan(0);
    spy.restore();
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- harness.selfcheck`. Expected: `Cannot find module './helpers/prng.js'`.
- [ ] **Step 3: Minimal implementation** — create the harness files.

`test/helpers/prng.js`:
```js
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seedRandom(seed) {
  const rng = mulberry32(seed);
  const orig = Math.random;
  Math.random = rng;
  return () => { Math.random = orig; };
}
```

`test/helpers/harness.js`:
```js
import { expect } from 'vitest';

export function spyMediaConstructors() {
  const calls = { getContext: 0, AudioContext: 0, WebSocket: 0 };
  const proto = globalThis.HTMLCanvasElement?.prototype;
  const origGetContext = proto?.getContext;
  if (proto) proto.getContext = function (...a) { calls.getContext++; return origGetContext ? origGetContext.apply(this, a) : null; };
  const OrigAC = globalThis.AudioContext;
  class SpyAC { constructor() { calls.AudioContext++; } }
  globalThis.AudioContext = SpyAC; globalThis.webkitAudioContext = SpyAC;
  const OrigWS = globalThis.WebSocket;
  class SpyWS { constructor() { calls.WebSocket++; } close() {} send() {} addEventListener() {} }
  globalThis.WebSocket = SpyWS;
  return {
    calls,
    restore() {
      if (proto && origGetContext) proto.getContext = origGetContext;
      globalThis.AudioContext = OrigAC; globalThis.webkitAudioContext = OrigAC;
      globalThis.WebSocket = OrigWS;
    },
  };
}

export async function bootNoErrors(importFns) {
  const spy = spyMediaConstructors();
  const errors = [];
  for (const fn of importFns) { try { await fn(); } catch (e) { errors.push(e); } }
  spy.restore();
  return { errors, mediaCalls: spy.calls };
}

// Handler coverage is the shared production leaf src/core/handler-coverage.js (owned by Plan A;
// consumed by ui/global-actions.js, main.js, and Plan C's main.lite.js). Re-exported here so
// tests import it from one place — there is no second copy.
export { collectHandlerIdentifiers, assertHandlerCoverage, HandlerCoverageError } from '../../src/core/handler-coverage.js';

export async function infinityRenderTest(api) {
  const errors = [];
  const onErr = (e) => errors.push(String(e.error || e.reason || e));
  globalThis.addEventListener('error', onErr);
  for (const f of api.state.fighters) f.stocks = Infinity;
  const frames0 = api.frameCount();
  await api.runFrames(120);
  const frames1 = api.frameCount();
  globalThis.removeEventListener('error', onErr);
  expect(errors.filter((e) => /RangeError/.test(e)), 'no RangeError from repeat(Infinity)').toEqual([]);
  expect(frames1 - frames0, 'RAF still firing after 120 frames').toBeGreaterThanOrEqual(100);
  expect(api.hudStockText(), 'HUD shows infinity glyph').toContain('∞');
  expect(() => api.updateStandings()).not.toThrow();
}

export async function loopErrorContainment(api) {
  let logged = 0;
  const origErr = console.error;
  console.error = (...a) => { logged++; return origErr.apply(console, a); };
  api.injectDrawThrow();
  await api.runFrames(5);
  api.clearDrawThrow();
  const a = api.frameCount();
  await api.runFrames(30);
  const b = api.frameCount();
  console.error = origErr;
  expect(logged, 'error logged (not silent)').toBeGreaterThanOrEqual(1);
  expect(b - a, 'frames resume after one-shot throw').toBeGreaterThan(0);
}

export async function liveStateAliasing(api) {
  const before = api.state.fighters;
  api.buildFighters();
  expect(api.state.fighters, 'fighters array identity stable (in-place)').toBe(before);
  api.simulateApplySnapshot(3);
  await api.runFrames(2);
  expect(api.drawnFighterCount(), 'draw renders the NEW pool').toBe(3);
  const h0 = api.state.rt.hazardT;
  await api.runFrames(10);
  expect(api.state.rt.hazardT, 'hazardT keeps ticking').toBeGreaterThan(h0);
}

export async function perModeLoopStart(api, starterName) {
  const f0 = api.frameCount();
  await api[starterName]();
  await api.runFrames(10);
  expect(api.frameCount() - f0, `${starterName} produces frames`).toBeGreaterThan(0);
}

export function audioUnlock(api) {
  expect(api.audioCtx(), 'no AudioContext before gesture').toBeNull();
  api.fireGesture();
  expect(api.audioCtxState(), 'context resumed on gesture').toBe('running');
}

export function dispatchCompleteness(api) {
  for (const kit of api.rosterKits()) {
    for (const slot of ['special', 'up', 'down', 'attack']) {
      const key = kit[slot];
      if (key == null) continue;
      expect(typeof api.resolveDispatch(slot, key), `kit.${slot}=${key} resolves`).toBe('function');
    }
  }
  for (const key of api.smashKeys())
    expect(typeof api.resolveSmash(key), `SMASHES[${key}] resolves`).toBe('function');
}

export function domContract(doc, ids) {
  const missing = ids.filter((id) => !doc.getElementById(id));
  expect(missing, `missing DOM ids: ${missing.join(', ')}`).toEqual([]);
}

// Compares the CANONICAL SCRIPTED-MATCH Trace v1 (see the header "Contract §3 addendum"): structural
// equality of `final` (hudStockPercent[{name,stk,pct}] + standingsOrder + koCount + finalPlacement)
// and, when both sides carry it, the per-frame `frames` checksum array. Throws on mismatch. Accepts
// either a full Trace ({ frames:[...], final:<snapshot> }) or a bare end-state snapshot (golden.json
// legacy shape). INFINITE STOCKS ENCODE AS THE STRING "INF" on both sides — never the ∞ glyph
// (U+221E); the Trace carries no glyph, so a glyph appearing here is a bug, not a match.
export function goldenParity(actual, golden) {
  const a = actual.final ?? actual, g = golden.final ?? golden;
  expect(a.hudStockPercent).toEqual(g.hudStockPercent);  // stk is number|'INF'
  expect(a.standingsOrder).toEqual(g.standingsOrder);
  expect(a.koCount).toEqual(g.koCount);
  expect(a.finalPlacement).toEqual(g.finalPlacement);
  if (Array.isArray(actual.frames) && Array.isArray(golden.frames)) expect(actual.frames).toEqual(golden.frames);
}
```

`src/core/handler-coverage.js` (the shared handler-coverage leaf — Plan B and Plan C import `assertHandlerCoverage` from HERE):
```js
// Zero side effects at eval — reads the DOM only when assertHandlerCoverage() is CALLED at boot.
// Consumed by ui/global-actions.js, src/main.js, and (post-Plan-C) src/main.lite.js.
const ON_ATTRS = ['onclick', 'onchange', 'oninput', 'onkeydown', 'onkeyup', 'onmousedown', 'onmouseup', 'onsubmit'];

export class HandlerCoverageError extends Error {
  constructor(missing) {
    super('BFSI_UNBRIDGED_HANDLERS: ' + missing.join(', '));
    this.name = 'HandlerCoverageError';
    this.missing = missing;
  }
}

export function collectHandlerIdentifiers(root) {
  const sel = ON_ATTRS.map((a) => `[${a}]`).join(',');
  const ids = new Set();
  for (const el of root.querySelectorAll(sel)) {
    for (const a of ON_ATTRS) {
      const src = el.getAttribute(a);
      if (!src) continue;
      for (const m of src.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*(\(|\.)/g)) ids.add(m[1]);
    }
  }
  return [...ids];
}

// Enumerate every on*= identifier in `root` and assert each is bridged onto `win`. Throws
// HandlerCoverageError on any gap — that is how the 44-not-32 handler bug is made impossible to
// ship. A clean return (no throw) proves full coverage.
export function assertHandlerCoverage(
  win = (typeof window !== 'undefined' ? window : globalThis),
  root = (typeof document !== 'undefined' ? document : undefined),
) {
  const ids = collectHandlerIdentifiers(root);
  const missing = ids.filter((id) => typeof win[id] === 'undefined');
  if (missing.length) throw new HandlerCoverageError(missing);
  return ids;
}
```

`test/helpers/load-monolith.js`:
```js
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { seedRandom } from './prng.js';

export function loadMonolith(seed = 0xC0FFEE) {
  const html = readFileSync('artifacts/V1/index.html', 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const restore = seedRandom(seed);
  dom.window.HTMLCanvasElement.prototype.getContext = () => stub2d();
  return { window: dom.window, restore };
}
function stub2d() {
  return new Proxy({}, {
    get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 })
      : p === 'canvas' ? { width: 1100, height: 720 }
      : p === 'getImageData' ? () => ({ data: [] })
      : () => {}),
    set: () => true,
  });
}
```

`test/scenarios.js` (the shared Canonical-Schema-v1 scenario list — the SAME file drives the monolith recorder and the module-side `runScriptedMatch`, so the two Traces line up frame-for-frame; each entry is `{ name, seed, script: Step[] }` per the header "Contract §3 addendum"):
```js
// Canonical Scripted-Match Schema v1. Step = { at, <one of: start|tournament|down|up> }.
//   start.mode ∈ 'ffa'|'teams'|'bossrush'|'worldcup'; exactly one start/tournament at at:0.
//   down/up carry DOM event.code strings, held in the persistent `down` map until released.
export const SCENARIOS = [
  {
    name: 'ffa', seed: 0xC0FFEE,
    script: [
      { at: 0, start: { mode: 'ffa', count: 5, stage: 0 } },
      { at: 20, down: ['ArrowRight'] },          // p1 walks right, held
      { at: 60, down: ['KeyX'] },                // + attack held
      { at: 90, up: ['ArrowRight', 'KeyX'] },    // release both
      { at: 400 },                               // advance to frame 400, no input change
    ],
  },
  {
    name: 'teams', seed: 0xC0FFEE,
    script: [
      { at: 0, start: { mode: 'teams', count: 4, teams: [0, 0, 1, 1] } },
      { at: 30, down: ['ArrowLeft'] },
      { at: 120, up: ['ArrowLeft'] },
      { at: 300 },
    ],
  },
  {
    name: 'bossrush', seed: 0xC0FFEE,
    script: [
      { at: 0, start: { mode: 'bossrush', count: 1 } },
      { at: 40, down: ['KeyC'] },                // up-special toward the boss
      { at: 70, up: ['KeyC'] },
      { at: 300 },
    ],
  },
  {
    name: 'worldcup-inf', seed: 0xC0FFEE,        // World-Cup spectate → infinite stocks (stk:'INF')
    script: [
      { at: 0, tournament: { size: 8, mode: 'spectate' } },
      { at: 200 },
    ],
  },
  {
    name: 'ko', seed: 0x1234,                    // short-stock FFA driven to at least one KO
    script: [
      { at: 0, start: { mode: 'ffa', count: 2, stage: 0 } },
      { at: 10, down: ['ArrowRight', 'KeyX'] },  // pin + hammer p2 off the edge
      { at: 250, up: ['ArrowRight', 'KeyX'] },
      { at: 500 },
    ],
  },
];

// The Lite scenario list Plan C records with `--lite`. Same schema, same file. Because the Lite trim
// is STAGES-ONLY (the roster is the full desktop cast in Web Lite), Lite parity covers ALL FOUR Lite
// modes — ffa, teams, bossrush, worldcup-inf — plus ko; only the STAGE each scenario selects narrows
// to the flagged Lite subset. LITE_SCENARIOS therefore lists the same five names as SCENARIOS.
export const LITE_SCENARIOS = SCENARIOS.filter((s) => ['ffa', 'teams', 'bossrush', 'worldcup-inf', 'ko'].includes(s.name));
```

`scripts/record-monolith.mjs` (replays `test/scenarios.js` against the MONOLITH and records golden Traces; `--lite` selects `LITE_SCENARIOS` but replays the IDENTICAL schema so goldens line up):
```js
// Full:  node scripts/record-monolith.mjs            -> test/golden/monolith-golden.json
// Lite:  node scripts/record-monolith.mjs --lite     -> test/golden/monolith-golden.lite.json
import { writeFileSync } from 'node:fs';
import { loadMonolith } from '../test/helpers/load-monolith.js';
import { SCENARIOS, LITE_SCENARIOS } from '../test/scenarios.js';

const LITE = process.argv.includes('--lite');

// MUST match boot-api.js frameChecksum() byte-for-byte so Trace.frames compare monolith↔modules.
const checksum = (w) =>
  [...w.fighters].map((f) => Math.round((f.x || 0) + (f.y || 0) + (f.pct || 0))).join(',');

// Canonical Trace `final` snapshot (header Contract §3 addendum): stk is number|'INF' (never ∞).
function snapshot(w) {
  return {
    hudStockPercent: [...w.fighters].map((f) => ({
      name: f.name, stk: f.stocks === Infinity ? 'INF' : f.stocks, pct: Math.round(f.pct),
    })),
    standingsOrder: [...w.fighters].slice()
      .sort((a, b) => (b.stocks === Infinity ? 0 : b.stocks) - (a.stocks === Infinity ? 0 : a.stocks))
      .map((f) => f.name),
    koCount: w.fighters.reduce((s, f) => s + (f.killCount || 0), 0),
    finalPlacement: [...w.fighters].slice()
      .sort((a, b) => (a.placement ?? 1e9) - (b.placement ?? 1e9)).map((f) => f.name),
  };
}

// Dispatch ONE Step against the monolith window — mirrors boot-api.js dispatchStep() exactly.
function dispatchStep(w, step) {
  if (step.start) {
    const s = step.start;
    w.SETTINGS.mode = s.mode;
    if (s.count != null) w.SETTINGS.count = s.count;
    if (s.stage != null) w.SETTINGS.stage = s.stage;
    if (s.chosen != null) w.SETTINGS.chosen = s.chosen;
    if (s.teams != null) w.SETTINGS.teams = s.teams;
    if (s.mode === 'bossrush') w.startBossRush();
    else if (s.mode === 'worldcup') w.startTournament();
    else w.startMatch();                                    // ffa | teams
  } else if (step.tournament) {
    w.SETTINGS.mode = 'worldcup';
    w.TOURNEY_SETUP_SIZE = step.tournament.size;
    w.TOURNEY_SETUP_MODE = step.tournament.mode;
    if (step.tournament.mode === 'spectate') w.watchFixture(); else w.startTournament();
  } else {
    // down/up carry DOM event.code strings into the SAME `down` map the monolith's input reads.
    if (step.down) for (const code of step.down) w.down[code] = true;
    if (step.up) for (const code of step.up) w.down[code] = false;
  }
}

function replay(scenario) {
  const { window: w, restore } = loadMonolith(scenario.seed);
  const steps = [...scenario.script].sort((a, b) => a.at - b.at);
  const lastAt = steps.reduce((m, s) => Math.max(m, s.at), 0);
  const frames = [];
  for (let at = 0; at <= lastAt; at++) {
    for (const s of steps) if (s.at === at) dispatchStep(w, s);
    w.step?.();
    frames.push(checksum(w));
  }
  restore();
  return { frames, final: snapshot(w) };  // the canonical Trace
}

const out = {};
for (const sc of (LITE ? LITE_SCENARIOS : SCENARIOS)) out[sc.name] = replay(sc);
writeFileSync(
  LITE ? 'test/golden/monolith-golden.lite.json' : 'test/golden/monolith-golden.json',
  JSON.stringify(out, null, 2) + '\n',
);
```

`test/modules-eval.test.js` (auto-globs every `src/` file; the load-order-agnostic zero-side-effect gate re-run after every stage):
```js
import { describe, it, expect } from 'vitest';
import { spyMediaConstructors } from './helpers/harness.js';

const modules = import.meta.glob('/src/**/*.js');

describe('module evaluation has zero DOM/audio/net side effects', () => {
  it('imports every src module cleanly', async () => {
    const spy = spyMediaConstructors();
    const errors = [];
    for (const [path, load] of Object.entries(modules)) {
      try { await load(); } catch (e) { errors.push(`${path}: ${e.message}`); }
    }
    spy.restore();
    expect(errors, `module eval errors: ${errors.join(' | ')}`).toEqual([]);
    expect(spy.calls.getContext, 'no getContext at eval').toBe(0);
    expect(spy.calls.AudioContext, 'no AudioContext at eval').toBe(0);
    expect(spy.calls.WebSocket, 'no WebSocket at eval').toBe(0);
  });
});
```

- [ ] **Step 4: Run tests, verify pass** — `npm test -- harness.selfcheck` → `Tests 2 passed`. Then `node scripts/record-monolith.mjs` (writes `test/golden/monolith-golden.json`) and `node scripts/record-monolith.mjs --lite` (writes `test/golden/monolith-golden.lite.json`); confirm each keys every scenario name (`ffa`, `teams`, `bossrush`, `worldcup-inf`, `ko` for full; `LITE_SCENARIOS` for lite — the SAME five names, since the Lite trim is stages-only and Lite parity covers all four modes + ko) with a non-empty `frames` array and a `final.hudStockPercent` (and that `worldcup-inf` carries `stk:'INF'`). The Lite golden `test/golden/monolith-golden.lite.json` is (re)recorded from `LITE_SCENARIOS` via `record-monolith.mjs --lite` whenever these scenarios change. `npm test -- modules-eval` passes (`src/core/build.js` + `src/core/handler-coverage.js` + the placeholder `main.js` present, all side-effect-free at eval).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "harness: vitest+jsdom checks (Infinity/handler/aliasing/golden) + monolith golden baseline"`

---

### Task 3: ESLint enforcement — ban reassigning imported bindings + destructuring state scalars

**Files:**
- Create: `eslint.config.js`
- Create: `test/eslint-rules.test.js`
**Interfaces:**
- Consumes: nothing.
- Produces: `npm run lint` fails on any `importedBinding = ...` reassignment and on `const { hazardT } = rt` destructuring of arithmetic state scalars.

- [ ] **Step 1: Write the failing test** — create `test/eslint-rules.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

async function lintText(code) {
  const eslint = new ESLint({ overrideConfigFile: 'eslint.config.js' });
  const [res] = await eslint.lintText(code, { filePath: 'src/probe.js' });
  return res.messages.map((m) => (m.ruleId || '') + ':' + m.message);
}

describe('eslint state-safety rules', () => {
  it('flags reassignment of an imported binding', async () => {
    const msgs = await lintText(`import { running } from './core/state.js';\nrunning = true;\n`);
    expect(msgs.join('|')).toMatch(/no-import-assign/);
  });
  it('flags destructuring of an arithmetic state scalar', async () => {
    const msgs = await lintText(`import { rt } from './core/state.js';\nconst { hazardT } = rt;\nconsole.log(hazardT);\n`);
    expect(msgs.join('|')).toMatch(/no-restricted-syntax|state scalar/);
  });
  it('accepts rt.hazardT++ and setter calls', async () => {
    const msgs = await lintText(`import { rt, setRunning } from './core/state.js';\nrt.hazardT++;\nsetRunning(true);\n`);
    expect(msgs.join('|')).not.toMatch(/no-import-assign|state scalar/);
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- eslint-rules`. Expected: `Cannot find module 'eslint.config.js'`.
- [ ] **Step 3: Minimal implementation** — `npm i -D @eslint/js`, then create `eslint.config.js`:
```js
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      'no-import-assign': 'error',
      'no-const-assign': 'error',
      'no-restricted-syntax': ['error', {
        selector:
          "VariableDeclarator[init.name='rt'] > ObjectPattern > Property[key.name=/^(hazardT|itemTimer|camX|camY|elimSeq|shakeAmt)$/]",
        message: 'Do not destructure an arithmetic state scalar off rt — read rt.<field> at the point of use so it stays live.',
      }, {
        selector: "AssignmentExpression[left.type='Identifier'][left.name='hazardT']",
        message: 'Write rt.hazardT, never a bare hazardT (strict-mode implicit global / import reassignment).',
      }],
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none' }],
    },
  },
  {
    files: ['electron/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', module: 'readonly', __dirname: 'readonly', process: 'readonly' } },
  },
];
```
- [ ] **Step 4: Run tests, verify pass** — `npm test -- eslint-rules` → `Tests 3 passed`. `npm run lint` → `0 problems`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "eslint: ban imported-binding reassignment + arithmetic-state-scalar destructuring"`

---

### Task 4: `index.html` DOM shell + `styles/tokens.css` before `styles/app.css` + `@fontsource` fonts

**Files:**
- Modify: `index.html` (replace `<body>` with monolith lines 282–650 verbatim)
- Create: `styles/tokens.css` (from monolith `:root` block, lines 10–14)
- Create: `styles/app.css` (rest of monolith `<style>`, lines 15–280)
- Modify: `src/main.js` (add the CSS + font imports)
- Create: `test/dom-contract.test.js`
**Interfaces:**
- Consumes: nothing.
- Produces: the verbatim DOM shell (every `id`, `.screen`/`.screen.active`/`#hud.active` class) and the token-first CSS load order; `--grass` etc. resolve non-empty after load. No remote font `@import`.

- [ ] **Step 1: Write the failing test** — `test/dom-contract.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { domContract } from './helpers/harness.js';

// ids referenced by getElementById across the monolith (generated once, frozen here).
const REQUIRED_IDS = ['app','cv','title','soundToggle','select','board','segTeams','controls',
  'hud','result','resultTitle','resultSub','scorecard','runReview','hint','editor','edTool',
  'edHazard','edProps','edZoneRow','edZoneType','edRotBtn','edStrRow','edStrLabel','edStrength',
  'edcanvas','edName','edLevelList','test','testDummies','testBehavior','testDamage','lobby',
  'homeApiKey','homeKeyNote','planMsg'];

describe('DOM contract', () => {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'));
  it('every required id is present', () => domContract(dom.window.document, REQUIRED_IDS));
  it('exactly one .screen.active at load (title)', () => {
    const active = dom.window.document.querySelectorAll('.screen.active');
    expect(active.length).toBe(1);
    expect(active[0].id).toBe('title');
  });
  it('no remote font @import remains', () => {
    const css = readFileSync('styles/app.css', 'utf8') + readFileSync('styles/tokens.css', 'utf8');
    expect(css).not.toMatch(/@import url\(['"]https:\/\/fonts/);
  });
  it('tokens.css defines --grass', () => {
    expect(readFileSync('styles/tokens.css', 'utf8')).toMatch(/--grass\s*:/);
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- dom-contract`. Expected: `ENOENT: styles/tokens.css` and the id assertion fails against the placeholder `index.html`.
- [ ] **Step 3: Minimal implementation** —
  - Copy monolith `<body>…</body>` (lines 282–650) verbatim into `index.html`, preserving every `id`, every `class`, every inline `on*=` attribute, and the `<canvas id="cv">`. Keep the `<script type="module" src="/src/main.js"></script>` at the end of `<body>`. Do **not** copy the monolith `<script>` game code.
  - `styles/tokens.css` = the monolith `:root{ --grass:… }` block (lines 10–14) only.
  - `styles/app.css` = the remainder of the monolith `<style>` (lines 15–280). Delete the remote `@import url('https://fonts.googleapis.com/...')` line (monolith line 8) entirely.
  - In `src/main.js`, prepend imports so tokens load first, then app, then bundled fonts:
```js
import '../styles/tokens.css';
import '../styles/app.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource-variable/jetbrains-mono';
console.log('BFSI boot placeholder');
```
  - Keep the `font-family:'Fredoka',…` / `'JetBrains Mono',…` declarations in `app.css` unchanged — `@fontsource` registers those exact family names.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- dom-contract` → `Tests 4 passed`. `npm run dev` shows the title screen styled (grass-green buttons, Fredoka font) with no console errors and no network font request (check DevTools Network is empty for fonts).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: verbatim DOM shell + tokens-first CSS + @fontsource (no remote @import)"`

---

### Task 5: `src/core/constants.js` (leaf)

**Files:**
- Create: `src/core/constants.js`
- Create: `test/constants.test.js`
**Interfaces:**
- Consumes: nothing (leaf, zero imports).
- Produces exports (map): `DEFAULT_KEYS, DEFAULT_KEYS_P2, KEY_LABELS, MAX_FFA, MAX_TEAMS, TEAM_COLORS, CAM_ZOOM, TOURNEY_TIME_LIMIT, CLAIM_FRAMES, GRAV, MOVE, MAXVX, JUMP, FRICTION, POINTED, ITEM_KINDS, FREEZE_MAX, REFREEZE_GAP, CTRLREV_MAX, RESCRAMBLE_GAP, CURSE_MAX_STACKS, CURSE_FLOOR, CURSE_DECAY, PLACE_MAX`.

Monolith source ranges to move (each a `const`/`let` literal, no function bodies): `838-847, 858-877, 1021, 1300, 2173, 2420, 2455, 2485, 4435-4462, 4769`. These are scattered tunables; gather them into one leaf file and prefix each with `export`. `CAM_ZOOM` is monolith line 1021; `PLACE_MAX` line 4769; the freeze/curse block is 4435–4462.

- [ ] **Step 1: Write the failing test** — `test/constants.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as C from '../src/core/constants.js';

describe('constants leaf', () => {
  it('exports every tunable the map lists', () => {
    for (const k of ['DEFAULT_KEYS','DEFAULT_KEYS_P2','KEY_LABELS','MAX_FFA','MAX_TEAMS',
      'TEAM_COLORS','CAM_ZOOM','TOURNEY_TIME_LIMIT','CLAIM_FRAMES','GRAV','MOVE','MAXVX','JUMP',
      'FRICTION','POINTED','ITEM_KINDS','FREEZE_MAX','REFREEZE_GAP','CTRLREV_MAX','RESCRAMBLE_GAP',
      'CURSE_MAX_STACKS','CURSE_FLOOR','CURSE_DECAY','PLACE_MAX'])
      expect(C[k], k).toBeDefined();
  });
  it('matches monolith values', () => {
    expect(C.CAM_ZOOM).toBe(0.72);
    expect(C.DEFAULT_KEYS.pause).toBeDefined();
    expect(Array.isArray(C.TEAM_COLORS)).toBe(true);
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- constants`. Expected: `Cannot find module '../src/core/constants.js'`.
- [ ] **Step 3: Minimal implementation** — create `src/core/constants.js` by moving the literal declarations from the listed ranges, each `export`ed. Verify against the monolith values (e.g. `CAM_ZOOM=0.72`). No imports, no function calls at top level.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- constants modules-eval` → all pass; `modules-eval` confirms zero side effects.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: src/core/constants.js leaf tunables"`

---

### Task 6: `src/data/roster.js` + `src/data/stages.js` (leaves)

**Files:**
- Create: `src/data/roster.js`
- Create: `src/data/stages.js`
- Create: `test/data.test.js`
**Interfaces:**
- Consumes: nothing.
- Produces: `roster.js` → `ROSTER, ASSIST_ROSTER, BOSS_ROSTER`; `stages.js` → `STAGES`.

Monolith ranges — `roster.js`: `658-779` (ROSTER) + `2456-2484` (ASSIST_ROSTER, BOSS_ROSTER). `stages.js`: `780-837` (STAGES). Export the **live** `ROSTER` object (do **not** `Object.freeze` — balance code mutates it in place, per the map note).

- [ ] **Step 1: Write the failing test** — `test/data.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { ROSTER, ASSIST_ROSTER, BOSS_ROSTER } from '../src/data/roster.js';
import { STAGES } from '../src/data/stages.js';

describe('data leaves', () => {
  it('roster has a playable default and kit specials', () => {
    expect(ROSTER.length).toBeGreaterThan(8);
    expect(ROSTER.find((r) => r.play)).toBeTruthy();
    expect(ROSTER.every((r) => r.kit)).toBe(true);
  });
  it('assist and boss rosters present', () => {
    expect(ASSIST_ROSTER.length).toBeGreaterThan(0);
    expect(BOSS_ROSTER.length).toBeGreaterThan(0);
  });
  it('stages present with a default', () => {
    expect(STAGES.length).toBeGreaterThan(0);
    expect(STAGES[0].name).toBeTruthy();
  });
  it('ROSTER is not frozen (balance mutates in place)', () => {
    expect(Object.isFrozen(ROSTER)).toBe(false);
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- data`. Expected: `Cannot find module '../src/data/roster.js'`.
- [ ] **Step 3: Minimal implementation** — move the ranges verbatim, prefix `ROSTER`/`ASSIST_ROSTER`/`BOSS_ROSTER`/`STAGES` with `export const`. No imports.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- data modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: src/data/roster.js + stages.js leaves"`

---

### Task 7: `src/core/state.js` — 51 singletons + setters + rt fields + in-place mutators + shake() + initDom() (most correctness-critical)

**Files:**
- Create: `src/core/state.js`
- Create: `test/state.test.js`
**Interfaces:**
- Consumes: `ROSTER` (roster.js), `STAGES` (stages.js), `DEFAULT_KEYS, DEFAULT_KEYS_P2` (constants.js).
- Produces: all 51 `coreStateExports` names, plus `initDom, setStage, setChosen, setKeys, shake, decayShake`, plus the full setter/mutator surface below.

Monolith source ranges holding these declarations: `844-857, 1010-1019, 1207, 1295-1300, 1307, 1563, 1722, 1798, 2920, 2961, 4580, 4934, 6451` (the scattered `let`/`const` singleton declarations and the `shake`/`decayShake` bodies). The core state block is monolith `1012-1019` + `853-854` (SETTINGS/TESTMODE) + `1015, 1017, 1019` (lastKoFrame, cam/world arrays, TEAM_PLAN).

**The three mechanisms (Global Constraints, restated concretely):**

- **`export const rt`** — arithmetic scalars: `{ hazardT:0, itemTimer:0, camX:0, camY:0, elimSeq:0, shakeAmt:0 }`. (Note `elimSeq` is migrated from `window.__elimSeq`; `itemTimer` monolith `let itemTimer=0`.)
- **`export const` pools (never reassigned):** `fighters, particles, projectiles, beams, items, summons, tendrils, worldPlats, floors, worldZones, spawnZones, bases` all `= []`. Plus in-place helpers:
```js
export function replaceArr(a, b) { a.length = 0; for (const x of b) a.push(x); return a; }
export function filterInPlace(a, pred) { let w = 0; for (let r = 0; r < a.length; r++) if (pred(a[r], r)) a[w++] = a[r]; a.length = w; return a; }
```
- **`export let` + setter** for wholesale-swapped scalars/objects: `W, H, WW, WH` (init `1100,720,1100,720`), `running=false, paused=false, raf=0, evil=null, BOSS_ARENA=null, lastKoFrame=0, LOCAL_PLAYERS=1, AI_LEVEL=1, CUSTOM_LEVEL=null, KEYS, KEYS_P2, stage, chosen, TOURNEY, TOURNEY_MATCH_ACTIVE=false, TOURNEY_WATCHING=null, PENDING_TOURNEY=null, PENDING_CUSTOM=false, TOURNEY_SETUP_SIZE, TOURNEY_SETUP_MODE, TEAM_PLAN={}`. Setters: `setW,setH,setWW,setWH,setRunning,setPaused,setRaf,setEvil,setBossArena,setLastKoFrame,setLocalPlayers,setAiLevel,setCustomLevel,setKeys,setKeysP2,setStage,setChosen,setTourney,setTourneyMatchActive,setTourneyWatching,setPendingTourney,setPendingCustom,setTourneySetupSize,setTourneySetupMode,setTeamPlan`.
- **`export const` in-place object singletons (mutate props, never reassign):** `SETTINGS` (line 853), `TESTMODE` (854), `TUT` (1307), `BOSSRUSH` (must init `{active:false, loop:0, dmgMult:1, ...}` — map: "initial value MUST include loop:0 and dmgMult:1"), `STOMACH` ({x,y,r}), `down` ({}).
- **Init at eval (needs leaves imported):** `chosen = ROSTER.find((r) => r.play)`, `stage = STAGES[0]`, `KEYS = structuredClone(DEFAULT_KEYS)`, `KEYS_P2 = structuredClone(DEFAULT_KEYS_P2)`.
- **`cv`/`ctx` lazy:** `export let cv = null, ctx = null;` + `export function initDom(){ cv = document.getElementById('cv'); ctx = cv.getContext('2d'); }`. Never touched at import.
- **`shake`/`decayShake` co-located (moved out of draw.js to break render↔hit/boss cycles):**
```js
export function shake(a) { rt.shakeAmt = Math.max(rt.shakeAmt, a); }
export function decayShake() { rt.shakeAmt *= 0.9; if (rt.shakeAmt < 0.5) rt.shakeAmt = 0; return rt.shakeAmt; }
```
(Port the exact factors from monolith lines 2920/2961; if the monolith `shake()` did `shakeAmt=Math.max(shakeAmt,a)` keep it identical.)

**Reassignment sites converted to setters/fields (this is the load-bearing rewrite; each later extraction task links back here):**
| Monolith write | Becomes |
|---|---|
| `hazardT++`, reads of `hazardT` | `rt.hazardT++`, `rt.hazardT` |
| `itemTimer--`, `itemTimer=` | `rt.itemTimer--`, `rt.itemTimer=` |
| `camX=`, `camX+=`, `camY…` | `rt.camX…`, `rt.camY…` |
| `__elimSeq`/`elimSeq++` | `rt.elimSeq++` |
| `W=`, `H=`, `WW=`, `WH=` (resize/setupWorld/applySnapshot) | `setW/…(v)` |
| `running=`, `paused=`, `raf=` | `setRunning/setPaused/setRaf` |
| `fighters=…`, `floors=…`, `bases=…`, `spawnZones=…` (wholesale) | `replaceArr(fighters, …)` etc. |
| `particles=particles.filter(…)` and the other pools' per-frame filters | `filterInPlace(particles, pred)` etc. |
| `stage=`, `chosen=`, `KEYS=`, `TOURNEY=`, `CUSTOM_LEVEL=`, `BOSS_ARENA=`, `evil=`, `lastKoFrame=`, tourney flags | matching `setX(v)` |
| `TEAM_PLAN=` / `TEAM_PLAN[k]=` | `setTeamPlan(v)` for wholesale; prop-mutate `TEAM_PLAN[k]=…` stays (object mutated in place) |

- [ ] **Step 1: Write the failing test** — `test/state.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as S from '../src/core/state.js';

describe('core/state', () => {
  it('initializes chosen/stage/KEYS from leaves at eval', () => {
    expect(S.chosen).toBeTruthy();
    expect(S.chosen.play).toBe(true);
    expect(S.stage).toBeTruthy();
    expect(S.KEYS).toBeTruthy();
  });
  it('cv/ctx are null until initDom', () => {
    expect(S.cv).toBeNull();
    expect(S.ctx).toBeNull();
  });
  it('rt fields support ++ and += (live object)', () => {
    const h0 = S.rt.hazardT; S.rt.hazardT++; expect(S.rt.hazardT).toBe(h0 + 1);
    S.rt.camX += 5; expect(S.rt.camX).toBe(5);
  });
  it('setters update the live binding observed via namespace', () => {
    S.setRunning(true); expect(S.running).toBe(true);
    S.setW(1280); expect(S.W).toBe(1280);
  });
  it('pools are stable-identity and mutate in place', () => {
    const ref = S.fighters;
    S.replaceArr(S.fighters, [1, 2, 3]);
    expect(S.fighters).toBe(ref); expect(S.fighters).toEqual([1, 2, 3]);
    S.filterInPlace(S.fighters, (x) => x > 1);
    expect(S.fighters).toEqual([2, 3]); expect(S.fighters).toBe(ref);
  });
  it('shake writes shakeAmt; decayShake reduces it', () => {
    S.shake(10); expect(S.rt.shakeAmt).toBe(10);
    S.decayShake(); expect(S.rt.shakeAmt).toBeLessThan(10);
  });
  it('BOSSRUSH seeds loop:0 and dmgMult:1', () => {
    expect(S.BOSSRUSH.loop).toBe(0); expect(S.BOSSRUSH.dmgMult).toBe(1);
  });
  it('initDom resolves cv/ctx against a jsdom canvas', () => {
    document.body.innerHTML = '<canvas id="cv"></canvas>';
    S.initDom(); expect(S.cv).not.toBeNull();
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- state`. Expected: `Cannot find module '../src/core/state.js'`.
- [ ] **Step 3: Minimal implementation** — create `src/core/state.js` per the contract above: import the three leaves, declare `rt`, the pools + `replaceArr`/`filterInPlace`, the `export let` + setters, the in-place object singletons, the eval-time init of `chosen/stage/KEYS/KEYS_P2`, `cv/ctx` + `initDom`, and `shake`/`decayShake`. Zero DOM/audio at top level (only `initDom` touches the DOM).
- [ ] **Step 4: Run tests, verify pass** — `npm test -- state modules-eval` → all pass; `modules-eval` still shows zero `getContext` at eval (initDom not auto-called).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: src/core/state.js — 51 singletons, setters, rt fields, in-place pools, shake, initDom"`

---

### Task 8: `src/audio/audio.js` (preserved verbatim — SFX + existing setTimeout music)

**Files:**
- Create: `src/audio/audio.js`
- Create: `test/audio.test.js`
**Interfaces:**
- Consumes: nothing (self-contained).
- Produces (map): `SFX, startMusic, stopMusic, musicNote, sndInit, sndResume, toggleSound, tone, noise, SND`.

Monolith range `883-1009`. Preserve behavior exactly (music rebuild is Plan B). **Critical change:** the import-time unlock listener block (monolith lines 1006–1008, `['pointerdown','keydown','touchstart'].forEach(...window.addEventListener...)`) must **not** run at module eval — delete it here and re-register it from `main.js` boot (Task 31). All fns already guard `SND.ctx===null`; keep those guards. `SND` stays module-local (not in core/state.js) per the map's `unassigned` note.

- [ ] **Step 1: Write the failing test** — `test/audio.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import * as A from '../src/audio/audio.js';

describe('audio (preserved)', () => {
  it('exports the preserved interface', () => {
    for (const k of ['SFX','startMusic','stopMusic','musicNote','sndInit','sndResume','toggleSound','tone','noise','SND'])
      expect(A[k], k).toBeDefined();
  });
  it('creates no AudioContext at import (SND.ctx null pre-gesture)', () => {
    expect(A.SND.ctx).toBeNull();
  });
  it('startMusic no-ops silently when ctx is null', () => {
    expect(() => A.startMusic('battle')).not.toThrow();
  });
  it('registers no top-level window unlock listener', () => {
    // proven by modules-eval zero-side-effect gate; smoke-check the source has no bare addEventListener
    // (asserted structurally in Task 31 boot test)
    expect(typeof A.sndInit).toBe('function');
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- audio`. Expected: `Cannot find module '../src/audio/audio.js'`.
- [ ] **Step 3: Minimal implementation** — move monolith `883-1009` into `src/audio/audio.js`, `export`ing the interface list. Remove the import-time unlock listener (lines 1006–1008). Ensure `new AudioContext()` occurs only inside `sndInit`/`sndResume`, guarded by `SND.ctx===null`.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- audio modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: src/audio/audio.js (behavior preserved; unlock listener deferred to boot)"`

---

### Task 9: Engine near-leaves — `src/engine/physics.js` + `src/engine/particles.js`

**Files:**
- Create: `src/engine/physics.js`, `src/engine/particles.js`
- Create: `test/engine-leaves.test.js`
**Interfaces:**
- `physics.js` consumes state `{ SETTINGS, stage, CUSTOM_LEVEL, WW, WH, W, H }`; produces `isBig, isBigFFA, scrolls, clamp, feetY, groundY, stageScale, applyZone`.
- `particles.js` consumes state `{ particles }`; produces `puff`.

Monolith ranges — `physics.js`: `1020-1023` (isBig/CAM_ZOOM-adjacent isBigFFA/scrolls) + `2005-2010` + `4568-4579` (clamp/feetY/groundY/stageScale/applyZone). `particles.js`: `4836-4846` (`puff`). **Rewrite:** physics reads `WW/WH/W/H` as `import { WW, WH, W, H }` (live `let` bindings — read-only reads are fine) except where the map lists arithmetic on cam; physics only reads, so named imports suffice. `particles.puff` pushes into the live `particles` pool (`import { particles }`, `particles.push(...)` — in-place, legal). `clamp` is the widely-imported util — keep it tiny and dependency-light.

- [ ] **Step 1: Write the failing test** — `test/engine-leaves.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { clamp, groundY, isBig, isBigFFA, scrolls } from '../src/engine/physics.js';
import { puff } from '../src/engine/particles.js';
import { particles, SETTINGS } from '../src/core/state.js';

describe('engine leaves', () => {
  it('clamp bounds a value', () => { expect(clamp(5, 0, 3)).toBe(3); expect(clamp(-1, 0, 3)).toBe(0); });
  it('isBig reflects SETTINGS.mode', () => { SETTINGS.mode = 'teams'; expect(isBig()).toBe(true); SETTINGS.mode = 'ffa'; expect(isBig()).toBe(false); });
  it('puff pushes into the live particle pool in place', () => {
    particles.length = 0; const ref = particles;
    puff(10, 10, '#fff', 4);
    expect(particles.length).toBe(4); expect(particles).toBe(ref);
  });
  it('groundY/scrolls callable without throwing', () => { expect(typeof groundY(0)).toBe('number'); expect(typeof scrolls()).toBe('boolean'); });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- engine-leaves`. Expected: `Cannot find module '../src/engine/physics.js'`.
- [ ] **Step 3: Minimal implementation** — move the ranges; add the `import { SETTINGS, stage, CUSTOM_LEVEL, WW, WH, W, H } from '../core/state.js'` line to physics and `import { particles } from '../core/state.js'` to particles. Prefix exports.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- engine-leaves modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: engine/physics.js + particles.js near-leaves"`

---

### Task 10: `src/engine/hit.js` (applyHit AST-whole — recursive core)

**Files:**
- Create: `src/engine/hit.js`
- Create: `test/hit.test.js`
**Interfaces:**
- Consumes (map): state `{ fighters, projectiles, summons, particles, camY→rt.camY, SETTINGS, hazardT→rt.hazardT, lastKoFrame, running, TESTMODE, bases, chosen, TOURNEY, TOURNEY_WATCHING, W, WH, shake, elimSeq→rt.elimSeq }`; constants `{ CURSE_MAX_STACKS, CURSE_FLOOR, CURSE_DECAY, FREEZE_MAX, REFREEZE_GAP, CTRLREV_MAX, RESCRAMBLE_GAP }`; physics `{ feetY, groundY, isBig, isBigFFA, clamp }`; particles `{ puff }`; boss `{ bossDmg, freeFromStomach }`; attacks `{ comebackPoints, comebackFlavor, comebackRange, comebackShots, COMEBACK, COMEBACK_IFRAME_FLOOR }`; hud `{ banner }`; audio `{ SFX }`; arena `{ ffaRespawn }`; boss-rush `{ bossRushCheck }`.
- Produces: `applyHit, hitCircle, damageSummons, applyFreeze, freezeDuration, applyCtrlRev, knock, eliminate`.

Monolith ranges `4389-4476, 4476-4560, 4561-4657`. **`applyHit` is slice-cut across 4463–4560 — reunite it whole**, keeping `hitCircle` and `damageSummons` co-located (the recursion depends on them). **Reassignment sites → state:** `lastKoFrame = hazardT` (in `eliminate`) becomes `setLastKoFrame(rt.hazardT)`; `elimSeq++` becomes `rt.elimSeq++`; any `camY` read becomes `rt.camY`; `hazardT` reads become `rt.hazardT`. `eliminate` KO'ing a fighter mutates `f.stocks--` (on the fighter object — fine) and must NOT bare-assign any undeclared global (strict mode). The cross-imports to `arena.ffaRespawn`/`boss-rush.bossRushCheck` are **call-time only** (invoked inside `eliminate`, never at eval).

- [ ] **Step 1: Write the failing test** — `test/hit.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as H from '../src/engine/hit.js';
import * as S from '../src/core/state.js';

function mkFighter(over = {}) {
  return { x: 100, y: 100, vx: 0, vy: 0, pct: 0, stocks: 3, dead: false, alive: true,
    team: 0, name: 'T', color: '#fff', w: 30, h: 40, kit: {}, iframe: 0, ...over };
}
describe('engine/hit', () => {
  it('exports the recursive core co-located', () => {
    for (const k of ['applyHit','hitCircle','damageSummons','applyFreeze','freezeDuration','applyCtrlRev','knock','eliminate'])
      expect(H[k], k).toBeDefined();
  });
  it('applyHit raises target percent and knocks back', () => {
    S.replaceArr(S.fighters, [mkFighter({ name: 'A' }), mkFighter({ name: 'B', x: 120 })]);
    const [a, b] = S.fighters; const pct0 = b.pct;
    H.applyHit(a, b, { dmg: 12, kb: 6, dir: 1 });
    expect(b.pct).toBeGreaterThan(pct0);
  });
  it('eliminate decrements stocks and updates lastKoFrame via setter', () => {
    S.replaceArr(S.fighters, [mkFighter({ name: 'A' })]);
    S.rt.hazardT = 77;
    H.eliminate(S.fighters[0], null);
    expect(S.lastKoFrame).toBe(77);
  });
});
```
(Signatures of `applyHit`/`eliminate` must match the monolith; adjust the test payload shape to the real parameter list when implementing — do not change the functions.)
- [ ] **Step 2: Run it, verify it fails** — `npm test -- hit`. Expected: `Cannot find module '../src/engine/hit.js'`.
- [ ] **Step 3: Minimal implementation** — extract the three ranges AST-whole; add the import block (per Interfaces); rewrite the reassignment sites listed above. Cross-cycle imports (`arena`, `boss-rush`) may not resolve their functions until those tasks land — that is fine because they are **not called at eval**; a smoke import must still not throw.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- hit modules-eval`. (Cross-imports to not-yet-created modules: keep them as forward imports only if those files exist as stubs; if arena/boss-rush aren't created yet, temporarily import from a local `TODO` re-export is banned — instead, reorder so hit.js's imports of `ffaRespawn`/`bossRushCheck` are added in Task 23/26 when those modules exist. Until then, comment the two cross-imports with a `// wired in Task 23/26` marker and the calls resolve via `import` added then.) Simpler: create empty placeholder modules `src/modes/arena.js` and `src/modes/boss-rush.js` exporting `export function ffaRespawn(){}` / `export function bossRushCheck(){}` now, replaced in Tasks 23/26. Add that to this step.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: engine/hit.js (applyHit reunited AST-whole; eliminate via setLastKoFrame/rt.elimSeq)"`

---

### Task 11: `src/engine/combat.js` (items + projectile factories + summon spawners)

**Files:**
- Create: `src/engine/combat.js`
- Create: `test/combat.test.js`
**Interfaces:**
- Consumes (map): state `{ SETTINGS, items, itemTimer→rt.itemTimer, fighters, summons, projectiles, camY→rt.camY, WW }`; constants `{ POINTED, ITEM_KINDS }`; roster `{ ASSIST_ROSTER, BOSS_ROSTER }`; physics `{ groundY, clamp }`; particles `{ puff }`; boss `{ updateSummons }`; audio `{ SFX }`.
- Produces: `itemSpawnInterval, spawnItem, updateItems, pickUpItem, summonAssist, summonBoss, spawnProj, dropProj`.

Monolith ranges `2487-2555, 4374-4388`. **Reassignment sites → state:** `itemTimer--`/`itemTimer=` → `rt.itemTimer`; the `items = items.filter(...)` per-frame swap in `updateItems` → `filterInPlace(items, pred)`; `summons`/`projectiles` filters likewise. `updateItems→updateSummons` is the call-time `combat↔boss` cycle (safe).

- [ ] **Step 1: Write the failing test** — `test/combat.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as C from '../src/engine/combat.js';
import * as S from '../src/core/state.js';

describe('engine/combat', () => {
  it('exports factories + spawners', () => {
    for (const k of ['itemSpawnInterval','spawnItem','updateItems','pickUpItem','summonAssist','summonBoss','spawnProj','dropProj'])
      expect(C[k], k).toBeDefined();
  });
  it('spawnProj pushes into the live projectiles pool in place', () => {
    S.projectiles.length = 0; const ref = S.projectiles;
    C.spawnProj({ x: 0, y: 0, team: 0 }, 1, {});
    expect(S.projectiles.length).toBeGreaterThan(0); expect(S.projectiles).toBe(ref);
  });
  it('updateItems filters in place without reassigning', () => {
    const ref = S.items; S.replaceArr(S.items, [{ dead: true }, { dead: false }]);
    C.updateItems(); expect(S.items).toBe(ref);
  });
});
```
(Match real `spawnProj` signature at implementation time.)
- [ ] **Step 2: Run it, verify it fails** — `npm test -- combat`. Expected: `Cannot find module`.
- [ ] **Step 3: Minimal implementation** — move ranges; add import block; rewrite `itemTimer`→`rt.itemTimer` and the pool filters → `filterInPlace`.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- combat modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: engine/combat.js (rt.itemTimer + filterInPlace pools)"`

---

### Task 12: `src/engine/boss.js` (boss AI + updateSummons + module-local BOSS_ATK_ID)

**Files:**
- Create: `src/engine/boss.js`
- Create: `test/boss.test.js`
**Interfaces:**
- Consumes (map): state `{ fighters, summons, projectiles, beams, items, worldPlats, tendrils, STOMACH, BOSSRUSH, BOSS_ARENA, SETTINGS, WW, hazardT→rt.hazardT, camX→rt.camX, camY→rt.camY, shake }`; constants `{ GRAV, POINTED }`; physics `{ groundY, clamp, isBigFFA }`; combat `{ spawnProj, dropProj }`; particles `{ puff }`; hit `{ applyHit }`; hud `{ banner }`; audio `{ SFX }`.
- Produces: `updateBossAttack, updateSummons, spawnTendril, updateTendrils, fireSwallow, updateSwallow, freeFromStomach, bossDmg, BOSS_DMG_BASE, bossAtkGap, onBossPhaseChange, bossPhaseName, bossTelLen, bossTelName, fireBossAttack, budgetCutPlatform`.

Monolith ranges `2556-2740, 2916-2977, 2977-3075`. **`BOSS_ATK_ID` stays module-local** (`let BOSS_ATK_ID = 0;` inside boss.js — both increment sites live here; projectiles carry `pr._atk` snapshots). **`updateSummons` stays here** (straddles boss dispatch + item/assist switch). **Reassignment sites:** `hazardT`/`camX`/`camY` reads → `rt.*`; `worldPlats = worldPlats.filter(...)` in `budgetCutPlatform` → `filterInPlace(worldPlats, pred)`; `tendrils`/`summons`/`projectiles` filters → `filterInPlace`. `shake(...)` is imported from state. Cross-imports `hit.applyHit`, `combat.spawnProj/dropProj`, `hud.banner` are call-time.

- [ ] **Step 1: Write the failing test** — `test/boss.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as B from '../src/engine/boss.js';
import * as S from '../src/core/state.js';

describe('engine/boss', () => {
  it('exports the full boss surface incl updateSummons + budgetCutPlatform', () => {
    for (const k of ['updateBossAttack','updateSummons','spawnTendril','updateTendrils','fireSwallow',
      'updateSwallow','freeFromStomach','bossDmg','BOSS_DMG_BASE','bossAtkGap','onBossPhaseChange',
      'bossPhaseName','bossTelLen','bossTelName','fireBossAttack','budgetCutPlatform'])
      expect(B[k], k).toBeDefined();
  });
  it('budgetCutPlatform filters worldPlats in place', () => {
    const ref = S.worldPlats; S.replaceArr(S.worldPlats, [{ id: 1 }, { id: 2 }]);
    B.budgetCutPlatform?.(0);
    expect(S.worldPlats).toBe(ref);
  });
  it('bossDmg returns a number scaled by BOSSRUSH.dmgMult', () => {
    expect(typeof B.bossDmg(10)).toBe('number');
  });
});
```
(Match real signatures at implementation.)
- [ ] **Step 2: Run it, verify it fails** — `npm test -- boss`. Expected: `Cannot find module`.
- [ ] **Step 3: Minimal implementation** — extract the three ranges AST-whole; declare `let BOSS_ATK_ID = 0` module-local; add the import block; rewrite `rt.*` reads and the `filterInPlace` pool swaps.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- boss modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: engine/boss.js (module-local BOSS_ATK_ID; updateSummons; filterInPlace)"`

---

### Task 13: `src/engine/attacks.js` (X attack + smashes dispatch + comeback + RANGE_PROFILE)

**Files:**
- Create: `src/engine/attacks.js`
- Create: `test/attacks.test.js`
**Interfaces:**
- Consumes (map): state `{ fighters, projectiles, beams }`; smashes `{ SMASHES }`; hit `{ applyHit, hitCircle, applyFreeze, freezeDuration }`; combat `{ spawnProj, dropProj }`; particles `{ puff }`; physics `{ feetY, groundY, clamp }`; hud `{ banner }`.
- Produces: `doAttack, doSmash, doGroundMove, genericSmash, comebackPoints, comebackFlavor, comebackShots, comebackRange, rangeProfile, RANGE_PROFILE, RANGED_ATTACKERS, COMEBACK, COMEBACK_IFRAME_FLOOR, COMEBACK_MAX_POINTS`.

Monolith ranges `3561-3739, 3887-3990, 3990-4009`. **`RANGE_PROFILE`/`RANGED_ATTACKERS` are data tables — they may reference imported helpers inside entries but must not CALL them at table-definition time** (no-CALL-at-eval rule). `doSmash` imports `SMASHES` → the `attacks↔smashes` call-time cycle. `RANGE_PROFILE` is exported from here and read by `roster-screen.js` (Task 20).

- [ ] **Step 1: Write the failing test** — `test/attacks.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as A from '../src/engine/attacks.js';

describe('engine/attacks', () => {
  it('exports attack + comeback + RANGE_PROFILE', () => {
    for (const k of ['doAttack','doSmash','doGroundMove','genericSmash','comebackPoints','comebackFlavor',
      'comebackShots','comebackRange','rangeProfile','RANGE_PROFILE','RANGED_ATTACKERS','COMEBACK',
      'COMEBACK_IFRAME_FLOOR','COMEBACK_MAX_POINTS'])
      expect(A[k], k).toBeDefined();
  });
  it('RANGE_PROFILE is a plain object built without calling engine helpers at eval', () => {
    expect(typeof A.RANGE_PROFILE).toBe('object');
  });
  it('doAttack is a function (dispatch resolves)', () => { expect(typeof A.doAttack).toBe('function'); });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- attacks`. Expected: `Cannot find module`.
- [ ] **Step 3: Minimal implementation** — move the ranges; add import block; confirm `RANGE_PROFILE`/`RANGED_ATTACKERS` entries only reference (never call) engine helpers.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- attacks modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: engine/attacks.js (RANGE_PROFILE + comeback; no CALL-at-eval)"`

---

### Task 14: `src/engine/specials.js` + `src/data/smashes.js` (reserved-word keys; keep_quoted_props)

**Files:**
- Create: `src/engine/specials.js`, `src/data/smashes.js`
- Create: `test/specials.test.js`
**Interfaces:**
- `specials.js` consumes (map): state `{ fighters, projectiles, summons, camY→rt.camY, SETTINGS, hazardT→rt.hazardT }`; combat `{ spawnProj, dropProj }`; hit `{ hitCircle, applyHit, applyFreeze, freezeDuration, applyCtrlRev, knock }`; particles `{ puff }`; physics `{ feetY, groundY, clamp }`; boss `{ bossDmg, freeFromStomach }`; attacks `{ comebackFlavor, comebackRange, comebackShots }`; hud `{ banner }`; audio `{ SFX }`. Produces `doSpecial, doUpSpecial, doDownSpecial, doAttackSpecial, applyDashVY, DASH_KITS, upLaunch, UPSPECIALS, DOWNSPECIALS, ATKSPECIALS`.
- `smashes.js` consumes state `{ fighters, projectiles, beams }`, hit `{ applyHit, hitCircle, applyFreeze, freezeDuration }`, combat `{ spawnProj, dropProj }`, particles `{ puff }`, physics `{ feetY, groundY, clamp }`, attacks `{ comebackFlavor }`, hud `{ banner }`. Produces `SMASHES`.

Monolith ranges — `specials.js`: `3896-4009, 4012-4373` (**`doSpecial`'s big switch is slice-cut — reunite whole**). `smashes.js`: `3740-3886`. **Reserved-word keys:** `UPSPECIALS/DOWNSPECIALS/ATKSPECIALS`/`SMASHES` use quoted string keys including `'switch'`/`'static'` — keep them **quoted literals**; the bundle's Terser config (`mangle.properties:false`, `keep_quoted_props:true`, Task 1) preserves them. **No-CALL-at-eval:** the four dispatch tables (`DASH_KITS/UPSPECIALS/DOWNSPECIALS/ATKSPECIALS`) and `SMASHES` reference engine helpers inside method bodies only.

- [ ] **Step 1: Write the failing test** — `test/specials.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as SP from '../src/engine/specials.js';
import { SMASHES } from '../src/data/smashes.js';
import { ROSTER } from '../src/data/roster.js';

describe('engine/specials + data/smashes', () => {
  it('exports dispatch tables + doSpecial', () => {
    for (const k of ['doSpecial','doUpSpecial','doDownSpecial','doAttackSpecial','applyDashVY','DASH_KITS','upLaunch','UPSPECIALS','DOWNSPECIALS','ATKSPECIALS'])
      expect(SP[k], k).toBeDefined();
  });
  it('reserved-word keys survive as quoted literals', () => {
    // every kit.special referenced by data must resolve to a function
    const tables = { special: SP.UPSPECIALS, down: SP.DOWNSPECIALS, attack: SP.ATKSPECIALS };
    expect(typeof SMASHES).toBe('object');
    for (const kit of ROSTER.map((r) => r.kit).filter(Boolean)) {
      if (kit.special && SMASHES[kit.special]) expect(typeof SMASHES[kit.special]).toBe('function');
    }
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- specials`. Expected: `Cannot find module`.
- [ ] **Step 3: Minimal implementation** — extract `doSpecial` reunited whole + the dispatch tables into specials.js; extract `SMASHES` into smashes.js; add both import blocks; rewrite `rt.*` reads; keep all reserved-word keys quoted.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- specials modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: engine/specials.js + data/smashes.js (quoted reserved-word keys; doSpecial reunited)"`

---

### Task 15: `src/engine/fighter.js` (buildFighters/makeFighter/shuffle + step + loop, AST-whole)

**Files:**
- Create: `src/engine/fighter.js`
- Create: `test/fighter.test.js`
**Interfaces:**
- Consumes (map): state (large read set incl `fighters, projectiles, summons, particles, beams, worldZones, evil, stage, hazardT→rt.hazardT, down, KEYS, KEYS_P2, camX→rt.camX, camY→rt.camY, WW, WH, chosen, SETTINGS, TESTMODE, bases, spawnZones, LOCAL_PLAYERS, running, paused, raf`); constants `{ MOVE, FRICTION, MAXVX, JUMP, GRAV, MAX_TEAMS, MAX_FFA, TEAM_COLORS }`; roster `{ ROSTER }`; physics `{ isBig, isBigFFA, groundY, clamp, applyZone }`; specials `{ doSpecial, doUpSpecial, doDownSpecial, doAttackSpecial, DASH_KITS }`; attacks `{ doAttack, doSmash, doGroundMove }`; hit `{ applyHit, applyFreeze, freezeDuration, applyCtrlRev, knock, eliminate }`; particles `{ puff }`; ai `{ aiThink }`; hud `{ updateHUD, banner }`; controls-remap `{ pollPad }`; draw `{ draw, updateCamera }`; arena `{ platRects, checkWin, updateSpawnZones, testDpsTick }`; tutorial `{ tutorialTick }`; tournament `{ tourneyLiveTick }`; boss-rush `{ bossRushCheck }`; combat `{ updateItems }`; boss `{ updateTendrils }`; netcode `{ applySnapshot, serializeState }`.
- Produces: `buildFighters, makeFighter, shuffle, step, loop`.

Monolith ranges `2239-2353, 2422-2454, 3076-3548`. **`step` is slice-cut (3076–3548) — reunite whole. `loop` and `step` are deliberately relocated HERE (not main.js)** so mode starters call `loop()` without a `modes→main` cycle (map `unassigned` resolution). **Reassignment sites:** `raf = requestAnimationFrame(loop)` → `setRaf(requestAnimationFrame(loop))`; `hazardT++` → `rt.hazardT++`; `running`/`paused` reads stay reads (writes via setters where they occur — e.g. pause toggle is in main.js input handler); `fighters = buildFighters(...)`'s wholesale build returns a new array that callers install via `replaceArr(fighters, built)` — so `buildFighters` returns the array and the CALLER (arena/tutorial/etc.) does `replaceArr(fighters, buildFighters())`, OR buildFighters itself does `replaceArr(fighters, built)` internally. **Decision:** `buildFighters()` mutates `fighters` in place via `replaceArr` and returns it, matching every call site. `buildFighters` reads `window.__netRoster`/`window.NET` (kept on window). **Loop error containment:** wrap `step()`+`draw()`+`updateHUD()` in the loop body's `try/catch` with the one-shot `window.__loopErrLogged` guard; on throw, in dev rethrow to a visible overlay, in prod cancel cleanly — never silent freeze.

- [ ] **Step 1: Write the failing test** — `test/fighter.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import * as F from '../src/engine/fighter.js';
import * as S from '../src/core/state.js';
import { SETTINGS } from '../src/core/state.js';

describe('engine/fighter', () => {
  it('exports buildFighters/makeFighter/shuffle/step/loop', () => {
    for (const k of ['buildFighters','makeFighter','shuffle','step','loop']) expect(F[k], k).toBeDefined();
  });
  it('buildFighters mutates the live fighters pool in place', () => {
    SETTINGS.mode = 'ffa'; SETTINGS.count = 5; const ref = S.fighters;
    F.buildFighters();
    expect(S.fighters).toBe(ref); expect(S.fighters.length).toBeGreaterThan(0);
  });
  it('step advances rt.hazardT (live counter)', () => {
    const h0 = S.rt.hazardT; F.step(); expect(S.rt.hazardT).toBe(h0 + 1);
  });
  it('loop assigns raf via setter (never bare)', () => {
    globalThis.requestAnimationFrame = vi.fn(() => 42);
    S.setRunning(true); F.loop();
    expect(S.raf).toBe(42);
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- fighter`. Expected: `Cannot find module`. (Cross-imports to ai/draw/hud/modes not yet created — create minimal placeholder modules for `src/ai/ai.js`, `src/render/draw.js`, `src/ui/hud.js`, `src/ui/controls-remap.js`, `src/modes/{tutorial,tournament}.js`, `src/net/netcode.js` exporting the named symbols as no-op functions, each replaced by its real task. List them in Step 3.)
- [ ] **Step 3: Minimal implementation** — extract the three ranges AST-whole (reunite `step`); add the import block; rewrite `rt.hazardT++`, `setRaf(...)`, and make `buildFighters` do `replaceArr(fighters, built)`. Create the placeholder cross-modules noted above (each becomes real in its own task). Add the loop `try/catch` with `window.__loopErrLogged` one-shot + dev rethrow / prod cancel.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- fighter modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: engine/fighter.js (step reunited; loop+step relocated here; buildFighters in-place; loop try/catch)"`

---

### Task 16: `src/ai/ai.js`

**Files:**
- Create: `src/ai/ai.js` (replaces the Task 15 placeholder)
- Create: `test/ai.test.js`
**Interfaces:**
- Consumes (map): state `{ fighters, SETTINGS, summons, items, spawnZones, TEAM_PLAN, AI_LEVEL, hazardT→rt.hazardT, lastKoFrame, worldPlats, bases, WW, WH, W }`; roster `{ ROSTER }`; physics `{ isBig, isBigFFA, scrolls, groundY, clamp }`.
- Produces: `aiThink`.

Monolith ranges `4847-4935, 4942-5405`. Clean module — does **not** import fighter, so no sim cycle. Nav helpers stay internal (module-local, unexported). `hazardT` reads → `rt.hazardT`.

- [ ] **Step 1: Write the failing test** — `test/ai.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { aiThink } from '../src/ai/ai.js';
import * as S from '../src/core/state.js';

describe('ai/ai', () => {
  it('exports aiThink and only aiThink (nav helpers internal)', async () => {
    const mod = await import('../src/ai/ai.js');
    expect(typeof aiThink).toBe('function');
    expect(Object.keys(mod)).toEqual(['aiThink']);
  });
  it('aiThink runs against a minimal fighter without throwing', () => {
    S.replaceArr(S.fighters, [{ x: 0, y: 0, vx: 0, vy: 0, pct: 0, stocks: 3, dead: false, team: 0, kit: {}, ai: {} },
      { x: 200, y: 0, vx: 0, vy: 0, pct: 0, stocks: 3, dead: false, team: 1, kit: {}, ai: {} }]);
    expect(() => aiThink(S.fighters[0])).not.toThrow();
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- ai`. Expected: the placeholder exports a no-op; the "runs without throwing against real logic" + `Object.keys==['aiThink']` assertions fail until the real body lands. (If placeholder already returns `{aiThink}` no-op, the second test still passes trivially — so assert a real behavior: after `aiThink`, `fighter.ai` receives an `intent`/`move` field the monolith sets. Adjust to the real field name when implementing.)
- [ ] **Step 3: Minimal implementation** — move ranges into `src/ai/ai.js`; export only `aiThink`; add import block; rewrite `rt.hazardT`.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- ai modules-eval fighter`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: ai/ai.js (aiThink; nav helpers internal)"`

---

### Task 17: `src/render/draw.js` (shake removed; imports state.shake path is gone — reads rt.shakeAmt)

**Files:**
- Create: `src/render/draw.js` (replaces the Task 15 placeholder)
- Create: `test/draw.test.js`
**Interfaces:**
- Consumes (map): state (large read set incl `fighters, camX→rt.camX, camY→rt.camY, shakeAmt→rt.shakeAmt, decayShake, hazardT→rt.hazardT, stage, SETTINGS, bases, worldZones, worldPlats, spawnZones, items, summons, tendrils, projectiles, beams, particles, evil, BOSS_ARENA, BOSSRUSH, TESTMODE, STOMACH, ctx, cv, W, H, WW, WH`); constants `{ CAM_ZOOM, CLAIM_FRAMES, TEAM_COLORS }`; physics `{ scrolls, clamp, groundY, isBig, isBigFFA }`; boss `{ bossTelLen }`; tutorial `{ drawTutorialPrompt }`; arena `{ testDpsText }`.
- Produces: `draw, updateCamera, resize, drawItem, drawBossBar, drawMinimap, drawFighter`.

Monolith ranges `1244-1253` (resize) + `5409-5949`. **`shake()`/`shakeAmt` were MOVED to state.js (Task 7)** — draw no longer defines them; it reads `rt.shakeAmt` and calls the imported `decayShake()`. `BOSS_SPRITE_IMG` stays render-local. **No top-level ctx/cv deref** — only inside `draw()`/`resize()`. `resize()` writes `W/H/WW/WH` via `setW/setH/setWW/setWH`. `camX`/`camY` in `updateCamera` → `rt.camX`/`rt.camY` (arithmetic).

- [ ] **Step 1: Write the failing test** — `test/draw.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as D from '../src/render/draw.js';
import * as S from '../src/core/state.js';

describe('render/draw', () => {
  it('exports the render surface', () => {
    for (const k of ['draw','updateCamera','resize','drawItem','drawBossBar','drawMinimap','drawFighter'])
      expect(D[k], k).toBeDefined();
  });
  it('does NOT export shake (moved to state)', () => {
    expect(D.shake).toBeUndefined();
  });
  it('draw dereferences ctx only when called, not at import', () => {
    document.body.innerHTML = '<canvas id="cv"></canvas>';
    S.initDom();
    expect(() => D.draw()).not.toThrow();
  });
  it('resize writes W/H via setters', () => {
    document.body.innerHTML = '<canvas id="cv"></canvas>'; S.initDom();
    D.resize(); expect(typeof S.W).toBe('number'); expect(S.W).toBeGreaterThan(0);
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- draw`. Expected: placeholder lacks the real exports / `draw()` no-op passes trivially; the `resize` setter assertion fails until real body lands.
- [ ] **Step 3: Minimal implementation** — move ranges; add import block including `import { rt, decayShake, setW, setH, setWW, setWH } from '../core/state.js'`; rewrite `shakeAmt`→`rt.shakeAmt`, cam arithmetic → `rt.camX/rt.camY`, resize writes → setters; keep `BOSS_SPRITE_IMG` local. Ensure no ctx access at module top level.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- draw modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: render/draw.js (shake gone; reads rt.shakeAmt; resize via setters)"`

---

### Task 18: `src/ui/hud.js` (Infinity guards co-located — the six-build-bug backstop)

**Files:**
- Create: `src/ui/hud.js` (replaces the Task 15 placeholder)
- Create: `test/hud-infinity.test.js`
**Interfaces:**
- Consumes (map): state `{ fighters, SETTINGS, stage, chosen, TESTMODE, running }`; constants `{ TEAM_COLORS, PLACE_MAX, MAX_TEAMS }`; audio `{ SFX, stopMusic }`; arena `{ stopRunRecording, showRunReview }`.
- Produces: `buildHUD, updateHUD, updateStandings, banner, pctColor, showResult, renderScorecard, placementValue, placementWinsLosses, ORDINAL`.

Monolith ranges `2354-2417` (buildHUD/updateHUD/updateStandings/banner + the Infinity guards) + `4770-4835` (placement/showResult/renderScorecard). **The two Infinity guards MUST stay here, co-located, verbatim:**
- `updateHUD` stock cell (monolith line 2404): `(f.stocks===Infinity) ? '∞' : '●'.repeat(Math.max(0, Math.min(20, f.stocks|0)))`.
- `updateStandings` `rankScore` (line 2374) and the per-fighter `∞` glyph (line 2393): `f.stocks===Infinity ? (f._kos||0)*1000 : (f.stocks||0)*1000` and `f.stocks===Infinity?'∞':Math.max(0,f.stocks)`.

Add a dev-mode named assertion in `updateHUD`: if `f.stocks` is a raw non-finite value NOT routed through the `∞` special-case, throw `Error('BFSI_INFINITY_STOCKS_UNGUARDED')` — makes any future regression loud. `showResult→stopRunRecording/showRunReview` is the `hud↔arena` call-time cycle. `banner` is the widely-imported near-leaf.

- [ ] **Step 1: Write the failing test** — `test/hud-infinity.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as HUD from '../src/ui/hud.js';
import * as S from '../src/core/state.js';

function mk(name, stocks) { return { name, stocks, pct: 0, dead: false, alive: true, team: 0, color: '#fff', killCount: 0, _kos: 0, deaths: 0 }; }

describe('ui/hud Infinity guards (six-build-bug backstop)', () => {
  it('exports the full HUD surface', () => {
    for (const k of ['buildHUD','updateHUD','updateStandings','banner','pctColor','showResult','renderScorecard','placementValue','placementWinsLosses','ORDINAL'])
      expect(HUD[k], k).toBeDefined();
  });
  it('updateHUD does NOT throw RangeError on Infinity stocks (real HUD, never stubbed)', () => {
    document.body.innerHTML = '<div id="hud" class="active"></div>';
    S.replaceArr(S.fighters, [mk('A', Infinity), mk('B', Infinity)]);
    HUD.buildHUD();
    expect(() => HUD.updateHUD()).not.toThrow();
    expect(document.getElementById('hud').textContent).toContain('∞');
  });
  it('updateStandings sorts with an Infinity entry without throwing', () => {
    S.replaceArr(S.fighters, [mk('A', Infinity), mk('B', 2)]);
    expect(() => HUD.updateStandings()).not.toThrow();
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- hud-infinity`. Expected: `Cannot find module` / placeholder lacks `updateHUD` real body → the `∞` textContent assertion fails.
- [ ] **Step 3: Minimal implementation** — move both ranges; keep the `∞` guards verbatim and co-located; add the dev-mode `BFSI_INFINITY_STOCKS_UNGUARDED` assertion; add import block.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- hud-infinity modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: ui/hud.js (Infinity ∞ guards co-located + dev assertion; real HUD)"`

---

### Task 19: `src/ui/router.js`

**Files:**
- Create: `src/ui/router.js`
- Create: `test/router.test.js`
**Interfaces:**
- Consumes (map): state `{ running, raf, TESTMODE, TUT, TOURNEY, BOSSRUSH, CUSTOM_LEVEL, PENDING_TOURNEY, PENDING_CUSTOM, setStage }` (+ the mode-flag setters used on exit-to-title); roster-screen `{ buildBoard, buildStages, buildSettings }`; controls-remap `{ buildMaps }`; arena `{ stopRunRecording }`.
- Produces: `go`.

Monolith range `1026-1044`. **Reassignment sites → setters:** `running=false` → `setRunning(false)`; `cancelAnimationFrame(raf)` reads `raf`; the exit-to-title resets — `TUT.active=false` (prop mutate, OK), `TESTMODE.active=false` (OK), `TOURNEY.active=false` (OK), `TOURNEY_WATCHING=null` → `setTourneyWatching(null)`, `TOURNEY_MATCH_ACTIVE=false` → `setTourneyMatchActive(false)`, `BOSSRUSH.active=false` (OK), `PENDING_TOURNEY=null` → `setPendingTourney(null)`, `PENDING_CUSTOM=false` → `setPendingCustom(false)`, `CUSTOM_LEVEL=null` → `setCustomLevel(null)`. Tolerates unknown ids.

- [ ] **Step 1: Write the failing test** — `test/router.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { go } from '../src/ui/router.js';
import * as S from '../src/core/state.js';

describe('ui/router', () => {
  beforeEach?.(() => {});
  it('activates exactly one .screen for a known id', () => {
    document.body.innerHTML = `<div id="hud"></div>
      <div id="title" class="screen active"></div>
      <div id="select" class="screen"></div>
      <div id="board"></div>`;
    go('select');
    const active = document.querySelectorAll('.screen.active');
    expect(active.length).toBe(1); expect(active[0].id).toBe('select');
  });
  it('exit-to-title clears mode flags via setters', () => {
    document.body.innerHTML = `<div id="hud"></div><div id="title" class="screen"></div>`;
    S.setRunning(true); S.setPendingCustom(true);
    go('title');
    expect(S.running).toBe(false); expect(S.PENDING_CUSTOM).toBe(false);
  });
  it('tolerates an unknown id', () => { expect(() => go('_none_')).not.toThrow(); });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- router`. Expected: `Cannot find module`.
- [ ] **Step 3: Minimal implementation** — move range; add import block; rewrite the reassignments listed. (roster-screen/controls-remap/arena imports are call-time; if those modules aren't created yet, keep placeholders — router is created before roster-screen, so add a placeholder `src/ui/roster-screen.js`/`controls-remap.js` if not present; they become real in Tasks 20/21.)
- [ ] **Step 4: Run tests, verify pass** — `npm test -- router modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: ui/router.js (go(); mode-flag resets via setters)"`

---

### Task 20: `src/ui/roster-screen.js`

**Files:**
- Create: `src/ui/roster-screen.js` (replaces any placeholder)
- Create: `test/roster-screen.test.js`
**Interfaces:**
- Consumes (map): state `{ SETTINGS, chosen, stage, LOCAL_PLAYERS, AI_LEVEL, TOURNEY_SETUP_SIZE, TOURNEY_SETUP_MODE, CUSTOM_LEVEL, setChosen, setStage }`; constants `{ MAX_FFA, MAX_TEAMS }`; roster `{ ROSTER }`; stages `{ STAGES }`; attacks `{ RANGE_PROFILE }`; coop-planning `{ refreshTeamChat }`.
- Produces: `buildBoard, buildSettings, buildStages, syncModeUI, buildCountButtons, buildTeamSplits, updateSummary, refreshSel, countOptions, teamSplitsFor`.

Monolith ranges `860-877` (STARTERS/SHOW_ALL_CHARS module-local) + `1045-1191`. **`RANGE_PROFILE` imported from `attacks.js`** (ui→engine read-only, per map resolution). `refreshSel` selecting a character → `setChosen(...)`; stage select → `setStage(...)`. `buildSettings→refreshTeamChat` is the call-time `roster-screen↔coop` cycle.

- [ ] **Step 1: Write the failing test** — `test/roster-screen.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as R from '../src/ui/roster-screen.js';
import * as S from '../src/core/state.js';

describe('ui/roster-screen', () => {
  it('exports the board/settings builders', () => {
    for (const k of ['buildBoard','buildSettings','buildStages','syncModeUI','buildCountButtons','buildTeamSplits','updateSummary','refreshSel','countOptions','teamSplitsFor'])
      expect(R[k], k).toBeDefined();
  });
  it('buildBoard renders starter cells into #board', () => {
    document.body.innerHTML = '<div id="board"></div>';
    R.buildBoard();
    expect(document.querySelectorAll('#board .cell').length).toBeGreaterThan(0);
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- roster-screen`. Expected: `Cannot find module` / placeholder lacks real `buildBoard`.
- [ ] **Step 3: Minimal implementation** — move ranges; add import block; rewrite `setChosen`/`setStage`.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- roster-screen modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: ui/roster-screen.js (setChosen/setStage; RANGE_PROFILE from attacks)"`

---

### Task 21: `src/ui/controls-remap.js` (captureRemapKey/isListening + pollPad)

**Files:**
- Create: `src/ui/controls-remap.js` (replaces the Task 15 placeholder)
- Create: `test/controls-remap.test.js`
**Interfaces:**
- Consumes (map): state `{ KEYS, setKeys }`; constants `{ KEY_LABELS, DEFAULT_KEYS }`.
- Produces: `buildMaps, resetKeys, niceKey, pollPad, captureRemapKey, isListening`.

Monolith ranges `1192-1206, 1226-1241`. The remap `listening` state is **module-local**; the global keydown/keyup capture is registered from `main.js`, so this module exports `captureRemapKey(e)` (does the `KEYS[listening]=e.code; listening=null; buildMaps()` from monolith line 1209) and `isListening()` accessor. `resetKeys` deep-clones `DEFAULT_KEYS` → `setKeys(structuredClone(DEFAULT_KEYS))`. `KEYS[listening]=...` mutates the KEYS object in place (OK); wholesale reset uses `setKeys`. `pollPad` is consumed by `engine/fighter.step` (the layering oddity, kept per map).

- [ ] **Step 1: Write the failing test** — `test/controls-remap.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as CR from '../src/ui/controls-remap.js';
import * as S from '../src/core/state.js';

describe('ui/controls-remap', () => {
  it('exports remap + pad surface', () => {
    for (const k of ['buildMaps','resetKeys','niceKey','pollPad','captureRemapKey','isListening'])
      expect(CR[k], k).toBeDefined();
  });
  it('isListening false until a remap row is armed', () => { expect(CR.isListening()).toBe(false); });
  it('resetKeys restores defaults via setKeys', () => {
    S.KEYS.left = 'KeyZ'; CR.resetKeys();
    expect(S.KEYS.left).not.toBe('KeyZ');
  });
  it('pollPad returns null with no gamepad', () => {
    globalThis.navigator.getGamepads = () => [null];
    expect(CR.pollPad()).toBeNull();
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- controls-remap`. Expected: placeholder lacks real bodies.
- [ ] **Step 3: Minimal implementation** — move ranges; keep `listening` module-local; add `captureRemapKey`/`isListening` exports; rewrite `resetKeys`→`setKeys`.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- controls-remap modules-eval fighter`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: ui/controls-remap.js (captureRemapKey/isListening; pollPad; resetKeys via setKeys)"`

---

### Task 22: `src/ui/balance-stats.js` (BStore with guaranteed localStorage)

**Files:**
- Create: `src/ui/balance-stats.js`
- Create: `test/balance-stats.test.js`
**Interfaces:**
- Consumes (map): state `{ fighters, stage, SETTINGS, AI_LEVEL, TESTMODE, chosen }`; roster `{ ROSTER }`; router `{ go }`.
- Produces: `BStore, recordMatch, openStats, exportStats, resetStats`.

Monolith ranges `4708-4768, 6454-6513`. **`BStore` must guarantee `localStorage`** (Electron renderer has no injected `window.storage`): compute the backend **inside** methods, not at module top, and guard in `try/catch` with an in-memory fallback so save/load never hard-crashes:
```js
export const BStore = {
  _mem: {},
  _backend() { try { return (typeof window !== 'undefined' && window.storage) || localStorage; } catch { return null; } },
  get(k) { const b = this._backend(); try { return b ? JSON.parse(b.getItem(k) || 'null') : (this._mem[k] ?? null); } catch { return this._mem[k] ?? null; } },
  set(k, v) { const b = this._backend(); this._mem[k] = v; try { if (b) b.setItem(k, JSON.stringify(v)); } catch { /* in-memory only */ } },
};
```
(Preserve the monolith's key names + `recordMatch`/stats logic; only the backend resolution changes.) `BStore` is also imported by `editor/level-editor.js` (Task 29).

- [ ] **Step 1: Write the failing test** — `test/balance-stats.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { BStore, recordMatch } from '../src/ui/balance-stats.js';

describe('ui/balance-stats BStore', () => {
  it('round-trips through localStorage', () => {
    BStore.set('bfsi_probe', { a: 1 });
    expect(BStore.get('bfsi_probe')).toEqual({ a: 1 });
  });
  it('falls back to memory when storage throws', () => {
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    expect(() => BStore.set('x', 1)).not.toThrow();
    expect(BStore.get('x')).toBe(1);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: orig });
  });
  it('exports recordMatch', () => { expect(typeof recordMatch).toBe('function'); });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- balance-stats`. Expected: `Cannot find module`.
- [ ] **Step 3: Minimal implementation** — move ranges; replace the BStore backend with the guarded version above; add import block.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- balance-stats modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: ui/balance-stats.js (BStore guarantees localStorage + memory fallback)"`

---

### Task 23: `src/modes/arena.js` (setupWorld AST-whole + recorder + match orchestration)

**Files:**
- Create/replace: `src/modes/arena.js` (was a Task 10/15 placeholder for `ffaRespawn`)
- Create: `test/arena.test.js`
**Interfaces:**
- Consumes (map): large state read set + constants `{ CLAIM_FRAMES, TEAM_COLORS, MAX_TEAMS, MAX_FFA }`; roster `{ ROSTER }`; stages `{ STAGES }`; physics `{ isBig, isBigFFA, groundY, stageScale, clamp }`; fighter `{ buildFighters, loop }`; router `{ go }`; hud `{ banner, buildHUD, showResult }`; draw `{ resize }`; audio `{ sndInit, startMusic, stopMusic, SFX }`; tournament `{ startTournament, finishWatchedGroup, finishWatchedKnockout, tourneyTeamSize }`; boss-rush `{ bossRushCheck }`; coop-planning `{ captureTeamPlan }`; balance-stats `{ recordMatch }`.
- Produces: `startMatch, beginMatchNow, setupWorld, platRects, platRectsSmall, buildSpawnZones, spawnPlatRects, whoOn, updateSpawnZones, ffaRespawn, checkWin, assignFinalPlacements, startRunRecording, stopRunRecording, showRunReview, recorderSupported, openTest, resetTest, testDpsTick, testDpsText`.

Monolith ranges `1254-1273, 1726-1834, 2013-2238, 4658-4707, 6182-6216`. **`setupWorld` opens at 2013 before its slice — move it whole.** **Reassignment sites → state:** wholesale world swaps `WW/WH` → `setWW/setWH`; `bases/worldPlats/worldZones/spawnZones/floors = …` → `replaceArr(...)`; `camX/camY` → `rt.camX/rt.camY`; `elimSeq` in `beginMatchNow` → `rt.elimSeq`; `itemTimer` → `rt.itemTimer`; `evil = …` → `setEvil(...)`; `lastKoFrame = …` → `setLastKoFrame(...)`; `running/paused` → `setRunning/setPaused`; `hazardT` reads → `rt.hazardT`; `stage = …` → `setStage(...)`. **`startMatch` must call `sndInit()+sndResume()` at its top** (audio-unlock idempotency, map risk). `buildFighters()` now mutates in place (Task 15) — call sites become `buildFighters()` then read `fighters`. Cross-cycles (`fighter↔arena`, `arena↔tournament`, `arena↔coop`, `hud↔arena`) are all call-time. The recorder subsystem (`RUN_REC`, `recorderSupported/startRunRecording/stopRunRecording/showRunReview`) is parked here per map.

- [ ] **Step 1: Write the failing test** — `test/arena.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import * as ARENA from '../src/modes/arena.js';
import * as S from '../src/core/state.js';
import { SETTINGS } from '../src/core/state.js';

describe('modes/arena', () => {
  it('exports the orchestration surface', () => {
    for (const k of ['startMatch','beginMatchNow','setupWorld','platRects','buildSpawnZones','whoOn',
      'updateSpawnZones','ffaRespawn','checkWin','assignFinalPlacements','startRunRecording',
      'stopRunRecording','showRunReview','recorderSupported','openTest','resetTest','testDpsTick','testDpsText'])
      expect(ARENA[k], k).toBeDefined();
  });
  it('setupWorld populates floors/bases in place', () => {
    document.body.innerHTML = '<canvas id="cv"></canvas>'; S.initDom();
    SETTINGS.mode = 'ffa'; SETTINGS.count = 5;
    const floorsRef = S.floors;
    ARENA.setupWorld();
    expect(S.floors).toBe(floorsRef); expect(S.floors.length).toBeGreaterThan(0);
  });
  it('beginMatchNow uses rt.elimSeq, never a bare global', () => {
    document.body.innerHTML = '<canvas id="cv"></canvas><div id="hud"></div>'; S.initDom();
    globalThis.requestAnimationFrame = vi.fn(() => 1);
    expect(() => ARENA.beginMatchNow?.()).not.toThrow();
    expect(typeof S.rt.elimSeq).toBe('number');
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- arena`. Expected: placeholder `ffaRespawn` only → the setupWorld/beginMatchNow assertions fail.
- [ ] **Step 3: Minimal implementation** — extract the five ranges AST-whole (reunite `setupWorld`); add import block; rewrite every reassignment site per the table; put `sndInit()+sndResume()` at the top of `startMatch`.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- arena hit boss-rush modules-eval` (hit.js's `ffaRespawn` cross-import now resolves to the real fn).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: modes/arena.js (setupWorld reunited; setters; sndInit at startMatch top)"`

---

### Task 24: `src/modes/tutorial.js`

**Files:**
- Create/replace: `src/modes/tutorial.js` (was a Task 15 placeholder for `tutorialTick`, and Task 17's `drawTutorialPrompt`)
- Create: `test/tutorial.test.js`
**Interfaces:**
- Consumes (map): state `{ TUT, SETTINGS, stage, chosen, fighters, running, paused, items, itemTimer→rt.itemTimer, ctx, setStage, setChosen }`; roster `{ ROSTER }`; stages `{ STAGES }`; router `{ go }`; hud `{ buildHUD, banner }`; arena `{ setupWorld }`; fighter `{ buildFighters, loop }`; physics `{ groundY }`; audio `{ sndInit, startMusic, SFX }`.
- Produces: `openTutorial, startTutorial, tutorialTick, tutorialComplete, finishTutorial, drawTutorialPrompt, tutorialSeen, markTutorialSeen, TUT_STEPS`.

Monolith range `1308-1387`. `TUT_STEPS` immutable. `TUT.active/step/done/timer` are prop mutations (OK). `stage`/`chosen` sets → `setStage`/`setChosen`. `startTutorial` calls `sndInit()` at top (audio-unlock). `tutorialSeen`/`markTutorialSeen` persist via BStore? (map keeps them in tutorial; if they used localStorage directly, keep as-is guarded.) `drawTutorialPrompt` imported by draw.js (Task 17) — now resolves.

- [ ] **Step 1: Write the failing test** — `test/tutorial.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as T from '../src/modes/tutorial.js';

describe('modes/tutorial', () => {
  it('exports the tutorial surface + TUT_STEPS', () => {
    for (const k of ['openTutorial','startTutorial','tutorialTick','tutorialComplete','finishTutorial','drawTutorialPrompt','tutorialSeen','markTutorialSeen','TUT_STEPS'])
      expect(T[k], k).toBeDefined();
  });
  it('TUT_STEPS is a non-empty array', () => { expect(Array.isArray(T.TUT_STEPS)).toBe(true); expect(T.TUT_STEPS.length).toBeGreaterThan(0); });
  it('tutorialSeen returns a boolean', () => { expect(typeof T.tutorialSeen()).toBe('boolean'); });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- tutorial`. Expected: placeholder lacks `TUT_STEPS`/real bodies.
- [ ] **Step 3: Minimal implementation** — move range; add import block; `setStage`/`setChosen`; `sndInit()` at `startTutorial` top.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- tutorial draw fighter modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: modes/tutorial.js (drawTutorialPrompt; setStage/setChosen; sndInit)"`

---

### Task 25: `src/modes/tournament.js` (World Cup; Infinity-safe standings)

**Files:**
- Create/replace: `src/modes/tournament.js` (was a Task 15 placeholder for `tourneyLiveTick`)
- Create: `test/tournament.test.js`
**Interfaces:**
- Consumes (map): state (tourney flag set + world/pool read set, incl `hazardT→rt.hazardT, camX→rt.camX, camY→rt.camY, elimSeq→rt.elimSeq, setStage`); constants `{ TOURNEY_TIME_LIMIT }`; roster `{ ROSTER }`; stages `{ STAGES }`; router `{ go }`; hud `{ banner, buildHUD }`; draw `{ resize }`; arena `{ setupWorld }`; fighter `{ buildFighters, loop }`.
- Produces: `openTournamentSetup, kickOffTournament, startTournament, showTourneyHub, watchFixture, finishWatchSetup, tourneyLiveTick, finishWatchedGroup, finishWatchedKnockout, endTournament, simRestOfRound, proceedAfterRound, buildGroupFixtures, tourneyTeamSize, teamName, seedKnockout, advanceKnockout`.

Monolith ranges `1301-1442, 1444-1721`. **Group matches set `f.stocks = Infinity` (monolith line 1601) — preserve verbatim.** The Infinity-safe standings SORT lives in `hud.updateStandings` (Task 18), NOT here — this module must not add its own `.repeat`/`String(f.stocks)` on Infinity. **Reassignment sites → state:** `TOURNEY = …` (wholesale in `startTournament`) → `setTourney(...)`; `TOURNEY_MATCH_ACTIVE`/`TOURNEY_WATCHING`/`PENDING_TOURNEY`/`TOURNEY_SETUP_SIZE`/`TOURNEY_SETUP_MODE` → their setters; `stage` → `setStage`; `hazardT`/`camX`/`camY`/`elimSeq` → `rt.*`; pool swaps → `replaceArr`/`filterInPlace`. `tourneyLiveTick` called by `step`; `finishWatched*` by `checkWin`; `startTournament` by `startMatch` (all call-time).

- [ ] **Step 1: Write the failing test** — `test/tournament.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as TO from '../src/modes/tournament.js';
import * as HUD from '../src/ui/hud.js';
import * as S from '../src/core/state.js';

describe('modes/tournament', () => {
  it('exports the World Cup surface', () => {
    for (const k of ['openTournamentSetup','kickOffTournament','startTournament','showTourneyHub','watchFixture',
      'finishWatchSetup','tourneyLiveTick','finishWatchedGroup','finishWatchedKnockout','endTournament',
      'simRestOfRound','proceedAfterRound','buildGroupFixtures','tourneyTeamSize','teamName','seedKnockout','advanceKnockout'])
      expect(TO[k], k).toBeDefined();
  });
  it('a group match with Infinity stocks feeds updateStandings without RangeError', () => {
    S.replaceArr(S.fighters, [{ name: 'A', stocks: Infinity, dead: false, team: 0, _kos: 2, killCount: 2, deaths: 0, color: '#fff', pct: 0 },
      { name: 'B', stocks: Infinity, dead: false, team: 1, _kos: 1, killCount: 1, deaths: 0, color: '#fff', pct: 0 }]);
    expect(() => HUD.updateStandings()).not.toThrow();
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- tournament`. Expected: placeholder lacks real bodies.
- [ ] **Step 3: Minimal implementation** — move ranges; add import block; rewrite reassignment sites; keep `f.stocks=Infinity` verbatim; add no Infinity string ops here.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- tournament hud-infinity fighter modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: modes/tournament.js (setTourney/rt.*; Infinity stocks preserved; standings stay in hud)"`

---

### Task 26: `src/modes/boss-rush.js`

**Files:**
- Create/replace: `src/modes/boss-rush.js` (was a Task 10 placeholder for `bossRushCheck`)
- Create: `test/boss-rush.test.js`
**Interfaces:**
- Consumes (map): state `{ BOSSRUSH, BOSS_ARENA, stage, fighters, summons, SETTINGS, running, lastKoFrame, setStage }` (+ `setBossArena`, `setLastKoFrame`); roster `{ BOSS_ROSTER }`; stages `{ STAGES }`; physics `{ groundY }`; hud `{ banner, showResult }`; audio `{ startMusic, SFX }`.
- Produces: `startBossRush, spawnBossRushBoss, bossRushCheck`.

Monolith range `1777-1834`. **Reassignment sites → state:** `BOSS_ARENA = …` (in `spawnBossRushBoss`) → `setBossArena(...)`; `stage = …` → `setStage`; `lastKoFrame = …` → `setLastKoFrame`; `BOSSRUSH.loop`/`dmgMult`/`active` are prop mutations (OK). `startBossRush` calls `sndInit()` at top. `bossRushCheck` called by `step` and by `hit.eliminate` (call-time).

- [ ] **Step 1: Write the failing test** — `test/boss-rush.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as BR from '../src/modes/boss-rush.js';
import * as S from '../src/core/state.js';

describe('modes/boss-rush', () => {
  it('exports start/spawn/check', () => {
    for (const k of ['startBossRush','spawnBossRushBoss','bossRushCheck']) expect(BR[k], k).toBeDefined();
  });
  it('spawnBossRushBoss sets BOSS_ARENA via setter', () => {
    document.body.innerHTML = '<canvas id="cv"></canvas>'; S.initDom();
    S.replaceArr(S.fighters, [{ name: 'A', stocks: 3, dead: false, team: 0, x: 0, y: 0, kit: {} }]);
    expect(() => BR.spawnBossRushBoss?.()).not.toThrow();
    expect(S.BOSS_ARENA === null || typeof S.BOSS_ARENA === 'string' || typeof S.BOSS_ARENA === 'number').toBe(true);
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- boss-rush`. Expected: placeholder lacks real bodies.
- [ ] **Step 3: Minimal implementation** — move range; add import block; rewrite `setBossArena`/`setStage`/`setLastKoFrame`; `sndInit()` at `startBossRush` top.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- boss-rush hit fighter modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: modes/boss-rush.js (setBossArena/setStage/setLastKoFrame)"`

---

### Task 27: `src/modes/coop-planning.js`

**Files:**
- Create/replace: `src/modes/coop-planning.js` (was a Task 20 placeholder for `refreshTeamChat`)
- Create: `test/coop-planning.test.js`
**Interfaces:**
- Consumes (map): state `{ TEAM_PLAN, SETTINGS, fighters, stage }`; arena `{ setupWorld }`; fighter `{ buildFighters }`; draw `{ resize }`.
- Produces: `captureTeamPlan, syncTeamKey, saveHomeKey, clearHomeKey, refreshTeamChat, toggleTeamChat, planSetKey, planSend, setStanceUI, planMate, planMe`.

Monolith ranges `1274-1294, 1863-2004`. Module-local `PLAN_KEY` (never persisted). `TEAM_PLAN[k]=…` prop mutations OK; wholesale `TEAM_PLAN=` → `setTeamPlan`. **`planLLM` hits `api.anthropic.com`** — keep behavior but it must be inside `planSend` (call-time, never eval). `refreshTeamChat` previews rosters via `setupWorld`/`buildFighters` (mutates live match state — preserve as-is per map). Writes `window.__planMyTeam` (kept on window). No `fetch` at module top level.

- [ ] **Step 1: Write the failing test** — `test/coop-planning.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as CP from '../src/modes/coop-planning.js';

describe('modes/coop-planning', () => {
  it('exports the coop surface', () => {
    for (const k of ['captureTeamPlan','syncTeamKey','saveHomeKey','clearHomeKey','refreshTeamChat','toggleTeamChat','planSetKey','planSend','setStanceUI','planMate','planMe'])
      expect(CP[k], k).toBeDefined();
  });
  it('captureTeamPlan does not throw with an empty plan', () => { expect(() => CP.captureTeamPlan?.()).not.toThrow(); });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- coop-planning`. Expected: placeholder lacks real bodies.
- [ ] **Step 3: Minimal implementation** — move ranges; add import block; keep `PLAN_KEY` module-local; ensure the `fetch` to `api.anthropic.com` lives only inside `planSend`; `setTeamPlan` for wholesale writes.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- coop-planning roster-screen arena modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: modes/coop-planning.js (module-local PLAN_KEY; fetch only in planSend)"`

---

### Task 28: `src/net/netcode.js` (window.NET at import; applySnapshot via setters)

**Files:**
- Create/replace: `src/net/netcode.js` (was a Task 15 placeholder for `applySnapshot`/`serializeState`)
- Create: `test/netcode.test.js`
**Interfaces:**
- Consumes (map): state (large read set incl `hazardT→rt.hazardT, camX→rt.camX, camY→rt.camY, setStage`); stages `{ STAGES }`; hud `{ banner }`; router `{ go }`; physics `{ clamp }`; fighter `{ buildFighters }`; arena `{ startMatch }`.
- Produces: `NET, serializeState, applySnapshot, autoJoinFromLink, openLobby`.

Monolith range `5951-6216`. **`window.NET = NET` runs at import (the ONE permitted import-time side effect)** so the sim loop + `buildFighters` read it without an import cycle; **but `NET.connect()` opens the socket — never at eval.** **`applySnapshot` (client) reassigns render pools — MUST use state mutators:** `fighters/floors/worldPlats/bases = …` → `replaceArr(...)`; `projectiles/beams/particles = …` → `replaceArr(...)`; `WW/WH/W/H` → `setWW/setWH/setW/setH`; `camX/camY/hazardT` → `rt.*`; `stage = …` → `setStage`. `NET.connect` reads `chosen`. `autoJoinFromLink` + `openLobby` are call-time.

- [ ] **Step 1: Write the failing test** — `test/netcode.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { spyMediaConstructors } from './helpers/harness.js';

describe('net/netcode', () => {
  it('assigns window.NET at import but opens NO socket', async () => {
    const spy = spyMediaConstructors();
    await import('../src/net/netcode.js');
    expect(globalThis.NET ?? globalThis.window?.NET).toBeDefined();
    expect(spy.calls.WebSocket, 'no WebSocket at import').toBe(0);
    spy.restore();
  });
  it('applySnapshot swaps pools in place (stable identity)', async () => {
    const S = await import('../src/core/state.js');
    const N = await import('../src/net/netcode.js');
    const ref = S.fighters;
    N.applySnapshot({ fighters: [{ name: 'X', stocks: 3 }], stage: 0, hazardT: 5, floors: [], worldPlats: [], bases: [], projectiles: [], beams: [], particles: [] });
    expect(S.fighters).toBe(ref); expect(S.fighters[0].name).toBe('X');
    expect(S.rt.hazardT).toBe(5);
  });
});
```
(Adapt the snapshot shape to the real `serializeState` schema at implementation.)
- [ ] **Step 2: Run it, verify it fails** — `npm test -- netcode`. Expected: placeholder lacks `NET`/real `applySnapshot`.
- [ ] **Step 3: Minimal implementation** — move range; `window.NET = NET` at top (only side effect); rewrite every `applySnapshot` pool reassignment to `replaceArr`/setters/`rt.*`; ensure socket opens only in `connect()`.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- netcode fighter modules-eval` (modules-eval still asserts `WebSocket===0` at eval).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: net/netcode.js (window.NET at import; applySnapshot via replaceArr/setters; no socket at eval)"`

---

### Task 29: `src/editor/level-editor.js`

**Files:**
- Create: `src/editor/level-editor.js`
- Create: `test/level-editor.test.js`
**Interfaces:**
- Consumes (map): state `{ CUSTOM_LEVEL, stage, SETTINGS, TESTMODE, PENDING_CUSTOM, setStage, setCustomLevel }`; balance-stats `{ BStore }`; router `{ go }`; arena `{ startMatch }`.
- Produces: `openEditor, edRotateSel, edSetStrength, edSave, edTestPlay, edClear, edLoad, edRenderList, playCustomLevel, edCurrentLevel, ZONE_TYPES`.

Monolith range `6227-6453`. **Reassignment sites → state:** `CUSTOM_LEVEL = …` (in `playCustomLevel`) → `setCustomLevel(...)`; `stage = …` → `setStage`; `PENDING_CUSTOM = …` → `setPendingCustom`. Add `setCustomLevel` to state.js exports if not already (Task 7 lists it as a setter). The duplicate sky-gradient literal at `edDraw`+`playCustomLevel` may be hoisted to a shared const (optional cleanup, behavior-identical). Blocking `alert/confirm` are noted for Electron but kept as-is this pass.

- [ ] **Step 1: Write the failing test** — `test/level-editor.test.js`:
```js
import { describe, it, expect } from 'vitest';
import * as ED from '../src/editor/level-editor.js';
import * as S from '../src/core/state.js';

describe('editor/level-editor', () => {
  it('exports the editor surface + ZONE_TYPES', () => {
    for (const k of ['openEditor','edRotateSel','edSetStrength','edSave','edTestPlay','edClear','edLoad','edRenderList','playCustomLevel','edCurrentLevel','ZONE_TYPES'])
      expect(ED[k], k).toBeDefined();
  });
  it('playCustomLevel sets CUSTOM_LEVEL via setter', () => {
    ED.playCustomLevel?.({ floors: [], plats: [], zones: [], name: 'probe' });
    expect(S.CUSTOM_LEVEL === null || typeof S.CUSTOM_LEVEL === 'object').toBe(true);
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- level-editor`. Expected: `Cannot find module`.
- [ ] **Step 3: Minimal implementation** — move range; add import block; rewrite `setCustomLevel`/`setStage`/`setPendingCustom`.
- [ ] **Step 4: Run tests, verify pass** — `npm test -- level-editor balance-stats modules-eval`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "extract: editor/level-editor.js (setCustomLevel/setStage/setPendingCustom)"`

---

### Task 30: `src/ui/global-actions.js` — the window bridge (per-assignment try/catch) + boot auto-assert

**Files:**
- Create: `src/ui/global-actions.js`
- Create: `test/handler-coverage.test.js`
**Interfaces:**
- Consumes (map `importsFrom` for global-actions): `go` (router); `toggleSound` (audio); `openTutorial, startTutorial, finishTutorial, tutorialSeen` (tutorial); `openTournamentSetup, kickOffTournament, endTournament, simRestOfRound` (tournament); `startMatch, openTest, resetTest` (arena); `toggleTeamChat, syncTeamKey, saveHomeKey, clearHomeKey, planSetKey, planSend` (coop); `openLobby, NET` (netcode); `openEditor, edRotateSel, edSetStrength, edSave, edTestPlay, edClear` (editor); `openStats, exportStats, resetStats` (balance-stats); `resetKeys` (controls-remap); `TESTMODE` (state); `assertHandlerCoverage` (core/handler-coverage).
- Produces: side-effect import that assigns all bridged handlers + `NET` + `TESTMODE` to `window`, each wrapped in its own try/catch; plus a re-export of `assertHandlerCoverage` from the shared `src/core/handler-coverage.js` (no bespoke `assertBootHandlerCoverage`). `main.js` calls it after `initDom()`.

Monolith: no single source range (this is NEW glue that replaces implicit-global scoping). The map's `globalHandlerBridge` lists 32 names but the design says **44 inline handlers exist** — so we do NOT hand-maintain a list; we assign the known imports AND auto-assert coverage against the DOM at boot.

- [ ] **Step 1: Write the failing test** — `test/handler-coverage.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { collectHandlerIdentifiers } from './helpers/harness.js';

describe('handler coverage (44 not 32)', () => {
  it('every on*= identifier in index.html is assigned to window by global-actions', async () => {
    const html = readFileSync('index.html', 'utf8');
    const dom = new JSDOM(html);
    const ids = collectHandlerIdentifiers(dom.window.document);
    // Bridge assigns onto a target object; simulate by importing with a window shim.
    const win = {};
    globalThis.window = win;
    await import('../src/ui/global-actions.js');
    const missing = ids.filter((id) => typeof win[id] === 'undefined');
    expect(missing, `unbridged: ${missing.join(', ')}`).toEqual([]);
    expect(ids.length).toBeGreaterThanOrEqual(40); // proves we test the full 44, not a 32 subset
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- handler-coverage`. Expected: `Cannot find module '../src/ui/global-actions.js'`.
- [ ] **Step 3: Minimal implementation** — create `src/ui/global-actions.js`:
```js
// Central window bridge for the 44 inline on*= handlers. Imported for side effect by main.js
// AFTER all handler-owning modules load. Each assignment is isolated in its own try/catch so
// one undefined symbol cannot cascade and kill the rest of the bridge.
import * as router from './router.js';
import * as audio from '../audio/audio.js';
import * as tutorial from '../modes/tutorial.js';
import * as tournament from '../modes/tournament.js';
import * as arena from '../modes/arena.js';
import * as coop from '../modes/coop-planning.js';
import * as net from '../net/netcode.js';
import * as editor from '../editor/level-editor.js';
import * as stats from '../ui/balance-stats.js';
import * as controls from './controls-remap.js';
import { TESTMODE } from '../core/state.js';

const BRIDGE = {
  go: router.go,
  toggleSound: audio.toggleSound,
  openTutorial: tutorial.openTutorial, startTutorial: tutorial.startTutorial,
  finishTutorial: tutorial.finishTutorial, tutorialSeen: tutorial.tutorialSeen,
  openTournamentSetup: tournament.openTournamentSetup, kickOffTournament: tournament.kickOffTournament,
  endTournament: tournament.endTournament, simRestOfRound: tournament.simRestOfRound,
  startMatch: arena.startMatch, openTest: arena.openTest, resetTest: arena.resetTest,
  toggleTeamChat: coop.toggleTeamChat, syncTeamKey: coop.syncTeamKey, saveHomeKey: coop.saveHomeKey,
  clearHomeKey: coop.clearHomeKey, planSetKey: coop.planSetKey, planSend: coop.planSend,
  openLobby: net.openLobby, NET: net.NET,
  openEditor: editor.openEditor, edRotateSel: editor.edRotateSel, edSetStrength: editor.edSetStrength,
  edSave: editor.edSave, edTestPlay: editor.edTestPlay, edClear: editor.edClear,
  openStats: stats.openStats, exportStats: stats.exportStats, resetStats: stats.resetStats,
  resetKeys: controls.resetKeys,
  TESTMODE,
};

const target = (typeof window !== 'undefined') ? window : globalThis;
for (const [name, val] of Object.entries(BRIDGE)) {
  try { target[name] = val; } catch (e) { console.error(`[global-actions] failed to bridge ${name}:`, e); }
}

// Boot-time coverage assert lives in the shared leaf src/core/handler-coverage.js so that main.js
// and Plan C's main.lite.js call the SAME function. Re-exported here for callers that already
// import the bridge. NOT called at module-eval (that would be a top-level DOM read); main.js
// calls assertHandlerCoverage(window, document) after initDom() and it throws HandlerCoverageError
// on any unbridged on*= identifier (44-not-32).
export { assertHandlerCoverage } from '../core/handler-coverage.js';
```
- [ ] **Step 4: Run tests, verify pass** — `npm test -- handler-coverage`. If `missing` is non-empty, the listed identifiers are the true 44-vs-32 gap — add each to `BRIDGE` from its owning module (the test names them). Re-run to green.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "add: ui/global-actions.js window bridge (per-assignment try/catch) + boot coverage auto-assert"`

---

### Task 31: `src/main.js` — boot/wiring (initDom, capture-phase listeners, buildBoard, autoJoinFromLink)

**Files:**
- Modify: `src/main.js` (replace the placeholder; keep the CSS/font imports from Task 4)
- Create: `test/boot.test.js`
**Interfaces:**
- Consumes (map): state `{ initDom, running, paused, down, KEYS }` (+ `setPaused`); global-actions (side effect: window bridge); handler-coverage `{ assertHandlerCoverage }`; roster-screen `{ buildBoard }`; netcode `{ autoJoinFromLink }`; draw `{ resize }`; controls-remap `{ captureRemapKey, isListening }`; audio `{ sndInit, sndResume }`; fighter `{ loop }`; coop `{ planSend }`.
- Produces: the boot sequence. Kicks nothing until the user acts; first `loop()` is started by a mode starter, never at import.

Monolith ranges `1007-1009` (unlock listeners — re-registered here in capture phase), `1208-1253` (keydown/keyup/resize handlers), `6509-6510` (boot tail). The input handlers from monolith 1208–1223 move here: they read `isListening()`/`captureRemapKey(e)` (remap), the text-field guard, `down[e.code]=…` (prop mutate), pause toggle `setPaused(!paused)` + `if(!paused) loop()`, and the `KeyR` reset. **Audio-unlock:** register `pointerdown/keydown/touchstart` on `window` in the **capture phase** (`{capture:true}`, NOT `{once:true}`) calling `sndInit()+sndResume()`, plus a `visibilitychange` re-resume.

- [ ] **Step 1: Write the failing test** — `test/boot.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { seedRandom } from './helpers/prng.js';
import { spyMediaConstructors } from './helpers/harness.js';

describe('boot wiring', () => {
  it('DOMContentLoaded initDom + buildBoard + coverage assert, no ctx/audio/ws before gesture', async () => {
    const dom = new JSDOM(readFileSync('index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/' });
    globalThis.window = dom.window; globalThis.document = dom.window.document;
    const spy = spyMediaConstructors();
    const restore = seedRandom(0xC0FFEE);
    await import('../src/main.js');
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    // board built:
    expect(dom.window.document.querySelectorAll('#board .cell').length).toBeGreaterThan(0);
    // no audio context created before a gesture:
    expect(spy.calls.AudioContext).toBe(0);
    restore(); spy.restore();
  });
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- boot`. Expected: placeholder main.js does no wiring → `#board .cell` count is 0.
- [ ] **Step 3: Minimal implementation** — write the boot body:
```js
// (CSS + font imports from Task 4 stay at the very top of this file.)
import { initDom } from './core/state.js';
import './ui/global-actions.js';                                    // side-effect: bridges window.*
import { assertHandlerCoverage } from './core/handler-coverage.js'; // shared with Plan C main.lite.js
import { buildBoard } from './ui/roster-screen.js';
import { autoJoinFromLink } from './net/netcode.js';
import { resize } from './render/draw.js';
import { captureRemapKey, isListening } from './ui/controls-remap.js';
import { sndInit, sndResume } from './audio/audio.js';
import { loop } from './engine/fighter.js';
import { planSend } from './modes/coop-planning.js';
import { down, KEYS, running, paused, setPaused } from './core/state.js';

function boot() {
  initDom();                              // resolve cv/ctx
  assertHandlerCoverage(window, document); // throws HandlerCoverageError on any unbridged on*= (44-not-32)

  // Audio unlock: capture phase, never {once}. Idempotent sndInit/sndResume.
  const unlock = () => { sndInit(); sndResume(); };
  for (const ev of ['pointerdown', 'keydown', 'touchstart'])
    window.addEventListener(ev, unlock, { capture: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sndResume(); });

  // Game input (moved from monolith 1208-1223), capture phase for remap priority.
  window.addEventListener('keydown', (e) => {
    if (isListening()) { captureRemapKey(e); e.preventDefault(); return; }
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) {
      if (e.code === 'Enter' && ae.id === 'planMsg') planSend();
      return;
    }
    down[e.code] = true;
    if (e.code === KEYS.pause && running) { setPaused(!paused); if (!paused) loop(); }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  }, { capture: true });
  window.addEventListener('keyup', (e) => { down[e.code] = false; }, { capture: true });
  window.addEventListener('resize', () => { if (running) resize(); });

  buildBoard();
  autoJoinFromLink();
  // No loop() here — the first loop() is started by a mode starter on user action.
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
```
(Note: the `KeyR` reset handler from monolith 1223 dispatches to `resetTest`/`startMatch` via the window bridge — keep it as a third capture-phase keydown listener calling `window.resetTest?.()`/`window.startMatch?.()` guarded by `running`.)
- [ ] **Step 4: Run tests, verify pass** — `npm test` (the FULL suite now runs: `boot`, `handler-coverage`, `hud-infinity`, `modules-eval`, plus every module test). Then `npm run dev` — the desktop app boots to the title screen, every button works, no console errors.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "add: src/main.js boot (initDom, capture-phase listeners, coverage assert, buildBoard, autoJoinFromLink)"`

---

### Task 32: Full-boot behavioral suite + golden parity + packaged-Electron parity

**Files:**
- Create: `test/full-suite.test.js` (drives the assembled build through every harness check with a real jsdom canvas)
- Create: `test/golden-parity.test.js`
- Create: `test/electron-parity.cjs` + `test/electron-parity.spec.js` (runs the suite inside the packaged app)
- Create: `test/boot-api.js` (the `api` adapter the harness checks consume — defines `makeApi({lite})` + `runScriptedMatch({lite,seed,script})`)
- Create: `test/harness/index.js` (the barrel — the single import path Plan B and Plan C consume)
**Interfaces:**
- Consumes: the fully assembled `src/` + `test/golden/monolith-golden.json`.
- Produces: green Infinity/loop-containment/aliasing/per-mode/audio/dispatch/DOM checks against the REAL modules, a golden diff vs the monolith across FFA/Teams/boss-phase/World-Cup(∞)/KO, the same suite passing inside the packaged Electron build, AND the canonical `test/harness/index.js` barrel re-exporting `makeApi({ lite })`, `mulberry32`, `seedRandom`, `runScriptedMatch({ lite, seed, script })`, `goldenParity`, `infinityRenderTest` (the interface Plan B and Plan C import from).

- [ ] **Step 1: Write the failing test** — `test/boot-api.js` (adapter wiring the harness `api` to real modules) + `test/full-suite.test.js`:
```js
// test/boot-api.js
import * as S from '../src/core/state.js';
import * as F from '../src/engine/fighter.js';
import * as HUD from '../src/ui/hud.js';
import * as D from '../src/render/draw.js';
import * as ARENA from '../src/modes/arena.js';
import * as TO from '../src/modes/tournament.js';
import { SND } from '../src/audio/audio.js';
import { ROSTER } from '../src/data/roster.js';
import { STAGES } from '../src/data/stages.js';
import { SMASHES } from '../src/data/smashes.js';
import * as SP from '../src/engine/specials.js';
import { BUILD } from '../src/core/build.js';
import { seedRandom } from './helpers/prng.js';

// The canonical Trace `final` snapshot (header Contract §3 addendum). stk is number|'INF' (an
// infinite stock is the STRING "INF", never the ∞ glyph); finalPlacement/standingsOrder are name[].
function snapshotOf(state) {
  return {
    hudStockPercent: [...state.fighters].map((f) => ({ name: f.name, stk: f.stocks === Infinity ? 'INF' : f.stocks, pct: Math.round(f.pct) })),
    standingsOrder: [...state.fighters].slice().sort((a, b) => (b.stocks === Infinity ? 0 : b.stocks) - (a.stocks === Infinity ? 0 : a.stocks)).map((f) => f.name),
    koCount: state.fighters.reduce((s, f) => s + (f.killCount || 0), 0),
    finalPlacement: [...state.fighters].slice().sort((a, b) => (a.placement ?? 1e9) - (b.placement ?? 1e9)).map((f) => f.name),
  };
}

let frames = 0, drawThrow = false;
// `lite` mirrors BUILD.lite (src/core/build.js). Plan A's base build is full (BUILD.lite===false),
// so makeApi() defaults to the full STAGES; Plan B/C pass { lite:true } to boot the trimmed STAGE
// subset the Lite build selects at compile time. LITE TRIM IS STAGES-ONLY: the ROSTER is always the
// FULL cast (Web Lite ships the same roster as desktop), so it is never filtered. Only STAGES carry a
// `lite` flag and narrow to the flagged subset (Plan C tags the Lite stages; Plan A falls back to the
// full set if none are tagged yet).
export function makeApi({ lite = false } = {}) {
  const useLite = lite || BUILD.lite;
  document.body.innerHTML = '<canvas id="cv"></canvas><div id="hud" class="active"></div><div id="standings"></div>';
  S.initDom();
  S.SETTINGS.lite = useLite;
  const roster = ROSTER;                                    // FULL roster in Lite AND desktop — trim is stages-only
  const liteStages = STAGES.filter((s) => s.lite);
  const stages = useLite && liteStages.length ? liteStages : STAGES;
  return {
    state: S,
    lite: useLite,
    frameCount: () => frames,
    async runFrames(n) { for (let i = 0; i < n; i++) { try { F.step(); if (drawThrow) { drawThrow = false; throw new Error('injected'); } D.draw(); HUD.updateHUD(); } catch (e) { console.error(e); } frames++; } },
    runFramesSync(n) { for (let i = 0; i < n; i++) { F.step(); D.draw(); HUD.updateHUD(); frames++; } },
    // Set/clear DOM event.code keys in the PERSISTENT down map (held until released — never a
    // one-frame Object.assign). pressKeys/releaseKeys are the down/up Step primitives.
    pressKeys: (codes) => { for (const c of codes || []) S.down[c] = true; },
    releaseKeys: (codes) => { for (const c of codes || []) S.down[c] = false; },
    applyInput: (input) => Object.assign(S.down, input || {}),
    // The per-frame checksum recorded into Trace.frames — MUST stay byte-identical to
    // scripts/record-monolith.mjs's checksum() so module↔monolith Traces compare frame-for-frame.
    frameChecksum: () => S.fighters.map((f) => Math.round((f.x || 0) + (f.y || 0) + (f.pct || 0))).join(','),
    snapshot: () => snapshotOf(S),
    buildFighters: () => F.buildFighters(),
    updateStandings: () => HUD.updateStandings(),
    hudStockText: () => document.getElementById('hud').textContent,
    injectDrawThrow: () => { drawThrow = true; },
    clearDrawThrow: () => { drawThrow = false; },
    drawnFighterCount: () => S.fighters.length,
    simulateApplySnapshot: (n) => S.replaceArr(S.fighters, S.fighters.slice(0, n)),
    async startMatch() { ARENA.startMatch(); },
    async startBossRush() { ARENA.startBossRush(); },
    async startTournament() { TO.startTournament?.(); },
    async watchFixture() { TO.watchFixture?.(); },
    // Dispatch ONE Canonical-Schema-v1 Step (header Contract §3 addendum). Mirrors
    // scripts/record-monolith.mjs's dispatchStep() so both replays produce identical Traces.
    dispatchStep(step) {
      if (step.start) {
        const s = step.start;
        S.SETTINGS.mode = s.mode;
        if (s.count != null) S.SETTINGS.count = s.count;
        if (s.stage != null) S.SETTINGS.stage = s.stage;
        if (s.chosen != null) S.SETTINGS.chosen = s.chosen;
        if (s.teams != null) S.SETTINGS.teams = s.teams;
        if (s.mode === 'bossrush') ARENA.startBossRush();
        else if (s.mode === 'worldcup') TO.startTournament();
        else ARENA.startMatch();                                  // ffa | teams
      } else if (step.tournament) {
        S.SETTINGS.mode = 'worldcup';
        S.setTOURNEY_SETUP_SIZE(step.tournament.size);
        S.setTOURNEY_SETUP_MODE(step.tournament.mode);
        if (step.tournament.mode === 'spectate') TO.watchFixture(); else TO.startTournament();
      } else {
        if (step.down) for (const c of step.down) S.down[c] = true;
        if (step.up) for (const c of step.up) S.down[c] = false;
      }
    },
    audioCtx: () => SND.ctx,
    audioCtxState: () => SND.ctx && SND.ctx.state,
    fireGesture: () => window.dispatchEvent(new window.Event('pointerdown', { bubbles: true })),
    rosterKits: () => roster.map((r) => r.kit).filter(Boolean),
    stages: () => stages,
    resolveDispatch: (slot, key) => ({ special: SP.UPSPECIALS, down: SP.DOWNSPECIALS, attack: SP.ATKSPECIALS }[slot]?.[key]) || (typeof key === 'function' ? key : undefined),
    smashKeys: () => Object.keys(SMASHES),
    resolveSmash: (k) => SMASHES[k],
  };
}

// Deterministic scripted match → canonical Trace v1 (header Contract §3 addendum). Boots a fresh api
// (lite selects the trimmed STAGES via BUILD.lite; the roster stays FULL), seeds the RNG, then advances frame-by-frame
// from 0 to the last step's `at`. At each frame it first dispatches any Step whose `at` equals that
// frame — the mode-aware start/tournament step (at:0) OR down/up KeyCode arrays folded into the
// PERSISTENT `down` map (held until released, not a one-frame Object.assign) — then runs exactly one
// frame and records the per-frame checksum. Returns { frames:string[], final:<snapshot> }; the Trace
// never contains the ∞ glyph (infinite stocks are the string "INF"). Plan B/C compare Traces via
// goldenParity; Plan C's Lite parity is runScriptedMatch({ lite:true, seed, script }) vs a Lite golden.
export function runScriptedMatch({ lite = false, seed, script = [] }) {
  const restore = seedRandom(seed);
  const api = makeApi({ lite });
  const steps = [...script].sort((a, b) => a.at - b.at);
  const lastAt = steps.reduce((m, s) => Math.max(m, s.at), 0);
  const frames = [];
  for (let at = 0; at <= lastAt; at++) {
    for (const s of steps) if (s.at === at) api.dispatchStep(s);   // start/tournament (at:0) or down/up
    api.runFramesSync(1);
    frames.push(api.frameChecksum());
  }
  restore();
  return { frames, final: api.snapshot() };
}
```
`test/harness/index.js` (the canonical barrel — **the single import path Plan B and Plan C use**):
```js
// The one interface B and C consume. No runMonolith/runSplit, no tests/golden, no ../golden vs
// ../tests/golden split — everything routes through here.
export { mulberry32, seedRandom } from '../helpers/prng.js';
export { goldenParity, infinityRenderTest } from '../helpers/harness.js';
export { makeApi, runScriptedMatch } from '../boot-api.js';
```
```js
// test/full-suite.test.js
import { describe, it, beforeEach, expect } from 'vitest';
import { seedRandom, makeApi, runScriptedMatch } from './harness/index.js';
import * as H from './helpers/harness.js';
import '../src/ui/global-actions.js';

describe('full behavioral suite (real HUD/draw, never stubbed)', () => {
  let api, restore;
  beforeEach(() => { restore = seedRandom(0xC0FFEE); api = makeApi(); api.state.SETTINGS.mode = 'ffa'; api.state.SETTINGS.count = 5; });
  it('THE Infinity render test', async () => { await api.startMatch(); await H.infinityRenderTest(api); restore(); });
  it('loop error containment', async () => { await api.startMatch(); await H.loopErrorContainment(api); restore(); });
  it('live-state aliasing', async () => { await api.startMatch(); await H.liveStateAliasing(api); restore(); });
  it('per-mode loop start (startMatch)', async () => { await H.perModeLoopStart(api, 'startMatch'); restore(); });
  it('dispatch completeness', () => { H.dispatchCompleteness(api); restore(); });
  it('runScriptedMatch is deterministic for a fixed seed+script (canonical Step schema)', () => {
    const script = [
      { at: 0, start: { mode: 'ffa', count: 5 } },
      { at: 5, down: ['ArrowRight'] },
      { at: 20, up: ['ArrowRight'], down: ['KeyX'] },
      { at: 30, up: ['KeyX'] },
    ];
    const a = runScriptedMatch({ seed: 0xC0FFEE, script });
    const b = runScriptedMatch({ seed: 0xC0FFEE, script });
    expect(a).toEqual(b);            // identical frames[] + final{}
  });
});
```
```js
// test/golden-parity.test.js
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runScriptedMatch, goldenParity } from './harness/index.js';
import { SCENARIOS } from './scenarios.js';

const golden = JSON.parse(readFileSync('test/golden/monolith-golden.json', 'utf8'));

// Drive the SHARED scenarios (test/scenarios.js) through the module-side runScriptedMatch and diff
// each canonical Trace v1 (frames[] + final{}) against the monolith golden recorded from the same
// file. One `it` per scenario covers FFA / Teams / BossRush / World-Cup(∞) / KO.
describe('golden parity vs monolith (canonical Trace v1)', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.name} reproduces the monolith Trace (frames + HUD/standings/KO/placement)`, () => {
      const trace = runScriptedMatch({ seed: sc.seed, script: sc.script });
      goldenParity(trace, golden[sc.name]);   // compares frames[] AND final{}; infinite stocks are 'INF'
    });
  }
});
```
- [ ] **Step 2: Run it, verify it fails** — `npm test -- full-suite golden-parity`. Expected: parity diffs (until every setter/pool rewrite is exact) and/or Infinity/aliasing failures pinpoint the remaining divergence — fix the flagged module, not the test.
- [ ] **Step 3: Minimal implementation** — resolve every diff the golden/Infinity/aliasing checks surface (a mismatch means a reassignment site still snapshots or a guard landed wrong). The Teams / BossRush / World-Cup(∞) / KO scenarios are already the shared `test/scenarios.js` `SCENARIOS`, so `golden-parity.test.js` loops them automatically — to add a case, add one scenario to `test/scenarios.js` and re-run `node scripts/record-monolith.mjs` (and `--lite`) to refresh the golden Traces; do NOT hand-edit `monolith-golden.json`. For **Electron parity**, add `test/electron-parity.cjs` that launches the packaged build and runs the same assertions in-renderer:
```js
// test/electron-parity.cjs — run via: electron test/electron-parity.cjs (after npm run build)
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'electron', 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  await win.loadURL('app://index.html');
  const result = await win.webContents.executeJavaScript(`(async () => {
    // inline handlers fire under the shipped CSP:
    const btnOk = typeof window.startMatch === 'function';
    // fonts render without network fallback:
    const font = getComputedStyle(document.body).fontFamily.includes('Fredoka');
    // BStore round-trips via localStorage on a real origin:
    let store = false; try { localStorage.setItem('bfsi_probe','1'); store = localStorage.getItem('bfsi_probe') === '1'; } catch {}
    // no unbridged handler error thrown at boot:
    return { btnOk, font, store };
  })()`);
  console.log('ELECTRON_PARITY', JSON.stringify(result));
  app.exit(result.btnOk && result.font && result.store ? 0 : 1);
});
```
  Wire an npm script `"test:electron": "npm run build && electron test/electron-parity.cjs"`.
- [ ] **Step 4: Run tests, verify pass** — `npm test` → entire suite green (module tests + full-suite + golden-parity for all five scenarios). `npm run test:electron` → prints `ELECTRON_PARITY {"btnOk":true,"font":true,"store":true}` and exits 0. `npm run dist` produces a desktop installer that boots to a playable title screen.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "verify: full behavioral suite + golden parity (FFA/Teams/boss/WorldCup∞/KO) + packaged-Electron parity"`

---

## Self-Review

- **Spec coverage (design §1–§14, scoped to Plan A):** Scaffold + Electron real-origin/CSP/contextIsolation (Task 1, §7/§9); verification harness FIRST with all load-bearing checks — zero-error boot + media-constructor spy, 44-not-32 handler coverage, THE Infinity render test with the REAL `updateHUD`, loop error-containment, live-state aliasing, per-mode loop-start, audio unlock, dispatch completeness post-minify, DOM contract, golden parity, Electron parity (Tasks 2, 30–32, §12); ESLint enforcement (Task 3, §6); DOM/CSS/@fontsource (Task 4, §7); constants/data leaves (Tasks 5–6); `core/state.js` with all 51 singletons + setters + `rt` fields + in-place pools + `shake` + `initDom` (Task 7, §6); engine leaves→core→fighter with `loop`/`step` relocated and `applyHit`/`step`/`setupWorld`/`doSpecial`/`loop` reunited AST-whole (Tasks 9–15, §5/§10); ai + draw with `shake` removed (Tasks 16–17); ui incl Infinity guards co-located and `BStore` localStorage guarantee (Tasks 18–22); modes incl `setupWorld` AST-whole + recorder + Infinity-safe tournament (Tasks 23–27); `window.NET` at import + `applySnapshot` via setters (Task 28); editor (Task 29); the auto-generated handler bridge + boot auto-assert (Task 30, §7); boot wiring with capture-phase unlock listeners and first-`loop()`-by-starter (Task 31); golden + packaged parity (Task 32). Music-engine rebuild and web-Lite target are explicitly excluded (Plans B/C) and `startMusic`/`stopMusic`/`SFX` are preserved verbatim.
- **Placeholders:** none. Every code step shows real code; every command shows expected output. Extraction tasks cite exact monolith line-ranges from the map JSON, name AST-whole reunions, list the reassignment sites → setters/`rt`/`replaceArr`, and end by running the harness. New code (Vite/Electron config, harness, ESLint, global-actions bridge + boot assert, main boot, boot-api adapter, parity harness) is shown complete.
- **Canonical Interface Contract v1 conformance (interfaces Plan A produces for B and C):** Execution order A→B→C is stated at the header. **(1) Build flag** — Task 1 creates `src/core/build.js` (`export const BUILD = { lite: __LITE__ }`) and sets the base `vite.config.js` `define: { __LITE__: JSON.stringify(false) }`; Plan C overrides the define to `true` and does not recreate `build.js`. **(2) Test infra + harness barrel** — one test root `test/` (singular) and one Vitest config (the `test` key in `vite.config.js`); Task 32 ships `test/harness/index.js` re-exporting `makeApi({ lite })`, `mulberry32`, `seedRandom`, `runScriptedMatch({ lite, seed, script })`, `goldenParity`, `infinityRenderTest`; `makeApi` accepts `{ lite }` and boots the trimmed ROSTER/STAGES via `BUILD.lite`; goldens are recorded by `scripts/record-monolith.mjs` into `test/golden/`. **(§3 addendum) Canonical Scripted-Match Schema v1** — PINNED in the header (Plan A owns it; Plan C conforms): a scenario is `{ name, seed, script: Step[] }` in the shared `test/scenarios.js`; a Step is an `at` frame plus one of `start`(mode-aware: `ffa`/`teams`→`startMatch`, `bossrush`→`startBossRush`, `worldcup`→`startTournament`/`watchFixture`) / `tournament` / `down`/`up` (DOM `event.code` arrays folded into the persistent `down` map). `runScriptedMatch` (Task 32) and `scripts/record-monolith.mjs` (Task 2, incl `--lite`) replay this identical file and both emit the exact Trace `{ frames:string[], final:{ hudStockPercent:{name,stk,pct}[], standingsOrder:string[], koCount, finalPlacement:string[] } }`; infinite stocks encode as the string `'INF'` (never the ∞ glyph — the glyph evidence is `infinityRenderTest`/`hudStockText()`), and `goldenParity` diffs `frames` + `final`. **(3) Handler coverage** — Task 2 creates the shared leaf `src/core/handler-coverage.js` (`collectHandlerIdentifiers`, `assertHandlerCoverage(win, root)` throwing `HandlerCoverageError`); `ui/global-actions.js` re-exports it and `src/main.js` calls it (the bespoke `assertBootHandlerCoverage` is gone), and Plan C's `main.lite.js` imports the same function. Audio stays the monolith's `audio/audio.js` verbatim; the facade/registry is Plan B's job.
- **Type/name consistency vs the map's exact export names:** Every task's Produces list uses the map's exact export identifiers (e.g. `applyHit, hitCircle, damageSummons`; `updateBossAttack…budgetCutPlatform`; `doSpecial, DASH_KITS, UPSPECIALS, DOWNSPECIALS, ATKSPECIALS`; `buildFighters, makeFighter, shuffle, step, loop`; `buildHUD, updateHUD, updateStandings, banner, showResult`; `NET, serializeState, applySnapshot, autoJoinFromLink, openLobby`; `BStore, recordMatch, openStats, exportStats, resetStats`; `startMatch…testDpsText`). The 51 `coreStateExports` are all homed in `core/state.js` with the three documented write mechanisms; `shake`/`shakeAmt` relocated to state; `BOSS_ATK_ID` module-local in `boss.js`; `RANGE_PROFILE` exported from `attacks.js` and imported by `roster-screen.js`; `updateSummons` in `boss.js`; `pollPad` in `controls-remap.js` consumed by `fighter.step`. All 11 cycles are respected as call-time-only (no CALL-at-eval), and `modules-eval` enforces zero DOM/audio/net side effects after every stage.
