import { describe, it, expect } from 'vitest';
import { loadMonolith } from './helpers/load-monolith.js';

// Unit 7 — tournament simulation hardening.
//
// Fighter RATINGS are deliberately out of scope (see the plan: no trustworthy strength data
// exists, and the obvious sources are inverted or circular). These are the three defects found
// while investigating that, each of which is real independent of any rating.

// NOTE: startTournament's first argument is TEAM SIZE (1 = solo, 2 = 2v2), not the number of
// teams — that is hardcoded at 48. Passing 48 here builds 48-member teams and makes every
// with-replacement duplicate assertion trivially true.
function startTourney(w, teamSize = 1, mode = 'spectate') {
  w.eval(`startTournament(${teamSize}, ${JSON.stringify(mode)})`);
}

describe('Unit 7 — teamStrength can never invert the simulation', () => {
  it('is strictly positive for every constructible team', () => {
    const { window: w } = loadMonolith();
    startTourney(w);
    const min = w.eval(`
      (function(){
        var worst = Infinity;
        for (var i=0;i<TOURNEY.teams.length;i++) worst = Math.min(worst, teamStrength(TOURNEY.teams[i]));
        return worst;
      })()`);
    expect(min).toBeGreaterThan(0);
  });

  it('stays positive for a team built entirely from the weakest possible members', () => {
    // The hazard: simGroupMatch rolls Math.random()*(strA+strB) and compares < strA. If a future
    // rating lets strength reach <= 0 the roll goes negative, is always < strA, and team A wins
    // 5-0 every single time — a deterministic inversion a roster-wide spread check cannot see.
    const { window: w } = loadMonolith();
    startTourney(w);
    const s = w.eval(`teamStrength({ members: ROSTER.slice(0, 8) })`);
    expect(s).toBeGreaterThan(0);
  });
});

describe('Unit 7 — standings order is stable and unbiased', () => {
  it('cmpTeam is a consistent comparator: sorting twice yields the same order', () => {
    const { window: w } = loadMonolith();
    startTourney(w);
    const [a, b] = w.eval(`
      (function(){
        var g = TOURNEY.groups[0];
        var first  = [...g].sort(cmpTeam).map(function(t){ return t.id; }).join(',');
        var second = [...g].sort(cmpTeam).map(function(t){ return t.id; }).join(',');
        return [first, second];
      })()`);
    expect(a).toBe(b);
  });

  it('re-rendering the hub does not reshuffle unchanged standings', () => {
    const { window: w } = loadMonolith();
    startTourney(w);
    const before = w.eval(`groupStandings(0).map(function(t){return t.id;}).join(',')`);
    w.eval('showTourneyHub(); showTourneyHub();');
    const after = w.eval(`groupStandings(0).map(function(t){return t.id;}).join(',')`);
    expect(after).toBe(before);
  });

  it('breaks fully-tied teams by a stable key rather than array index', () => {
    // Every team starts 0/0/0, so at kickoff the entire group is tied on points, stock
    // difference, and stocks scored — the final tiebreak decides the whole order. Falling back
    // to a.id - b.id means low-index teams systematically place higher before a ball is kicked.
    const { window: w } = loadMonolith();
    startTourney(w);
    const ids = w.eval(`groupStandings(0).map(function(t){return t.id;})`);
    const ascending = [...ids].sort((x, y) => x - y);
    expect(ids, 'tied standings are in raw id order — index bias').not.toEqual(ascending);
  });
});

describe('Unit 7 — team construction', () => {
  it('never puts the same fighter in a team twice', () => {
    const { window: w } = loadMonolith();
    startTourney(w, 2);   // 2v2 — the only setting where a within-team duplicate is possible
    const dupes = w.eval(`
      (function(){
        return TOURNEY.teams.filter(function(t){
          var names = t.members.map(function(m){ return m.name; });
          return new Set(names).size !== names.length;
        }).length;
      })()`);
    expect(dupes).toBe(0);
  });

  it('still runs a full 48-team tournament without error', () => {
    const { window: w } = loadMonolith();
    startTourney(w);
    expect(() => w.eval(`
      var guard = 0;
      while (TOURNEY.stage !== 'done' && guard++ < 50) {
        for (var i=0;i<TOURNEY.fixtures.length;i++) {
          var fx = TOURNEY.fixtures[i];
          if (!fx.played) { fx.kind === 'group' ? simGroupMatch(fx) : simKnockoutMatch(fx); }
        }
        proceedAfterRound();
      }
    `)).not.toThrow();
    expect(w.eval('TOURNEY.champion && TOURNEY.champion.name')).toBeTruthy();
  });
});
