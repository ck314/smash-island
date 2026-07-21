---
module: deployment
date: 2026-07-21
problem_type: best_practice
component: tooling
severity: high
related_components:
  - development_workflow
  - testing_framework
applies_when:
  - Configuring a hosting platform where an omitted value has defined meaning
  - Shipping initialization that runs once at page load
  - Signing off a release on the basis of a green test suite alone
tags:
  - deployment
  - config-semantics
  - runtime-behaviour
  - live-verification
  - vercel
---

# Some defects only exist in the deployed artifact

## Context

Two bugs from the first public deploy of Battle for Smash Island. Neither was reachable by reading the code, and neither could have been caught by any test in the repository — one required running the real build tool, the other required driving the real site.

Both would have shipped silently. One of them did.

## Guidance

### 1. In config, an omitted value is not the same as a disabled one

The deploy config told Vercel not to build, because the game is a single self-contained HTML file:

```json
{ "framework": null, "buildCommand": null, "installCommand": null, "outputDirectory": "artifacts/V1" }
```

That reads as "no framework, no build, no install." It means the opposite. In Vercel, **`null` means *auto-detect*; the empty string `""` means *skip*.**

The config was harmless right up until the moment a `package.json` containing `"build": "vite build"` landed on the deploy branch. From that commit onward, `null` would have made Vercel detect Vite, run the build, and serve `dist/` — which was an empty scaffold whose entry point was `console.log('boot placeholder')`. A blank page, discovered at the exact moment of the first public deploy.

```json
{ "framework": null, "buildCommand": "", "installCommand": "", "outputDirectory": "artifacts/V1" }
```

The general rule: for any config key, find out what **absent**, **null**, and **empty** each mean. They are frequently three different behaviours, and the intuitive reading ("nothing to do here") is the one most likely to be wrong. Then prove it empirically rather than by reading docs:

```
npx vercel build       # then inspect .vercel/output/static/
```

That single command showed the output directory containing exactly the intended file, with no install step — turning a config assumption into an observation.

### 2. Boot-time initialization does not re-run on same-document navigation

The game supported invite links of the form `…/#room=ABCD`, handled once at the bottom of the script:

```js
autoJoinFromLink();   // reads location.hash, opens the lobby
```

Correct on a cold load. But clicking a link to the *same page with a different fragment* is a **same-document navigation** — the browser updates the URL and fires `hashchange`, and does not re-execute anything. So the flow the product actually promised ("share the link and your friends drop straight in") was broken for the single most likely case: a player already on the site, sent a link by a friend.

There is no error, no console warning, and nothing to see. The URL changes and the page sits there.

```js
window.addEventListener('hashchange', () => { try { autoJoinFromLink(); } catch (e) {} });
```

Generalized: any handler wired only at load — hash routing, deep links, query-parameter state, `postMessage` bootstraps — needs a matching lifecycle event for the case where the page is already open. Ask *"what happens if the user is already here?"* of every boot-time handler.

## Why This Matters

Both defects are invisible to the whole apparatus that normally provides confidence. Unit tests pass, because the code is correct in isolation. Code review passes, because the source reads as intended. Static inspection of the deployed file passes, because the bytes are right.

They live in the seam between the artifact and its environment: what the platform does with a config value, and what the browser does with a navigation. That seam is only observable by running the real thing.

This is worth naming precisely because a green suite is exactly the condition under which people stop looking. The credential-strip work in this same session had 25 passing tests and a verified-clean deployed file — and the invite-link bug was still live in production, found only by loading the site and clicking around.

## When to Apply

Run a live pass, not just a test pass, when:

- **A deploy config changes**, or a file lands that the platform might auto-detect (`package.json`, lockfiles, framework markers). Build locally with the real tool and inspect the output directory.
- **Anything is keyed to page load** — routing, deep links, fragment or query state, storage hydration, focus and visibility handlers.
- **It is the first deploy of anything**, since every environment assumption is untested by definition.

A useful minimum for a first deploy: load the real URL, exercise one full user path end to end, confirm the things that should *not* exist actually 404, and check the network panel for requests you did not intend.

## Examples

One caveat learned the same day: **automation is not the same as a real session.** Driving the live site headlessly, the game loop reported zero frames advanced while `running` was `true` — which looks exactly like a hung game.

```js
document.visibilityState  // "hidden"
requestAnimationFrame(cb) // never fires
```

The automation tab was never foregrounded, and browsers throttle `requestAnimationFrame` in hidden tabs. Not a bug at all. Driving the loop directly proved the logic was fine:

```js
for (let i = 0; i < 600; i++) step();   // 600 real frames, zero errors
```

So the corollary: when live verification reports something alarming, first ask whether the *harness* is the anomaly. Headless and background contexts differ from a real session in timers, focus, visibility, and animation scheduling — the same class of environment seam that produced the two real bugs above.

## References

- `vercel.json` — the empty-string form
- `artifacts/V1/index.html` — `autoJoinFromLink` and its `hashchange` listener
- `test/deploy-hardening.test.js` — regression coverage for the same-document case
- [[verification-that-measures-the-wrong-thing-2026-07-21]] — the companion failure mode: checks that run green while measuring the wrong thing
