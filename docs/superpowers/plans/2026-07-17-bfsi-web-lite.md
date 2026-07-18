---
# Battle for Smash Island — Web Lite Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **EXECUTION ORDER — A → B → C → D.** This plan (C, web-lite) **depends on Plan A (modularization) and Plan B (music)** and executes strictly **after** both. Plan C ships the **offline** Lite taster; it is **not** the last phase — the online **Rooms** feature (room-code join + a public room browser, reusing `net/netcode.js` over a small always-on relay server) is a separate final phase **Plan D**, which runs **after** C. Full order is **A → B → C → D**. Plan C targets the **post-Plan-B** module layout. Concretely it assumes: (a) Plan A owns `src/core/build.js` (the `BUILD.lite` flag), `src/core/handler-coverage.js` (the boot handler-coverage assertion), the single `test/` harness under `test/harness/` re-exported from `test/harness/index.js`, and the base `vite.config.js` with `define: { __LITE__: JSON.stringify(false) }`; (b) Plan B owns the `src/audio/audio.js` facade + `setMusicDirector()` registry and the `music-director.js`/`stem-player.js`/`manifest.js` engine, with SFX living in `audio/bus.js` + `audio/sfx.js`. Plan C **creates none of those**; it consumes them and adds only the Lite entry/shell/config/tests. Do not start Plan C until Plans A and B are merged.

**Goal:** Ship a second, browser-deployable "Lite" Vite build over the *same* `src/` core as the Electron desktop app — Arena (FFA+Teams vs AI), Tutorial, Boss Rush, and World Cup on the **full roster** with a **trimmed stage taster**, with SFX but no music, and with LAN/editor/co-op/music/test-stats code provably tree-shaken out. (The online **Rooms** feature is out of scope here — it is the next phase, Plan D, which runs after C and adds `net/netcode.js` + a relay server.)

**Architecture:** Lite is defined by *which modules its entry imports*, not by forking gameplay code. Plan A's `BUILD.lite` constant (Vite `define`, owned by Plan A's `src/core/build.js`) drives (1) an in-place `STAGES` filter to the `lite:true` subset at load — the **`ROSTER` stays full** (same cast as desktop) — and (2) a trimmed `index.lite.html` DOM shell. Music is silenced by a *third, structural* mechanism rather than a flag: `src/main.lite.js` **never imports `music-director.js` and never calls `setMusicDirector()`**, so Plan B's `audio/audio.js` facade keeps its `_director` null and every music call no-ops while SFX (`audio/bus.js`/`audio/sfx.js`) still runs. Three modules that kept-code statically imports — `net/netcode.js` (via `engine/fighter.js`) and `modes/coop-planning.js` (via `modes/arena.js` + `ui/roster-screen.js`) — are redirected to no-op **lite stubs** by a per-mode Vite `resolveId` plugin; everything else Lite omits (`editor/level-editor.js`, `audio/music-director.js`/`stem-player.js`/`manifest.js`, the Test/Sandbox and stats-viewer paths) is simply never imported by `src/main.lite.js` + `src/ui/global-actions.lite.js` and Rollup drops it.

**Tech Stack:** Vite (multi-target, mode-switched), Rollup tree-shaking, ES modules, Vitest + jsdom (unit/DOM), Playwright (real-browser boot), Node (bundle-symbol assertions). Depends on **Plan A's** modular `src/` (build flag, handler-coverage module, single `test/` harness) and **Plan B's** audio facade + music-director registry. Executes after both (order A → B → C).

