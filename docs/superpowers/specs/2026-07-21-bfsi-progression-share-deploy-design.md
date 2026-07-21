# Battle for Smash Island — Progression, Share Loop & Public Deploy

**Date:** 2026-07-21
**Status:** Design (awaiting review)
**Target file:** `artifacts/V1/index.html` (the monolith), pre-refactor
**Relationship to Plan A–D:** This work lands *before* Plan A extraction and is carried through it for free.

---

## 1. Problem

`artifacts/_adversarial_review.txt` audited build **v66** and ranked seven failures against the goal *"100 middle schoolers playing, competing, and telling their friends."* That review is now **stale** — its top three items shipped. This document covers what is actually still open, plus a deploy-blocking defect the review did not catch.

### 1.1 Verified current state

Every claim below was checked against `artifacts/V1/index.html`, not inferred from the review.

| Review item | Verified state |
|---|---|
| #1 Local 2-player | ✅ **Done.** `DEFAULT_KEYS_P2` / `LOCAL_PLAYERS` (`:842-846`), per-player controller routing (`:3095-3097`) |
| #2 Tutorial | ✅ **Done.** `startTutorial()` (`:1319`), `TUT` state |
| #3 Starter roster | ✅ **Done.** `STARTERS` (8 fighters, `:1045`), `SHOW_ALL_CHARS` toggle (`:1049`) |
| #7 Footer understates product | ✅ **Done.** Toggle reads a live count: `All ${ROSTER.filter(r=>r.play).length} fighters` |
| #5 Tournament is RNG | ❌ **Open.** `teamStrength()` is `s += 0.5 + Math.random()*0.5` (`:1473`) — ignores the fighter entirely |
| #3 Progression / persistence | ❌ **Open.** `BStore` (`:4708`) stores only `balance:*` telemetry and `levels:custom`. No player record, no unlocks |
| #4 Share loop | ❌ **Open.** Recorder exports `bfsi-match.webm` to the downloads folder (`:1774`) |
| #6 Mobile / touch | ❌ **Open.** Only `touchstart` use is the audio unlock (`:1008`). **Out of scope here.** |

### 1.2 The deploy-blocking defect (not in the review)

`artifacts/V1/index.html:310-316` renders a `sk-ant-...` password field **on the title screen**. It feeds `PLAN_KEY`, consumed by `planLLM()` (`:1997`):

```js
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json" },   // ← the entire header set
  body: JSON.stringify({ model: "claude-sonnet-4-6", ... }) });
```

**This call cannot succeed.** There is no `x-api-key`, no `anthropic-version`, and no `anthropic-dangerous-direct-browser-access`; CORS blocks the request regardless; and `claude-sonnet-4-6` is not a real model id. The key is collected and never sent.

Compounding it, `:1871` renders **`"A key is required to start a teams match."`** — which contradicts the code's own comment at `:1261` (*"No key required to play teams"*) and the actual control flow, which calls `captureTeamPlan()` unconditionally.

**Net effect:** the game asks children to paste a live API credential to unlock a mode that isn't locked, for a feature that has never worked. On a local file this is dead code. On a public URL it is indistinguishable from phishing — precisely the outcome reviewer "Tom" predicted (*"I don't care what it does. I'm blocking the domain."*).

No secret is hardcoded anywhere; the exposure is reputational and trust-related, not a credential leak.

---

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Goal | **Both, re-sequenced** — keep the modular architecture, but land player-facing value and a public URL far earlier than Plan C |
| Sequencing | **Monolith wins first, then refactor.** Extraction is mechanical line-moving, so features added now are carried through Plan A at no extra cost. Only cost is re-running `scripts/record-monolith.mjs` |
| Scope | Tier 0 strip → **C** tournament → **A** progression → **B** share → deploy |
| Unlock model | **Hybrid** — fast drip cadence + ~8–10 hand-authored trophies |
| Unlock escape hatch | **"Show everything" settings toggle** |
| API key | **Remove entirely**; scripted AI teammate becomes the only path |
| Share format | Highlight **GIF** via a vendored MIT encoder |
| Host | **Vercel**, static from `artifacts/V1` (`vercel.json` committed on `main`) |
| Deploy timing | **After** the Tier 0 strip — the box is never public |
| Repo | `github.com/ck314/smash-island`, public, `main` default |

**Out of scope:** touch/mobile controls, balance passes, any Plan A–D work, in-game accounts, chat, matchmaking.

---

## 3. Workstream 0 — Strip the credential surface (deploy blocker)

**Goal:** no API-key surface anywhere, with zero functional loss.

