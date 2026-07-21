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
