---
module: roster-data
date: 2026-07-21
problem_type: best_practice
component: testing_framework
severity: medium
related_components:
  - development_workflow
applies_when:
  - A curated list references another collection by string name
  - Consuming code uses filter/find rather than a validating lookup
  - Deriving new sets (partitions, orderings, tiers) from an existing collection
tags:
  - referential-integrity
  - invariants
  - silent-failure
  - test-design
  - derived-sets
---

# Completeness invariants catch silent referential errors that no targeted test will

## Context

Battle for Smash Island shipped a curated starter list:

```js
const STARTERS = ["Firey","Leafy","Bubble","Pencil","Blocky","Ice Cube","Match","Four"];
```

Eight names, consumed by the roster board as `ROSTER.filter(r => STARTERS.includes(r.name))`.

**"Four" is not a playable fighter.** Four is the final boss, defined in a completely different collection (`BOSS_ROSTER`). The filter matched seven entries and silently returned them. The "8 starters" board had been rendering **7 cells** for the entire life of the project — through a 5-persona adversarial review that specifically praised the starter roster as a shipped fix, through a public deploy, and through my own visual inspection of that exact screen in a browser.

Nothing errored. Nothing logged. The UI looked plausible, because seven cells in an 11-column grid looks exactly as intentional as eight.

It was caught by a test I wrote for an unrelated reason.

## Guidance

**When you derive a set from a collection, assert that the derivation is complete and non-overlapping — not just that individual members behave.**

The test that found this was checking something else entirely: that a newly-built unlock ordering partitioned the roster correctly.

```js
it('the drip order plus starters covers the whole roster exactly once', () => {
  expect(new Set(UNLOCK_ORDER.concat(STARTERS)).size).toBe(ROSTER.length);
});
// => expected 60 to be 59
```

`UNLOCK_ORDER` was `ROSTER` minus `STARTERS` (51 entries). 51 + 8 = 59 *only if every starter is in the roster*. One wasn't, so the union had 60 distinct names and the invariant failed. The assertion never mentioned "Four", never mentioned bosses, and was not written to find a bug.

That is the property worth copying: a completeness invariant is sensitive to errors **nobody thought to look for**, because it constrains the whole set rather than sampling it.

Useful invariants over derived sets:

| Invariant | Catches |
|---|---|
| `derived ∪ complement` has exactly `source.length` distinct members | Names that resolve to nothing; duplicates |
| `derived ∩ complement` is empty | An item claimed by two categories |
| every member of the curated list resolves in the source | Typos, category errors, stale entries |

**The deeper rule: `filter`/`includes` degrade silently; a validating lookup does not.** `ROSTER.filter(r => STARTERS.includes(r.name))` cannot distinguish "this starter doesn't exist" from "there are no starters". If a curated list is a *reference* to another collection, resolve it in that direction and fail loudly:

```js
// Silent — a bad name simply produces one fewer cell
const list = ROSTER.filter(r => STARTERS.includes(r.name));

// Loud — a bad name is a bug, and says so
const list = STARTERS.map(n => {
  const r = ROSTER.find(x => x.name === n);
  if (!r) throw new Error(`STARTERS references unknown fighter: ${n}`);
  return r;
});
```

## Why This Matters

The failure mode is specifically *invisible to inspection*. Reviewers, screenshots, and manual QA all confirmed "the starter board works" — and it did work, just with one fewer fighter than intended. There is no observable symptom to notice, because the missing element leaves no gap.

Cost here was small (one absent starter). The same shape is not always small: a permissions list naming a role that no longer exists, a feature-flag list referencing a removed flag, a required-fields array with a renamed field — each silently narrows behavior while every targeted test still passes.

It also propagates. The bad name was about to be copied into a new derived structure (the unlock ordering) and a trophy map, where it would have become an unlockable that could never be unlocked.

## When to Apply

Add a completeness invariant when:

- A hand-maintained list references another collection **by string** — the join has no compile-time or runtime check
- You are **partitioning** a collection (starters/unlockables, free/premium, active/archived) — assert the partition covers and doesn't overlap
- A derived set feeds further derived sets — errors compound silently down the chain

Skip it when the collection is generated from the source it references, since the join is structural and cannot drift.

## Examples

The bug, and what made it findable:

```
STARTERS       = 8 names          (hand-maintained)
ROSTER         = 59 fighters
BOSS_ROSTER    = 9 bosses         ← "Four" actually lives here

ROSTER.filter(r => STARTERS.includes(r.name))   → 7 cells, no error
new Set(UNLOCK_ORDER.concat(STARTERS)).size     → 60 ≠ 59   ← caught it
```

The fix substituted a real, selectable fighter and recorded why, so the next reader doesn't reintroduce it:

```js
// "Four" used to be listed here, but Four is the FINAL BOSS (BOSS_ROSTER), not a playable
// fighter — so buildBoard's ROSTER filter silently dropped him and the "8 starters" board has
// always rendered 7 cells. Swapped for Pen, who is both recognisable and actually selectable.
const STARTERS = ["Firey","Leafy","Bubble","Pencil","Blocky","Ice Cube","Match","Pen"];
```

A related near-miss from the same session, worth the same reflex: `startTournament(teamSize, mode)` takes **team size** as its first argument, but the codebase talks constantly about "48 teams". Passing `48` produced 48-member teams and a spectacular false-positive bug report. Positional parameters whose name collides with an ambient magic number in the same domain will be misread — assert on a named constant, or check the shape of what you built before concluding the code is broken.

## References

- `test/progression-hooks.test.js` — the invariant that caught it
- `artifacts/V1/index.html` — `STARTERS`, `UNLOCK_ORDER`, `TROPHIES`
- [[verification-that-measures-the-wrong-thing-2026-07-21]] — same session; a check that ran green while measuring the wrong thing
