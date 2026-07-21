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
| Sequencing | **Monolith wins first, then refactor.** See §2.1 — the cost is real but bounded, *not* zero as an earlier draft claimed |
| Scope | Tier 0 strip → **C** tournament → **A** progression → **B** share → deploy |
| Unlock model | **Hybrid** — fast drip cadence + ~8–10 hand-authored trophies |
| Unlock escape hatch | **"Show everything" settings toggle** |
| API key | **Remove entirely**; scripted AI teammate becomes the only path |
| Share format | Highlight **GIF** via a vendored MIT encoder |
| Host | **Vercel**, static from `artifacts/V1` (`vercel.json` committed on `main`) |
| Deploy timing | **After** the Tier 0 strip — the box is never public |
| Repo | `github.com/ck314/smash-island`, public, `main` default |

**Out of scope:** touch/mobile controls, balance passes, any Plan A–D work, in-game accounts, chat, matchmaking.

### 2.1 The real cost of sequencing before the refactor

An earlier draft claimed extraction is "mechanical line-moving" so this work is carried through Plan A "at no extra cost, only re-running `scripts/record-monolith.mjs`." **That is false and must not be used to justify the sequence.** Verified against `docs/superpowers/plans/2026-07-17-bfsi-modularization.md`:

- **Plan A tasks are keyed to monolith line ranges**, not symbols (e.g. Task 27: *"Monolith ranges `1274-1294, 1863-2004`"*). Every insertion or deletion shifts them.
- **Task 27 is materially invalidated.** It extracts `coop-planning.js` with instructions to keep `PLAN_KEY` module-local and *"`planLLM` hits `api.anthropic.com` — keep behavior but it must be inside `planSend`"*, and its commit message encodes that. Workstream 0 deletes `PLAN_KEY`, `planLLM`, `syncTeamKey`, `saveHomeKey`, `clearHomeKey`, and `planSetKey`.
- **The Electron CSP** (plan line 193) whitelists `https://api.anthropic.com` in `connect-src` — no longer needed.
- **Task 4 already deletes the Google Fonts `@import`** (plan line 824). Workstream 0 duplicates it.
- The decomposition map describes a **5,861-line** monolith; the file is **6,513** lines today, so this drift has already occurred once independently.

**Honest accounting:** most of this is *simplification* — Task 27 shrinks, the CSP entry disappears, Task 4's font work is pre-done. The genuine new cost is a re-derivation pass over Plan A's line ranges plus map entries for new symbols (`fighterRating`, the profile record, `isUnlocked`, any vendored encoder). That is real work, and the sequencing decision should be made against it rather than against a claim of zero.

---

## 3. Workstream 0 — Strip the credential surface (deploy blocker)

**Goal:** no API-key surface anywhere, with zero functional loss.

**Delete — the complete surface.** An earlier draft of this list was incomplete in a way that would have shipped the defect: several credential-request surfaces contain none of the grep-gate tokens, so the gate went green while a `🔑 API key` button was still on screen.

| Line(s) | What |
|---|---|
| `:229-233` | `.apikeybox` styles |
| `:310-318` | Title-screen `.apikeybox` markup (**full block** — `:310-316` truncates it) |
| `:317` | `#homeKeyNote` ("Your key stays in memory only…") |
| `:499-501` | `#teamKeyPrompt` — **"⚠ Team chat needs a Claude API key to start"** |
| `:503` | `Claude API key` planrow label |
| `:504` | `teamApiKey` input |
| `:536` | `planKeyBtn` — **`<button …>🔑 API key</button>`** |
| `:543` | `planKeyNote` ("Add a Claude API key for real conversation.") |
| `:1264-1267`, `:1863-1884`, `:1931`, `:1959-1960`, `:1978` | `PLAN_KEY` and all reads |
| — | `syncTeamKey()`, **`saveHomeKey()`** (not `setHomeKey()` — that name does not exist), `clearHomeKey()`, `planSetKey()`, `planLLM()` (`:1997-2004`) |
| `:1871` | The misleading "A key is required…" string |

Deleting `planSetKey()` without deleting `planKeyBtn` (`:536`) leaves a live button whose handler throws — verify no `on*=` attribute references a removed global.

**Preserve:** `planScriptedReply()` (`:1988`) and `captureTeamPlan()`. The branch at `:1978` collapses to its existing `else`, so scripted teammate replies become unconditional.

**Also:** replace the remote `@import` of Google Fonts (`:8`) with self-hosted or system-stack fonts, removing the only third-party request — a common school-filter trip and a privacy improvement for a kids' site.

**Done when:** no `sk-ant`, `api.anthropic.com`, `PLAN_KEY`, or `fonts.googleapis.com` remains in the file; a teams match starts and shows scripted teammate dialogue; no console errors.

---

## 4. Workstream C — Deterministic tournament strength

**Goal:** a good fighter genuinely wins more often, without slowing the tournament or eliminating upsets.

`teamStrength()` (`:1473`) is called only from `simGroupMatch()` (`:1460`) and `simKnockoutMatch()` (`:1516`) — both **unwatched simulations**. Playable matches already use real physics, so this workstream cannot affect hands-on gameplay.

