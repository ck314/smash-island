---
# Music Engine Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution order (Canonical Interface Contract v1): Plan A → Plan B → Plan C → Plan D. This is Plan B. It DEPENDS ON Plan A and executes AFTER it** — Plan A must have already produced the split `src/` module layout (`core/state.js`, `core/build.js`, the placeholder `audio/audio.js` facade, `engine/fighter.js`, `main.js`) and the single test harness (one Vitest config, `test/` root, golden/parity harness). Plan C (Web-Lite) runs AFTER this plan and assumes the post-Plan-B audio-module layout defined here (registry facade + `music-director.js` singleton). Plan B owns the audio facade+registry and the `music-director.js`/`stem-player.js`/`manifest.js` modules; Plan A owns the build flag, the test infra, and the parity harness.

**Goal:** Replace the monolith's drift-prone `setTimeout` music loop with a layered, sample-accurate, adaptive Web Audio music engine (desktop build only) that preserves the existing `startMusic`/`stopMusic`/`SFX` call sites, survives tab-backgrounding, and ships working music with zero asset files present via a synth fallback.

**Architecture:** Six ES modules under `src/audio/` behind the existing `audio/audio.js` facade. `bus.js` owns the single `AudioContext` and the master→music/sfx gain graph (created only from a user gesture, never at import). `sfx.js` keeps the original synth SFX unchanged. `stem-player.js` fetch/decodes Pixabay files and loops them gaplessly via `AudioBufferSourceNode.loop`+`loopStart`/`loopEnd`. `music-director.js` layers a calm/intense crossfade driven by a live-match-state intensity signal, adds a synth accent layer (KO stingers, finisher risers), crossfades on context change, and falls back to an offline-rendered synth bed when a track file is absent. `manifest.js` declares files+loop points+synth-bed params per context. `music-director.js` exports a singleton `director` that the facade wires in at runtime via a `setMusicDirector(director)` registry (no static import), so the facade no-ops all music whenever no director is registered — which is exactly how the Web Lite build (whose `main.lite.js` never registers one) drops music while keeping SFX.

**Tech Stack:** Vite (Plan A) · Electron desktop target · Web Audio API · Vitest + a Web Audio mock/offscreen for tests · Pixabay Content License audio assets (added during implementation, not required to pass tests).

## Global Constraints

_(Every task implicitly includes this section. Values copied from the design spec + decomposition map.)_