## Global Constraints
- Node ≥ 20.19, Vite ≥ 5, Vitest ≥ 2, Playwright ≥ 1.44. `package.json` has `"type": "module"`.
- **Single source of truth for content:** the trimmed **stage** subset is expressed only as `lite: true` flags on existing `STAGES` entries in `src/data/stages.js`. The **`ROSTER` is FULL in Lite** (same cast as desktop) — it carries **no** `lite` flag and is **never** filtered. No duplicated data tables. The Lite build filters `STAGES` **in place** so every importer keeps seeing the live exported array binding.
- **ESM live-binding / setter rule (from the map):** never reassign an imported binding; reassignable scalars go through `core/state.js` setters, wholesale array swaps through in-place mutators, object singletons are mutated in place. Lite stubs and the content filter must obey this — the filter mutates the live `STAGES` array in place (`arr.length=0; arr.push(...kept)`), never reassigns the export (`ROSTER` is untouched in every build).
- **No top-level DOM/audio/net side effects:** every module (including all new Lite modules and stubs) must have zero DOM/canvas/`AudioContext`/`WebSocket`/network effects at import-time. `netcode.lite.js` must NOT open a socket; `coop-planning.lite.js` must NOT hit `api.anthropic.com`. (Plan A's `build.js` reads only the `__LITE__` define token — a pure leaf Plan C imports but does not create.)
- **Behavior identical to the monolith except the trims:** Lite reproduces monolith behavior for Arena/Tutorial/Boss-Rush/World-Cup on the **full roster** and the **trimmed stage subset**. The intended differences vs desktop are exactly: a trimmed stage subset (full roster), the absence of music (SFX retained), and the absence of the level editor / co-op planning / test mode. (The online Rooms feature arrives later in Plan D.)
- **Copyright boundary (non-negotiable):** Lite ships no music assets at all and embeds no third-party recordings; this is moot for Lite because the entire music engine and `public/assets/music/` payload are excluded.
- **Plan B audio-facade contract (Plan C consumes it):** the post-Plan-B `src/audio/audio.js` exposes music via a `setMusicDirector(d)` registry holding `let _director = null` — it contains **no static `import` of `music-director.js`/`stem-player.js`/`manifest.js`**, and every facade method (`startMusic`/`stopMusic`/`setIntensity`/`tickMusic`) is a no-op while `_director` is null. Full `main.js` (Plan B) registers a director; **`main.lite.js` never imports `music-director.js` and never calls `setMusicDirector`**, so in Lite `_director` stays null forever — music no-ops while SFX (`audio/bus.js`/`audio/sfx.js`) is retained. This static-import-free boundary is what lets the music engine tree-shake out of Lite. Plan C does **not** modify `audio.js`; it only verifies this contract (Task 5) and honors it in `main.lite.js` (Task 8).
- **Per-mode build, not one multi-page build (decision, grounded in the map):** because `engine/fighter.js` statically imports `net/netcode.js` (`applySnapshot`,`serializeState`) and `modes/arena.js` + `ui/roster-screen.js` statically import `modes/coop-planning.js` (`captureTeamPlan`,`refreshTeamChat`), a single Rollup build with both HTML inputs would place those excluded modules in the *shared* chunk graph and leak them into Lite. `vite.config.js` therefore defines **both** page targets (full + lite) in one config and selects one per invocation via `--mode`, applying the lite-only `resolveId` redirect and `define`. This is the only configuration that makes the tree-shake guarantee real.
- **No stubbing of `updateHUD`/`buildHUD`/`draw`/`updateStandings` in any Lite test** (the six-build-bug process rule). The Lite Infinity/parity checks run the REAL HUD and draw.
- **Lite stage subset (fixed by this plan) — the `ROSTER` is FULL in Lite (same cast as desktop); only `STAGES` are trimmed:**
  - `roster.js` — **unchanged**: the full `ROSTER` ships in Lite (no `lite` flag, no filter). `BOSS_ROSTER` and `ASSIST_ROSTER` also ship full (Boss Rush + item assists need them). The Lite/desktop cast is identical.
  - `stages.js` — `lite:true` on 5 stages: **goiky** (flat; tutorial forces it, must stay first), **yoyle** (lowgrav), **pillars** (solid), **incin** (lava), **grandplains** (big/scrolling). Order preserved so `STAGES[0]` stays `goiky`.
- Every test command below is run from the repo root `C:/Users/pkupe/Aardvark/smash-island`.

---

### Task 1: Consume Plan A's `BUILD.lite` flag (Lite `define` override only)

> **Ownership:** `src/core/build.js` is **created by Plan A**, not Plan C. Per the canonical contract, Plan A ships `export const BUILD = { lite: __LITE__ };` and its base `vite.config.js` sets `define: { __LITE__: JSON.stringify(false) }`. Plan C's **only** responsibility for the flag is to **override** that define to `true` in the Lite build mode (wired in Task 9) — Plan C creates **no** `build.js`. Every Plan-C consumer imports it via `import { BUILD } from '../core/build.js'` (adjust relative depth) and never reads a global `__LITE__` directly.

**Files:**
- Consume (owned by Plan A): `src/core/build.js`
- Test: `test/lite/build-flag.test.js`
**Interfaces:**
- Consumes: Plan A's `src/core/build.js` exporting `BUILD = { lite: __LITE__ }`, where `__LITE__` is the Vite `define` token (base `false`, overridden to `true` in Lite mode by Task 9). Under Vitest the base define resolves `__LITE__` to `false`, so `BUILD.lite === false`.
- Produces: nothing new. Plan C's `roster.js`/`stages.js` guards (Task 2) import `BUILD` from `../core/build.js`; the Lite `true` override lives in `vite.config.js` (Task 9).

- [ ] **Step 1: Write the failing test** (fails until Plan A's `build.js` is present in the merged tree — it is a prerequisite)
```js
// test/lite/build-flag.test.js
import { describe, it, expect } from 'vitest';
import { BUILD } from '../../src/core/build.js'; // owned by Plan A

describe('BUILD flag (Plan A, consumed by Lite)', () => {
  it('exposes a boolean lite flag, resolving to false under the test runner', () => {
    expect(typeof BUILD.lite).toBe('boolean');
    expect(BUILD.lite).toBe(false); // base define __LITE__ === false under vitest
  });
});
```

- [ ] **Step 2: Run it, verify it fails (only if run before Plan A is merged)**
```
npx vitest run test/lite/build-flag.test.js
```
Expected while Plan A is unmerged: `FAIL` with `Failed to resolve import "../../src/core/build.js"`. Once Plan A is merged (the A → B → C order this plan requires), the import resolves.

- [ ] **Step 3: No Plan-C implementation** — Plan C creates nothing here. The Lite `__LITE__: JSON.stringify(true)` override is added to `vite.config.js` in Task 9; the base `false` and `build.js` itself belong to Plan A. This step only records the dependency.

- [ ] **Step 4: Run tests, verify pass** (with Plan A merged)
```
npx vitest run test/lite/build-flag.test.js
```
Expected: `PASS test/lite/build-flag.test.js` — 1 passed (`BUILD.lite === false` under the runner).

- [ ] **Step 5: Commit**
```
git add test/lite/build-flag.test.js
git commit -m "test(lite): assert Plan A's BUILD.lite flag resolves false under the runner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Lite stage flags + single-source in-place filter (STAGES only; ROSTER stays full)

> **Content-trim scope (owner decision):** the Lite trim is **STAGES ONLY**. The `ROSTER` is **full** in Lite — same cast as desktop — so this task adds **no** `lite` flag to `roster.js` and **no** roster filter. Only `src/data/stages.js` is flagged and filtered.

**Files:**
- Create: `src/data/lite-content.js`
- Modify: `src/data/stages.js` (add `lite:true` to the 5 subset entries in `STAGES`, monolith `780-835`; append filter guard at module end)
- Test: `test/lite/lite-content.test.js`
**Interfaces:**
- Consumes: `BUILD` from `src/core/build.js` (Task 1).
- Produces: `keepLite(list)` → filtered copy; `applyLiteFilterInPlace(list)` → mutates `list` in place to only `lite:true` entries, returns `list`. `STAGES` is unchanged in the full build and reduced to the subset in the Lite build; `ROSTER` is never filtered in any build. The `STAGES` filter is evaluated **before** `core/state.js` reads it (stages evaluate before state in the import graph).

- [ ] **Step 1: Write the failing test**
```js
// test/lite/lite-content.test.js
import { describe, it, expect } from 'vitest';
import { keepLite, applyLiteFilterInPlace } from '../../src/data/lite-content.js';
import { ROSTER } from '../../src/data/roster.js';
import { STAGES } from '../../src/data/stages.js';

describe('lite content filter', () => {
  it('keepLite returns only lite:true entries without mutating input', () => {
    const src = [{ n: 'a', lite: true }, { n: 'b' }, { n: 'c', lite: true }];
    expect(keepLite(src).map(x => x.n)).toEqual(['a', 'c']);
    expect(src).toHaveLength(3); // input untouched
  });

  it('applyLiteFilterInPlace keeps the same array reference (live binding safe)', () => {
    const arr = [{ lite: true }, {}, { lite: true }];
    const ref = arr;
    applyLiteFilterInPlace(arr);
    expect(arr).toBe(ref);      // same reference — importers keep seeing it
    expect(arr).toHaveLength(2);
  });

  it('STAGES carries exactly the 5 lite-flagged subset; ROSTER is full (no lite flags)', () => {
    const liteStages = STAGES.filter(s => s.lite === true).map(s => s.id);
    expect(liteStages).toEqual(['goiky', 'yoyle', 'pillars', 'incin', 'grandplains']);
    // ROSTER is FULL in Lite — the trim is STAGES only, so no fighter carries a
    // lite flag and the roster is never filtered.
    expect(ROSTER.some(r => r.lite === true)).toBe(false);
    // full build must NOT be filtered when BUILD.lite is false (vitest default)
    expect(STAGES.length).toBeGreaterThan(5);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**
```
npx vitest run test/lite/lite-content.test.js
```
Expected: `FAIL` — `Failed to resolve import "../../src/data/lite-content.js"`.

- [ ] **Step 3: Minimal implementation**

Create the pure helper (leaf, no imports):
```js
// src/data/lite-content.js
// Single-source Lite content trimming. Pure helpers so they are unit-testable
// without the build flag; the guarded call sites live in roster.js / stages.js.
export function keepLite(list) {
  return list.filter(x => x && x.lite === true);
}
export function applyLiteFilterInPlace(list) {
  const kept = keepLite(list);
  list.length = 0;            // in-place: preserve the live exported array binding
  for (const item of kept) list.push(item);
  return list;
}
```

`src/data/roster.js` is **NOT modified**: the trim is STAGES-only, so the roster carries no `lite` flag and no filter guard — the full cast (plus `BOSS_ROSTER`/`ASSIST_ROSTER`) ships in Lite exactly as on desktop.

In `src/data/stages.js`, add `lite:true` to `goiky`, `yoyle`, `pillars`, `incin`, `grandplains` (edit existing literals; do not reorder), then append the guard at the **end** of the module (after the `STAGES` declaration), importing the flag and helper:
```js
import { BUILD } from '../core/build.js';
import { applyLiteFilterInPlace } from './lite-content.js';
// Lite trims STAGES in place to the taster subset. ROSTER is NOT trimmed — the
// full cast ships in Lite (same as desktop).
if (BUILD.lite) applyLiteFilterInPlace(STAGES);
```
> Note: this adds a `build.js`/`lite-content.js` import to one previously-leaf data module (`stages.js` only). Both new modules are pure zero-side-effect leaves, so no import-time-effect or cycle risk is introduced. The guard runs during `stages.js` evaluation, i.e. **before** `core/state.js` evaluates `stage=STAGES[0]`, so the Lite default stage is a lite entry and `STAGES[0]` stays `goiky`. `chosen=ROSTER.find(r=>r.play)` is unaffected because `ROSTER` is never filtered.

- [ ] **Step 4: Run tests, verify pass**
```
npx vitest run test/lite/lite-content.test.js
```
Expected: `PASS` — 3 passed. (Full `STAGES` untouched because `BUILD.lite` is false under vitest; `ROSTER` is never filtered in any build.)

This task edits a shared Plan-A file (`stages.js`), so it **also gates on the full Plan A harness** (canonical contract §2):
```
npm test
```
Expected: `PASS` — Plan A's entire suite (including its full-split golden parity) stays green with the appended guard, proving the in-place `STAGES` filter is inert when `BUILD.lite` is false.

- [ ] **Step 5: Commit**
```
git add src/data/lite-content.js src/data/stages.js test/lite/lite-content.test.js
git commit -m "feat(lite): lite:true STAGES flags + single-source in-place filter (roster stays full)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Lite stub — `net/netcode.lite.js`

**Files:**
- Create: `src/net/netcode.lite.js`
- Test: `test/lite/netcode-lite.test.js`
**Interfaces:**
- Consumes: nothing (pure leaf).
- Produces: the exact export surface of `src/net/netcode.js` that kept code imports, as inert no-ops — `NET`, `serializeState`, `applySnapshot`, `autoJoinFromLink`, `openLobby`. `engine/fighter.js` statically imports `applySnapshot`,`serializeState`; the Vite `resolveId` plugin (Task 7) redirects `netcode.js` → this file in the Lite build. Must set no `window.NET` socket and must not construct a `WebSocket`.

- [ ] **Step 1: Write the failing test**
```js
// test/lite/netcode-lite.test.js
import { describe, it, expect, vi } from 'vitest';
import * as netLite from '../../src/net/netcode.lite.js';

describe('netcode.lite stub', () => {
  it('exports the netcode surface fighter.js relies on, as no-ops', () => {
    expect(typeof netLite.applySnapshot).toBe('function');
    expect(typeof netLite.serializeState).toBe('function');
    expect(typeof netLite.autoJoinFromLink).toBe('function');
    expect(typeof netLite.openLobby).toBe('function');
    expect(netLite.NET).toBeDefined();
    // Callable without effect; serializeState yields null (no snapshot in Lite).
    expect(() => netLite.applySnapshot({})).not.toThrow();
    expect(netLite.serializeState()).toBeNull();
    expect(() => netLite.autoJoinFromLink()).not.toThrow();
  });

  it('never constructs a WebSocket and leaves window.NET falsy', () => {
    const spy = vi.spyOn(globalThis, 'WebSocket', 'get');
    // importing already happened; assert the module body did not touch window.NET
    expect(globalThis.window?.NET ?? null).toBeNull();
    spy.mockRestore?.();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**
```
npx vitest run test/lite/netcode-lite.test.js
```
Expected: `FAIL` — `Failed to resolve import "../../src/net/netcode.lite.js"`.

- [ ] **Step 3: Minimal implementation**
```js
// src/net/netcode.lite.js
// Lite stub for src/net/netcode.js. The Lite build has no LAN play, but
// engine/fighter.js statically imports applySnapshot/serializeState, so those
// names must resolve to inert no-ops. ZERO import-time side effects: no socket,
// no window.NET assignment (kept code reads `window.NET` as falsy → "solo" role).
export const NET = null;
export function serializeState() { return null; }
export function applySnapshot(_snapshot) { /* no-op: Lite is always solo */ }
export function autoJoinFromLink() { /* no-op: no room links in Lite */ }
export function openLobby() { /* no-op: no LAN lobby screen in Lite */ }
```

- [ ] **Step 4: Run tests, verify pass**
```
npx vitest run test/lite/netcode-lite.test.js
```
Expected: `PASS` — 2 passed.

- [ ] **Step 5: Commit**
```
git add src/net/netcode.lite.js test/lite/netcode-lite.test.js
git commit -m "feat(lite): inert netcode.lite stub for the LAN-free web build

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Lite stub — `modes/coop-planning.lite.js`

**Files:**
- Create: `src/modes/coop-planning.lite.js`
- Test: `test/lite/coop-lite.test.js`
**Interfaces:**
- Consumes: nothing (pure leaf).
- Produces: no-op versions of the co-op exports that kept modules statically import — `captureTeamPlan` (called by `modes/arena.js` `startMatch`) and `refreshTeamChat` (called by `ui/roster-screen.js` `buildSettings`/`syncModeUI`). Also exports the rest of the co-op surface (`toggleTeamChat`,`syncTeamKey`,`saveHomeKey`,`clearHomeKey`,`planSetKey`,`planSend`,`setStanceUI`,`planMate`,`planMe`) as no-ops for safety. Must not touch `api.anthropic.com`, `innerHTML`, or the (absent) `#teamChatBody` DOM. The Vite `resolveId` plugin (Task 7) redirects `coop-planning.js` → this file in the Lite build.

- [ ] **Step 1: Write the failing test**
```js
// test/lite/coop-lite.test.js
import { describe, it, expect } from 'vitest';
import * as coop from '../../src/modes/coop-planning.lite.js';

describe('coop-planning.lite stub', () => {
  it('provides the co-op surface kept modules import, all inert', () => {
    for (const name of [
      'captureTeamPlan', 'refreshTeamChat', 'toggleTeamChat', 'syncTeamKey',
      'saveHomeKey', 'clearHomeKey', 'planSetKey', 'planSend',
      'setStanceUI', 'planMate', 'planMe',
    ]) {
      expect(typeof coop[name], name).toBe('function');
    }
  });

  it('captureTeamPlan / refreshTeamChat are safe to call with no co-op DOM present', () => {
    expect(() => coop.captureTeamPlan()).not.toThrow();
    expect(() => coop.refreshTeamChat()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**
```
npx vitest run test/lite/coop-lite.test.js
```
Expected: `FAIL` — `Failed to resolve import "../../src/modes/coop-planning.lite.js"`.

- [ ] **Step 3: Minimal implementation**
```js
// src/modes/coop-planning.lite.js
// Lite stub for src/modes/coop-planning.js. The Lite build keeps Teams mode
// (FFA/Teams vs AI) but drops the LLM team-chat panel. modes/arena.js and
// ui/roster-screen.js statically import captureTeamPlan / refreshTeamChat, so
// those must resolve to no-ops. ZERO side effects: no network, no innerHTML,
// no #teamChatBody access.
export function captureTeamPlan() { /* no-op: no co-op plan in Lite */ }
export function refreshTeamChat() { /* no-op: no team-chat panel in Lite */ }
export function toggleTeamChat() {}
export function syncTeamKey() {}
export function saveHomeKey() {}
export function clearHomeKey() {}
export function planSetKey() {}
export function planSend() {}
export function setStanceUI() {}
export function planMate() {}
export function planMe() {}
```

- [ ] **Step 4: Run tests, verify pass**
```
npx vitest run test/lite/coop-lite.test.js
```
Expected: `PASS` — 2 passed.

- [ ] **Step 5: Commit**
```
git add src/modes/coop-planning.lite.js test/lite/coop-lite.test.js
git commit -m "feat(lite): inert coop-planning.lite stub (keeps Teams, drops LLM chat)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Verify the post-Plan-B audio facade no-ops music in Lite (SFX retained)

> **Ownership:** the `src/audio/audio.js` facade and its `setMusicDirector()` registry are a **Plan B** deliverable (Plan A leaves the monolith's original `audio.js` untouched). Plan C does **not** modify `audio.js` and does **not** re-invent a registry — the registry already exists post-B. Plan C's whole "no music" behavior comes from `main.lite.js` **never importing `music-director.js` and never calling `setMusicDirector`** (Task 8), so `_director` stays null and every facade music method no-ops while SFX (`audio/bus.js`/`audio/sfx.js`) keeps working. This task is a **verification/guard test** that pins the cross-plan contract Plan C relies on; it changes no product code.

**Files:**
- Consume (owned by Plan B): `src/audio/audio.js` (facade + `setMusicDirector`), `src/audio/bus.js` + `src/audio/sfx.js` (SFX)
- Test: `test/lite/audio-facade-lite.test.js`
**Interfaces:**
- Consumes: Plan B's post-B `src/audio/audio.js` exposing `setMusicDirector(d)` (holding `let _director = null`), and `startMusic(context)`/`stopMusic()`/`setIntensity(v)`/`tickMusic()` that no-op when `_director` is null. SFX comes from `audio/bus.js`/`audio/sfx.js` (via the facade's `SFX`), retained in both builds.
- Produces: nothing new. Asserts (a) the facade exposes `setMusicDirector` and the four music methods; (b) with no director registered, all four no-op (the Lite state); (c) `audio.js` contains **no static `import` of `music-director.js`/`stem-player.js`/`manifest.js`**; (d) SFX is still reachable through the facade. This is exactly the boundary that lets the music engine tree-shake out of Lite (verified end-to-end in Task 10).

- [ ] **Step 1: Write the guard test** (passes once Plan B is merged — the A → B → C order this plan requires)
```js
// test/lite/audio-facade-lite.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as audio from '../../src/audio/audio.js'; // post-Plan-B facade

describe('post-Plan-B audio facade — Lite music-no-op contract', () => {
  it('exposes the registry + music method surface Lite depends on', () => {
    expect(typeof audio.setMusicDirector).toBe('function');
    for (const name of ['startMusic', 'stopMusic', 'setIntensity', 'tickMusic']) {
      expect(typeof audio[name], name).toBe('function');
    }
  });

  it('all music methods no-op when no director is registered (the Lite state)', () => {
    audio.setMusicDirector(null); // Lite never registers one → _director stays null
    expect(() => audio.startMusic('battle')).not.toThrow();
    expect(() => audio.setIntensity(0.7)).not.toThrow();
    expect(() => audio.tickMusic()).not.toThrow();
    expect(() => audio.stopMusic()).not.toThrow();
  });

  it('SFX is still reachable through the facade (SFX retained in Lite)', () => {
    expect(audio.SFX).toBeDefined();
    expect(typeof audio.SFX.ko).toBe('function'); // SFX from bus.js/sfx.js
  });

  it('audio.js statically imports no music-engine module (tree-shake boundary)', () => {
    const src = readFileSync(new URL('../../src/audio/audio.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/import[^\n]*music-director/);
    expect(src).not.toMatch(/import[^\n]*stem-player/);
    expect(src).not.toMatch(/import[^\n]*\bmanifest\b/);
  });
});
```

- [ ] **Step 2: Run it, verify state**
```
npx vitest run test/lite/audio-facade-lite.test.js
```
Expected before Plan B is merged: `FAIL` (`setMusicDirector`/`tickMusic` undefined). After Plan B is merged: this asserts Plan B honored the contract Plan C needs.

- [ ] **Step 3: No Plan-C implementation** — Plan C writes no `audio.js` code. If any assertion fails **after** Plan B is merged, that is a Plan B contract violation (facade statically importing the director, or a music method that throws when `_director` is null) — fix it in Plan B, not here. Do NOT add a `BUILD.lite` short-circuit to the facade: the contract is that music no-ops purely because `_director` is null, which is exactly how Lite (no registration) and full-before-boot (not yet registered) both stay silent.

- [ ] **Step 4: Run tests, verify pass** (with Plan B merged)
```
npx vitest run test/lite/audio-facade-lite.test.js
```
Expected: `PASS` — 4 passed.

- [ ] **Step 5: Commit**
```
git add test/lite/audio-facade-lite.test.js
git commit -m "test(lite): pin post-Plan-B audio facade music-no-op contract (SFX retained)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `index.lite.html` — trimmed DOM shell

**Files:**
- Create: `index.lite.html`
- Test: `test/lite/lite-shell-contract.test.js`
**Interfaces:**
- Consumes: `styles/tokens.css` + `styles/app.css` (Plan A) and `/src/main.lite.js` (Task 8) as the module entry.
- Produces: a DOM shell containing only the Lite screens — `title`, `select`, `controls`, `hud`, `tutorial`, `tourneySetup`, `tourneyHub`, `result` — with every included id/class preserved **verbatim** from `index.html`, the dropped screens (`editor`, `test`, `stats`, `lobby`) and their `on*=` handlers removed, the co-op `#teamChatPanel` content replaced by a hidden placeholder that preserves the id, and the title trimmed to Lite-reachable buttons only.

- [ ] **Step 1: Write the failing test**
```js
// test/lite/lite-shell-contract.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../../index.lite.html', import.meta.url), 'utf8');
const doc = new JSDOM(html).window.document;

describe('index.lite.html shell contract', () => {
  it('keeps exactly the Lite screens and drops the excluded ones', () => {
    const ids = [...doc.querySelectorAll('.screen')].map(s => s.id).sort();
    expect(ids).toEqual(
      ['controls', 'result', 'select', 'title', 'tourneyHub', 'tourneySetup', 'tutorial'].sort()
    );
    for (const gone of ['editor', 'test', 'stats', 'lobby']) {
      expect(doc.getElementById(gone), gone).toBeNull();
    }
  });

  it('preserves the canvas + hud contract and the #teamChatPanel placeholder', () => {
    expect(doc.getElementById('cv')).not.toBeNull();
    expect(doc.getElementById('hud')).not.toBeNull();
    const panel = doc.getElementById('teamChatPanel'); // roster-screen syncModeUI reads .style
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('style') || '').toMatch(/display:\s*none/);
  });

  it('references no handler for a dropped module', () => {
    const attrs = ['onclick', 'onchange', 'oninput'];
    const idents = new Set();
    for (const el of doc.querySelectorAll('*')) {
      for (const a of attrs) {
        const v = el.getAttribute(a);
        if (v) for (const m of v.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) idents.add(m[1]);
      }
    }
    for (const banned of [
      'openLobby', 'openTest', 'resetTest', 'openEditor', 'edSave', 'edTestPlay',
      'edClear', 'edRotateSel', 'edSetStrength', 'openStats', 'exportStats',
      'resetStats', 'toggleTeamChat', 'syncTeamKey', 'saveHomeKey', 'clearHomeKey',
      'planSetKey', 'planSend',
    ]) {
      expect([...idents], banned).not.toContain(banned);
    }
    // and the loads it DOES need are present:
    for (const need of ['go', 'startMatch', 'startTutorial', 'kickOffTournament', 'toggleSound']) {
      expect([...idents], need).toContain(need);
    }
  });

  it('loads the Lite entry module', () => {
    const scripts = [...doc.querySelectorAll('script[type="module"]')].map(s => s.getAttribute('src'));
    expect(scripts).toContain('/src/main.lite.js');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**
```
npx vitest run test/lite/lite-shell-contract.test.js
```
Expected: `FAIL` — cannot read `index.lite.html` (ENOENT).

- [ ] **Step 3: Minimal implementation** — create `index.lite.html`. Copy `index.html` and apply exactly these deletions/edits, preserving every retained id/class verbatim:
  1. `<head>`: keep the same `styles/tokens.css` then `styles/app.css` link order (tokens first). Change the module script at the bottom from `/src/main.js` to `/src/main.lite.js`.
  2. **Title screen** (`#title`): keep the heading/contestants. In the button `.row`, KEEP: `Take the Plunge` (`onclick="tutorialSeen() ? go('select') : openTutorial()"`), `World Cup Tournament` (`openTournamentSetup()`), `Controls` (`go('controls')`), `How to Play` (`openTutorial()`), `Sound` (`#soundToggle` `toggleSound()`). REMOVE the buttons: `🌐 Play with Friends` (`openLobby`), `🎯 Test Mode` (`openTest`), `🛠 Level Creator` (`openEditor`), `📊 Balance Stats` (`openStats`). REMOVE the entire `.apikeybox` block (co-op API key; `saveHomeKey`/`clearHomeKey`).
  3. **Delete whole blocks**: `#editor` (`<!-- LEVEL EDITOR -->`), `#test` (`<!-- TEST MODE CONFIG -->`), `#stats` (`<!-- BALANCE STATS -->`), `#lobby` (`<!-- LAN LOBBY -->`).
  4. **Select screen** (`#select`): keep the board, stagepick, and the full `#settings` block including `#segMode` (FFA / Teams / Boss Rush all retained). Replace the entire `#teamChatPanel` sub-tree (the co-op chat) with a single hidden placeholder that preserves the id `ui/roster-screen.js` reads:
```html
<!-- Co-op team-chat is desktop-only; Lite keeps a hidden placeholder so
     roster-screen.js syncModeUI can still read #teamChatPanel.style safely. -->
<div id="teamChatPanel" class="teamchat" style="display:none"></div>
```
  5. Keep `#controls`, `#hud`, `#tutorial`, `#tourneySetup`, `#tourneyHub`, `#result` **verbatim** (their handlers — `resetKeys`, `startTutorial`, `finishTutorial`, `kickOffTournament`, `endTournament`, `simRestOfRound`, `startMatch`, `go` — are all Lite-provided).
  6. Update the visible foot/blurb copy if desired (cosmetic only; not asserted).

- [ ] **Step 4: Run tests, verify pass**
```
npx vitest run test/lite/lite-shell-contract.test.js
```
Expected: `PASS` — 4 passed.

- [ ] **Step 5: Commit**
```
git add index.lite.html test/lite/lite-shell-contract.test.js
git commit -m "feat(lite): trimmed index.lite.html shell (drops editor/test/stats/lobby/co-op)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Per-build handler-coverage for the Lite shell (using Plan A's shared module)

> **Ownership:** `src/core/handler-coverage.js` is **created by Plan A**. Per the canonical contract it exports `collectHandlerIdentifiers(root)`, `assertHandlerCoverage(win, root)` (throws `HandlerCoverageError`), and `class HandlerCoverageError`. Plan C **creates no handler-coverage module**; both Plan A's `main.js` and Plan C's `main.lite.js` import the **same** `assertHandlerCoverage`. Note the argument order the contract fixes: **`assertHandlerCoverage(win, root)`** (win first, root second). This task adds only a Plan-C-owned *per-build* test proving the Lite shell's inline handlers are exactly covered by the 12-symbol Lite bridge — it drives Plan A's shared function.

**Files:**
- Consume (owned by Plan A): `src/core/handler-coverage.js`
- Test: `test/lite/handler-coverage.test.js`
**Interfaces:**
- Consumes: Plan A's `src/core/handler-coverage.js` — `collectHandlerIdentifiers(root)`, `assertHandlerCoverage(win, root)`, `HandlerCoverageError`; plus `index.lite.html` (Task 6) and the 12-symbol Lite bridge set (Task 8).
- Produces: a per-build assertion that (a) Plan A's `assertHandlerCoverage(win, root)` throws a named `HandlerCoverageError` for a missing identifier, and (b) every inline-handler identifier in `index.lite.html` is present once the 12 Lite bridge symbols are on `window` — and that no dropped-module handler (e.g. `openEditor`, `openLobby`) survives in the Lite shell.

- [ ] **Step 1: Write the failing test** (resolves once Plan A's module + Task 6/8 exist)
```js
// test/lite/handler-coverage.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  assertHandlerCoverage, collectHandlerIdentifiers, HandlerCoverageError,
} from '../../src/core/handler-coverage.js'; // owned by Plan A

// The 12 handler symbols the Lite bridge (global-actions.lite.js, Task 8) installs.
const LITE_BRIDGE = [
  'go', 'toggleSound', 'openTutorial', 'startTutorial', 'finishTutorial', 'tutorialSeen',
  'openTournamentSetup', 'kickOffTournament', 'endTournament', 'simRestOfRound',
  'startMatch', 'resetKeys',
];

describe('Lite shell handler coverage (Plan A module, argument order win, root)', () => {
  it('throws a named HandlerCoverageError for a missing identifier', () => {
    const dom = new JSDOM('<!doctype html><body><button onclick="openEditor()">x</button></body>');
    // Contract argument order: assertHandlerCoverage(win, root)
    expect(() => assertHandlerCoverage(dom.window, dom.window.document)).toThrow(HandlerCoverageError);
    expect(() => assertHandlerCoverage(dom.window, dom.window.document)).toThrow(/openEditor/);
  });

  it('index.lite.html is fully covered by exactly the 12 Lite bridge symbols', () => {
    const html = readFileSync(new URL('../../index.lite.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html);
    const { window: win, window: { document: root } } = dom;
    // Every referenced handler identifier is within the Lite bridge set (no orphans).
    for (const id of collectHandlerIdentifiers(root)) {
      expect(LITE_BRIDGE, `unexpected handler ${id} in Lite shell`).toContain(id);
    }
    // Install the bridge, then coverage must pass with (win, root) order.
    for (const name of LITE_BRIDGE) win[name] = () => {};
    expect(() => assertHandlerCoverage(win, root)).not.toThrow();
    // Dropped-module handlers must be absent from the shell entirely.
    for (const gone of ['openEditor', 'openLobby', 'openTest', 'openStats', 'planSend']) {
      expect(collectHandlerIdentifiers(root), gone).not.toContain(gone);
    }
  });
});
```

- [ ] **Step 2: Run it, verify state**
```
npx vitest run test/lite/handler-coverage.test.js
```
Expected before Plan A is merged: `FAIL` — `Failed to resolve import "../../src/core/handler-coverage.js"`. Before Task 6 exists: `FAIL` reading `index.lite.html`. Both resolve as the A → B → C order and this plan's own Task 6 land.

- [ ] **Step 3: No Plan-C implementation** — Plan C creates no handler-coverage module. If Plan A's `assertHandlerCoverage` uses a different argument order than `(win, root)`, that is a Plan A contract violation to fix in Plan A. `main.lite.js` (Task 8) calls the same shared function.

- [ ] **Step 4: Run tests, verify pass** (with Plan A merged and Task 6 done)
```
npx vitest run test/lite/handler-coverage.test.js
```
Expected: `PASS` — 2 passed.

- [ ] **Step 5: Commit**
```
git add test/lite/handler-coverage.test.js
git commit -m "test(lite): per-build handler coverage of index.lite.html via Plan A's shared module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: `src/main.lite.js` + `src/ui/global-actions.lite.js` — Lite entry & bridge

**Files:**
- Create: `src/ui/global-actions.lite.js`
- Create: `src/main.lite.js`
- Test: `test/lite/global-actions-lite.test.js`, `test/lite/main-lite-boot.test.js`
**Interfaces:**
- Consumes: `go` (`ui/router.js`), `toggleSound` (`audio/audio.js`), `openTutorial`/`startTutorial`/`finishTutorial`/`tutorialSeen` (`modes/tutorial.js`), `openTournamentSetup`/`kickOffTournament`/`endTournament`/`simRestOfRound` (`modes/tournament.js`), `startMatch` (`modes/arena.js`), `resetKeys` (`ui/controls-remap.js`); `initDom`/`down`/`KEYS` (`core/state.js`), `buildBoard` (`ui/roster-screen.js`), `resize` (`render/draw.js`), `captureRemapKey`/`isListening` (`ui/controls-remap.js`), `sndInit`/`sndResume` (`audio/audio.js`), `assertHandlerCoverage` (`core/handler-coverage.js`).
- Produces: `global-actions.lite.js` assigns exactly the 12 Lite handler symbols to `window`, each in its own try/catch. `main.lite.js` is the Lite module entry: on `DOMContentLoaded` it runs `initDom()`, imports the Lite bridge, registers the same runtime listeners as the full boot **minus** LAN auto-join and co-op, calls `assertHandlerCoverage(window, document)` (Plan A's shared module, `(win, root)` order), then `buildBoard()`. It statically imports **no** `netcode.js` (full), `level-editor.js`, `coop-planning.js`, `music-director.js`/`stem-player.js`/`manifest.js`, `balance-stats` viewer, or `test` paths, and **never calls `setMusicDirector`** — so `_director` stays null (no music) and Rollup drops all excluded modules from `dist-lite`.

- [ ] **Step 1: Write the failing tests**
```js
// test/lite/global-actions-lite.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/ui/global-actions.lite.js', import.meta.url), 'utf8');

describe('global-actions.lite', () => {
  it('imports no excluded module', () => {
    for (const bad of ['netcode.js', 'level-editor', 'coop-planning.js', 'music-director', 'stem-player']) {
      expect(src, bad).not.toMatch(new RegExp(`from\\s+['"][^'"]*${bad.replace('.', '\\.')}`));
    }
  });
  it('assigns exactly the 12 Lite handler symbols to window', () => {
    const assigned = [...src.matchAll(/window\.(\w+)\s*=/g)].map(m => m[1]).sort();
    expect(assigned).toEqual([
      'endTournament', 'finishTutorial', 'go', 'kickOffTournament', 'openTournamentSetup',
      'openTutorial', 'resetKeys', 'simRestOfRound', 'startMatch', 'startTutorial',
      'toggleSound', 'tutorialSeen',
    ].sort());
  });
  it('wraps each assignment in try/catch', () => {
    expect((src.match(/try\s*{/g) || []).length).toBeGreaterThanOrEqual(12);
  });
});
```
```js
// test/lite/main-lite-boot.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/main.lite.js', import.meta.url), 'utf8');

describe('main.lite entry', () => {
  it('imports the Lite bridge, not the full global-actions', () => {
    expect(src).toMatch(/global-actions\.lite\.js/);
    expect(src).not.toMatch(/from\s+['"][^'"]*\/global-actions\.js/);
  });
  it('does not call autoJoinFromLink or import excluded modules', () => {
    expect(src).not.toMatch(/autoJoinFromLink/);
    for (const bad of ['netcode.js', 'level-editor', 'coop-planning.js', 'music-director', 'stem-player', 'manifest']) {
      expect(src, bad).not.toMatch(new RegExp(`from\\s+['"][^'"]*${bad.replace('.', '\\.')}`));
    }
  });
  it('never registers a music director (the Lite no-music contract)', () => {
    expect(src).not.toMatch(/setMusicDirector/);
  });
  it('asserts handler coverage at boot with (win, root) argument order', () => {
    expect(src).toMatch(/assertHandlerCoverage\s*\(\s*window\s*,\s*document\s*\)/);
  });
});
```

- [ ] **Step 2: Run them, verify they fail**
```
npx vitest run test/lite/global-actions-lite.test.js test/lite/main-lite-boot.test.js
```
Expected: both `FAIL` — modules not found.

- [ ] **Step 3: Minimal implementation**
```js
// src/ui/global-actions.lite.js
// Lite inline-handler bridge. Assigns ONLY the handlers index.lite.html can
// reference. Imports no excluded module, so LAN/editor/co-op never enter the
// Lite graph. Each assignment is isolated in try/catch so one bad symbol can't
// cascade and kill the rest (design §7).
import { go } from './router.js';
import { toggleSound } from '../audio/audio.js';
import { openTutorial, startTutorial, finishTutorial, tutorialSeen } from '../modes/tutorial.js';
import { openTournamentSetup, kickOffTournament, endTournament, simRestOfRound } from '../modes/tournament.js';
import { startMatch } from '../modes/arena.js';
import { resetKeys } from './controls-remap.js';

const bridge = {
  go, toggleSound,
  openTutorial, startTutorial, finishTutorial, tutorialSeen,
  openTournamentSetup, kickOffTournament, endTournament, simRestOfRound,
  startMatch, resetKeys,
};
for (const [name, fn] of Object.entries(bridge)) {
  try { window[name] = fn; }
  catch (e) { console.error('global-actions.lite: failed to bridge', name, e); }
}
```
```js
// src/main.lite.js
// LITE boot/wiring. Mirrors Plan A's main.js boot MINUS: LAN auto-join, co-op
// planSend, the music-director registration, and the editor/test/stats bridges.
// CRITICAL music contract: this file must NEVER `import ... music-director.js`
// and NEVER call setMusicDirector() — that is the ONLY reason Lite has no music.
// Because _director in Plan B's audio.js facade stays null, every music call
// no-ops (SFX via bus.js/sfx.js still runs) and Rollup tree-shakes the whole
// music engine (music-director/stem-player/manifest) out of dist-lite.
// Imports only the Lite module set; Rollup drops everything unreachable from here.
import { initDom, down, KEYS } from './core/state.js';
import { buildBoard } from './ui/roster-screen.js';
import { resize } from './render/draw.js';
import { captureRemapKey, isListening } from './ui/controls-remap.js';
import { sndInit, sndResume } from './audio/audio.js'; // SFX unlock only; NO setMusicDirector
import { assertHandlerCoverage } from './core/handler-coverage.js'; // Plan A's shared module
import './ui/global-actions.lite.js'; // side effect: window bridge (after handler owners load)

function boot() {
  initDom(); // resolve cv/ctx now that the DOM exists

  // Audio unlock: idempotent, capture-phase, on window — wins the race vs startMusic.
  const unlock = () => { try { sndInit(); sndResume(); } catch (e) {} };
  for (const evt of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(evt, unlock, { capture: true });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { try { sndResume(); } catch (e) {} } });

  // Input + remap capture (same contract as full boot).
  window.addEventListener('keydown', (e) => {
    if (isListening()) { captureRemapKey(e); return; }
    down[e.code] = true;
  }, { capture: true });
  window.addEventListener('keyup', (e) => { down[e.code] = false; });
  window.addEventListener('resize', () => { try { resize(); } catch (e) {} });

  // Fail loudly and per-build if the Lite shell references an unbridged handler.
  // Contract argument order is (win, root) — Plan A's shared handler-coverage.js.
  assertHandlerCoverage(window, document);

  buildBoard(); // NO autoJoinFromLink() — Lite has no room links.
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
```
> `KEYS` is imported to match the full boot's input contract even if only referenced by the shared listeners; keep the import if Plan A's `main.js` uses it in the keydown path, otherwise drop it to satisfy `no-unused-vars`. Verify against Plan A's `main.js` listener body and mirror it exactly (behavior-identical requirement).

- [ ] **Step 4: Run tests, verify pass**
```
npx vitest run test/lite/global-actions-lite.test.js test/lite/main-lite-boot.test.js
```
Expected: both `PASS` — 3 + 4 assertions green.

- [ ] **Step 5: Commit**
```
git add src/ui/global-actions.lite.js src/main.lite.js test/lite/global-actions-lite.test.js test/lite/main-lite-boot.test.js
git commit -m "feat(lite): main.lite entry + lite handler bridge (excluded modules unimported)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: `vite.config.js` mode-switched targets + npm scripts

**Files:**
- Modify: `vite.config.js` (add lite mode: input, `resolveId` redirect plugin, `define`, `outDir`)
- Modify: `package.json` (`dev:lite`, `build:lite`, extend `build` to both targets)
- Test: `test/lite/vite-config.test.js`
**Interfaces:**
- Consumes: `mode` from Vite CLI (`--mode lite`); the stub files from Tasks 3–4; `index.lite.html` (Task 6); `src/main.lite.js` (Task 8).
- Produces: `vite build --mode lite` → `dist-lite/` built from `index.lite.html`, with `__LITE__` defined `true`, and `net/netcode.js`→`netcode.lite.js` + `modes/coop-planning.js`→`coop-planning.lite.js` redirected. Full (`vite build`) unchanged → `dist/`. Scripts: `dev:lite`, `build:lite`, and `build` runs both.

- [ ] **Step 1: Write the failing test**
```js
// test/lite/vite-config.test.js
import { describe, it, expect } from 'vitest';

describe('vite.config lite mode', () => {
  it('lite mode wires define/outDir/input and the exclude plugin', async () => {
    const mod = await import('../../vite.config.js');
    const factory = mod.default;
    const cfg = typeof factory === 'function' ? factory({ mode: 'lite', command: 'build' }) : factory;
    expect(cfg.define.__LITE__).toBe('true');
    expect(cfg.build.outDir).toBe('dist-lite');
    expect(JSON.stringify(cfg.build.rollupOptions.input)).toMatch(/index\.lite\.html/);
    expect(cfg.plugins.flat().some(p => p && p.name === 'bfsi-lite-exclude')).toBe(true);
  });

  it('full mode leaves define false, outDir dist, no redirect', async () => {
    const mod = await import('../../vite.config.js');
    const factory = mod.default;
    const cfg = typeof factory === 'function' ? factory({ mode: 'production', command: 'build' }) : factory;
    expect(cfg.define.__LITE__).toBe('false');
    expect(cfg.build.outDir).toBe('dist');
    expect(JSON.stringify(cfg.build.rollupOptions.input)).toMatch(/index\.html/);
  });

  it('the exclude plugin redirects only in lite and only the two stubbed basenames', async () => {
    const mod = await import('../../vite.config.js');
    const cfg = mod.default({ mode: 'lite', command: 'build' });
    const plugin = cfg.plugins.flat().find(p => p && p.name === 'bfsi-lite-exclude');
    const netId = plugin.resolveId('../net/netcode.js');
    const coopId = plugin.resolveId('./coop-planning.js');
    expect(netId).toMatch(/netcode\.lite\.js$/);
    expect(coopId).toMatch(/coop-planning\.lite\.js$/);
    expect(plugin.resolveId('../engine/fighter.js')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**
```
npx vitest run test/lite/vite-config.test.js
```
Expected: `FAIL` — current `vite.config.js` is not mode-switched / has no `bfsi-lite-exclude` plugin / `__LITE__` undefined.

- [ ] **Step 3: Minimal implementation** — `vite.config.js`:
```js
// vite.config.js — defines BOTH page targets (full + lite) in one config,
// selected per invocation by --mode. A single multi-page build cannot exclude
// netcode/coop from Lite because engine/fighter.js and modes/arena.js import them
// statically (they would land in the shared chunk graph); hence per-mode config
// with a lite-only resolveId redirect. See design §4a.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

// Redirect the two excluded-but-statically-imported modules to inert Lite stubs.
function liteExcludePlugin(isLite) {
  const STUBS = {
    'netcode.js': r('./src/net/netcode.lite.js'),
    'coop-planning.js': r('./src/modes/coop-planning.lite.js'),
  };
  return {
    name: 'bfsi-lite-exclude',
    enforce: 'pre',
    resolveId(source) {
      if (!isLite || typeof source !== 'string') return null;
      const base = source.replace(/\\/g, '/').split('/').pop();
      return STUBS[base] || null;
    },
  };
}

export default defineConfig(({ mode }) => {
  const isLite = mode === 'lite';
  return {
    // Plan A's base config owns `define: { __LITE__: JSON.stringify(false) }`.
    // Plan C's ONLY build-flag responsibility is to OVERRIDE it to true in lite
    // mode — it creates no build.js (Plan A owns src/core/build.js).
    define: { __LITE__: JSON.stringify(isLite) },
    plugins: [liteExcludePlugin(isLite)],
    build: {
      outDir: isLite ? 'dist-lite' : 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: isLite ? r('./index.lite.html') : r('./index.html'),
      },
    },
    server: { port: isLite ? 5174 : 5173 },
    preview: { port: isLite ? 4174 : 4173 },
  };
});
```
> **Plan A owns this file.** Plan A's `vite.config.js` already exports a `defineConfig(({ mode }) => …)` function with the base `define: { __LITE__: JSON.stringify(false) }`, the single Vitest `test` block (`environment: 'jsdom'`, `include: ['test/**/*.test.js']`), and the Electron `base`/plugins for the full target. **MERGE** Plan C's additions into it — the lite-mode `define` override to `true`, the `bfsi-lite-exclude` plugin, and the lite `outDir`/`input`/ports — rather than overwriting. Plan C adds **no** second `vitest.config.js` and uses the single `test/` root. Preserve tokens-before-app CSS import order.

`package.json` scripts (merge into `"scripts"`):
```json
{
  "scripts": {
    "dev:lite": "vite --mode lite",
    "build:lite": "vite build --mode lite",
    "build": "vite build && vite build --mode lite"
  }
}
```

- [ ] **Step 4: Run tests, verify pass**
```
npx vitest run test/lite/vite-config.test.js
```
Expected: `PASS` — 3 passed. Then smoke the real build:
```
npm run build:lite
```
Expected: Vite prints `dist-lite/index.lite.html` and hashed JS/CSS assets, exit 0.

This task edits shared Plan-A files (`vite.config.js`, `package.json`), so it **also gates on the full Plan A harness** (canonical contract §2), confirming the merged config leaves the full target and Plan A's single Vitest `test` block (`include: ['test/**/*.test.js']`) intact:
```
npm test
```
Expected: `PASS` — Plan A's entire suite still green; the full (`dist/`) target is unchanged.

- [ ] **Step 5: Commit**
```
git add vite.config.js package.json test/lite/vite-config.test.js
git commit -m "build(lite): mode-switched vite config (dist-lite, define, exclude plugin) + scripts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Tree-shake verification — no LAN/editor/co-op/music symbols in `dist-lite`

> **Plan D note (netcode stays excluded in Plan C):** Plan C ships the Lite build **without** `net/netcode.js` — the offline taster has no online play, so this test asserts real-netcode markers (`new WebSocket`, `broadcastState`, `sendInput`) are **absent** from `dist-lite`, alongside editor / co-op-planning / music-director / stem-player / manifest. **Plan D** (the online Rooms phase, after C) will later **add** `net/netcode.js` + the relay server + the rooms UI to the Lite build and **amend this test** so netcode is allowed in Lite from Plan D onward (editor / co-op-planning / music-director / stem-player / manifest stay excluded). Do not relax the netcode assertion in Plan C.

**Files:**
- Create: `test/lite/tree-shake.test.js`
**Interfaces:**
- Consumes: a built `dist-lite/` (the test builds it if missing).
- Produces: an assertion that the Lite bundle contains none of the marker strings unique to excluded features (LAN/netcode, editor, co-op, music, stats), and that it DOES contain kept markers (Arena/Tutorial/BossRush/WorldCup + SFX), proving exclusion is real and the build isn't empty.

- [ ] **Step 1: Write the failing test**
```js
// test/lite/tree-shake.test.js
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const distDir = fileURLToPath(new URL('../../dist-lite/assets', import.meta.url));

function bundleText() {
  const files = readdirSync(distDir).filter(f => f.endsWith('.js'));
  return files.map(f => readFileSync(`${distDir}/${f}`, 'utf8')).join('\n');
}

describe('Lite bundle tree-shaking', () => {
  let js;
  beforeAll(() => {
    if (!existsSync(distDir)) {
      execSync('npm run build:lite', { cwd: fileURLToPath(new URL('../../', import.meta.url)), stdio: 'inherit' });
    }
    js = bundleText();
  }, 180_000);

  it('contains NO LAN/netcode code', () => {
    expect(js).not.toMatch(/new WebSocket/);
    expect(js).not.toMatch(/broadcastState/);
    expect(js).not.toMatch(/sendInput/);
  });
  it('contains NO level-editor code', () => {
    expect(js).not.toMatch(/playCustomLevel/);
    expect(js).not.toMatch(/edRenderList/);
  });
  it('contains NO co-op LLM code', () => {
    expect(js).not.toMatch(/api\.anthropic\.com/);
    expect(js).not.toMatch(/planLLM/);
  });
  it('contains NO music-engine code (music-director / stem-player / manifest)', () => {
    // Stem-player WebAudio decode path:
    expect(js).not.toMatch(/decodeAudioData/);
    expect(js).not.toMatch(/AudioBufferSourceNode/);
    // music-director singleton method names (unique to the excluded module):
    expect(js).not.toMatch(/sampleMatchIntensity/);
    expect(js).not.toMatch(/koStinger/);
    // manifest.js music-asset payload references:
    expect(js).not.toMatch(/assets\/music/);
  });
  it('contains NO stats-viewer code', () => {
    expect(js).not.toMatch(/exportStats/);
  });
  it('DOES contain the kept modes + SFX (sanity — not an empty bundle)', () => {
    expect(js).toMatch(/startMatch|beginMatchNow/);
    expect(js).toMatch(/startBossRush/);
    expect(js).toMatch(/startTournament/);
    expect(js).toMatch(/startTutorial/);
  });
});
```

- [ ] **Step 2: Run it, verify it fails (or guides a real fix)**
```
npx vitest run test/lite/tree-shake.test.js
```
Expected initially: if any excluded marker leaks, `FAIL` naming it (e.g. `expected bundle not to match /api\.anthropic\.com/`). This is the check that catches a missed alias or a stray import — fix the leak (usually an unexpected static import of an excluded module by a kept module) rather than the test.

- [ ] **Step 3: Minimal implementation** — no product code if Tasks 3–9 are correct. If a marker leaks, trace the offending static import (e.g. a kept module importing `level-editor.js`) and route it through an alias/stub or move the symbol, then rebuild. Document any additional stub here.

- [ ] **Step 4: Run tests, verify pass**
```
npm run build:lite && npx vitest run test/lite/tree-shake.test.js
```
Expected: `PASS` — 6 passed.

- [ ] **Step 5: Commit**
```
git add test/lite/tree-shake.test.js
git commit -m "test(lite): assert dist-lite excludes LAN/editor/co-op/music/stats symbols

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Lite golden-parity subset check (ffa / teams / bossrush / worldcup-inf / ko)

> **Harness ownership (canonical contract §3):** the golden/parity harness AND the scenarios file are **Plan A's**. The harness lives under `test/harness/` (imported from the **single path `test/harness/index.js`**); the scenarios live in the **single shared `test/scenarios.js`**, from which Plan A derives `LITE_SCENARIOS` (the Lite-subset name filter, now covering **ffa, teams, bossrush, worldcup-inf, ko**). Plan C uses ONLY this surface — `makeApi({ lite })`, `mulberry32(seed)`, `seedRandom(seed)`, `runScriptedMatch({ lite, seed, script })` (returns a `Trace`), `goldenParity(actualTrace, goldenTrace)` (asserts structural equality, throws on mismatch), and `infinityRenderTest(api)`. There is **no** `runMonolith`/`runSplit`, **no separate `test/lite/scenarios.js`**, no `tests/golden`, and no `../golden` vs `../tests/golden` split. Goldens are recorded by Plan A's `scripts/record-monolith.mjs` into `test/golden/*.json`; the **Lite** golden is `test/golden/monolith-golden.lite.json`, that same recorder run over `LITE_SCENARIOS`. When `makeApi`/`runScriptedMatch` are called with `lite:true`, the harness automatically yields the **full `ROSTER` + the trimmed `STAGES`** via `BUILD.lite` — no manual content patch is needed.

**Files:**
- **Delete:** `test/lite/scenarios.js` — the separate Lite scenarios file is removed. Plan C imports `LITE_SCENARIOS` from the shared `test/scenarios.js` (Plan A owns it): `import { LITE_SCENARIOS as SCENARIOS } from "../scenarios.js"`. One scenarios file, one recorder, one subset filter.
- Read (recorded artifact, committed; produced by `scripts/record-monolith.mjs --lite`): `test/golden/monolith-golden.lite.json`
- Create: `test/lite/golden-parity.test.js`
**Interfaces:**
- Consumes: **Plan A's** harness via the single path `test/harness/index.js` — `runScriptedMatch({ lite, seed, script })` → the canonical `Trace` (schema v1) EXACTLY `{ frames: string[], final: { hudStockPercent: { name:string, stk:number|'INF', pct:number }[], standingsOrder: string[], koCount: number, finalPlacement: string[] } }` (infinite stocks encode as `stk:'INF'`, never the ∞ glyph — the Trace itself never contains the glyph), `goldenParity(actual, golden)` — all from that one import path — plus `LITE_SCENARIOS` from the shared `test/scenarios.js`. Plan A's `scripts/record-monolith.mjs --lite` records `test/golden/monolith-golden.lite.json` from `artifacts/V1/index.html` with the `lite:true` subset selected (full roster + trimmed stages), replaying `LITE_SCENARIOS`.
- Produces: a recorded-input, fixed-seed parity comparison of the Lite split build (`runScriptedMatch({ lite:true, … })`) vs the Lite golden recorded from the monolith on the same content (full roster + trimmed stages), across the five Lite modes (**ffa, teams, bossrush, worldcup-inf, ko**), asserting identical `final.hudStockPercent` (name/stk/pct), `final.standingsOrder`, `final.koCount`, and `final.finalPlacement`, plus identical per-frame `frames` checksums — with the World-Cup infinite-stock evidence taken from the encoded `stk:'INF'` entry in `final.hudStockPercent` (schema v1: the Trace never contains the ∞ glyph).

- [ ] **Step 1: Write the failing test**
```js
// test/lite/golden-parity.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// Single harness surface — from the one path test/harness/index.js (Plan A).
import { runScriptedMatch, goldenParity } from '../harness/index.js';
// Single shared scenarios file — Plan A owns it; LITE_SCENARIOS is the Lite subset
// (ffa, teams, bossrush, worldcup-inf, ko). There is NO test/lite/scenarios.js.
import { LITE_SCENARIOS as SCENARIOS } from '../scenarios.js';

const golden = JSON.parse(
  readFileSync(new URL('../golden/monolith-golden.lite.json', import.meta.url), 'utf8'),
);

describe('Lite golden parity vs monolith (full roster + trimmed stages)', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.name}: Lite split build matches the monolith on lite content`, async () => {
      // Trace shape (canonical v1): { frames, final:{ hudStockPercent, standingsOrder, koCount, finalPlacement } }.
      const trace = await runScriptedMatch({ lite: true, seed: sc.seed, script: sc.script });
      // goldenParity throws (structural mismatch) → the test fails with a diff.
      goldenParity(trace, golden[sc.name]);
      // World-Cup infinite-stock evidence: the encoded INF stock in the Trace
      // (schema v1: the Trace never contains the ∞ glyph). No standalone
      // infinityRenderTest on an unbooted api — the Trace assertion is sufficient.
      if (sc.name === 'worldcup-inf') {
        expect(trace.final.hudStockPercent.some(e => e.stk === 'INF')).toBe(true);
      }
    });
  }
});
```
The scenarios come from the shared `test/scenarios.js` (Plan A owns it); Plan C creates no scenarios file. `LITE_SCENARIOS` is Plan A's name-filtered subset covering **ffa, teams, bossrush, worldcup-inf, ko** — each entry is the canonical `{ name, seed, script }` (schema v1). No content patch here: `runScriptedMatch({ lite:true })` yields the **full roster + trimmed stages** automatically via `BUILD.lite`, and the harness pins `Math.random` via its own `mulberry32`/`seedRandom` from `seed`, so draws/spawns are identical between the monolith recording and the Lite split.

- [ ] **Step 2: Run it, verify it fails**
```
npx vitest run test/lite/golden-parity.test.js
```
Expected: `FAIL` — `Cannot find module '../golden/monolith-golden.lite.json'` (Lite golden not recorded yet).

- [ ] **Step 3: Record the Lite golden from the monolith on the trimmed content** — use Plan A's recorder with the Lite subset (Plan C creates NO separate recorder; the harness/recorder/scenarios are Plan A's). `scripts/record-monolith.mjs --lite` drives `artifacts/V1/index.html` with the `lite:true` subset selected (full roster + trimmed stages), replaying `LITE_SCENARIOS` from the shared `test/scenarios.js`, and writes `test/golden/monolith-golden.lite.json`:
```
node scripts/record-monolith.mjs --lite
```
Expected: prints one `captured <scenario>:` line per scenario (`ffa`, `teams`, `bossrush`, `worldcup-inf`, `ko`) and `wrote test/golden/monolith-golden.lite.json`, exit 0. For `worldcup-inf` the recorder exercises the monolith's own Infinity guard (its `hudStockText()` DOM contains the ∞ glyph, proving the reference is the guard and not a crash), but the recorded Trace encodes the infinite-stock entry as `final.hudStockPercent[i].stk === 'INF'` — the Trace never contains the ∞ glyph (schema v1).
> If Plan A's `scripts/record-monolith.mjs` does not yet accept `--lite` (subset selection + `LITE_SCENARIOS`), that flag is a small extension to Plan A's recorder — add it in Plan A, not by re-introducing a `runMonolith` clone here. The Lite golden MUST come from the same monolith recorder as the full goldens, into the same `test/golden/` directory, from the same shared `test/scenarios.js`.

- [ ] **Step 4: Run tests, verify pass**
```
npx vitest run test/lite/golden-parity.test.js
```
Expected: `PASS` — 5 scenarios green (`ffa`, `teams`, `bossrush`, `worldcup-inf`, `ko`), with the `worldcup-inf` `stk:'INF'` Trace sub-assertion passing. A `goldenParity` throw here is a real behavioral divergence (Infinity guard on the wrong side, a snapshotted `hazardT`, a slice-dropped branch) — investigate the module, never loosen the assertion.
> Reasoning chain: Plan A's own golden check proves `full-split ≡ monolith`; this task proves `lite ≡ monolith-on-subset` via the same harness/recorder/scenarios. Together they establish `lite ≡ monolith` for the lite content across all five Lite modes.

- [ ] **Step 5: Commit** (the separate `test/lite/scenarios.js` is deleted — `git rm` it if it exists in the tree)
```
git rm --ignore-unmatch test/lite/scenarios.js
git add test/golden/monolith-golden.lite.json test/lite/golden-parity.test.js
git commit -m "test(lite): golden parity vs monolith on lite content (ffa/teams/bossrush/worldcup-inf/ko)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Plain-browser boot — zero console errors + handler coverage in a real browser

**Files:**
- Create: `test/lite/e2e/lite-boot.spec.js`
- Modify: `package.json` (`test:lite:e2e` script)
- Create/Modify: `playwright.config.js` (add a `dist-lite` preview project if Plan A hasn't)
- Test: the Playwright spec IS the test.
**Interfaces:**
- Consumes: a served `dist-lite/` (via `vite preview --mode lite` on port 4174).
- Produces: a headless-Chromium assertion that `index.lite.html` boots with **zero** console errors / page errors, the title screen renders, the boot-time handler-coverage assertion did not throw, and clicking through Tutorial start produces moving frames (the per-mode loop-start check for Lite).

- [ ] **Step 1: Write the failing test**
```js
// test/lite/e2e/lite-boot.spec.js
import { test, expect } from '@playwright/test';

test.describe('Lite plain-browser boot', () => {
  test('boots dist-lite with no console errors and a visible title', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/index.lite.html');
    await expect(page.locator('#title.screen.active')).toBeVisible();

    // Boot-time handler bridge succeeded (a Lite-reachable handler is on window).
    expect(await page.evaluate(() => typeof window.startMatch)).toBe('function');
    // And an excluded handler was NOT bridged (per-build correctness).
    expect(await page.evaluate(() => typeof window.openEditor)).toBe('undefined');

    // Per-mode loop-start: Tutorial produces moving frames (hazardT advances).
    await page.getByRole('button', { name: /How to Play/i }).click();
    await page.getByRole('button', { name: /Try it/i }).click();
    const h0 = await page.evaluate(() => window.__hazardTProbe?.() ?? null);
    await page.waitForTimeout(400);
    const h1 = await page.evaluate(() => window.__hazardTProbe?.() ?? null);
    if (h0 !== null) expect(h1).toBeGreaterThan(h0);

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
```
> `window.__hazardTProbe` is Plan A's dev-only frame-counter probe. The master frame counter is **`rt.hazardT`** on the runtime object exported by `core/state.js` (canonical contract §5 — never `state.hazardT`), so the probe returns `rt.hazardT`. If the probe is absent, replace the frame-advance check with an assertion that `requestAnimationFrame` is still scheduling (e.g. a monkey-patched rAF counter injected via `page.addInitScript`).

- [ ] **Step 2: Run it, verify it fails**
```
npm run build:lite
npx playwright test test/lite/e2e/lite-boot.spec.js
```
Expected: `FAIL` — no preview server configured for `dist-lite` / spec/base URL not wired yet.

- [ ] **Step 3: Minimal implementation** — add a Playwright project that serves `dist-lite`. In `playwright.config.js` (merge with Plan A's config; add a project + webServer):
```js
// playwright.config.js (Lite preview project — merge into Plan A's config)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/lite/e2e',
  use: { baseURL: 'http://localhost:4174' },
  webServer: {
    command: 'npm run build:lite && vite preview --mode lite --port 4174',
    url: 'http://localhost:4174/index.lite.html',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```
`package.json`:
```json
{ "scripts": { "test:lite:e2e": "playwright test test/lite/e2e" } }
```

- [ ] **Step 4: Run tests, verify pass**
```
npm run test:lite:e2e
```
Expected: `1 passed` — title visible, `window.startMatch` is a function, `window.openEditor` is undefined, tutorial frames advance, and the collected console/page error array is empty.

- [ ] **Step 5: Commit**
```
git add test/lite/e2e/lite-boot.spec.js playwright.config.js package.json
git commit -m "test(lite): plain-browser boot — zero console errors + per-build handler coverage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Cross-plan contract & execution order.** This plan is reconciled to **Canonical Interface Contract v1** and executes **after A and B (order A → B → C → D)** — Plan C is the **offline** Lite taster and is **not** last; the online **Rooms** feature is **Plan D** (after C), which adds `net/netcode.js` + a relay server and amends the tree-shake test (Task 10). Plan-A-owned assets Plan C only *consumes* (creates none): `src/core/build.js` (`BUILD.lite`, Task 1), `src/core/handler-coverage.js` (`assertHandlerCoverage(win, root)`, Task 7), the single `test/` root with Plan A's one Vitest `test` block (no second `vitest.config.js`, no `tests/` plural), the single shared scenarios file `test/scenarios.js` (Plan A owns `LITE_SCENARIOS` = ffa/teams/bossrush/worldcup-inf/ko; there is **no** `test/lite/scenarios.js`), and the golden/parity harness under `test/harness/` imported from `test/harness/index.js` with goldens in `test/golden/*.json` (the Lite golden is `test/golden/monolith-golden.lite.json`) recorded by `scripts/record-monolith.mjs` (Task 11). Plan-B-owned assets it only *consumes*: the post-B `audio/audio.js` facade + `setMusicDirector()` registry and the `music-director.js`/`stem-player.js`/`manifest.js` engine (Task 5). Every Plan-C task that edits a shared/Plan-A file (Task 2 `stages.js`; Task 9 `vite.config.js`/`package.json`) additionally gates on the full `npm test` harness (contract §2).
- **Spec coverage.** Every Lite item maps to a task: consuming Plan A's `BUILD.lite` + the Lite `__LITE__:true` `define` override (Tasks 1, 9); `index.lite.html` trimmed shell dropping editor/lobby/co-op/test screens while keeping the id/`.screen.active` contract (Task 6); `src/main.lite.js` importing only the Lite module set and never registering a music director (Task 8); `vite.config.js` full+lite targets + `dev:lite`/`build:lite` → `dist-lite/` (Task 9); stage `lite:true` flags (STAGES only; the `ROSTER` stays full) with single-source in-place filter (Task 2); verifying the post-B `audio/audio.js` facade no-ops music while SFX is retained (Task 5); the per-build handler-coverage assertion passing for the Lite shell via Plan A's shared module (Tasks 7, 8, 12); the tree-shake verification that no LAN/netcode/editor/co-op/music (incl. `music-director`/`stem-player`/`manifest`) symbols ship — Plan D later re-adds `net/netcode.js` and amends this test (Task 10); the Lite golden-parity subset check across the five Lite modes (ffa/teams/bossrush/worldcup-inf/ko) via `runScriptedMatch({ lite:true })` + `goldenParity` against `test/golden/monolith-golden.lite.json` (Task 11); and plain-browser no-console-errors boot (Task 12). "No music" is structural, not a flag: `main.lite.js` never imports `music-director.js` and never calls `setMusicDirector`, so `_director` stays null; SFX (`bus.js`/`sfx.js`) is untouched and no task hard-codes SFX-on.
- **Placeholders.** None. Every code step shows complete, real code; every command shows concrete expected output. Extraction-style verbatim monolith bodies are avoided — Tasks 2 and 6 specify exact edits/line-ranges and small glue instead of reproducing tables/markup.
- **Name/type consistency vs the contract + map.** Consumed symbols use the exact export names: `applySnapshot`/`serializeState`/`NET`/`autoJoinFromLink`/`openLobby` (netcode), `captureTeamPlan`/`refreshTeamChat` (coop-planning); post-B audio facade `setMusicDirector`/`startMusic`/`stopMusic`/`setIntensity`/`tickMusic`/`SFX` (audio) with `sampleMatchIntensity`/`koStinger` belonging only to the excluded `music-director.js`; `startMatch`/`beginMatchNow` (arena), `startBossRush` (boss-rush), `startTournament`/`openTournamentSetup`/`kickOffTournament`/`endTournament`/`simRestOfRound` (tournament), `openTutorial`/`startTutorial`/`finishTutorial`/`tutorialSeen` (tutorial), `buildBoard` (roster-screen), `resetKeys`/`captureRemapKey`/`isListening` (controls-remap), `resize` (draw), `initDom`/`down`/`KEYS` (state), `go` (router); harness `makeApi`/`runScriptedMatch`/`goldenParity`/`infinityRenderTest`/`mulberry32`/`seedRandom` from `test/harness/index.js`; `assertHandlerCoverage(win, root)`/`collectHandlerIdentifiers`/`HandlerCoverageError` from `core/handler-coverage.js`. The frame counter is `rt.hazardT` (never `state.hazardT`). The 12-symbol Lite bridge is a strict subset of the map's `globalHandlerBridge`.
- **Load-bearing correctness decisions.** (1) Per-mode build not single multi-page build, because `engine/fighter.js`→`net/netcode.js` and `modes/arena.js`+`ui/roster-screen.js`→`modes/coop-planning.js` are *static* imports that would leak into a shared Lite chunk — resolved by the `resolveId` redirect to `.lite` stubs. (2) The content filter is STAGES-only: it runs during `stages.js` evaluation (before `core/state.js` reads `STAGES[0]`) and mutates the `STAGES` array in place, honoring the ESM live-binding rule; `ROSTER` is never filtered (full cast in Lite). (3) `#teamChatPanel` is retained as a hidden placeholder because `ui/roster-screen.js syncModeUI` reads `panel.style` (monolith line 1119), preventing a null-deref without forking roster-screen. (4) The music engine tree-shakes out because Plan B's facade holds a `setMusicDirector` registry with no static `music-director`/`stem-player`/`manifest` import and `main.lite.js` never registers a director — leaving `_director` null. (5) Boss Rush/World Cup are trivially valid because the `ROSTER` is **full** in Lite (no roster trim at all) and `BOSS_ROSTER`/`ASSIST_ROSTER` are likewise unfiltered; the only content difference from desktop is the trimmed `STAGES` set.
