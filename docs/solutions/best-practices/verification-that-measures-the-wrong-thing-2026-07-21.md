---
module: verification-gates
date: 2026-07-21
last_updated: 2026-07-21
problem_type: best_practice
component: testing_framework
severity: high
related_components:
  - development_workflow
  - tooling
applies_when:
  - Writing a check that guards a deploy, release, or security boundary
  - Deriving a metric or rating from data someone else tuned
  - Designing an acceptance test for a statistical or measurement result
  - Reviewing a plan whose safety argument rests on a single automated gate
tags:
  - verification
  - false-confidence
  - deploy-safety
  - construct-validity
  - acceptance-criteria
  - measurement
---

# Verification that measures the wrong thing

## Context

In one session on Battle for Smash Island, four separate checks were written, reviewed, and believed correct. All four ran green. **All four measured something other than what they were believed to measure**, and each would have shipped the exact failure it was written to prevent.

They looked unrelated — a security gate, a game-balance rating, a statistical acceptance criterion, a test harness. They are the same mistake.

A check that is absent is a known gap. A check that is present and measures the wrong thing is worse: it manufactures confidence and closes off further inspection. In every instance below, the green result actively suppressed the question that would have found the problem.

## Guidance

**Before trusting a check, ask: what would it do if the thing I fear were true?** If the answer is "pass," the check is decorative. Run that question against the check itself, not the code it guards.

Four specific forms this takes:

### 1. Scope the gate to the deploy unit, never to a sample of it

A grep gate for a credential surface was written with four tokens: `sk-ant`, `api.anthropic.com`, `PLAN_KEY`, `fonts.googleapis.com`. It passed while a `🔑 API key` button, a "Team chat needs a Claude API key to start" warning, and two key-note strings were still rendered on screen — **none of those strings contain any of the four tokens.**

That was caught, the token list was broadened, and the gate was re-run green. Then code review found the same mistake one level up: the gate read a single file, `artifacts/V1/index.html`, while `vercel.json` published the whole `artifacts/V1` **directory** — which also contained `battle-for-smash-island.html`, an older build still carrying the live `sk-ant` password field and the `api.anthropic.com` fetch. It would have deployed to a guessable public URL serving children the exact credential prompt the work existed to remove.

The gate was narrowed twice by the same reflex: checking the thing in front of me rather than the thing that ships.

```js
// Wrong — pins one filename while the deploy publishes a directory
const SOURCE = 'artifacts/V1/index.html';

// Right — derive the scope from the deployment config itself
const PUBLISH_ROOT = JSON.parse(readFileSync('vercel.json', 'utf8')).outputDirectory;
const PUBLISHED_HTML = readdirSync(PUBLISH_ROOT)
  .filter((f) => f.endsWith('.html'))
  .map((f) => join(PUBLISH_ROOT, f));
```

Also pin the publish root's *contents*, so a future stray artifact fails the suite rather than shipping silently:

```js
it('publishes only the files we intend to serve', () => {
  expect(PUBLISHED_FILES).toEqual([`${PUBLISH_ROOT}/index.html`]);
});
```

### 2. A tuned table records the compensation, not the quality

A plan proposed rating fighters from `RANGE_PROFILE`, described in the spec as "a curated, balance-tuned table of reach/dmg/kb, with comments citing measured 1v1 results." That description is accurate and the conclusion drawn from it was backwards.

The table is a **compensation** artifact. Its values were adjusted to *flatten* win rates, so a high stat marks a fighter that was historically **weak**:

| Entry | Stat | The table's own comment |
|---|---|---|
| `debuff` (Golf Ball) | `dmg:5` — lowest band | `92% real 1v1 -> trimmed again` |
| `zap` (Lightning) | `dmg:5` | `trimmed: too strong` |
| `fluff` (Pillow) | `dmg:8` — high band | `15% real 1v1 — buffed` |
| `paste` (Toothpaste) | `dmg:9` | `8% real 1v1 — buffed` |

Deriving strength from reach/dmg/kb would have ranked the roster **roughly backwards** — a tournament systematically favouring the weakest fighters, which is the precise inverse of the stated goal.

The trap is that "balance-tuned" reads as a mark of authority. It is, but of a *different* quantity. Whenever a table has been adjusted by someone optimizing an outcome, it encodes the correction, not the underlying signal — and often anti-correlates with it.

The fallback was no better: the 9 recorded percentages are all **pre-trim** numbers that motivated the nerfs, so adopting them recreates the same inversion one indirection removed.

### 3. A held-out slice tests sampling noise, not construct validity

Having spotted the inversion risk, the next proposal was to generate fresh data via an AI-vs-AI measurement sweep, and to keep the acceptance check honest by **holding out a slice** to correlate against.

That does not work, and the reason generalizes. A held-out slice is drawn from the *same generative process* and therefore shares every systematic bias of that process. Splitting a sample estimates **sampling noise**. It cannot detect **construct error** — the possibility that the whole measurement is of the wrong thing.

