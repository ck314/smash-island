import { describe, it, expect } from 'vitest';
import { loadMonolith } from './helpers/load-monolith.js';

// Two defects logged during review and fixed here.
//
// 1. The Team Strategy & Chat panel was gated on `!window.NET`. window.NET is assigned
//    unconditionally at module scope, so that expression is ALWAYS false: the panel never
//    rendered and captureTeamPlan() never ran, leaving TEAM_PLAN empty and the AI on defaults.
//
// 2. applySnapshot replaces the fighters array wholesale with peer-supplied objects, keeping
//    `name` and `color` verbatim. buildHUD, updateStandings and renderScorecard interpolate both
//    into innerHTML. Inert today only because clients skip step(), so the HUD never refreshes on
//    the receiving side — one refactor away from a peer message executing script.

const XSS = '<img src=x onerror="window.__pwned=1">';

describe('team planning is reachable', () => {
  it('is not gated on a condition that can never be true', () => {
    const { window: w } = loadMonolith();
    expect(w.eval('NET.role')).toBe('solo');
    expect(w.eval('inNetSession()')).toBe(false);
    w.eval('NET.role="host"');
    expect(w.eval('inNetSession()')).toBe(true);
  });

  it('shows the panel and captures a plan in a local teams match', () => {
    const { window: w } = loadMonolith();
    w.eval('SETTINGS.mode="teams"; go("select"); syncModeUI();');
    expect(w.document.getElementById('teamChatPanel').style.display).not.toBe('none');
    w.eval('SETTINGS.count=4; startMatch();');
    expect(w.eval('Object.keys(TEAM_PLAN).length')).toBeGreaterThan(0);
  });

  it('still suppresses the local planner during a network match', () => {
    const { window: w } = loadMonolith();
    w.eval('NET.role="client"; SETTINGS.mode="teams"; go("select"); syncModeUI();');
    expect(w.document.getElementById('teamChatPanel').style.display).toBe('none');
  });
});

describe('peer-supplied fighter fields cannot inject markup', () => {
  const inject = (w) => w.eval(`
    applySnapshot({ fighters:[{ name:${JSON.stringify(XSS)}, color:'red" onload="window.__pwned=1',
                                stocks:3, pct:0, x:0, y:0, team:0 }],
                    stage:0, hazardT:0, floors:[], worldPlats:[], bases:[],
                    projectiles:[], beams:[], particles:[] })`);

  it('updateStandings escapes a hostile name', () => {
    const { window: w } = loadMonolith();
    inject(w);
    w.eval('updateStandings()');
    const host = w.document.getElementById('standings');
    expect(host.querySelector('img'), 'markup from a peer name was parsed as HTML').toBeNull();
    expect(host.textContent).toContain('<img');   // rendered as visible text, not an element
    expect(w.eval('window.__pwned')).toBeUndefined();
  });

  it('buildHUD escapes a hostile name', () => {
    const { window: w } = loadMonolith();
    inject(w);
    w.eval('buildHUD()');
    expect(w.document.getElementById('hud').querySelector('img')).toBeNull();
    expect(w.eval('window.__pwned')).toBeUndefined();
  });

  it('renderScorecard escapes a hostile name', () => {
    const { window: w } = loadMonolith();
    inject(w);
    w.eval('renderScorecard()');
    expect(w.document.getElementById('scorecard').querySelector('img')).toBeNull();
    expect(w.eval('window.__pwned')).toBeUndefined();
  });

  it('rejects a color that tries to escape its attribute', () => {
    const { window: w } = loadMonolith();
    expect(w.eval(`safeColor('red" onload="alert(1)')`)).not.toContain('onload');
    expect(w.eval(`safeColor('#e0503a')`)).toBe('#e0503a');
    expect(w.eval(`safeColor('rgb(1, 2, 3)')`)).toBe('rgb(1, 2, 3)');
  });

  it('leaves ordinary names untouched', () => {
    const { window: w } = loadMonolith();
    expect(w.eval(`esc('Firey Jr.')`)).toBe('Firey Jr.');
  });
});