**Delete:** the `.apikeybox` styles (`:229-233`) and markup (`:310-316`); the `teamApiKey` input (`:504`); `PLAN_KEY` and all reads (`:1264-1267`, `:1863-1880`, `:1931`, `:1959-1960`, `:1978`); `syncTeamKey()`, `setHomeKey()`, `clearHomeKey()`; `planLLM()` (`:1997-2004`); the `prompt()` key request (`:1959`); and the misleading string at `:1871`.

**Preserve:** `planScriptedReply()` (`:1988`) and `captureTeamPlan()`. The branch at `:1978` collapses to its existing `else`, so scripted teammate replies become unconditional.

**Also:** replace the remote `@import` of Google Fonts (`:8`) with self-hosted or system-stack fonts, removing the only third-party request — a common school-filter trip and a privacy improvement for a kids' site.

**Done when:** no `sk-ant`, `api.anthropic.com`, `PLAN_KEY`, or `fonts.googleapis.com` remains in the file; a teams match starts and shows scripted teammate dialogue; no console errors.

---

## 4. Workstream C — Deterministic tournament strength

**Goal:** a good fighter genuinely wins more often, without slowing the tournament or eliminating upsets.

`teamStrength()` (`:1473`) is called only from `simGroupMatch()` (`:1460`) and `simKnockoutMatch()` (`:1516`) — both **unwatched simulations**. Playable matches already use real physics, so this workstream cannot affect hands-on gameplay.

**Design:** a new `fighterRating(r)` derives a scalar from `RANGE_PROFILE[r.kit.special]` (`:3605` — a curated, balance-tuned table of `reach`/`dmg`/`kb`, with comments citing measured 1v1 results) plus weight `r.w`. Fighters with no profile entry fall through the existing default (`:3675`) and rate `1.0`. `teamStrength(t)` becomes the sum of member ratings, containing **no `Math.random()`**.

**Why determinism is safe:** both callers already supply variance through five strength-weighted rolls. Removing RNG from the *rating* while leaving it in the *rolls* is what makes a stronger team win more often while keeping upsets routine.

**Tuning is a requirement, not a detail.** Rating spread is the knob that decides whether the tournament feels earned or predetermined. It must be validated statistically — run ≥10,000 simulated fixtures and confirm the upset rate for a mid-vs-mid pairing lands in a target band (**~30–45%**), with a strong-vs-weak pairing meaningfully lower but never near zero. Eyeballing a single bracket is not acceptance.

**Done when:** the spread check passes; a 48-team World Cup completes without errors; the champion distribution is visibly non-uniform across repeated runs.

---

## 5. Workstream A — The return loop

**Goal:** a reason to come back tomorrow and something to brag about, built from content that already exists.

**Storage.** A `profile:v1` record in the existing `BStore` (`:4708`), written from the existing `recordMatch()` call site (`:4735`) which already computes per-fighter results. Existing key namespaces are `balance:*` and `levels:*`, so `profile:*` does not collide.

```
profile:v1 = { matches, wins, kos, bossesCleared:{}, bestRushLoop, wcTitles, unlocked:[] }
```

**Unlock model — hybrid.** A fixed reveal order on a **fast early cadence** (the first few unlocks must land inside the first session), plus ~8–10 hand-authored trophies tied to real deeds: clear a specific boss, win a World Cup, reach Boss Rush loop 2. This gets memorable unlock moments without authoring 51 separate criteria.

**Presentation.** `buildBoard()` (`:1049`) gains an `isUnlocked(r)` check that reuses the **already-present but currently dead** `locked` class (`:1053`) — no entry has `play:false` today, so the rendering path exists and is unused. A locked cell must show *how* to earn the fighter; it teaches rather than refuses. Newly-earned unlocks are announced on the result screen — that announcement is the actual return hook.

**Guardrails — this is the only non-additive workstream.** All 59 fighters are playable today, so unlocks *remove* access that currently exists, and risk re-creating the "wall of unfamiliar names" problem `STARTERS` was built to solve. Two mitigations are mandatory:

1. A **"Show everything" toggle** in settings that unlocks the full roster immediately.
2. Cadence tuned so a new player earns several fighters in their first sitting. **Explicit target:** at least 3 unlocks within the first 5 matches, and the first unlock no later than match 2. These numbers are a starting point to tune against, not a derived result — but planning must implement a specific cadence rather than leaving it open.

**Done when:** a match updates the profile; unlocks persist across reload; locked cells explain their criteria; the toggle restores full access; and a player with an existing install is never worse off than before.

---

## 6. Workstream B — Highlight clip and share

**Goal:** convert the recorder from an artifact into something a 13-year-old actually shares.

The recorder (`:1728-1755`) captures the whole match at 30fps and exports `bfsi-match.webm` (`:1774`). A full-match WebM in a downloads folder is not shareable content; a short highlight is.

