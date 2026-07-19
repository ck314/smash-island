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
