// Full:  node scripts/record-monolith.mjs            -> test/golden/monolith-golden.json
// Lite:  node scripts/record-monolith.mjs --lite     -> test/golden/monolith-golden.lite.json
//
// Replays test/scenarios.js against the UNTOUCHED monolith (artifacts/V1/index.html, booted in
// jsdom by load-monolith.js) and records the canonical Trace v1 for each scenario. The frozen
// output is the parity baseline every later extraction task diffs against via goldenParity().
import { writeFileSync, mkdirSync } from 'node:fs';
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

// Dispatch ONE canonical Step against the REAL monolith window. This is the schema->monolith
// adapter: the same Step[] also feeds the module-side runScriptedMatch (Task 32's boot-api.js
// dispatchStep), which must reproduce these Traces frame-for-frame. Deviations from the brief's
// illustrative snippet exist because that snippet targeted the future boot-api, not the monolith:
//   * the monolith's Boss Rush mode string is 'boss' (schema says 'bossrush');
//   * startBossRush() is invoked BY beginMatchNow() when mode==='boss' — calling it standalone would
//     not build fighters or start the match, so we set the mode and call startMatch();
//   * watchFixture(fx) requires an actual group fixture (fx.kind==='group' is what sets stocks to
//     Infinity), so we startTournament() first and watch TOURNEY.fixtures[0];
//   * SETTINGS/down/TOURNEY are lexical globals reached via the live accessors load-monolith installs.
function dispatchStep(w, step) {
  if (step.start) {
    const s = step.start;
    w.SETTINGS.mode = s.mode === 'bossrush' ? 'boss' : s.mode;
    if (s.count != null) w.SETTINGS.count = s.count;
    if (s.stage != null) w.setStage(s.stage);
    if (s.teams != null) w.SETTINGS.teamKey = teamKeyFromArray(s.teams);
    w.startMatch();                                         // ffa | teams | boss (boss spawns inside)
  } else if (step.tournament) {
    const t = step.tournament;
    w.startTournament(t.size, t.mode);                      // build the 48-team World Cup + fixtures
    // a GROUP fixture watch is the path that sets every fighter's stocks to Infinity (stk:'INF')
    w.watchFixture(w.TOURNEY.fixtures[0], t.mode !== 'spectate');
  } else {
    // down/up carry DOM event.code strings into the SAME `down` map the monolith's input reads.
    if (step.down) for (const code of step.down) w.down[code] = true;
    if (step.up) for (const code of step.up) w.down[code] = false;
  }
}

// scenario `teams:[0,0,1,1]` -> the monolith's teamKey "2v2" (count per team id, joined by 'v').
function teamKeyFromArray(teams) {
  const sizes = [];
  for (const t of teams) sizes[t] = (sizes[t] || 0) + 1;
  return [...sizes].filter((n) => n > 0).join('v');
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
mkdirSync('test/golden', { recursive: true });
writeFileSync(
  LITE ? 'test/golden/monolith-golden.lite.json' : 'test/golden/monolith-golden.json',
  JSON.stringify(out, null, 2) + '\n',
);
console.log(`recorded ${Object.keys(out).length} scenarios -> ${LITE ? 'test/golden/monolith-golden.lite.json' : 'test/golden/monolith-golden.json'}`);
