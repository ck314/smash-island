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