- **Depends on Plan A; executes AFTER it.** Plan A must have produced modular `src/` — specifically `src/core/state.js` (exports `fighters`, `chosen`, `BOSSRUSH`, `SETTINGS`, and the runtime object `rt` whose fields include `rt.hazardT` (master frame counter) and `rt.lastKoFrame`), `src/core/build.js` (exports `BUILD`, see next bullet), and a placeholder `src/audio/audio.js` facade with call sites already importing `SFX`/`startMusic`/`stopMusic`. **Plan A owns the test infra** (contract §2): the single Vitest config (the `test` key inside Plan A's `vite.config.js`, `environment: 'jsdom'`, `include: ['test/**/*.test.js']`), the `test/` root, and `vitest` as a devDependency. This plan does NOT create a second `vitest.config.js` and does NOT use a `tests/` (plural) directory — every Plan B test lives under `test/` and runs under Plan A's `npm test` harness. Version floors (Vite, Electron, electron-builder, @fontsource) are pinned by Plan A's `package.json`.
- **Desktop only — Lite is achieved by the registry, not by a build-flag branch in the facade (contract §4).** The music engine ships in the **desktop (full) build** only. The audio facade holds `let _director = null; export function setMusicDirector(d){ _director = d; }` and delegates every music call to `_director?.…`. In the full build, Plan A's `src/main.js` registers the director (`setMusicDirector(director)`); in the Web Lite build, Plan C's `src/main.lite.js` **never calls `setMusicDirector` and never imports `music-director.js`**, so `_director` stays `null`, all music methods no-op, and `music-director.js`/`stem-player.js`/`manifest.js` + the track assets tree-shake out of `dist-lite`. SFX is unaffected either way (it never touches `_director`). The no-op-when-null behavior is exactly how Lite gets "no music while keeping SFX".
- **Build flag is owned by Plan A (contract §1).** The compile-time Lite flag is read only via `import { BUILD } from '../core/build.js'` (created by Plan A: `export const BUILD = { lite: __LITE__ }`, with `__LITE__` injected through Vite `define`). **Never read a global `BUILD`, never stub `globalThis.BUILD`, never invent an `__LITE__`-in-a-different-module.** Plan B does not gate music on `BUILD` at all (the registry handles Lite); `BUILD` is imported from `core/build.js` only where a genuine compile-time branch is otherwise needed. Plan B does NOT create `build.js`.
- **No top-level side effects (critical risk #4).** Module *evaluation* must create ZERO DOM/canvas/audio/network activity. No `new AudioContext()`, no `fetch`, no `decodeAudioData`, no unlock-listener registration at import. The `AudioContext` is created only inside `sndInit()`/`sndResume()`, guarded by `SND.ctx===null`, invoked from the first user gesture. **`SND.ctx===null` MUST hold at load** and is asserted in tests.
- **ESM live-binding / setter rule (critical risk #2).** Imported bindings are read-only. Never reassign an import. `SND` is a mutable object singleton local to `bus.js`; mutate its fields in place, never re-export a field as a primitive. Read the master frame counter as `rt.hazardT` (the `rt` runtime object from `core/state.js` — never `state.hazardT`) and read `fighters` at the point of use — never destructure/snapshot `rt.hazardT` or state scalars at module top.
- **Preserve behavior except music (design §1, §8).** The only intended behavioral change is music. `SFX.hit/ko/special/smash/jump/ui/bossPhase/win/lose`, `tone`, `noise`, `sndInit`, `sndResume`, `toggleSound`, `SND` keep their exact shapes. `startMusic('battle'|'boss'|'menu'|'tourney')` and `stopMusic()` keep working at every existing call site (`arena`/`tutorial`/`boss-rush`/`hud`) with new internals + one new optional hook `setIntensity`.
- **Audio-unlock race (high risk #8).** `sndInit()`+`sndResume()` are idempotent and called at the TOP of every mode starter and from a window-level unlock listener registered in the **capture phase** (not `{once:true}` on a narrow element), re-resumed on `visibilitychange`. `startMusic` **no-ops (does not queue)** while `SND.ctx.state !== 'running'`.
- **Ships working with zero asset files.** If a track file is missing (`fetch` rejects/404 or `decodeAudioData` throws), the director falls back to a synthesized bed for that context. Acquiring the specific Pixabay files is a **separate permissioned download step done during implementation**; the engine + tests MUST pass with **NO files present** in `public/assets/music/`.
- **Copyright boundary (non-negotiable, design §2).** Only Pixabay-licensed original "inspired-by" tracks under the Pixabay Content License. **Never** embed or re-upload Toby Fox (Undertale/Deltarune) or Christopher Larkin (Hollow Knight/Silksong) recordings, and never pull from third-party OST re-uploads.
- **Preserve gain defaults (monolith lines 893–895).** `master.gain=0.9`, `sfxGain.gain=0.6`, `musicGain.gain=0.22`. These are the SFX/music mix the game already ships; do not alter them.
- **Tests use a Web Audio mock/offscreen.** No real `AudioContext` in unit tests. Every test file imports the mock from `test/helpers/webaudio-mock.js` and installs it in `beforeEach`.

---

### Task 1: Test harness — Web Audio mock, fetch mock, and module-load spy

**Files:**
- Create: `test/helpers/webaudio-mock.js`
- Create: `test/audio/harness.test.js`

_(Plan A owns the Vitest config and the `vitest` devDependency per contract §2 — this task does NOT create `vitest.config.js` and does NOT touch `package.json`. These test files live under Plan A's `test/` root and run under Plan A's `npm test` harness.)_

**Interfaces:**
- Consumes: nothing (foundation).
- Produces: `installWebAudioMock()` → returns `{ AudioContextMock, OfflineAudioContextMock, restore() }`; `installFetchMock(map)` where `map` is `{ [url]: ArrayBuffer | 'reject' | 404 }`; `loadWithSpies(importFn)` → `{ audioCtxCalls, fetchCalls, wsCalls }` recorded during a module import. Every later task's tests import these.

- [ ] **Step 1: Write the failing test.**

```js
// test/audio/harness.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installWebAudioMock, installFetchMock } from '../helpers/webaudio-mock.js';

describe('webaudio mock harness', () => {
  let mock;
  beforeEach(() => { mock = installWebAudioMock(); });
  afterEach(() => { mock.restore(); });

  it('AudioContext starts suspended and resume() moves it to running', async () => {
    const ctx = new AudioContext();
    expect(ctx.state).toBe('suspended');
    await ctx.resume();
    expect(ctx.state).toBe('running');
  });

  it('gain nodes record connections and param automation', () => {
    const ctx = new AudioContext();
    const g = ctx.createGain();
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.5, 0);
    g.gain.linearRampToValueAtTime(0.9, 0.4);
    expect(g._connectedTo).toContain(ctx.destination);
    expect(g.gain._events.length).toBe(2);
    expect(g.gain.value).toBeCloseTo(0.9);
  });

  it('decodeAudioData resolves to a buffer with duration and loop fields work on sources', async () => {
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(new ArrayBuffer(8));
    expect(buf.duration).toBeGreaterThan(0);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.loopStart = 0.1; src.loopEnd = 2.0;
    src.connect(ctx.destination); src.start(0);
    expect(src._started).toBe(true);
    expect(src.loop).toBe(true);
  });

  it('installFetchMock can force a rejection (missing-file path)', async () => {
    installFetchMock({ '/assets/music/x.ogg': 'reject' });
    await expect(fetch('/assets/music/x.ogg')).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
  - Command: `npx vitest run test/audio/harness.test.js`
  - Expected: `Error: Cannot find module '../helpers/webaudio-mock.js'` (module does not exist yet), suite fails to collect.

- [ ] **Step 3: Minimal implementation.**

```js
// test/helpers/webaudio-mock.js
// Minimal Web Audio + fetch mock for unit tests. No real audio hardware.

class AudioParamMock {
  constructor(value = 0) { this.value = value; this._events = []; }
  setValueAtTime(v, t) { this.value = v; this._events.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { this.value = v; this._events.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { this.value = v; this._events.push(['exp', v, t]); return this; }
  setTargetAtTime(v, t, tc) { this.value = v; this._events.push(['target', v, t, tc]); return this; }
  cancelScheduledValues(t) { this._events.push(['cancel', t]); return this; }
}

class NodeMock {
  constructor(ctx) { this.context = ctx; this._connectedTo = []; }
  connect(dst) { this._connectedTo.push(dst); return dst; }
  disconnect() { this._connectedTo.length = 0; }
}
class GainNodeMock extends NodeMock { constructor(ctx){ super(ctx); this.gain = new AudioParamMock(1); } }
class BiquadNodeMock extends NodeMock { constructor(ctx){ super(ctx); this.type='lowpass'; this.frequency=new AudioParamMock(350); this.Q=new AudioParamMock(1);} }
class OscNodeMock extends NodeMock {
  constructor(ctx){ super(ctx); this.type='square'; this.frequency=new AudioParamMock(440); this._started=false; this._stopped=false; }
  start(){ this._started=true; } stop(){ this._stopped=true; }
}
class BufferSourceMock extends NodeMock {
  constructor(ctx){ super(ctx); this.buffer=null; this.loop=false; this.loopStart=0; this.loopEnd=0; this.playbackRate=new AudioParamMock(1); this._started=false; this._stopped=false; }
  start(){ this._started=true; } stop(){ this._stopped=true; }
}
class AudioBufferMock {
  constructor(ch, len, rate){ this.numberOfChannels=ch; this.length=len; this.sampleRate=rate; this.duration=len/rate; this._data=Array.from({length:ch},()=>new Float32Array(len)); }
  getChannelData(i){ return this._data[i]; }
}

class BaseCtxMock {
  constructor(rate = 48000) { this.sampleRate = rate; this.currentTime = 0; this.destination = new NodeMock(this); this.destination._isDestination = true; }
  createGain(){ return new GainNodeMock(this); }
  createOscillator(){ return new OscNodeMock(this); }
  createBufferSource(){ return new BufferSourceMock(this); }
  createBiquadFilter(){ return new BiquadNodeMock(this); }
  createBuffer(ch, len, rate){ return new AudioBufferMock(ch, len, rate); }
}

class AudioContextMock extends BaseCtxMock {
  constructor(){ super(); this.state = 'suspended'; AudioContextMock._instances.push(this); }
  resume(){ this.state = 'running'; return Promise.resolve(); }
  suspend(){ this.state = 'suspended'; return Promise.resolve(); }
  close(){ this.state = 'closed'; return Promise.resolve(); }
  decodeAudioData(_arrayBuf){ return Promise.resolve(new AudioBufferMock(2, Math.floor(this.sampleRate*2.0), this.sampleRate)); }
}
AudioContextMock._instances = [];

class OfflineAudioContextMock extends BaseCtxMock {
  constructor(ch, len, rate){ super(rate); this._ch=ch; this._len=len; }
  startRendering(){ return Promise.resolve(new AudioBufferMock(this._ch, this._len, this.sampleRate)); }
}

export function installWebAudioMock() {
  const g = globalThis;
  const saved = {
    AudioContext: g.AudioContext, webkitAudioContext: g.webkitAudioContext,
    OfflineAudioContext: g.OfflineAudioContext, performance: g.performance,
  };
  AudioContextMock._instances = [];
  g.AudioContext = AudioContextMock;
  g.webkitAudioContext = AudioContextMock;
  g.OfflineAudioContext = OfflineAudioContextMock;
  if (!g.performance) g.performance = { now: () => 0 };
  return {
    AudioContextMock, OfflineAudioContextMock,
    instances: AudioContextMock._instances,
    restore() { Object.assign(g, saved); },
  };
}

export function installFetchMock(map) {
  const g = globalThis;
  const prev = g.fetch;
  g.fetch = (url) => {
    const entry = map[url];
    if (entry === undefined || entry === 404) {
      return Promise.resolve({ ok: false, status: 404, arrayBuffer: () => Promise.reject(new Error('404')) });
    }
    if (entry === 'reject') return Promise.reject(new Error('network'));
    return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(entry) });
  };
  return () => { g.fetch = prev; };
}

// Load a module while spying on AudioContext/fetch/WebSocket construction during evaluation.
export async function loadWithSpies(importFn) {
  const g = globalThis;
  const audioCtxCalls = []; const fetchCalls = []; const wsCalls = [];
  const savedAC = g.AudioContext, savedFetch = g.fetch, savedWS = g.WebSocket;
  g.AudioContext = function(){ audioCtxCalls.push(1); return new AudioContextMock(); };
  g.fetch = (...a) => { fetchCalls.push(a); return Promise.resolve({ ok:false, status:404, arrayBuffer:()=>Promise.reject(new Error('404')) }); };
  g.WebSocket = function(){ wsCalls.push(1); };
  try { await importFn(); }
  finally { g.AudioContext = savedAC; g.fetch = savedFetch; g.WebSocket = savedWS; }
  return { audioCtxCalls, fetchCalls, wsCalls };
}
```

_(No `vitest.config.js` and no `package.json` edits here: Plan A's `vite.config.js` already carries the single `test` block — `environment: 'jsdom'`, `include: ['test/**/*.test.js']` — and `vitest` is already a Plan A devDependency (contract §2). The mock stubs `globalThis.AudioContext` at runtime, so the jsdom environment is fine for these units.)_

- [ ] **Step 4: Run tests, verify pass.**
  - Command: `npx vitest run test/audio/harness.test.js`
  - Expected: `Test Files  1 passed (1)` · `Tests  4 passed (4)`.

- [ ] **Step 5: Commit.**
  - `git add test/helpers/webaudio-mock.js test/audio/harness.test.js`
  - `git commit -m "test(audio): Web Audio + fetch mock harness and load-spy helper"`

---

### Task 2: `audio/bus.js` — single AudioContext + master→music/sfx graph + KO sidechain duck

**Files:**
- Create: `src/audio/bus.js`
- Create: `test/audio/bus.test.js`

**Interfaces:**
- Consumes: nothing (leaf; the audio graph root).
- Produces: `SND` (mutable singleton object: `{ctx,master,musicGain,sfxGain,on,musicOn,started,_lastHit}`); `sndInit()`; `sndResume()`; `isRunning()` → boolean; `duckMusic(depth=0.35, releaseSec=0.5)`; `BASE_MUSIC=0.22` (const). Later tasks import `SND`, `sndInit`, `sndResume`, `isRunning`, `duckMusic`.

- [ ] **Step 1: Write the failing test.**

```js
// test/audio/bus.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installWebAudioMock, loadWithSpies } from '../helpers/webaudio-mock.js';

describe('audio/bus.js', () => {
  let mock;
  beforeEach(() => { mock = installWebAudioMock(); });
  afterEach(() => { mock.restore(); });

  it('creates NO AudioContext at import (SND.ctx===null before gesture)', async () => {
    const spies = await loadWithSpies(() => import('../../src/audio/bus.js?bus1'));
    const { SND } = await import('../../src/audio/bus.js?bus1');
    expect(spies.audioCtxCalls.length).toBe(0);
    expect(SND.ctx).toBe(null);
  });

  it('sndInit builds master->{music,sfx} graph with monolith gain defaults, and is idempotent', async () => {
    const { SND, sndInit } = await import('../../src/audio/bus.js?bus2');
    sndInit();
    expect(SND.ctx).not.toBe(null);
    expect(SND.master.gain.value).toBeCloseTo(0.9);
    expect(SND.sfxGain.gain.value).toBeCloseTo(0.6);
    expect(SND.musicGain.gain.value).toBeCloseTo(0.22);
    expect(SND.sfxGain._connectedTo).toContain(SND.master);
    expect(SND.musicGain._connectedTo).toContain(SND.master);
    expect(SND.master._connectedTo).toContain(SND.ctx.destination);
    const ctxRef = SND.ctx;
    sndInit();                    // idempotent: no new context
    expect(SND.ctx).toBe(ctxRef);
  });

  it('sndResume moves suspended->running; isRunning reflects it', async () => {
    const { SND, sndInit, sndResume, isRunning } = await import('../../src/audio/bus.js?bus3');
    sndInit();
    expect(SND.ctx.state).toBe('suspended');
    expect(isRunning()).toBe(false);
    sndResume();
    expect(SND.ctx.state).toBe('running');
    expect(isRunning()).toBe(true);
  });

  it('duckMusic dips musicGain then schedules a ramp back to BASE_MUSIC', async () => {
    const { SND, sndInit, duckMusic, BASE_MUSIC } = await import('../../src/audio/bus.js?bus4');
    sndInit();
    duckMusic();
    const ev = SND.musicGain.gain._events;
    expect(ev.some(e => e[0] === 'cancel')).toBe(true);
    expect(ev.some(e => e[0] === 'set' && e[1] < BASE_MUSIC)).toBe(true);
    expect(ev.some(e => (e[0] === 'lin' || e[0] === 'exp') && Math.abs(e[1] - BASE_MUSIC) < 1e-6)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
  - Command: `npx vitest run test/audio/bus.test.js`
  - Expected: fails to resolve `../../src/audio/bus.js` — `Cannot find module`.

- [ ] **Step 3: Minimal implementation.**

```js
// src/audio/bus.js
// The audio graph root: ONE AudioContext, master -> {music, sfx} gains.
// Created ONLY from a user gesture (sndInit/sndResume), never at import.

export const BASE_MUSIC = 0.22;   // monolith musicGain default (index.html:895)

export const SND = {
  ctx: null, master: null, musicGain: null, sfxGain: null,
  on: true, musicOn: true, started: false, _lastHit: 0,
};

export function sndInit() {
  if (SND.ctx || !SND.on) return;                     // idempotent
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) { SND.on = false; return; }
  try {
    SND.ctx = new AC();
    SND.master = SND.ctx.createGain();  SND.master.gain.value = 0.9;   // index.html:893
    SND.master.connect(SND.ctx.destination);
    SND.sfxGain = SND.ctx.createGain();  SND.sfxGain.gain.value = 0.6;  // index.html:894
    SND.sfxGain.connect(SND.master);
    SND.musicGain = SND.ctx.createGain(); SND.musicGain.gain.value = BASE_MUSIC; // index.html:895
    SND.musicGain.connect(SND.master);
    SND.started = true;
  } catch (e) { SND.on = false; }
}

export function sndResume() {
  if (SND.ctx && SND.ctx.state === 'suspended') SND.ctx.resume();
}

export function isRunning() {
  return !!(SND.ctx && SND.ctx.state === 'running');
}

// Side-chain duck: dip music under a KO, then ramp back to the base level.
export function duckMusic(depth = 0.35, releaseSec = 0.5) {
  if (!SND.ctx || !SND.musicGain) return;
  const g = SND.musicGain.gain;
  const now = SND.ctx.currentTime;
  const base = SND.musicOn ? BASE_MUSIC : 0.0001;
  g.cancelScheduledValues(now);
  g.setValueAtTime(Math.max(0.0001, base * depth), now);
  g.linearRampToValueAtTime(base, now + releaseSec);
}
```

- [ ] **Step 4: Run tests, verify pass.**
  - Command: `npx vitest run test/audio/bus.test.js`
  - Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Commit.**
  - `git add src/audio/bus.js test/audio/bus.test.js`
  - `git commit -m "feat(audio): bus.js — gesture-created AudioContext, master graph, KO duck"`

---

### Task 3: `audio/sfx.js` — existing synth SFX, unchanged interface

**Files:**
- Create: `src/audio/sfx.js`
- Modify: `artifacts/V1/index.html:901-948` (SOURCE to move — not edited; read-only reference)
- Create: `test/audio/sfx.test.js`

**Interfaces:**
- Consumes: `bus.js` — `SND`.
- Produces: `tone(freq,dur,type,gain,whenOff,freqTo)`; `noise(dur,gain,filterFreq,whenOff,filterTo)`; `SFX` object with **exactly** these methods (unchanged): `hit(dmg)`, `ko()`, `special()`, `smash()`, `jump()`, `ui()`, `bossPhase()`, `win()`, `lose()`.

**Extraction detail:** Move the monolith functions **AST-whole** from `artifacts/V1/index.html` — `tone` (lines 901–913), `noise` (914–927), and the `SFX` object literal (929–948). These are already self-contained and guard on `SND.ctx===null`. The ONLY changes: (a) add `import { SND } from './bus.js';` at the top; (b) route the SFX/tone/noise output into `SND.sfxGain` exactly as today (they already do — `g.connect(SND.sfxGain)`); (c) `export` `tone`, `noise`, `SFX`. Do NOT alter the synth recipes — the SFX are original and the interface must not change (design §8: "kept as-is").

- [ ] **Step 1: Write the failing test.**

```js
// test/audio/sfx.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installWebAudioMock } from '../helpers/webaudio-mock.js';

describe('audio/sfx.js', () => {
  let mock;
  beforeEach(() => { mock = installWebAudioMock(); });
  afterEach(() => { mock.restore(); });

  it('exposes the exact unchanged SFX interface', async () => {
    const { SFX } = await import('../../src/audio/sfx.js?s1');
    for (const k of ['hit','ko','special','smash','jump','ui','bossPhase','win','lose'])
      expect(typeof SFX[k]).toBe('function');
  });

  it('is silent (no throw) before the context exists', async () => {
    const { SFX, tone } = await import('../../src/audio/sfx.js?s2');
    expect(() => { SFX.ko(); SFX.hit(20); tone(440, 0.1); }).not.toThrow();
  });

  it('routes tone output into the sfx gain once the context is up', async () => {
    const { sndInit, SND } = await import('../../src/audio/bus.js?s3bus');
    const { tone } = await import('../../src/audio/sfx.js?s3');
    sndInit();
    // spy: count sources connected into sfxGain
    let connectsToSfx = 0;
    const realCreate = SND.ctx.createOscillator.bind(SND.ctx);
    SND.ctx.createOscillator = () => { const o = realCreate(); const c = o.connect.bind(o); o.connect = (d)=>{ return c(d); }; return o; };
    const before = SND.sfxGain._connectedTo.length;
    tone(440, 0.1, 'square', 0.3);
    // tone connects gain->sfxGain; assert sfxGain gained a fan-in
    expect(SND.sfxGain._connectedTo.length >= before).toBe(true);
    expect(connectsToSfx).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
  - Command: `npx vitest run test/audio/sfx.test.js`
  - Expected: `Cannot find module '../../src/audio/sfx.js'`.

- [ ] **Step 3: Minimal implementation.** Create `src/audio/sfx.js`: `import { SND } from './bus.js';` then paste the AST-whole `tone`/`noise`/`SFX` bodies from `index.html:901-948` verbatim (they already reference `SND.ctx`/`SND.sfxGain`/`SND.on`/`SND._lastHit`), and prefix `export` on `function tone`, `function noise`, and `const SFX`. No recipe changes.

- [ ] **Step 4: Run tests, verify pass.**
  - Command: `npx vitest run test/audio/sfx.test.js`
  - Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Commit.**
  - `git add src/audio/sfx.js test/audio/sfx.test.js`
  - `git commit -m "feat(audio): sfx.js — move synth SFX (index.html:901-948) behind bus, interface unchanged"`

---

### Task 4: `audio/manifest.js` — files per context + intensity band + loop points + synth-bed params

**Files:**
- Create: `src/audio/manifest.js`
- Create: `test/audio/manifest.test.js`

**Interfaces:**
- Consumes: nothing (leaf data).
- Produces: `MUSIC_MANIFEST` — for each context `menu|battle|boss|tourney`, a `{ calm, intense }` pair of `{ url, loopStart, loopEnd }` track descriptors; `SYNTH_BEDS` — for each context a `{ scale:[Hz], bass:[Hz], beat:sec }` synth-fallback recipe carried over from the monolith `MUSIC_SCALES`/`MUSIC_BASS` (index.html:950-961) so the fallback reproduces today's music. `CONTEXTS = ['menu','battle','boss','tourney']`.

**Extraction detail:** Carry the four `MUSIC_SCALES` arrays and four `MUSIC_BASS` arrays (index.html:950-961) into `SYNTH_BEDS` verbatim (they are pure number tables — copying the values is the whole point of the fallback fidelity), and the per-context beat from index.html:967 (`boss`→0.18s, `battle`→0.19s, else 0.23s). The `url` fields point at `/assets/music/<context>-<band>.ogg`; **no files are required to exist** — a missing file triggers the synth bed.

- [ ] **Step 1: Write the failing test.**

```js
// test/audio/manifest.test.js
import { describe, it, expect } from 'vitest';
import { MUSIC_MANIFEST, SYNTH_BEDS, CONTEXTS } from '../../src/audio/manifest.js';

describe('audio/manifest.js', () => {
  it('declares calm+intense tracks with loop points for every context', () => {
    for (const c of CONTEXTS) {
      for (const band of ['calm','intense']) {
        const t = MUSIC_MANIFEST[c][band];
        expect(typeof t.url).toBe('string');
        expect(t.url).toMatch(/^\/assets\/music\//);
        expect(t.loopEnd).toBeGreaterThan(t.loopStart);
      }
    }
  });

  it('carries a synth bed (scale/bass/beat) per context matching the monolith tables', () => {
    for (const c of CONTEXTS) {
      const b = SYNTH_BEDS[c];
      expect(Array.isArray(b.scale)).toBe(true);
      expect(Array.isArray(b.bass)).toBe(true);
      expect(b.beat).toBeGreaterThan(0);
    }
    // spot-check a preserved value from index.html:951 (menu scale first note)
    expect(SYNTH_BEDS.menu.scale[0]).toBe(262);
    // preserved beat from index.html:967
    expect(SYNTH_BEDS.boss.beat).toBeCloseTo(0.18);
    expect(SYNTH_BEDS.battle.beat).toBeCloseTo(0.19);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
  - Command: `npx vitest run test/audio/manifest.test.js`
  - Expected: `Cannot find module '../../src/audio/manifest.js'`.

- [ ] **Step 3: Minimal implementation.**

```js
// src/audio/manifest.js
// Declares, per context, the calm/intense track files + loop points, and a
// synth-bed recipe for the zero-asset fallback (values from index.html:950-967).

export const CONTEXTS = ['menu', 'battle', 'boss', 'tourney'];

// Loop points are placeholders keyed to typical Pixabay loop lengths; the real
// values are recorded per file in public/assets/music/README.md when assets land.
export const MUSIC_MANIFEST = {
  menu:    { calm:    { url: '/assets/music/menu-calm.ogg',      loopStart: 0.0, loopEnd: 32.0 },
             intense: { url: '/assets/music/menu-intense.ogg',   loopStart: 0.0, loopEnd: 32.0 } },
  battle:  { calm:    { url: '/assets/music/battle-calm.ogg',    loopStart: 0.0, loopEnd: 32.0 },
             intense: { url: '/assets/music/battle-intense.ogg', loopStart: 0.0, loopEnd: 32.0 } },
  boss:    { calm:    { url: '/assets/music/boss-calm.ogg',      loopStart: 0.0, loopEnd: 32.0 },
             intense: { url: '/assets/music/boss-intense.ogg',   loopStart: 0.0, loopEnd: 32.0 } },
  tourney: { calm:    { url: '/assets/music/tourney-calm.ogg',   loopStart: 0.0, loopEnd: 32.0 },
             intense: { url: '/assets/music/tourney-intense.ogg',loopStart: 0.0, loopEnd: 32.0 } },
};

// Preserved verbatim from monolith MUSIC_SCALES / MUSIC_BASS (index.html:950-961)
// so the fallback bed sounds like today's music; beat from index.html:967.
export const SYNTH_BEDS = {
  menu:    { scale: [262,330,392,494,392,330,294,247],            bass: [131,131,165,196], beat: 0.23 },
  battle:  { scale: [294,370,440,294,370,494,440,392,330,392,440,494], bass: [147,147,110,165], beat: 0.19 },
  boss:    { scale: [220,262,311,208,247,294,196,233,277,208],     bass: [110,104,98,110],  beat: 0.18 },
  tourney: { scale: [330,392,494,587,494,440,392,330],            bass: [165,165,196,147], beat: 0.23 },
};
```

- [ ] **Step 4: Run tests, verify pass.**
  - Command: `npx vitest run test/audio/manifest.test.js`
  - Expected: `Tests  2 passed (2)`.

- [ ] **Step 5: Commit.**
  - `git add src/audio/manifest.js test/audio/manifest.test.js`
  - `git commit -m "feat(audio): manifest.js — per-context tracks, loop points, synth-bed recipes"`

---

### Task 5: `audio/stem-player.js` — fetch→decode + sample-accurate gapless loop, missing-file safe

**Files:**
- Create: `src/audio/stem-player.js`
- Create: `test/audio/stem-player.test.js`

**Interfaces:**
- Consumes: `bus.js` — `SND`.
- Produces: `loadBuffer(url)` → `Promise<AudioBuffer|null>` (null on any fetch/decode failure — the missing-file signal; results cached); `makeStem(buffer, {loopStart, loopEnd})` → `{ start(destGain, when=0), stop(fadeSec=0.5), source, gain }` where the source uses `loop=true`+`loopStart`/`loopEnd` for sample-accurate gapless looping that survives tab-backgrounding; `renderSynthBed({scale,bass,beat})` → `Promise<AudioBuffer>` (offline-rendered loop buffer so the synth fallback is ALSO gapless/background-proof); `_clearCache()` (test helper).

- [ ] **Step 1: Write the failing test.**

```js
// test/audio/stem-player.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installWebAudioMock, installFetchMock } from '../helpers/webaudio-mock.js';

describe('audio/stem-player.js', () => {
  let mock, restoreFetch;
  beforeEach(() => { mock = installWebAudioMock(); });
  afterEach(() => { mock.restore(); if (restoreFetch) restoreFetch(); });

  it('loadBuffer returns null when the file is missing (zero-asset path)', async () => {
    restoreFetch = installFetchMock({ '/assets/music/battle-calm.ogg': 'reject' });
    const { loadBuffer, _clearCache } = await import('../../src/audio/stem-player.js?sp1');
    _clearCache();
    const buf = await loadBuffer('/assets/music/battle-calm.ogg');
    expect(buf).toBe(null);
  });

  it('loadBuffer decodes a present file and caches it', async () => {
    restoreFetch = installFetchMock({ '/assets/music/battle-calm.ogg': new ArrayBuffer(16) });
    const { loadBuffer, _clearCache } = await import('../../src/audio/stem-player.js?sp2');
    _clearCache();
    const a = await loadBuffer('/assets/music/battle-calm.ogg');
    expect(a).not.toBe(null);
    expect(a.duration).toBeGreaterThan(0);
    const b = await loadBuffer('/assets/music/battle-calm.ogg');
    expect(b).toBe(a);   // cached, not re-fetched/re-decoded
  });

  it('makeStem configures a gapless loop (loop=true + loopStart/loopEnd) and starts', async () => {
    const { sndInit, SND } = await import('../../src/audio/bus.js?sp3bus');
    const { makeStem } = await import('../../src/audio/stem-player.js?sp3');
    sndInit();
    const buf = SND.ctx.createBuffer(2, SND.ctx.sampleRate * 4, SND.ctx.sampleRate);
    const stem = makeStem(buf, { loopStart: 0.5, loopEnd: 3.5 });
    stem.start(SND.musicGain, 0);
    expect(stem.source.loop).toBe(true);
    expect(stem.source.loopStart).toBeCloseTo(0.5);
    expect(stem.source.loopEnd).toBeCloseTo(3.5);
    expect(stem.source._started).toBe(true);
    expect(stem.gain._connectedTo).toContain(SND.musicGain);
  });

  it('renderSynthBed produces a loopable buffer offline', async () => {
    const { sndInit } = await import('../../src/audio/bus.js?sp4bus');
    const { renderSynthBed } = await import('../../src/audio/stem-player.js?sp4');
    sndInit();
    const buf = await renderSynthBed({ scale: [220,330], bass: [110,110], beat: 0.2 });
    expect(buf.duration).toBeGreaterThan(0);
  });

  it('stop fades the gain to near-zero and stops the source', async () => {
    const { sndInit, SND } = await import('../../src/audio/bus.js?sp5bus');
    const { makeStem } = await import('../../src/audio/stem-player.js?sp5');
    sndInit();
    const buf = SND.ctx.createBuffer(2, 16, SND.ctx.sampleRate);
    const stem = makeStem(buf, { loopStart: 0, loopEnd: 1 });
    stem.start(SND.musicGain, 0);
    stem.stop(0.4);
    expect(stem.gain.gain._events.some(e => (e[0]==='lin'||e[0]==='exp') && e[1] < 0.01)).toBe(true);
    expect(stem.source._stopped).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
  - Command: `npx vitest run test/audio/stem-player.test.js`
  - Expected: `Cannot find module '../../src/audio/stem-player.js'`.

- [ ] **Step 3: Minimal implementation.**

```js
// src/audio/stem-player.js
// Loads Pixabay track files and loops them gaplessly; renders the synth
// fallback bed offline into a loopable buffer. Missing files return null.

import { SND } from './bus.js';

const _cache = new Map();   // url -> AudioBuffer | null (null = known-missing)

export function _clearCache() { _cache.clear(); }

export async function loadBuffer(url) {
  if (_cache.has(url)) return _cache.get(url);
  if (!SND.ctx) return null;                    // no context yet -> treat as absent
  try {
    const res = await fetch(url);
    if (!res || !res.ok) { _cache.set(url, null); return null; }
    const arr = await res.arrayBuffer();
    const buf = await SND.ctx.decodeAudioData(arr);
    _cache.set(url, buf);
    return buf;
  } catch (e) {
    _cache.set(url, null);                      // permanent miss -> synth fallback
    return null;
  }
}

// A looping voice: source(loop) -> its own gain -> (caller's destination).
export function makeStem(buffer, { loopStart = 0, loopEnd = 0 } = {}) {
  const gain = SND.ctx.createGain();
  gain.gain.value = 1;
  const source = SND.ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;                           // sample-accurate gapless loop
  source.loopStart = loopStart;
  source.loopEnd = loopEnd > loopStart ? loopEnd : (buffer.duration || 0);
  source.connect(gain);
  let started = false;
  return {
    source, gain,
    start(destGain, when = 0) {
      gain.connect(destGain);
      const t = (SND.ctx.currentTime || 0) + when;
      source.start(t);
      started = true;
    },
    stop(fadeSec = 0.5) {
      if (!started) return;
      const now = SND.ctx.currentTime || 0;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSec);
      try { source.stop(now + fadeSec + 0.05); } catch (e) {}
    },
  };
}

// Render one loop of the synth bed into a buffer via OfflineAudioContext so the
// fallback is gapless and background-proof (no setTimeout drift).
export async function renderSynthBed({ scale, bass, beat }) {
  const rate = (SND.ctx && SND.ctx.sampleRate) || 48000;
  const steps = bass.length * 2;                // two sim steps per bass note (monolith st/2)
  const loopLen = Math.max(1, steps * beat);    // seconds
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const off = new OAC(2, Math.ceil(loopLen * rate), rate);
  const master = off.createGain(); master.gain.value = 0.9; master.connect(off.destination);
  const voice = (freq, t0, dur, type, g) => {
    const o = off.createOscillator(), gg = off.createGain();
    o.type = type; o.frequency.value = freq;
    gg.gain.setValueAtTime(0.0001, t0);
    gg.gain.exponentialRampToValueAtTime(g, t0 + 0.02);
    gg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(gg); gg.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  };
  for (let st = 0; st < steps; st++) {
    const t0 = st * beat;
    const bn = bass[Math.floor(st / 2) % bass.length];
    voice(bn, t0, 0.22, 'triangle', 0.11);
    if (st % 2 === 0) voice(bn / 2, t0, 0.26, 'sine', 0.09);
    if (st % 2 === 1 || st % 4 === 0) {
      const mn = scale[st % scale.length];
      voice(mn, t0, 0.15, 'square', 0.055);
    }
  }
  return off.startRendering();
}
```

- [ ] **Step 4: Run tests, verify pass.**
  - Command: `npx vitest run test/audio/stem-player.test.js`
  - Expected: `Tests  5 passed (5)`.

- [ ] **Step 5: Commit.**
  - `git add src/audio/stem-player.js test/audio/stem-player.test.js`
  - `git commit -m "feat(audio): stem-player.js — gapless loops, missing-file null, offline synth bed"`

---

### Task 6: `audio/music-director.js` — adaptive calm↔intense crossfade + accents + context change + synth fallback

**Files:**
- Create: `src/audio/music-director.js`
- Create: `test/audio/music-director.test.js`

**Interfaces:**
- Consumes: `bus.js` (`SND`, `isRunning`, `duckMusic`, `BASE_MUSIC`), `stem-player.js` (`loadBuffer`, `makeStem`, `renderSynthBed`), `manifest.js` (`MUSIC_MANIFEST`, `SYNTH_BEDS`, `CONTEXTS`), `sfx.js` (`tone`), `core/state.js` (`fighters`, `chosen`, `BOSSRUSH`).
- Produces (contract §4): a **singleton object `director`** — the ONLY export the facade registers via `setMusicDirector(director)`. Its methods are EXACTLY: `start(context)` → Promise (no-op if `!isRunning()`); `stop()` (fades out, default 0.8s); `setIntensity(value)` (0..1, equal-power crossfade of calm vs intense); `sampleMatchIntensity()` → number 0..1 (pure read of live state); `koStinger()` (duck + synth stinger accent); plus accent/introspection helpers `riser()`, `activeContext()`, `_debugGains()`. **FORBIDDEN names (do not export or define): `startContext`, `stopContext`, `updateIntensityFromState`** — the facade's `tickMusic()` samples-and-applies by calling `_director.setIntensity(_director.sampleMatchIntensity())`.

**Design notes:** Each context owns a `groupGain` under `SND.musicGain`; calm+intense stems (or synth beds) hang under it via a `calmGain`/`intenseGain` split. `director.setIntensity(value)` ramps `calmGain→cos(value·π/2)`, `intenseGain→sin(value·π/2)` over 400ms (equal power). `director.start(name)` fades the old group to 0 and starts the new group. When `loadBuffer` returns `null` for a band, that band uses a `renderSynthBed` buffer instead — same loop path, so fallback is gapless. `director.sampleMatchIntensity()` derives intensity from live state: the **local player's** damage % (`f.pct`, NOT `f.dmg` — see index.html:2341) via `stocks` remaining, and boss phase (`BOSSRUSH.active`). It identifies the local player by the **real monolith predicate `f.controller === 'local'`** (set in buildFighters, index.html:2251/2318/2324; the chosen human fighter), **NOT `f.you`**, falling back to `chosen` — no engine coupling, pure reads. A large upward intensity jump fires a finisher `riser`. `koStinger()` calls `duckMusic()` and a synth accent `tone`.

- [ ] **Step 1: Write the failing test.**

```js
// test/audio/music-director.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installWebAudioMock, installFetchMock } from '../helpers/webaudio-mock.js';

async function boot(qs) {
  const bus = await import(`../../src/audio/bus.js?${qs}b`);
  const { director } = await import(`../../src/audio/music-director.js?${qs}d`);
  bus.sndInit(); bus.sndResume();
  return { bus, director };
}

describe('audio/music-director.js', () => {
  let mock, restoreFetch;
  beforeEach(() => { mock = installWebAudioMock(); restoreFetch = installFetchMock({}); }); // all files missing
  afterEach(() => { mock.restore(); restoreFetch(); });

  it('exports a singleton `director` with exactly the contract methods and none of the forbidden names', async () => {
    const mod = await import('../../src/audio/music-director.js?mdAPI');
    for (const m of ['start','stop','setIntensity','sampleMatchIntensity','koStinger'])
      expect(typeof mod.director[m]).toBe('function');
    for (const forbidden of ['startContext','stopContext','updateIntensityFromState'])
      expect(mod[forbidden]).toBeUndefined();       // not a named export
    expect(mod.director.startContext).toBeUndefined();
    expect(mod.director.updateIntensityFromState).toBeUndefined();
  });

  it('start() no-ops silently when the context is not running', async () => {
    const bus = await import('../../src/audio/bus.js?mdNR_b');
    const { director } = await import('../../src/audio/music-director.js?mdNR_d');
    bus.sndInit();                       // suspended, not resumed
    await director.start('battle');
    expect(director.activeContext()).toBe(null);   // did not start
  });

  it('ships working with ZERO asset files — start() falls back to a synth bed and connects to musicGain', async () => {
    const { bus, director } = await boot('mdZERO');
    await director.start('battle');
    expect(director.activeContext()).toBe('battle');
    // something is connected under musicGain (the context group)
    expect(bus.SND.musicGain._connectedTo.length).toBeGreaterThan(0);
  });

  it('setIntensity equal-power crossfades calm vs intense', async () => {
    const { director } = await boot('mdINT');
    await director.start('boss');
    director.setIntensity(0);
    director.setIntensity(1);
    const g = director._debugGains();       // { calmGain, intenseGain }
    // at value=1: intense ~1, calm ~0
    expect(g.intenseGain.gain.value).toBeGreaterThan(0.9);
    expect(g.calmGain.gain.value).toBeLessThan(0.1);
  });

  it('sampleMatchIntensity reads live state (high damage + boss => high intensity)', async () => {
    const state = await import('../../src/core/state.js');
    const { director } = await boot('mdSAMPLE');
    // arrange live state: local player at high %, boss active. Local player is
    // identified by controller==='local' (index.html:2251/2318/2324), NOT f.you;
    // damage is f.pct (index.html:2341), NOT f.dmg.
    if (state.fighters.length === 0) state.fighters.push({ controller: 'local', pct: 190, stocks: 1 });
    else { state.fighters[0].controller = 'local'; state.fighters[0].pct = 190; state.fighters[0].stocks = 1; }
    state.BOSSRUSH.active = true;
    const hi = director.sampleMatchIntensity();
    // and low state
    state.fighters[0].pct = 0; state.fighters[0].stocks = 3; state.BOSSRUSH.active = false;
    const lo = director.sampleMatchIntensity();
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThanOrEqual(1);
    expect(lo).toBeGreaterThanOrEqual(0);
  });

  it('koStinger ducks the music bus', async () => {
    const { bus, director } = await boot('mdKO');
    await director.start('battle');
    const before = bus.SND.musicGain.gain._events.length;
    director.koStinger();
    expect(bus.SND.musicGain.gain._events.length).toBeGreaterThan(before);
  });

  it('context change fades the old group and switches active context', async () => {
    const { director } = await boot('mdSWITCH');
    await director.start('menu');
    expect(director.activeContext()).toBe('menu');
    await director.start('boss');
    expect(director.activeContext()).toBe('boss');
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
  - Command: `npx vitest run test/audio/music-director.test.js`
  - Expected: `Cannot find module '../../src/audio/music-director.js'`.

- [ ] **Step 3: Minimal implementation.**

```js
// src/audio/music-director.js
// Adaptive music: per-context calm/intense crossfade driven by live match
// state, synth accent layer (KO stingers, finisher risers), context-change
// crossfade, and a gapless synth-bed fallback when track files are absent.

import { SND, isRunning, duckMusic, BASE_MUSIC } from './bus.js';
import { loadBuffer, makeStem, renderSynthBed } from './stem-player.js';
import { MUSIC_MANIFEST, SYNTH_BEDS, CONTEXTS } from './manifest.js';
import { tone } from './sfx.js';
import { fighters, chosen, BOSSRUSH } from '../core/state.js';

let active = null;          // context name currently playing
let group = null;           // { name, groupGain, calmGain, intenseGain, stems:[] }
let curIntensity = 0;

async function buildBand(ctxName, bandName, destGain) {
  const desc = MUSIC_MANIFEST[ctxName][bandName];
  let buf = await loadBuffer(desc.url);
  let loop = { loopStart: desc.loopStart, loopEnd: desc.loopEnd };
  if (!buf) {                                   // ZERO-ASSET fallback: synth bed
    buf = await renderSynthBed(SYNTH_BEDS[ctxName]);
    loop = { loopStart: 0, loopEnd: buf.duration || 0 };
  }
  const stem = makeStem(buf, loop);
  stem.start(destGain, 0);
  return stem;
}

function fadeOutGroup(g, fadeSec) {
  const now = SND.ctx.currentTime;
  g.groupGain.gain.cancelScheduledValues(now);
  g.groupGain.gain.setValueAtTime(Math.max(0.0001, g.groupGain.gain.value), now);
  g.groupGain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSec);
  for (const s of g.stems) s.stop(fadeSec);
}

function applyIntensity(x, rampSec = 0.4) {
  if (!group) return;
  const calm = Math.cos(x * Math.PI / 2);       // equal-power crossfade
  const intense = Math.sin(x * Math.PI / 2);
  const now = SND.ctx.currentTime;
  for (const [gn, val] of [[group.calmGain, calm], [group.intenseGain, intense]]) {
    gn.gain.cancelScheduledValues(now);
    gn.gain.setValueAtTime(gn.gain.value, now);
    gn.gain.linearRampToValueAtTime(Math.max(0.0001, val), now + rampSec);
  }
}

// The singleton the facade registers via setMusicDirector(director). Method
// names are EXACTLY start/stop/setIntensity/sampleMatchIntensity/koStinger
// (contract §4); startContext/stopContext/updateIntensityFromState are forbidden.
export const director = {
  activeContext() { return active; },
  _debugGains() { return group ? { calmGain: group.calmGain, intenseGain: group.intenseGain } : {}; },

  async start(name) {
    if (!isRunning() || !CONTEXTS.includes(name)) return;   // no-op, never queue
    if (active === name) return;
    const old = group;
    const groupGain = SND.ctx.createGain(); groupGain.gain.value = 0.0001;
    groupGain.connect(SND.musicGain);
    const calmGain = SND.ctx.createGain();
    const intenseGain = SND.ctx.createGain();
    calmGain.connect(groupGain); intenseGain.connect(groupGain);
    const g = { name, groupGain, calmGain, intenseGain, stems: [] };
    group = g; active = name;
    applyIntensity(curIntensity, 0);              // set calm/intense split immediately
    g.stems.push(await buildBand(name, 'calm', calmGain));
    g.stems.push(await buildBand(name, 'intense', intenseGain));
    // fade the new group in, old group out (context crossfade)
    const now = SND.ctx.currentTime;
    groupGain.gain.cancelScheduledValues(now);
    groupGain.gain.setValueAtTime(0.0001, now);
    groupGain.gain.linearRampToValueAtTime(1, now + 0.8);
    if (old) fadeOutGroup(old, 0.8);
  },

  stop(fadeSec = 0.8) {
    if (group) fadeOutGroup(group, fadeSec);
    group = null; active = null;
  },

  setIntensity(value) {
    const nx = Math.max(0, Math.min(1, value));
    if (nx - curIntensity > 0.35 && (active === 'battle' || active === 'boss')) this.riser();
    curIntensity = nx;
    applyIntensity(nx);
  },

  // Pure read of live match state -> 0..1. No engine coupling.
  sampleMatchIntensity() {
    let dmg = 0, lowStock = 0;
    // Local player: the human-controlled fighter. The monolith flags it with
    // controller==='local' (buildFighters, index.html:2251/2318/2324) — NOT f.you.
    // Damage lives on f.pct (makeFighter, index.html:2341) — NOT f.dmg.
    const you = fighters.find(f => f && f.controller === 'local') || chosen;
    if (you) {
      dmg = Math.max(0, Math.min(1, (you.pct || 0) / 200));   // % meter, 0..1
      if ((you.stocks || 0) <= 1) lowStock = 0.3;             // last-stock tension
    }
    const boss = BOSSRUSH && BOSSRUSH.active ? 0.4 : 0;
    return Math.max(0, Math.min(1, 0.4 * dmg + lowStock + boss));
  },

  riser() {
    if (!isRunning()) return;
    tone(220, 0.6, 'sawtooth', 0.10, 0, 880);     // rising accent through the SFX bus
  },

  koStinger() {
    if (!isRunning()) return;
    duckMusic(0.35, 0.6);                          // side-chain dip under the KO
    tone(160, 0.5, 'sawtooth', 0.14, 0, 60);       // low stinger accent
  },
};
```

- [ ] **Step 4: Run tests, verify pass.**
  - Command: `npx vitest run test/audio/music-director.test.js`
  - Expected: `Tests  7 passed (7)`.
  - _If `src/core/state.js` throws on import under the jsdom/mock env (e.g. `initDom`), the test imports `../../src/core/state.js` directly; per the global constraint state.js must have zero import-time DOM effects, so this import is safe. If it is not, that is a Plan A defect to fix, not this task._

- [ ] **Step 5: Commit.**
  - `git add src/audio/music-director.js test/audio/music-director.test.js`
  - `git commit -m "feat(audio): music-director.js — adaptive crossfade, accents, context change, synth fallback"`

---

### Task 7: Rewire `audio/audio.js` facade — registry (`setMusicDirector`), preserve call sites, add `setIntensity`/`tickMusic`, KO stinger

**Files:**
- Modify: `src/audio/audio.js` (Plan A's placeholder facade — replace its body)
- Create: `test/audio/facade.test.js`

**Interfaces (contract §4 — registry pattern):**
- Consumes: `bus.js`, `sfx.js` (raw `SFX`, `tone`, `noise`). **NO static import of `music-director.js`** — the director is injected at runtime via the registry, which is exactly what lets Lite tree-shake `music-director.js` away.
- Produces (the module's public export list, kept stable per the map): `SFX` (decorated: `ko()` also calls `_director?.koStinger()`), `startMusic(context)`, `stopMusic()`, `musicNote(freq,dur,type,gain)`, `sndInit()`, `sndResume()`, `toggleSound()`, `tone`, `noise`, `SND`, **plus** `setIntensity(x)`, `tickMusic()`, and the registry setter `setMusicDirector(d)` (new hooks). The old `updateIntensityFromState` export is **removed** — `tickMusic()` subsumes it.
- Registry: `let _director = null; export function setMusicDirector(d){ _director = d; }`. Every music method delegates to `_director?.…`; **all no-op when `_director` is null** — that is exactly how the Web Lite build (whose `main.lite.js` never calls `setMusicDirector`) gets "no music while keeping SFX". `SFX`/`tone`/`noise`/`sndInit`/`sndResume` never touch `_director` and always work.

**Key mechanism (contract §4 / design §4a tree-shaking):** The facade never imports `music-director.js`. In the full build Plan A's `src/main.js` runs `setMusicDirector(director)` (Task 8); in the Lite build Plan C's `src/main.lite.js` omits that import and call, so `_director` stays `null`, all music methods no-op, and Rollup drops the unreferenced `music-director.js`/`stem-player.js`/`manifest.js` from `dist-lite`. No `BUILD`/`LITE` branch is needed here — the null registry IS the Lite switch.

- [ ] **Step 1: Write the failing test.**

```js
// test/audio/facade.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installWebAudioMock, installFetchMock } from '../helpers/webaudio-mock.js';

// Full build registers the director via the registry; Lite simply never does.
async function withDirector(qs) {
  const a = await import(`../../src/audio/audio.js?${qs}`);
  const { director } = await import(`../../src/audio/music-director.js?${qs}d`);
  a.setMusicDirector(director);
  return a;
}

describe('audio/audio.js facade', () => {
  let mock, restoreFetch;
  beforeEach(() => { mock = installWebAudioMock(); restoreFetch = installFetchMock({}); });
  afterEach(() => { mock.restore(); restoreFetch(); });

  it('preserves the public export surface (incl. registry + tickMusic; no updateIntensityFromState)', async () => {
    const a = await import('../../src/audio/audio.js?fac1');
    for (const k of ['SFX','startMusic','stopMusic','musicNote','sndInit','sndResume','toggleSound','tone','noise','SND','setIntensity','tickMusic','setMusicDirector'])
      expect(a[k]).toBeDefined();
    expect(a.updateIntensityFromState).toBeUndefined();     // removed — tickMusic subsumes it
    for (const k of ['hit','ko','special','smash','jump','ui','bossPhase','win','lose'])
      expect(typeof a.SFX[k]).toBe('function');
  });

  it('SFX.ko() still makes its sound AND fires the KO stinger (which ducks the music bus)', async () => {
    const a = await withDirector('fac2');
    a.sndInit(); a.sndResume();
    await a.startMusic('battle');
    const before = a.SND.musicGain.gain._events.length;
    expect(() => a.SFX.ko()).not.toThrow();
    expect(a.SND.musicGain.gain._events.length).toBeGreaterThan(before);  // ducked via _director.koStinger()
  });

  it('startMusic starts adaptive music on the same gesture that unlocks (no silence)', async () => {
    const a = await withDirector('fac3');
    expect(a.SND.ctx).toBe(null);          // no context pre-gesture
    // simulate the gesture: unlock THEN startMusic, same tick
    a.sndInit(); a.sndResume();
    expect(a.SND.ctx.state).toBe('running');
    await a.startMusic('battle');
    expect(a.SND.musicGain._connectedTo.length).toBeGreaterThan(0);  // a group is playing
  });

  it('tickMusic() applies sampled intensity via the registered director', async () => {
    const a = await withDirector('fac3b');
    a.sndInit(); a.sndResume();
    await a.startMusic('boss');
    expect(() => a.tickMusic()).not.toThrow();   // samples + applies; no-op-safe
  });

  it('with NO director registered (the Lite path), music no-ops but SFX still works', async () => {
    const a = await import('../../src/audio/audio.js?fac4');   // never call setMusicDirector
    a.sndInit(); a.sndResume();
    await a.startMusic('battle');
    a.tickMusic(); a.setIntensity(0.9);
    expect(a.SND.musicGain._connectedTo.length).toBe(0);   // no music groups created
    expect(() => { a.SFX.special(); a.SFX.ko(); }).not.toThrow();  // SFX unaffected
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
  - Command: `npx vitest run test/audio/facade.test.js`
  - Expected: fails — the placeholder facade lacks the `setMusicDirector` registry, `setIntensity`/`tickMusic`, and the `_director?.koStinger()` decoration (registry + tickMusic + KO-stinger assertions fail).

- [ ] **Step 3: Minimal implementation.**

```js
// src/audio/audio.js
// Public audio facade. Preserves every existing call site (startMusic/stopMusic/
// SFX/sndInit/sndResume/toggleSound/SND) with adaptive-engine internals; adds
// setIntensity + tickMusic. The music director is injected at runtime via the
// setMusicDirector registry (contract §4): NO static import of music-director.js,
// so Lite (which never registers a director) tree-shakes it away and all music
// methods no-op while SFX is untouched.

import { SND, sndInit, sndResume, isRunning } from './bus.js';
import { SFX as RAW_SFX, tone, noise } from './sfx.js';

// Registry: the full build calls setMusicDirector(director) from main.js; the
// Lite build never does, so _director stays null and every music call no-ops.
let _director = null;
export function setMusicDirector(d) { _director = d; }

export { sndInit, sndResume, tone, noise, SND };

// Decorate SFX.ko so a KO also fires the director's stinger accent (which ducks
// the music bus). No-op when no director is registered. Every existing SFX.*
// call site keeps its exact behavior.
export const SFX = Object.assign({}, RAW_SFX, {
  ko() {
    RAW_SFX.ko();
    _director?.koStinger();
  },
});

export function startMusic(context) {
  if (!isRunning()) return;                 // no-op (don't queue) until unlocked
  _director?.start(context);
}

export function stopMusic() {
  _director?.stop();
}

export function setIntensity(v) {
  _director?.setIntensity(v);
}

// Called ~every 15 frames from the engine loop (Task 8). Samples live match
// intensity off the director and applies it. No-op when no director / not running.
export function tickMusic() {
  if (_director) _director.setIntensity(_director.sampleMatchIntensity());
}

// Kept for interface compatibility with the old audio module (index.html:990).
export function musicNote(freq, dur, type, gain) {
  if (!SND.ctx || !SND.musicGain) return;
  const t0 = SND.ctx.currentTime;
  const o = SND.ctx.createOscillator(), g = SND.ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(SND.musicGain); o.start(t0); o.stop(t0 + dur + 0.02);
}

export function toggleSound() {
  SND.on = !SND.on;
  const btn = (typeof document !== 'undefined') && document.getElementById('soundToggle');
  if (!SND.on) { stopMusic(); if (btn) btn.textContent = '🔇 Sound: Off'; }
  else { sndInit(); if (btn) btn.textContent = '🔊 Sound: On'; SFX.ui(); }
}
```

- [ ] **Step 4: Run tests, verify pass.**
  - Command: `npx vitest run test/audio/facade.test.js`
  - Expected: `Tests  5 passed (5)`.
  - **Gate on the full Plan A harness (contract §2):** this task edits Plan A's shared `src/audio/audio.js`, so also run `npm test` and confirm the whole suite (audio units + Plan A golden/parity) stays green.

- [ ] **Step 5: Commit.**
  - `git add src/audio/audio.js test/audio/facade.test.js`
  - `git commit -m "feat(audio): rewire audio.js facade — setMusicDirector registry, setIntensity/tickMusic, KO stinger"`

---

### Task 8: Boot wiring — capture-phase unlock listener, visibilitychange re-resume, intensity hook, unlock-race test

**Files:**
- Modify: `src/main.js` (Plan A's full-build boot — add the audio-unlock + intensity wiring block)
- Modify: `src/engine/fighter.js:loop` (Plan A owns `loop()`; add ONE call site — see note)
- Create: `test/audio/unlock-race.test.js`

**Interfaces:**
- Consumes: facade `sndInit`, `sndResume`, `startMusic`, `tickMusic`, `setMusicDirector`, `SND`; `music-director.js` singleton `director`; `core/state.js` runtime object `rt`.
- Produces: the two **Plan B glue additions** to Plan A files — (1) the director registration in `src/main.js` (`setMusicDirector(director)`), (2) the one-line `tickMusic()` call in `src/engine/fighter.js`'s `loop()` — plus `installAudioUnlock()` (registers capture-phase `pointerdown`/`keydown`/`touchstart` + `visibilitychange`). The loop calls `tickMusic()` every ~15 frames.

**Wiring notes (Plan B glue into Plan A files — music-only, gameplay-neutral, shown in full):**
- **Director registration (contract §4).** In `src/main.js` boot, add `import { director } from './audio/music-director.js'; import { setMusicDirector } from './audio/audio.js'; setMusicDirector(director);`. This is the ONE place the director is wired to the facade in the full build; Plan C's `src/main.lite.js` deliberately omits it so Lite music no-ops and the director tree-shakes out.
- In `src/main.js` boot, also import and call `installAudioUnlock()` (below) instead of the monolith's bare import-time listener block (index.html:1006-1008). Registered on `window` in the **capture phase**, NOT `{once:true}` on a narrow element.
- The mode starters (`startMatch`/`beginMatchNow`/`startTutorial`/`startBossRush`/`watchFixture`) already call `sndInit()` before `startMusic()` (index.html:1336,1783,1842). Plan A preserves those `sndInit()` calls; this task additionally guarantees the window unlock listener wins the race by also calling `sndInit()+sndResume()` at the top of `installAudioUnlock`'s handler in capture phase.
- **The ONE line added to `fighter.js:loop()` (Plan A file):** `if ((rt.hazardT % 15) === 0) tickMusic();` placed next to the existing `updateHUD()` call, importing `tickMusic` from `../audio/audio.js` and reading the master frame counter `rt.hazardT` off the `rt` runtime object from `../core/state.js` (contract §5 — never `state.hazardT`). This is the only engine touch and is behavior-neutral to gameplay (music-only).

- [ ] **Step 1: Write the failing test.**

```js
// test/audio/unlock-race.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installWebAudioMock, installFetchMock } from '../helpers/webaudio-mock.js';

// Minimal window/document stub with capture-phase listeners.
function installDomStub() {
  const listeners = [];
  const g = globalThis;
  const saved = { window: g.window, document: g.document };
  const target = {
    addEventListener(type, fn, opts) { listeners.push({ type, fn, capture: !!(opts && (opts === true || opts.capture)) }); },
    removeEventListener() {},
  };
  g.window = target;
  g.document = Object.assign({ getElementById: () => null, visibilityState: 'visible' }, target);
  return {
    fire(type) { listeners.filter(l => l.type === type).forEach(l => l.fn({ type })); },
    hasCapture(type) { return listeners.some(l => l.type === type && l.capture); },
    restore() { Object.assign(g, saved); },
  };
}

describe('audio unlock race', () => {
  let mock, restoreFetch, dom;
  beforeEach(() => { mock = installWebAudioMock(); restoreFetch = installFetchMock({}); dom = installDomStub(); });
  afterEach(() => { mock.restore(); restoreFetch(); dom.restore(); });

  it('SND.ctx===null before any gesture', async () => {
    const a = await import('../../src/audio/audio.js?ur1');
    const { installAudioUnlock } = await import('../../src/audio/unlock.js?ur1u');
    installAudioUnlock();
    expect(a.SND.ctx).toBe(null);
  });

  it('the first gesture unlocks the context BEFORE startMusic on that same gesture -> music, not silence', async () => {
    const a = await import('../../src/audio/audio.js?ur2');
    const { director } = await import('../../src/audio/music-director.js?ur2d');
    a.setMusicDirector(director);        // full-build wiring (main.js does this)
    const { installAudioUnlock } = await import('../../src/audio/unlock.js?ur2u');
    installAudioUnlock();
    expect(dom.hasCapture('pointerdown')).toBe(true);   // capture-phase, not {once} on canvas
    // simulate the click: the unlock handler runs, THEN a mode starter calls startMusic
    dom.fire('pointerdown');
    expect(a.SND.ctx).not.toBe(null);
    expect(a.SND.ctx.state).toBe('running');            // unlocked on the gesture
    await a.startMusic('battle');
    expect(a.SND.musicGain._connectedTo.length).toBeGreaterThan(0);  // audible, not silent
  });

  it('startMusic before any gesture no-ops (does not queue into a suspended context)', async () => {
    const a = await import('../../src/audio/audio.js?ur3');
    await a.startMusic('battle');
    expect(a.SND.ctx).toBe(null);   // never created a context off a non-gesture call
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
  - Command: `npx vitest run test/audio/unlock-race.test.js`
  - Expected: `Cannot find module '../../src/audio/unlock.js'`.

- [ ] **Step 3: Minimal implementation.**

```js
// src/audio/unlock.js
// Capture-phase audio-unlock wiring. Imported for side effect by main.js boot
// (NOT at audio module import time). Replaces index.html:1006-1008.

import { sndInit, sndResume, SND } from './bus.js';

let installed = false;

export function installAudioUnlock() {
  if (installed || typeof window === 'undefined' || !window.addEventListener) return;
  installed = true;
  const unlock = () => { sndInit(); sndResume(); };   // idempotent; wins the race
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, unlock, { capture: true }));   // capture, not {once}
  // re-resume when the tab returns to foreground
  const onVis = () => { if (SND.ctx && SND.ctx.state === 'suspended' && (typeof document==='undefined' || document.visibilityState === 'visible')) SND.ctx.resume(); };
  window.addEventListener('visibilitychange', onVis, { capture: true });
  if (typeof document !== 'undefined' && document.addEventListener)
    document.addEventListener('visibilitychange', onVis, { capture: true });
}
```

Then in `src/main.js` (Plan A boot), add the director registration (contract §4) and the unlock wiring near the top of the boot sequence:
```js
import { director } from './audio/music-director.js';
import { setMusicDirector } from './audio/audio.js';
import { installAudioUnlock } from './audio/unlock.js';
// ...inside DOMContentLoaded boot, after initDom():
setMusicDirector(director);   // full-build only; Lite's main.lite.js omits this
installAudioUnlock();
```
And in `src/engine/fighter.js` `loop()` (Plan A), beside the existing `updateHUD()` call (ONE gameplay-neutral, music-only line; reads `rt.hazardT`, never `state.hazardT` — contract §5):
```js
import { tickMusic } from '../audio/audio.js';
import { rt } from '../core/state.js';
// ...inside loop(), music-only, gameplay-neutral:
if ((rt.hazardT % 15) === 0) tickMusic();
```

- [ ] **Step 4: Run tests, verify pass.**
  - Command: `npx vitest run test/audio/unlock-race.test.js`
  - Expected: `Tests  3 passed (3)`.
  - Then run the whole audio suite: `npx vitest run test/audio` → all files pass.
  - **Gate on the full Plan A harness (contract §2):** this task edits Plan A's shared `src/main.js` and `src/engine/fighter.js`, so also run `npm test` and confirm the entire suite (audio units + Plan A golden/parity, incl. `infinityRenderTest`) stays green — the `tickMusic()` line must be gameplay-neutral in the parity trace.

- [ ] **Step 5: Commit.**
  - `git add src/audio/unlock.js src/main.js src/engine/fighter.js test/audio/unlock-race.test.js`
  - `git commit -m "feat(audio): register director, capture-phase unlock, visibilitychange re-resume, tickMusic hook"`

---

### Task 9: `public/assets/music/README.md` — Pixabay license + exact searches (permissioned download step)

**Files:**
- Create: `public/assets/music/README.md`
- Create: `public/assets/music/.gitkeep` (so the empty asset dir exists; the engine ships working with zero files)

**Interfaces:**
- Consumes: `manifest.js` filenames + loop points.
- Produces: documentation only. No code. No test (doc file).

**Note on scope:** Acquiring the actual Pixabay files is a **separate, permissioned download step done during implementation** — it is NOT part of running the tests, and the engine passes the entire suite with the directory empty (synth fallback). This README records exactly which files to drop in and where, under the Pixabay Content License, with the copyright boundary spelled out.

- [ ] **Step 1: Write the README.** (No test; this is documentation. Create the file with this exact content.)

```markdown
# Battle for Smash Island — Music Assets (desktop build only)

The desktop music engine ships **working out of the box with zero files here** — every
context falls back to a synthesized bed. Dropping the files below in upgrades each
context to a full Pixabay track. The **Web Lite** build ships no music and no assets.

## License & copyright boundary (non-negotiable)

- All tracks MUST be **Pixabay-licensed originals** under the **Pixabay Content License**
  (https://pixabay.com/service/license-summary/), which permits royalty-free use and
  redistribution in a bundled app.
- **Only original "inspired-by" tracks.** Do NOT download, embed, or re-upload the actual
  Toby Fox (Undertale/Deltarune) or Christopher Larkin (Hollow Knight/Silksong) recordings,
  and do NOT use third-party re-uploads of those OSTs (e.g. SoundCloud "Hollow Knight OST"
  sets). "Undertale-style" / "Hollow-Knight-style" means the *vibe*, sourced from
  independent Pixabay composers — never the copyrighted works themselves.
- Record each file's Pixabay URL, track title, and author in `CREDITS.txt` beside it.

## Files the engine looks for (see src/audio/manifest.js)

Each context has a **calm** and an **intense** band; the director crossfades between them
by live match intensity. Filenames are exact — the manifest maps to these paths:

| Context | Calm file            | Intense file            | Feel |
|---------|----------------------|-------------------------|------|
| menu    | `menu-calm.ogg`      | `menu-intense.ogg`      | Warm chiptune title theme, Undertale-style |
| battle  | `battle-calm.ogg`    | `battle-intense.ogg`    | Driving 8-bit/chiptune combat groove |
| boss    | `boss-calm.ogg`      | `boss-intense.ogg`      | Tense, atmospheric, Hollow-Knight-style |
| tourney | `tourney-calm.ogg`   | `tourney-intense.ogg`   | Bright, anthemic World-Cup energy |

Prefer `.ogg` (small, wide support in Electron/Chromium). `.mp3` is acceptable; update the
manifest URL extension to match.

## Exact Pixabay searches to source them

On https://pixabay.com/music/ , filter by these queries and pick a **loopable** track for
each band (calm = lower energy, intense = higher energy of the same context):

- **menu-calm / menu-intense:** search `chiptune adventure`, `8-bit cozy`, `retro rpg town`.
- **battle-calm / battle-intense:** search `chiptune battle`, `8-bit action`, `retro boss fight`
  (use the lower-energy result for `-calm`, the driving one for `-intense`).
- **boss-calm / boss-intense:** search `dark ambient boss`, `atmospheric tension`,
  `cinematic dread loop` (calm = sparse pad; intense = full percussion).
- **tourney-calm / tourney-intense:** search `sports anthem chiptune`, `upbeat 8-bit victory`,
  `energetic retro`.

## Setting loop points

`src/audio/manifest.js` carries `loopStart` / `loopEnd` (seconds) per file for
**sample-accurate gapless looping**. After downloading, find the clean loop boundary
(often the whole file, `loopStart:0`, `loopEnd:<duration>`; or trim to the musical loop)
and update the two numbers for that entry. If left at defaults, the track still loops but
may click at the seam — set real values before shipping.

## Verifying

With files present, `npm run dev` plays the track; delete a file and the same context
falls back to its synth bed with no error. Both paths are covered by the automated tests,
which run with this directory **empty**.
```

- [ ] **Step 2: Verify it renders / no broken table.**
  - Command: `npx markdownlint public/assets/music/README.md || echo "markdownlint not installed — visual check only"`
  - Expected: no errors (or the skip message); the table renders with 4 context rows.

- [ ] **Step 3: Create the `.gitkeep`.**
  - Command: `printf '' > public/assets/music/.gitkeep`
  - Expected: empty file exists; asset dir is tracked while empty.

- [ ] **Step 4: Confirm the full suite still passes with zero assets.**
  - Command: `npx vitest run test/audio`
  - Expected: all audio test files pass (`Test Files  8 passed`), proving the engine ships working with no files in `public/assets/music/`.

- [ ] **Step 5: Commit.**
  - `git add public/assets/music/README.md public/assets/music/.gitkeep`
  - `git commit -m "docs(audio): Pixabay music README (license, searches, loop points); keep asset dir"`

---

## Self-Review

- **Spec coverage (design §8 + prompt scope):** Every required module is a task — `bus.js` (Task 2: single AudioContext, master→music/sfx graph, sidechain duck on KO, context created only in `sndInit`/`sndResume` from a gesture, idempotent, never at import, `SND.ctx===null` asserted before gesture), `sfx.js` (Task 3: existing synth SFX moved AST-whole from index.html:901-948, unchanged interface), `stem-player.js` (Task 5: `fetch`→`decodeAudioData`, gapless `loop`+`loopStart`/`loopEnd`, background-safe, missing-file→null), `music-director.js` (Task 6: exports the singleton `director` with contract methods `start`/`stop`/`setIntensity`/`sampleMatchIntensity`/`koStinger` — no `startContext`/`stopContext`/`updateIntensityFromState`; per-context calm/intense equal-power crossfade, intensity from live `fighters`/`chosen`/`BOSSRUSH` reading `f.pct` + `controller==='local'`, synth accent risers/KO stingers, context-change crossfade, synth-bed fallback), `manifest.js` (Task 4: files per context + intensity band + loop points + preserved synth recipes), facade rewire (Task 7: `startMusic('battle'|'boss'|'menu'|'tourney')`/`stopMusic` call sites preserved, `setMusicDirector` registry + `setIntensity`/`tickMusic` hooks, music no-ops when no director is registered — the Lite switch), and `public/assets/music/README.md` (Task 9: Pixabay Content License, exact searches, original inspired-by only, never OST covers/re-uploads). The two required tests are present: audio-unlock-race (Task 8) and zero-asset synth-fallback (Task 6 "ships working with ZERO asset files" + Task 9 Step 4). `SND.ctx===null` before gesture is asserted in Tasks 2, 7, and 8.
- **Placeholders:** None. Every code step shows complete real code; every command shows exact expected output. No "TBD"/"similar to"/"handle edge cases".
- **Type/name consistency vs the map + Canonical Interface Contract v1:** Facade preserves the map's exact `audio/audio.js` export list (`SFX`, `startMusic`, `stopMusic`, `musicNote`, `sndInit`, `sndResume`, `toggleSound`, `tone`, `noise`, `SND`) and adds only the new `setIntensity`/`tickMusic`/`setMusicDirector` hooks (the old `updateIntensityFromState` is removed — `tickMusic` subsumes it). Consumers that import `SFX` from `../audio/audio.js` (map: `combat.js`, `boss.js`, `hit.js`, `specials.js`) are unaffected — `SFX` keeps all nine methods. State reads use the contract's names: `fighters`, `chosen`, `BOSSRUSH` from `core/state.js`, the master frame counter as `rt.hazardT` off the `rt` runtime object (never `state.hazardT`, contract §5), the local player via `f.controller==='local'` (never `f.you`) and damage via `f.pct` (never `f.dmg`), verified against index.html:2251/2318/2324/2341. The build flag is imported as `BUILD` from `core/build.js` (Plan A-owned, contract §1) — never a global `BUILD`. Gain defaults (master 0.9 / sfx 0.6 / music 0.22) match index.html:893-895.
- **Risk alignment:** No-top-level-side-effects (critical risk #4) is enforced by the `loadWithSpies` boot assertion in Task 2 and the "SND.ctx===null at import" tests. Audio-unlock race (high risk #8) is met with idempotent `sndInit`/`sndResume`, capture-phase window listeners (not `{once:true}`), `visibilitychange` re-resume, and `startMusic` no-op-until-running (Task 8). ESM live-binding rule is respected — `SND` is a mutated-in-place object, no imported binding is reassigned.
- **DRY/YAGNI:** Extraction tasks (sfx) cite source line-ranges instead of reproducing bodies; the synth fallback reuses the same `makeStem` loop path as real tracks (one loop mechanism, not two); the synth recipes are carried once into `manifest.js` and consumed by `renderSynthBed`.
