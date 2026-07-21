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
