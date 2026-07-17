# Battle for Smash Island — Modular App Re-architecture + Music Engine

**Date:** 2026-07-17
**Status:** Design (awaiting review)
**Scope:** Re-architecture only. Convert the single-file game into a multi-file Vite + Electron desktop application, and replace the music system with a layered adaptive engine. **Game behavior stays identical**; the only intended behavioral change is music.

---

## 1. Problem

The game ships as one `artifacts/V1/index.html` — 6,513 lines: 273 lines CSS + a single **5,861-line `<script>`** in one flat scope where roster, physics, combat, boss AI, rendering, netcode, audio, tournament, and the level editor all reference each other freely. That flat scope is what let the `'●'.repeat(f.stocks)` → `RangeError` render bug (infinite-stock World Cup matches) hide for **six builds** — the failure the whole project is a reaction to.

Two problems to solve:

1. **File layering** — decompose the monolith into focused ES modules with clear interfaces, built with Vite and packaged as an installable Electron desktop app.
2. **Music** — today's music is a single `setTimeout`-driven loop (`startMusic`, lines 949–1005) with four hardcoded scale/bass tables. It drifts, dies when the tab backgrounds, and has no real layering. Replace it with a sample-accurate, layered, adaptive engine that loads royalty-free audio.

## 2. Decisions (locked with owner)

| Decision | Choice |
|---|---|
| Build tool | **Vite** (multi-file ES-module source → bundled) |
| Deliverable | **Installable Electron desktop app** (not a browser/Chromebook target) |
| Music source | **Royalty-free Pixabay tracks** — Undertale-style for menu/battle/tournament, atmospheric for boss — under the Pixabay Content License. Original "inspired-by" tracks only, **not** covers of specific copyrighted songs. |
| Music fallback | Synthesized bed always available, so audio works with zero asset files present |
| Scope | **Re-architecture only.** No gameplay changes (local 2P, tutorial, mobile, balance are out). |

**Copyright boundary (non-negotiable):** We do **not** embed the actual Toby Fox (Undertale/Deltarune) or Christopher Larkin (Hollow Knight/Silksong) recordings, and we do **not** pull from third-party re-uploads of those OSTs (e.g. the SoundCloud "Hollow Knight OST" set). Only Pixabay-licensed originals or assets the owner personally licenses.

## 3. Source of truth for the split

The decomposition is driven by a verified dependency graph produced by a 19-slice parallel audit of the actual source, saved alongside this doc as **`2026-07-17-bfsi-decomposition-map.json`**. It contains, per module: exact source line-ranges, exports, and the full import list; the complete shared-state singleton set; the circular-import analysis; and a 15-item risk register with a 14-item verification suite. The implementation plan consumes that JSON directly. This document is the human-readable contract; the JSON is the machine-readable one.

## 4. Target project layout

```
smash-island/
├─ artifacts/                    # UNTOUCHED reference: v1 HTML + design/review docs
├─ docs/superpowers/specs/       # this design + the decomposition-map JSON
├─ package.json                  # vite, electron, electron-builder, @fontsource
├─ vite.config.js
├─ index.html                    # Vite entry: DOM shell only (verbatim from monolith body)
├─ electron/
│  ├─ main.cjs                   # BrowserWindow; loads dev server / built dist; CSP
│  └─ preload.cjs                # contextIsolation:true, nodeIntegration:false
├─ public/assets/music/          # royalty-free tracks + README manifest
├─ styles/
│  ├─ tokens.css                 # :root custom props (--grass/--host/--gold/…) — loads FIRST
│  └─ app.css                    # everything else
└─ src/
   ├─ main.js                    # boot/wiring only
   ├─ core/
   │  ├─ state.js                # ALL mutable shared singletons + setters + shake()
   │  └─ constants.js            # immutable tunables + control defaults (leaf)
   ├─ data/  roster.js  stages.js  smashes.js          # pure data (leaves)
   ├─ audio/ audio.js  bus.js  sfx.js  music-director.js  stem-player.js  manifest.js
   ├─ engine/ physics.js particles.js combat.js boss.js hit.js attacks.js specials.js fighter.js
   ├─ ai/ ai.js
   ├─ render/ draw.js
   ├─ ui/ router.js hud.js roster-screen.js controls-remap.js balance-stats.js global-actions.js
   ├─ modes/ arena.js tutorial.js tournament.js boss-rush.js coop-planning.js
   ├─ net/ netcode.js
   └─ editor/ level-editor.js
```

