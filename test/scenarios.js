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
