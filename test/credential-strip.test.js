import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadMonolith } from './helpers/load-monolith.js';

// Workstream 0 (Unit 2) — the deploy blocker.
//
// The monolith shipped a title-screen `sk-ant-...` password field feeding planLLM(), a call that
// omits x-api-key, anthropic-version, and the browser-access header and therefore could never
// succeed. On a public, child-facing URL that reads as phishing.
//
// The FIRST version of this gate checked only four tokens (sk-ant, api.anthropic.com, PLAN_KEY,
// fonts.googleapis.com) and passed while a `🔑 API key` button, a "Team chat needs a Claude API
// key to start" warning, and two key-note strings were still rendered — none of them contain any
// of those four tokens. That near-miss is why this gate is token-broad AND checks handler
// integrity: deleting planSetKey() without deleting the button that calls it leaves a live
// control that throws on click, which no text search would catch.

// Scope the gate to the DEPLOY UNIT, never to one filename. Vercel serves every file under
// outputDirectory, so a stray sibling is publicly reachable at its own URL. An earlier version of
// this gate pinned 'artifacts/V1/index.html' and passed green while artifacts/V1 also contained
// battle-for-smash-island.html — a second, un-stripped copy of the whole game carrying the live
// sk-ant field. Same class of miss as the four-token version, one level up: the check was
// narrower than the thing it guards.
const PUBLISH_ROOT = JSON.parse(readFileSync('vercel.json', 'utf8')).outputDirectory;
const PUBLISHED_FILES = readdirSync(PUBLISH_ROOT).map((f) => join(PUBLISH_ROOT, f));
const PUBLISHED_HTML = PUBLISHED_FILES.filter((f) => f.endsWith('.html'));
const SOURCE = join(PUBLISH_ROOT, 'index.html');

/** Tokens that must not survive anywhere in the shipped file. */
const FORBIDDEN = [
  { name: 'Anthropic key prefix', re: /sk-ant/i },
  { name: 'Anthropic vendor reference', re: /anthropic/i },
  { name: 'API-key phrasing', re: /api[ _-]?key/i },
  { name: 'PLAN_KEY state', re: /PLAN_KEY/ },
  { name: 'planSetKey handler', re: /planSetKey/ },
  { name: 'planKey DOM ids', re: /planKey(Btn|Note)/ },
  { name: 'homeKeyNote DOM id', re: /homeKeyNote/ },
  { name: 'key-surface CSS classes', re: /apikeybox|teamkeyrow|apikey-/ },
  { name: 'remote font import', re: /fonts\.googleapis\.com/i },
];

describe('Workstream 0 — credential surface is fully stripped', () => {
  it('publishes only the files we intend to serve', () => {
    // Anything dropped into the publish root becomes a public URL. Pin the contents so a stray
    // build artifact fails the suite instead of silently shipping.
    expect(PUBLISHED_FILES.map((f) => f.replace(/\\/g, '/'))).toEqual([`${PUBLISH_ROOT}/index.html`]);
  });

  it.each(PUBLISHED_HTML)('%s contains none of the forbidden credential tokens', (file) => {
    const src = readFileSync(file, 'utf8');
    const found = FORBIDDEN
      .filter(({ re }) => re.test(src))
      .map(({ name, re }) => {
        // Report the first offending line so a failure is actionable, not just "something matched".
        const line = src.split('\n').findIndex((l) => re.test(l)) + 1;
        return `${name} (${re}) at line ${line}`;
      });
    expect(found, `forbidden credential tokens still present:\n  ${found.join('\n  ')}`).toEqual([]);
  });

  it.each(PUBLISHED_HTML)('%s makes no network reference to a third-party host', (file) => {
    const src = readFileSync(file, 'utf8');
    const externals = [...src.matchAll(/https?:\/\/([^/"'\s)]+)/g)]
      .map((m) => m[1])
      .filter((host) => !/^(localhost|127\.0\.0\.1)/.test(host));
    expect([...new Set(externals)]).toEqual([]);
  });
});

// Reserved words and literals that the leading-identifier regex can still pick up.
const KEYWORDS = new Set(['if', 'else', 'return', 'var', 'let', 'const', 'new', 'typeof', 'this',
  'true', 'false', 'null', 'undefined', 'function', 'void', 'delete', 'in', 'of', 'do', 'while']);

const ON_ATTRS = ['onclick', 'onchange', 'oninput', 'onkeydown', 'onkeyup', 'onmousedown',
  'onmouseup', 'onsubmit'];

// Leading identifiers only — the head of a member expression, never a property after a dot.
// src/core/handler-coverage.js's collector deliberately matches `X(` and `X.` including members,
// so it reports NET.host() as "host"; that is too broad to assert reachability against.
function leadingIdentifiers(doc) {
  const ids = new Set();
  for (const el of doc.querySelectorAll(ON_ATTRS.map((a) => `[${a}]`).join(','))) {
    for (const a of ON_ATTRS) {
      const src = el.getAttribute(a);
      if (!src) continue;
      for (const m of src.matchAll(/(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*[(.]/g)) {
        if (!KEYWORDS.has(m[1])) ids.add(m[1]);
      }
    }
  }
  return [...ids];
}

describe('Workstream 0 — no handler is orphaned by the strip', () => {
  it('every inline on*= identifier resolves in the page realm', () => {
    const { window: w } = loadMonolith();
    const ids = leadingIdentifiers(w.document);
    // Sanity floor, not an exact count: guards against the collector silently matching nothing
    // (a regex break would otherwise make this suite vacuously green). The strip removed four
    // inline handlers — saveHomeKey, clearHomeKey, syncTeamKey, planSetKey — so the real figure
    // sits just under 30 and will drift again as Units 10-11 add controls.
    expect(ids.length).toBeGreaterThan(20);
    // Resolve in the monolith's OWN realm, not via window[id]: top-level `let`/`const` (TESTMODE,
    // SETTINGS, …) live in the global lexical environment and are reachable by an inline handler
    // in a real browser while never appearing as window properties.
    const missing = ids.filter((id) => w.eval(`typeof ${id}`) === 'undefined');
    expect(missing, `inline handlers reference unreachable identifiers: ${missing.join(', ')}`).toEqual([]);
  });

  it('retains the scripted teammate planner that replaces the removed LLM path', () => {
    const { window: w } = loadMonolith();
    expect(typeof w.planScriptedReply).toBe('function');
    expect(typeof w.captureTeamPlan).toBe('function');
    // planLLM was the dead credential consumer; it must be gone.
    expect(typeof w.planLLM).toBe('undefined');
  });
});