## 5. Module architecture

**Layering (leaf → app):**
`constants` / `data/*` (leaves) → `core/state` → `engine/physics`, `engine/particles` (near-leaves) → engine core (`hit`, `combat`, `boss`, `attacks`, `specials`, `fighter`) → `ai`, `render/draw` → `ui/*` → `modes/*` → `net`, `editor` → `ui/global-actions` → `main`.

Every module's exact exports/imports are enumerated in the map JSON. Key structural rulings:

- **`loop()` and `step()` live in `engine/fighter.js`** (not `main.js`), so mode starters can call `loop()` without a `modes → main` cycle.
- **`shake()` + `shakeAmt` live in `core/state.js`** (co-located with the value), which breaks the `render/draw ↔ hit` and `render/draw ↔ boss` cycles — hit/boss never import the renderer.
- **`banner` and `clamp`** are the most widely-imported leaves (`ui/hud`, `engine/physics`); kept small and dependency-free.
- Non-obvious homes, resolved explicitly in the map's `unassigned` section: `BOSS_ATK_ID` stays module-local in `boss.js`; `RANGE_PROFILE` is exported from `attacks.js` and read by `roster-screen.js`; `updateSummons` stays in `boss.js`; `BStore` (storage) lives in `balance-stats.js` but must guarantee `localStorage` (Electron renderer has no injected `window.storage`).

**Circular imports:** 11 cycles exist among the engine cluster and ui/modes. All are **call-time only** and therefore safe under ESM's live-binding + single-evaluation semantics. The invariant that keeps them safe, and which the implementation must preserve:

> **No module may CALL an imported function during its own top-level evaluation, and no module may reassign an imported binding (writes go through `core/state.js` setters).**

## 6. Shared-state design (`core/state.js`)

51 mutable singletons move here (full list in the map). The critical correctness rule is about **ESM live bindings being read-only for importers**:

- **Reassignable scalars** (`running`, `paused`, `raf`, `camX/camY`, `W/H/WW/WH`, `stage`, `chosen`, `KEYS`, `elimSeq`, tournament flags, …) are written **only via setters** (`setStage`, `setChosen`, `setKeys`, `setRunning`, `setCam…`) or exposed as **object fields** so `++`/`+=` work (`state.hazardT`, `state.camX`). You cannot `hazardT++` on an imported binding.
- **Wholesale array swaps** done every frame via `.filter()` (`particles`, `projectiles`, `beams`, `items`, `summons`, `tendrils`, `worldPlats`, `floors`, `fighters`) route through **in-place mutators / setters** so every importer keeps seeing the live array (the renderer reads these pools).
- **Object singletons** (`SETTINGS`, `TESTMODE`, `BOSSRUSH`, `TUT`, `STOMACH`, `down`) are **mutated in place**, never re-exported as primitives.
- `cv`/`ctx` are resolved **lazily** via `initDom()` on `DOMContentLoaded`, never at import time.
- Former implicit globals (`lastKoFrame`, `TEAM_PLAN`, `elimSeq`) are now declared/exported here — ESM strict mode turns bare assignments into `ReferenceError`.

**Enforcement:** ESLint rule banning reassignment of imported bindings and destructuring of state scalars (always read `state.hazardT` at the point of use, never snapshot it); production build runs strict so "Assignment to constant variable" surfaces at build time as a blocker.

## 7. DOM handler bridge & CSP

`index.html` has **44 inline `on*=` handlers** calling top-level functions by bare name (`onclick="startMatch()"`, `onclick="NET.host()"`, `onchange="TESTMODE.damage=this.value"`, …). Under ESM these are no longer global and every handler throws `ReferenceError`.

**Approach (recommended):**
1. `src/ui/global-actions.js` imports the real functions and assigns them to `window`, imported for side effect by `main.js` **after** all handler-owning modules load. Each assignment is wrapped in its own `try/catch` so one bad symbol can't cascade and kill the rest.
2. **Auto-generate + assert coverage at boot** rather than hand-maintaining a list (the map's own hand list had 32 of 44 — a real gap): at boot, `querySelectorAll('[onclick],[onchange],[oninput],…]')`, parse every referenced identifier, and assert each exists on `window` **before first paint** — fail loudly if any is missing. This makes a coverage gap impossible to ship.
3. **CSP:** the Electron renderer ships a CSP that permits inline handlers (`script-src` with the inline allowance they require), since we keep `on*=`. Remote font `@import` (Fredoka/JetBrains) is replaced with a **bundled `@fontsource`** import (CSP/offline-safe).

