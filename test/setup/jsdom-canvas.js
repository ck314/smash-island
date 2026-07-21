// Vitest (jsdom) setup: give HTMLCanvasElement.getContext a benign 2D shim so real draw() code can
// run under jsdom, which otherwise logs "Not implemented: getContext" and returns nothing. This is
// the sanctioned minimal 2D-canvas-context shim — it never touches HUD or game-state logic; HUD DOM
// text is still produced by the real code. Later tasks that boot modules (Task 32's makeApi) rely on
// this so their real draw()/render calls don't throw. spyMediaConstructors() still wraps and counts
// this getContext, so the module-eval side-effect gate is unaffected.
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

if (globalThis.HTMLCanvasElement) {
  HTMLCanvasElement.prototype.getContext = function () { return stub2d(); };
}