Here the construct was shaky in a specific way: the AI is one heuristic policy that buckets all 59 fighters into 7 archetypes and drops 22% of offensive inputs at the default level. A fighter scoring high is one *this policy pilots well*, or one whose counter-kit *this policy mishandles*. Both halves of any split agree on that identically, so the guard could never fire.

To test validity rather than variance you need an **independent channel**: a different measurement regime (two difficulty levels, two stages) with a rank-agreement requirement, or an external anchor set judged by other means.

The same trap sat in the acceptance criterion. It checked the *spread* of upset rates while the failure mode was a *sign flip* — so an inverted rating would have passed:

```
Wrong:  assert upset rate for a comparable pairing is within 30-45%
Right:  assert the rating correlates POSITIVELY with an independent signal,
        THEN assert the spread
```

### 4. A harness can be structurally blind to an entire layer

The golden test harness booted the app with `new JSDOM(html, { … })` and no `url`. That yields an **opaque origin**, where `window.localStorage` is absent. The app's storage wrapper swallows the failure by design ("recording must never break the game"), so nothing crashed — and nothing persisted.

Consequence: the entire persistence layer — the player profile, unlocks, the grandfathering path — was **invisible to every golden test**, and would have been invisible to the later module-parity proof that is supposed to guarantee a refactor changed nothing. The suite was green the whole time. It was green because it could not see.

Worse, the naive fix is also wrong. A test asserting "storage probing does not throw when storage is denied" *passes in a plain jsdom realm without any fix at all*, because `localStorage` there is merely `undefined` and `typeof` shields it. The real browser failure — cookies blocked, where the **getter itself throws** `SecurityError` — is never exercised. The test must install a throwing getter explicitly, or it proves nothing:

```js
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  get() { throw new DOMException('denied', 'SecurityError'); },
});
```

Ask of any harness: *which categories of behavior can this environment not express?* Storage, timers, network, focus, and visibility are the usual answers, and each one silently converts a class of test into a no-op.

## Why This Matters

The cost profile is asymmetric. A missing check leaves a visible gap that review, intuition, or a later reader can still catch. A check that measures the wrong thing **removes** those chances — it answers the question so nobody asks it again, and its green result is cited as evidence in exactly the reviews that would otherwise have found the problem.

In this session the four instances would have produced, respectively: a credential-phishing surface deployed to children at a guessable URL; a flagship tournament mode systematically rewarding the worst fighters; a multi-day compute investment whose output could not be validated at all; and a refactor-safety proof that silently excluded the entire persistence layer.

None were caught by running the checks. The first three were caught by asking what the check would do if the feared thing were true. The fourth was caught only when a reviewer instrumented the harness itself and measured what it could observe — which is the same question aimed one level lower, at the environment rather than the assertion.

## When to Apply

Highest value when:

- **A single automated gate carries a safety argument.** Especially security, privacy, or anything that becomes publicly reachable. Ask what the deploy unit actually is — a directory, a bundle, an image — and scope to that, derived from the deployment config rather than restated by hand.
- **You are about to derive a metric from data you did not produce.** Ask what the data's author was optimizing. If they were correcting an outcome, the values encode the correction.
- **An acceptance criterion is statistical.** Check that it can fail in the direction you actually fear. Spread, variance, and distribution checks routinely miss sign errors and inversions.
- **A verification is "cheap" and was written quickly.** All four instances here were written fast because they seemed obvious. The gate was the deliverable that made the whole workstream trustworthy, and it was the least examined thing in it.

Lower value for checks whose scope is inherently the whole artifact (a full-suite run, a type check), where the narrowing failure cannot occur.

## Examples

The reusable move is a single question, applied to the check rather than the code:

```
Feared thing:  a credential surface reaches the public URL
Check:         grep index.html for 4 tokens
Would it pass if the feared thing were true?  YES — a second file ships,
                                              and button text matches no token
=> the check is decorative; scope it to the deploy unit
```

```
Feared thing:  the rating is inverted
Check:         upset rate falls within 30-45%
Would it pass if the feared thing were true?  YES — spread is unchanged
                                              when the sign flips
=> add a correlation-sign assertion against an independent signal
```

```
Feared thing:  the sweep measures AI-pilot skill, not fighter quality
Check:         correlate against a held-out slice of the same sweep
Would it pass if the feared thing were true?  YES — the slice shares the bias
=> use an independent channel or an external anchor set
```

A useful companion habit, seen working twice in this session: **write the check first and confirm it fails for the right reason.** The credential gate's handler-integrity assertion was written before the strip, and it caught a genuine regression introduced by the strip itself. The LAN characterization test pinned the clean case green *before* the broken case, so the fix was provable rather than asserted. A test that has never failed has never been tested.

## References

- `test/credential-strip.test.js` — the corrected gate, with the near-miss recorded in its header comment
- `test/net-roster-leak.test.js` — characterization-first pattern
- `docs/superpowers/plans/2026-07-21-bfsi-launch-and-progression.md` — Key Technical Decisions records the rating and tiebreak reasoning
- `docs/superpowers/specs/2026-07-21-bfsi-progression-share-deploy-design.md` §4 — the inversion write-up
- PR #1 — the deploy-unit fix