**Recommended follow-up (not this pass):** migrate the 44 inline handlers to `addEventListener` delegation keyed on `data-action` attributes, which is CSP-clean (no inline allowance, no window bridge) and the better long-term posture for a packaged app. Deferred to keep this pass behavior-identical and low-churn. Flagged for the review gate. A related security follow-up: audit any `innerHTML` rendering of co-op-chat / LLM responses.

## 8. Music engine (`src/audio/`)

Replaces the `setTimeout` loop while **preserving the existing call sites** — `startMusic('battle'|'boss'|'menu'|'tourney')` and `stopMusic()` keep working exactly where arena/tutorial/boss-rush/hud call them, so no game code changes. New internals + one optional new hook (`setIntensity`).

- **`bus.js`** — one `AudioContext`, master → music/sfx gain graph, side-chain ducking (music dips under KOs). Context created only in `sndInit()`/`sndResume()` from a user gesture, never at import.
- **`sfx.js`** — the existing synth hit/KO/special/UI sounds, kept as-is (original, no copyright issue).
- **`stem-player.js`** — loads Pixabay files (`fetch` → `decodeAudioData`), **sample-accurate gapless looping** via `AudioBufferSourceNode.loop` + `loopStart`/`loopEnd`. This directly fixes today's two real music bugs: drift and dying on tab-background.
- **`music-director.js`** — the adaptive **layering**: each context has a track set; an **intensity signal** derived from live match state (your %, stocks remaining, boss phase) **crossfades between a calmer and a more intense track**, plus a **live synth accent layer** (risers on finisher charge, stingers on KO). Context changes crossfade instead of hard-cutting. `startMusic(context)` → director; `stopMusic()` → fade out.
- **`manifest.js`** — declares files per context + intensity band + loop points.
- **Graceful fallback:** if a track file is missing, the director falls back to a synthesized bed for that context. **The app ships with working music out of the box** and upgrades to Pixabay tracks the moment they land in `public/assets/music/`.

**Honesty note on "layers":** Pixabay tracks are full mixes, not separated stems, so true per-instrument stem layering isn't sourceable. Real adaptive layering here = calm/intense crossfade per context + live synth accent layer + smooth context transitions. Genuinely adaptive, legal, no faked stems.

**Asset acquisition** is a separate, permissioned step (downloading files) done during implementation; the engine + synth fallback do not block on it, and a `public/assets/music/README.md` documents the exact Pixabay searches/tracks to drop in.