> **🔴 BLOCKING — the original design was inverted. Do not implement until resolved.**
>
> An earlier draft derived the rating from `RANGE_PROFILE[r.kit.special]` (`:3605`), calling it "a curated, balance-tuned table." It *is* balance-tuned — and that is exactly the problem. It is a **compensation** table: its values were adjusted to *flatten* win rates, so high stats mark historically **weak** fighters. Verified in the table's own comments:
>
> | Entry | Stat | Comment |
> |---|---|---|
> | `debuff` (Golf Ball) | `dmg:5` — lowest band | `92% real 1v1 -> trimmed again` |
> | `zap` (Lightning) | `dmg:5` | `trimmed: too strong` |
> | `bomb` (Bomby) | `dmg:7` | `90% real 1v1 -> trimmed` |
> | `fluff` (Pillow) | `dmg:8` — high band | `15% real 1v1 — buffed` |
> | `barf` (Barf Bag) | `dmg:8` | `buffed: was bottom` |
>
> A rating built from `reach`/`dmg`/`kb` would rank the roster **roughly backwards**, making the World Cup systematically favor the weakest fighters — the precise inverse of this workstream's goal, and the §8 criterion-3 gate (which only checks upset *spread*) would not catch it.
>
> **Rating source is therefore an open decision** (see handoff). The obvious candidate the original draft never considered: `balance:tallies` in `BStore` already persists real per-fighter `{games, wins, kos, falls, dmgDealt}` from actual play (`:4756`) — the measured signal, not the compensation for it. Whatever source is chosen, acceptance must validate the **sign** of the correlation against measured win rates, not just the spread.

**Design (pending the rating-source decision):** a new `fighterRating(r)` returns a deterministic scalar; fighters with no data fall through to `1.0`. `teamStrength(t)` sums member ratings and contains **no `Math.random()`**.

**Retain the `let s=1` baseline.** Today's `teamStrength` starts at `1` and adds `0.5–1.0` per member. That baseline is the dominant equalizing term — at team size 1 it compresses win probability to roughly 0.43–0.57. Dropping it silently multiplies effective spread and makes the target band in the next paragraph unreachable.

**Why determinism is safe:** both callers already supply variance through five strength-weighted rolls. Removing RNG from the *rating* while leaving it in the *rolls* is what makes a stronger team win more often while keeping upsets routine.

**Tuning is a requirement, not a detail.** Rating spread is the knob that decides whether the tournament feels earned or predetermined. It must be validated statistically — run ≥10,000 simulated fixtures and confirm the upset rate for a mid-vs-mid pairing lands in a target band (**~30–45%**), with a strong-vs-weak pairing meaningfully lower but never near zero. Eyeballing a single bracket is not acceptance.

**Done when:** the spread check passes; a 48-team World Cup completes without errors; the champion distribution is visibly non-uniform across repeated runs.

---

## 5. Workstream A — The return loop

**Goal:** a reason to come back tomorrow and something to brag about, built from content that already exists.

**Storage.** A `profile:v1` record in the existing `BStore` (`:4708`). Existing key namespaces are `balance:*` and `levels:*`, so `profile:*` does not collide.

**⚠️ `recordMatch()` alone is not a sufficient hook.** Its single call site (`:4681`) sits *after* a tournament early-return, so **no World Cup match ever reaches it** — `matches`/`wins` would undercount, and three of the seven profile fields have no source there at all. Additional hooks are required:

| Field | Source |
|---|---|
| `matches`, `wins`, `kos` | `recordMatch()` (`:4681`) — **plus** a tournament path that bypasses the early return |
| `wcTitles` | `TOURNEY.champion = winners[0]` (`:1526`) |
| `bestRushLoop` | `BOSSRUSH.loop++` (`:1827`) |
| `bossesCleared` | Boss-defeat path in Boss Rush |

**⚠️ Unlock state must be a new field, never `r.play`.** The `locked` class is emitted by `c.className='cell '+(r.play?'play':'locked')` (`:1052`), so "reuse the locked path" reads as "set `play:false`" — but `r.play` also gates the default fighter (`:851`), the tutorial pick (`:1325`), the **tournament pool** (`:1405`), and the CPU/netplay pools (`:2244`, `:2264`). Setting it false would silently shrink the World Cup roster and corrupt Workstream C's tuning. `r.play` stays `true` for all 59; unlock state is `profile.unlocked` membership, read only by `buildBoard()`.

**⚠️ `BStore` is async; `buildBoard()` is not.** `BStore.get` returns a Promise, while `buildBoard()` is synchronous and re-entrant (called from `c.onclick`). `isUnlocked(r)` cannot consult storage at render time — the profile must be hydrated into an in-memory object during boot, **before the first `buildBoard()`**, with a defined pre-hydration render state. Note also that `BStore.available()` (`:4728`) is the one accessor with no `try/catch`; any new call must be wrapped.

**⚠️ Existing installs must be grandfathered.** A returning player has no `profile:v1` and is otherwise indistinguishable from a new one — they would drop from 59 available fighters to 8, directly violating §8 criterion 6. On first run with no profile, check for pre-existing `balance:matchlog` / `balance:tallies`; if either shows prior play, seed `unlocked` with the full roster.

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
- **Grep gate** for Workstream 0 — case-insensitive absence of `sk-ant`, `anthropic`, `api[ -]?key`, `apikey`, `planKey`, `planSetKey`, `PLAN_KEY`, `fonts.googleapis.com`. The original four-token gate was insufficient: none of them appear in the `🔑 API key` button, the `#teamKeyPrompt` warning, or the two key-note strings. Plus a boot assertion that no inline `on*=` handler references a missing global.

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