**Constraint discovered during design:** `RUN_REC.rec.start(1000)` produces 1-second chunks, but **WebM chunks after the first carry no headers**, so slicing `RUN_REC.chunks` cannot yield a valid clip. The highlight must be produced by seeking the finished `<video>` and redrawing frames to an offscreen canvas.

**Design.** `lastKoFrame` (`:1015`, updated on every KO at `:4607`) already marks the final KO. On the result screen, seek to shortly before it, redraw ~4s at reduced resolution and framerate to an offscreen canvas, and encode with a **vendored MIT GIF encoder (~8KB)**. Auto-name from match context: `bfsi-Leafy-4KO.gif`.

The single `Save Clip` action becomes three: **Save GIF · Share · Copy link**. `Share` uses `navigator.share()` with the file where supported. `Copy link` points at the deployed URL from §7 — which is why deploy is part of this scope rather than a follow-up.

**This is the highest-risk workstream.** Seeking a `MediaRecorder`-produced WebM to an exact timestamp is unreliable across browsers. A fallback must be designed in: if seek accuracy fails, capture a rolling highlight buffer during play instead. B is sequenced last of the four precisely so it can slip without blocking anything else.

**Done when:** a finished match yields a playable, correctly-named GIF under a sane file size; the flow degrades gracefully where `MediaRecorder`, `navigator.share`, or seeking is unsupported; and no path can break the result screen.

---

## 7. Workstream P — Public deploy

> Named **P**, not D, to avoid collision with **Plan D (Online Rooms)** in `docs/superpowers/plans/2026-07-18-bfsi-online-rooms.md`. They are unrelated.

`artifacts/V1/index.html` is a **self-contained static file with zero build step**, so publishing is a file upload, not Plan C.

`vercel.json` (committed on `main`) sets `framework: null`, `buildCommand: null`, `outputDirectory: "artifacts/V1"`. This is required: `package.json` has a `vite build` script, so Vercel would otherwise auto-detect Vite and serve `dist/` built from the root `index.html` — the empty scaffold whose `src/main.js` is `console.log('BFSI boot placeholder')`. That would deploy a blank page.

**Ordering requirement:** connecting the repo through Vercel's GitHub integration **auto-deploys `main` on connect**. Connection must therefore happen *after* Workstream 0, so the first build Vercel ever runs is already clean. Every later push auto-deploys.

**Migration path:** when Plan C's modular Lite build lands, `outputDirectory` changes to `dist-lite` — one line, same URL.

**Done when:** the URL serves the game; a full match is playable; `localStorage` persists across reloads on the real origin; no console errors; and no API-key surface is present.

---

## 8. Success criteria

1. No credential-collection surface exists anywhere in the shipped file.
2. A stranger can open a URL on a school Chromebook and play, with no install and no account.
3. World Cup outcomes correlate with fighter quality while retaining a measured upset rate in the target band.
4. Progress survives closing the tab, and the roster board gives a visible reason to return.
5. A finished match produces a shareable clip and a link, in two taps.
6. No existing player loses access to anything they can do today.

---

## 9. Verification

- **Golden re-record.** All four workstreams change monolith behavior, invalidating `test/golden/monolith-golden.json`. Re-run `scripts/record-monolith.mjs` **after** the last behavioral change and before resuming Plan A, so extraction diffs against the improved game.
- **Statistical check** for C (§4) — not a spot check.
- **Persistence check** for A: play → reload → state intact; plus a first-run path with no stored profile.
- **Degradation checks** for B across missing `MediaRecorder`, missing `navigator.share`, and unreliable seek.
- **Grep gate** for Workstream 0: `sk-ant`, `api.anthropic.com`, `PLAN_KEY`, `fonts.googleapis.com` all absent.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| **B's WebM seek is unreliable** (highest) | Rolling-buffer fallback; B sequenced last so slippage blocks nothing |
| **Unlocks make the game feel smaller** | "Show everything" toggle + fast early cadence; locked cells teach their criteria |
| **C's rating spread kills upsets** | Statistical tuning gate with an explicit target band |
| **Monolith churn complicates extraction** | All four workstreams are additive or single-function; goldens re-recorded once at the end |
| **Public repo + public URL exposes fan-work IP** | BFDI is jacknjellify's IP. Named here so it is an explicit, revisitable decision rather than an accident |
| **Vercel auto-deploys on connect** | Connect only after Workstream 0 |

---

## 11. What happens after

Re-record goldens, then resume **Plan A** (`docs/superpowers/plans/2026-07-17-bfsi-modularization.md`) with **web as the primary build target** and Electron packaging plus the music engine (Plan B) demoted. Plan C then replaces the deployed static file with the modular Lite build at the same URL.