**Audio-unlock race:** `sndInit()`+`sndResume()` are idempotent and called at the top of every mode starter (and from a window-level unlock listener registered in capture phase, not `{once:true}` on a narrow element), so the first gesture always unlocks the context before any `startMusic` on that same gesture. `startMusic` no-ops (doesn't queue) while the context isn't `running`.

## 9. Electron shell

- `electron/main.cjs` creates the `BrowserWindow`, loads `http://localhost:<vite>` in dev and the built `dist/` in prod **via a real origin** (custom `app://` protocol or a localhost server) so `localStorage` works — never bare `file://` (which can throw `SecurityError` and breaks `BStore`).
- `electron/preload.cjs`: `contextIsolation: true`, `nodeIntegration: false`. The game needs no Node — it's canvas + WebAudio + WebSocket. (The in-page `window.NET`/`window.TESTMODE` bridge is page-scoped and unaffected by context isolation.)
- Scripts: `npm run dev` (Vite + Electron, hot reload) · `npm run build` (Vite) · `npm run dist` (electron-builder → Windows installer).
- **Parity requirement:** the full behavioral suite runs inside the **packaged** build, not just dev — CSP, fonts, `localStorage`, and audio-unlock all diverge between dev and packaged.

## 10. Extraction method

Mechanical, incremental, and verified — never a big-bang split:

1. Scaffold Vite + Electron + the empty module tree; get a blank window running.
2. Extract in dependency order: **CSS → data/constants → core/state → engine leaves → engine core → ai/render → ui → modes → net → editor → global-actions → main.**
3. **Extract by function/AST boundary, not raw line ranges** — several functions are slice-cut across ranges (`applyHit`, `step`, `setupWorld`, `loop`, `doSpecial`'s switch). Reunite each whole. After each stage, diff the set of top-level symbol names against the monolith to prove none vanished.
4. **Run the verification suite (§12) after every stage.** The historical bug shipped because a stage looked fine; a stage isn't "done" until behavior is verified.
5. Build the music engine last (it's the one intentional behavior change), against the preserved `startMusic`/`stopMusic` interface.

## 11. Risk register (from the adversarial audit; full detail in the map JSON)

**Critical**
- **Inline `on*=` handlers dead under module scope / CSP** — 44 handlers, hand-bridge covered only 32; strict CSP would kill all. → auto-generate + assert bridge at boot; permissive-for-inline CSP now; wrap assignments in try/catch.
- **Shared-state aliasing** — reassigning an import throws; snapshotting a scalar (esp. `hazardT`) silently freezes timing (freeze cap, curse decay, KO timing). → setters + object fields + ESLint enforcement; never destructure state scalars.
- **Infinity/RangeError render loop resurrected** — the named six-build bug; `f.stocks=Infinity` in World Cup. → keep `∞` guards co-located in `updateHUD` + Infinity-safe standings sort; loop body in `try/catch`; the infinite-stock path is in the automated suite **with the real HUD, never stubbed.**
- **Import-time side effects** touching canvas/AudioContext/DOM/WebSocket before ready. → module eval must have zero DOM/audio/net effects; assert by spying on `getContext`/`AudioContext`/`WebSocket` during load.

**High** — ESM strict-mode implicit globals → `ReferenceError`; circular-import undefined-at-init if any cyclic import is called at eval time; Electron packaged-vs-dev divergence (CSP/`file://`/fonts); audio-unlock race; slice-cut function bodies losing a fragment.

**Medium/Low** — reserved-word string keys (`'switch'`,`'static'`) mangled by minifier (disable property mangling; assert every `kit.special` resolves); per-frame `.filter()` pool reassignment setters; DOM id / `.screen.active` contract preserved verbatim; harness must not stub HUD/draw; CSS token-layer load order.

## 12. Verification plan (the anti-six-build-bug backstop)

Run after **every** extraction stage. Full list of 14 checks in the map JSON; the load-bearing ones:

- **Zero-error boot** + spy assertion that no `getContext`/`AudioContext`/`WebSocket` fired during module evaluation.
- **Handler coverage (44 not 32):** enumerate every `on*=` identifier, assert on `window`, dispatch each, assert no `ReferenceError`.
- **THE Infinity render test** with the **real** `updateHUD`: World Cup group match (`stocks=Infinity`), run ≥120 frames, assert no `RangeError`, HUD shows `∞`, `requestAnimationFrame` still firing, standings sort doesn't throw.
- **Loop error-containment:** inject a one-time throw into `draw()`, assert it logs once and does **not** silently freeze the page.
- **Live-state aliasing:** after a rematch (`buildFighters`) and a simulated `applySnapshot`, assert `draw()` renders the NEW pools (proves consumers read `state.*`, not a stale copy); assert `hazardT`-driven effects keep ticking.
- **Per-mode loop-start:** each starter (`startMatch`, `beginMatchNow`, `startTutorial`, `startBossRush`, `watchFixture`, net `applySnapshot`) produces moving frames.
- **Audio unlock:** `SND.ctx===null` at load; first click → `suspended`→`running` + music (not silence).
- **Dispatch completeness post-minify:** every `ROSTER` kit's `special/up/down/attack` and every `SMASHES` key resolves to a function.
- **Electron parity suite:** the entire suite inside the packaged build.
- **Golden parity vs monolith:** drive both builds through a fixed-seed recorded-input match (FFA, Teams, a boss phase transition, a World Cup group match, a KO/eliminate) and diff HUD stock/percent text, standings order, KO count, final placement. Equality proves behavior is *preserved*, not merely that the build runs.

## 13. Out of scope

Gameplay changes from the adversarial review (local 2-player, 60-second tutorial, starter roster, mobile/touch, balance passes, share loop). Those belong in a follow-up on top of the clean architecture. The `data-action`/CSP-hardening migration and the co-op `innerHTML` audit are recommended follow-ups, not this pass.

## 14. Definition of done

- `npm run dev` launches the Electron app; every screen, mode, boss, tournament, editor, and LAN path behaves identically to `artifacts/V1/index.html`.
- The full verification suite passes, including the golden-parity diff and the Electron packaged parity suite.
- Music is sample-accurate, layered by intensity, survives tab-background, and falls back to synth when assets are absent.
- `npm run dist` produces a Windows installer.
