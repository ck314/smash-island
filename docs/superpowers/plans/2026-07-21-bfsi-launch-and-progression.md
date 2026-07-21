---
title: "feat: Public launch, tournament hardening, and progression"
type: feat
status: active
date: 2026-07-21
origin: docs/superpowers/specs/2026-07-21-bfsi-progression-share-deploy-design.md
---

# feat: Public launch, tournament hardening, and progression

## Overview

Work on `artifacts/V1/index.html` (the 6,513-line self-contained monolith), landing **before** Plan A modularization resumes: strip a dead credential surface, deploy publicly, put the URL in front of real players, harden the tournament simulator, and add persistent progression with roster unlocks.

Two things were cut during review, both after measurement rather than argument:

- **Workstream B (share/GIF loop) is deferred** to after Plan A — origin §6.
- **Workstream C's fighter-rating work is deferred**, and C reduces to bug fixes. A measurement sweep was costed at 28–190 hours of compute, would have measured *AI-pilot performance under one heuristic policy* rather than fighter quality, and could not be validated by a held-out slice (a slice of the same generative process shares all its bias). Spending the plan's single largest cost before Unit 6 produces any player evidence contradicts this plan's own sequencing principle. The **real bugs** found while investigating it are kept.

## Problem Frame

The game is complete and good — 59 fighters, 9 three-phase bosses, a 48-team World Cup — and has never been played by anyone outside the project. `artifacts/_adversarial_review.txt` set the goal as *"100 middle schoolers playing, competing, and telling their friends."* Its top three findings (local 2P, tutorial, starter roster) have since shipped.

Verified still-open items:

1. A title-screen `sk-ant-...` field collects API credentials for a call that omits every required header and **can never succeed** — a deploy blocker and a trust catastrophe on a kids' site.
2. There is no public URL, so nothing else can matter.
3. The tournament simulator has genuine defects — see Unit 7.
4. Nothing survives closing the tab.

See origin: `docs/superpowers/specs/2026-07-21-bfsi-progression-share-deploy-design.md`.

## Requirements Trace

- **R1.** No credential-collection surface exists anywhere in the shipped file (origin §8.1)
- **R2.** A stranger can open a URL on a school Chromebook and play, no install, no account (origin §8.2)
- **R3.** The World Cup simulator is free of deterministic inversions and systematic index-order bias. *(Revised — the origin's "correlates positively with measured strength" is deferred with the rating work; no trustworthy strength data exists.)*
- **R4.** Progress survives closing the tab; the roster board gives a visible reason to return (origin §8.4)
- **R5.** No existing player loses access to anything they can do today (origin §8.5)
- **R6.** ≥5 target-age players outside the project have opened the live URL (origin §8.6)
- **R7.** Per observed session, record whether the player started a second match **and why or why not**. *(Revised — at n=5–10 a proportion has a ~40pp confidence interval and cannot gate anything; 5 reasons are informative where 5 data points are not.)*
- **R8.** At least one observed session shows the laptop handed to another player, or its absence recorded (origin §8.8)

## Scope Boundaries

- **Not** touch/mobile controls, balance passes, in-game accounts, chat, matchmaking
- **Not** the share loop / GIF export (deferred — origin §6)
- **Not** fighter ratings or any measurement sweep (deferred — see Overview)
- **Not** any Plan A–D modularization work
- **Not** LAN-*client* progression (clients never run `checkWin()`). The LAN **host** does run it and is decided in the table below

## Context & Research

### Relevant Code and Patterns

All paths `artifacts/V1/index.html` unless noted. Line numbers spot-verified across ~60 citations during review.

| Concern | Location | Pattern |
|---|---|---|
| Persistence | `BStore` :4708-4729 | Prefers `window.storage`, falls back to `localStorage` |
| Existing record-write | `recordMatch()` :4730-4766 | Async read-modify-write |
| Match-end hub | `checkWin()` :4658-4682 | Tournament early-return :4677; `recordMatch` :4681 |
| Settings control | `bindSeg()` :1071-1077 | Segmented buttons — **no checkbox precedent** |
| State reconciler | `syncModeUI()` :1112-1125 | `bindSeg` never sets `.on` from state |
| Roster board | `buildBoard()` :1047-1068 | `.cell.locked` branch is dead code today |
| Result screen | `#result` :636-647, `showResult()` :4784-4810 | ⚠️ Does **not** route through `go()` — manipulates `.screen` classes directly at :4791 |
| Tournament sim | `teamStrength()` :1473, `cmpTeam()` :1493, sampling :1410 | See Unit 7 |
| Boot | :6508-6510 | No `DOMContentLoaded`, no async |
| Harness | `test/harness/index.js`, `scripts/record-monolith.mjs` | Currently only on `feat/modular-app-refactor` — Unit 1 |

### Institutional Learnings

`docs/solutions/` does not exist; there are no recorded learnings. `artifacts/_adversarial_review.txt` is `.gitignore`d via `artifacts/_*.txt`, so premises traced to it are **unverifiable from a clone** of the now-public repo.

### External References

None gathered — every workstream follows patterns already dense in this codebase.

## Key Technical Decisions

**Branch unification first.** The harness lives only on `feat/modular-app-refactor`; `main` has the monolith and `vercel.json`. Verified: `artifacts/V1/index.html` is byte-identical across both branches and `git merge-tree` reports no conflicts, so the merge and its zero-diff baseline are sound.

**`vercel.json` must use empty strings, not `null`.** In Vercel, `null` means *auto-detect*; `""` means *skip*. Once Unit 1 merges `package.json` (whose `build` script is `vite build`) onto `main`, a `null` build command would flip the deploy to `npm install` + `vite build` and serve the blank scaffold. Already corrected in `vercel.json`.

**Ratings are deferred; the sign hazard is not.** `RANGE_PROFILE` is a *compensation* table (Golf Ball, measured 92%, carries `dmg:5`; Pillow, measured 15%, carries `dmg:8`), the 9 recorded percentages are all pre-trim, and `balance:tallies` blends incompatible populations. No trustworthy source exists, so no rating ships. But `simGroupMatch` computes `Math.random()*(strA+strB)` and compares `< strA`: **any future rating that lets `teamStrength` reach ≤ 0 makes team A win 5-0 deterministically.** Unit 7 installs that guard now, before a rating can ever exploit it.

**Tiebreaks need a stable key, not a random comparator.** `cmpTeam` is passed to `Array.prototype.sort` in three places (`groupStandings()` :1486, :1502, :1507) and `renderGroupHub()` re-sorts all 12 groups on **every** `showTourneyHub()` render. A random comparator violates sort consistency (V8 TimSort may reorder well beyond tied pairs), reshuffles displayed standings on unchanged data, and destroys golden reproducibility. Use a per-team `tieKey` assigned once at team construction.

**Unlock state is `profile.unlocked`, never `r.play`.** `r.play` also gates the default fighter (:851), tutorial pick (:1325), tournament pool (:1405), and CPU/netplay pools (:2244, :2264).

**Storage failure degrades to the full roster.** Correction from review: with no `url`, jsdom leaves `window.localStorage` **undefined** — it does not throw, so `typeof localStorage` shields it and `available()` returns `false` cleanly. The genuine failure is Chrome with cookies blocked, where the *getter throws* `SecurityError` and `typeof` does not help. The hardening is still needed; the test must install a throwing getter or it proves nothing.

**One three-state roster control**, not two overlapping toggles.

**Progression announcements need their own surface.** `banner()` (:2410) is a single node with a shared `clearTimeout`; the Boss Rush loop-clear path fires three within 1.5s.

## Open Questions

### Resolved During Planning

- **Branch?** `main`, after merging `feat/modular-app-refactor` (Unit 1).
- **Level-editor matches count?** No — excluded from progression *and* `balance:tallies`. `edTestPlay()` (:6435) sets `TESTMODE.active=false`, so the sandbox guard doesn't apply.
- **LAN host?** Counts toward progression; does **not** write `balance:tallies`. `buildFighters` sets `f.you = (role==="host")` (:2318), so the host genuinely reaches `recordMatch`.
- **Storage unavailable or write fails?** Full roster unlocked plus a one-time note.
- **Profile merge?** Re-read before write; `unlocked` set-union, counters `Math.max`. Never write the in-memory object wholesale.
- **Corrupt JSON?** Treated as **missing**, not empty.
- **Losing advances the drip?** Yes — keyed on `matches`.
- **Tutorial grants unlock #1?** Yes.
- **Tournament matches feed `balance:tallies`?** No.

### Deferred to Implementation

- Exact drip cadence beyond the origin's target (≥3 unlocks in 5 matches, first by match 2)
- The specific 8–10 trophy criteria and which fighter each awards
- Whether pre-hydration render needs a skeleton or can rely on synchronous `localStorage`

### Deferred Beyond This Plan

- **Fighter ratings and any measurement sweep.** If revisited, it needs: an Elo/Bradley-Terry fit over sampled pairings rather than a 1,711-cell matrix; validation across *independent channels* (two `AI_LEVEL`s, two stages) since a held-out slice cannot detect construct error; fixed recorded sweep parameters (`itemRate`, stage, stocks, `AI_LEVEL` — none are controlled today); and an anchor set of ~10 hand-judged fighters. Also note the sweep tool would depend on realm internals (reassigning `shuffle`, mutating `fighters[i].controller` post-`startMatch`) that Plan A's module boundaries destroy.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

**Which match paths produce progression** — the artifact the implementer actually needs.

| Entry path | `matches`/`wins` | `balance:tallies` | Announcement |
|---|---|---|---|
| Select → Start Match | yes | yes | yes |
| Local 2P (P1 seat only) | yes | yes | yes |
| Result → Rematch | yes | yes | yes |
| **LAN host** | **yes** | **no** | **yes** |
| Tutorial completion | grants unlock #1 only | no | yes |
| Boss Rush — boss defeated | `bossesCleared` | no | yes (own surface) |
| Boss Rush — gauntlet loop | `bestRushLoop` | no | yes (own surface) |
| World Cup — player wins | `wcTitles` | no | yes (tourney hub) |
| Level editor ▶ Play | no | no | no |
| Test Mode | no (guard :4659) | no | no |
| Tournament watched match | no (early return :4677) | no | no |
| LAN client | no (never runs `checkWin`) | no | no |

**Progression write path** — the async/sync hazard is the crux:

```
checkWin()  [synchronous]
  └─ compute newly-earned unlocks from the IN-MEMORY profile
  └─ stash into PENDING_UNLOCKS            ← synchronous, so showResult can read it
  └─ fire async persist (re-read → merge → write)   ← not awaited
  └─ setTimeout(showResult, 700)
       └─ render PENDING_UNLOCKS, then CLEAR it     ← so Rematch doesn't re-announce
```

**Roster visibility** collapses to one control:

```
Starters  ──▸  Unlocked  ──▸  Everything
 (8 known)     (earned)       (all 59, escape hatch)
```

## Implementation Units

### Phase 1 — Unblock and launch

- [x] **Unit 1: Unify branches**

**Goal:** `main` holds the monolith, `vercel.json`, and the harness, so work and verification share one tree.

**Requirements:** Prerequisite for all · **Dependencies:** None

**Files:** merge `feat/modular-app-refactor` → `main`; verify `package.json`, `vite.config.js`, `test/harness/index.js`, `test/golden/*.json`, `scripts/record-monolith.mjs`, `vercel.json`

**Approach:**
- Merge is verified conflict-free; both branches touch disjoint file sets
- **`test/eslint-rules.test.js` will be collected regardless of git tracking** — `vite.config.js` sets `test.include: ['test/**/*.test.js']` with no exclude, and it fails all three cases because `eslint.config.js` exists on neither branch. Move it to `test/pending/` or add a `test.exclude`, or Unit 1's own gate is red on arrival and every later unit inherits a failing baseline
- Confirm the corrected `vercel.json` actually skips the build: run a local Vercel build and assert the output contains `artifacts/V1/index.html` with **no npm install performed**
- Record a baseline golden run before any workstream edits

**Test scenarios:**
- Happy path: `npm test` is **green** on `main` after the merge
- Happy path: baseline golden re-record produces zero diff for both `monolith-golden.json` and `monolith-golden.lite.json`
- Edge case: a local Vercel build emits the monolith, not a Vite bundle, and runs no install

**Verification:** One branch suffices to edit and certify; `npm test` green; deploy config proven.

---

- [x] **Unit 2: Strip the credential surface**

**Goal:** No API-key collection anywhere, zero functional loss. The deploy blocker. **(R1)**

**Requirements:** R1 · **Dependencies:** Unit 1

**Files:** Modify `artifacts/V1/index.html` · Test `test/credential-strip.test.js`

**Approach:**
- Delete the full surface per origin §3 — including `planKeyBtn` (:536), `#teamKeyPrompt` (:499-501), `planKeyNote` (:543), `#homeKeyNote` (:317), the `Claude API key` label (:503). **None contain a grep-gate token**, which is how the original list missed them
- Markup block is `:310-318`, not `:310-316`. The function is `saveHomeKey()` (:1873) — `setHomeKey()` does not exist
- `.teamkeyrow` CSS survives the token gate as dead style — remove it explicitly
- `planScriptedReply()` (:1988) is a complete fallback; the `if(PLAN_KEY)` branch at :1978 collapses to its `else`
- **Fonts belong here, not at deploy** (origin §3 lists `fonts.googleapis.com` in Workstream 0's done-criteria): replace the remote `@import` (:8) with self-hosted or system-stack fonts

**Execution note:** Write the grep gate and handler-integrity assertion **first** — the original gate passed while the defect was on screen.

**Test scenarios:**
- Happy path: a teams match starts and shows scripted teammate dialogue
- Happy path: case-insensitive absence of `sk-ant`, `anthropic`, `api[ -]?key`, `apikey`, `planKey`, `planSetKey`, `PLAN_KEY`, `fonts.googleapis.com` — run against the **deployed artifact**, not only source
- Error path: every inline `on*=` attribute references a global that exists
- Edge case: title screen renders without layout breakage; font swap does not break the hand-tuned layout
- Integration: boot → select → teams → start → planning panel works end to end

**Verification:** Gate and handler assertion pass; team planning unchanged.

---

- [x] **Unit 3: Fix pre-existing progression blockers**

**Goal:** Repair bugs that would silently make Unit 9's hooks wrong. **(R4, R5)**

**Requirements:** R4, R5 · **Dependencies:** Unit 1

**Files:** Modify `artifacts/V1/index.html` · Test `test/net-roster-leak.test.js`

**Approach:**
- `window.__netRoster` is set at :6140 and **never cleared**. After any LAN game, `buildFighters` takes the netRoster branch (:2262-2270); for a *client* every entry is `you:false`, so no fighter has `f.you` and `showResult`'s `youWon` (:4794) is permanently false. Clear it (and `__netHumanCount`) in `NET.leave()` and `go('title')`
- Harden `BStore.available()` (:4728) — no `try/catch`, and note it returns true whenever `window.storage` is merely truthy, which does **not** guarantee writes succeed

**Execution note:** Add characterization coverage for the LAN→solo transition first; this is untested legacy netcode.

**Test scenarios:**
- Happy path: after a LAN session ends and the player returns to title, a fresh solo match has exactly one fighter with `f.you === true`
- Error path: with a **throwing** `localStorage` getter installed (`Object.defineProperty(window,'localStorage',{get(){throw new DOMException('denied','SecurityError')}})`), `available()` returns `false` rather than propagating. A plain jsdom realm does **not** reproduce this — `localStorage` is merely undefined there, so the test would be vacuous without the getter
- Edge case: `go('title')` mid-LAN clears the roster override
- Integration: LAN → title → solo → `showResult` correctly reports "you won"

**Verification:** Solo win detection survives a LAN session; storage probing never throws.

---

- [x] **Unit 4: Zero-diff golden re-record**

**Goal:** Prove Units 2–3 changed no behavior. A grep gate cannot show this.

**Requirements:** R1 · **Dependencies:** Units 2, 3

**Files:** Verify `test/golden/monolith-golden.json`, `test/golden/monolith-golden.lite.json`

**Approach:** Re-record both targets and require an **empty diff**. This must happen before Unit 5 deploys and before any feature work lands, or the proof is unrecoverable.

**Test scenarios:**
- Happy path: both goldens re-record with zero diff
- Edge case: any non-empty diff is investigated and explained before proceeding — a font swap should not move gameplay checksums

**Verification:** Empty diff on both targets.

---

- [x] **Unit 5: Deploy publicly**

**Goal:** A live URL a stranger can open. **(R2)**

**Requirements:** R2 · **Dependencies:** Unit 4

**Files:** Verify `vercel.json`; modify `artifacts/V1/index.html`

**Approach:**
- Connect the repo to Vercel **only now** — connecting auto-deploys `main`
- Decide `autoJoinFromLink()` (:6171, boot :6510): it parses `#room=CODE` and calls `NET.join()` after 60 ms with **no confirmation**. Latent today (no relay at same-origin `/api/ws`); recommend gating off until Plan D defines a model
- Add the one-line "what is this" description for the nervous adult (the review's unaddressed Tier 4 item) **and a fan-work / non-commercial disclaimer** — BFDI is jacknjellify's IP and no unit previously owned shipping this

**Test scenarios:**
- Happy path: the URL serves the game at `/` and a full FFA match is playable
- Happy path: `localStorage` persists across reload on the real origin
- Edge case: no console errors; no third-party network requests
- Error path: `<url>/#room=ZZZZ` does not hang, crash, or connect anywhere

**Verification:** R2 satisfied. No credential surface, no third-party requests.

---

- [ ] **Unit 6: Seed and observe**

**Goal:** Replace inference with observation. **(R6, R7, R8)**

> **⚠️ GATE DELIBERATELY RELAXED — 2026-07-21.** This unit was written as a hard gate on Units 7–11, on the principle that progression and tournament work should be justified by observed player behavior rather than inference. The owner chose to build Units 7–11 **before** seeding, accepting that trade explicitly.
>
> What that costs, recorded honestly so nobody later mistakes it for validated design: **Units 8–11 are built on inference.** The four branch outcomes below never got the chance to fire, so if observation later shows players quit before finishing a match, the progression work will have been aimed at the wrong bottleneck. R7's "write the number down before building A" is also unmet by construction.
>
> This unit remains valuable and should still run — as **validation** rather than a gate. Its findings can still cut or redirect work that has already been built.

**Requirements:** R6, R7, R8 · **Dependencies:** Unit 5

**Files:** Create `docs/superpowers/observations/2026-07-XX-seed-session-notes.md`

**Approach:**
- Put the URL in front of **5–10 real target-age players**, without coaching
- Record: where they quit and why; device; whether they hand the laptop over; whether anyone returns
- Per session record *whether a second match started and why or why not* — reasons, not a proportion
- Gather by sitting with players, not analytics
- **Explicit branch points.** Units 7–11 are specified but not unconditional:
  - Nobody notices or mentions tournament results → **cut Unit 7's remaining scope**; it fixes bugs no player perceives
  - Players quit before finishing one match → progression is the wrong next bet; controls/difficulty/onboarding take priority and a new workstream is inserted
  - Players finish matches but don't return → Units 8–11 proceed as planned
  - Anything else → revise before building

**Test expectation:** none — observation unit, no code change.

**Verification:** ≥5 target-age players outside the project have opened the live URL; findings written down with an explicit statement of which planned unit they support, undercut, or replace.

---

### Phase 2 — Tournament hardening (gated on Unit 6)

- [ ] **Unit 7: Tournament simulation hardening**

**Goal:** Remove real defects from the simulator. **No ratings** — see Overview. **(R3)**

**Requirements:** R3 · **Dependencies:** Unit 6

**Files:** Modify `artifacts/V1/index.html` · Test `test/tournament-sim.test.js`

**Approach:**
- **Install the sign guard now.** `simGroupMatch` rolls `Math.random()*(strA+strB)` and compares `< strA`. Assert `teamStrength(t) > 0` for every constructible team. Today's `s = 1 + Σ(0.5..1.0)` cannot go negative, so this is a guard against the *future* rating rather than a live bug — install it while the reasoning is fresh
- **Replace the index-order tiebreak.** `cmpTeam`'s final comparison is `a.id - b.id` (:1493), systematically favouring low-index teams. Assign a stable per-team `tieKey` once at construction (:1411) and compare that. **Do not randomize inside the comparator** — it is used by three `.sort()` calls and `renderGroupHub()` re-sorts all 12 groups on every hub render
- **Sample team members without replacement** (:1410). Note this only bites at the non-default 2v2 setting; the *cross-team* duplication (48 teams drawn from 59 with replacement, so ~33 distinct fighters appear) is larger and is explicitly accepted here
- Retain the `let s=1` baseline

**Execution note:** Implement test-first.

**Test scenarios:**
- Error path (sign guard): `teamStrength(t) > 0` for every constructible team including an all-weakest lineup
- Happy path: `cmpTeam` is a consistent comparator — sorting the same array twice yields identical order, and repeated `showTourneyHub()` renders do not reshuffle standings
- Happy path: across many seeds, low-index teams no longer qualify at an elevated rate
- Edge case: a 2v2 team never contains the same fighter twice
- Integration: a full 48-team World Cup completes without error

**Verification:** Deterministic inversions impossible; standings stable across renders; no index bias.

---

### Phase 3 — Progression (gated on Unit 6)

- [ ] **Unit 8: Profile storage layer**

**Goal:** A durable, corruption-tolerant, multi-tab-safe profile. **(R4, R5)**

**Requirements:** R4, R5 · **Dependencies:** Units 3, 6

**Files:** Modify `artifacts/V1/index.html` · Test `test/profile-store.test.js`

**Approach:**
- `profile:v1` = `{ version, matches, wins, kos, bossesCleared, bestRushLoop, wcTitles, unlocked[], viewMode, migratedFrom }`
- **Merge on write.** Re-read, then union `unlocked`, `Math.max` counters, union `bossesCleared`. Two tabs is the default on a Chromebook; a blind write makes an earned fighter visibly vanish
- **Corrupt JSON is missing, not empty** — the existing `try{JSON.parse}catch{}` pattern (:4753) yields `{}`, which would skip grandfathering
- **Grandfather check** considers `bfsi:tutorialDone` (raw `localStorage`, :1316), `levels:custom` (:6402), `balance:*`. Runs **once**, writes `migratedFrom` — `resetStats()` (:6502) deletes both `balance:*` keys, so a player who pressed "🗑 Reset" is otherwise indistinguishable from new
- **Storage unavailable or write failure → full roster unlocked** plus a one-time note. Do not use `available()` as a proxy for writability
- Hydrate **before the first `buildBoard()`** (:6509); prefer the synchronous `localStorage` path, defer only for `window.storage`
- Preserve unknown fighter names in `unlocked` rather than pruning

**Execution note:** Implement test-first — pure state machinery, many failure modes, no visible surface.

**Test scenarios:**
- Happy path: write, reload, read back intact
- Edge case (first run): no profile, no prior keys → fresh profile, starter roster
- Edge case (grandfathering): `bfsi:tutorialDone` present → full roster, `migratedFrom` written
- Edge case (after reset): `balance:*` deleted but `levels:custom` present → still grandfathered
- Edge case (one-shot): with `migratedFrom` set, the heuristic does not re-run
- Error path (concurrency): hydrate → simulate another writer adding an unlock → write → the other unlock **survives**
- Error path: corrupt JSON still triggers grandfathering
- Error path: throwing `localStorage` getter → full roster, no exception escapes
- Error path: quota exceeded → reported internally, player not demoted

**Verification:** R5 holds in every storage state, including denied and corrupt.

---

- [ ] **Unit 9: Progression hooks**

**Goal:** Wire every legitimate achievement moment to the profile. **(R4)**

**Requirements:** R4 · **Dependencies:** Unit 8

**Files:** Modify `artifacts/V1/index.html` · Test `test/progression-hooks.test.js`

**Approach:**
- Implement the "which paths count" table exactly, including the **LAN host** row
- **Normal matches:** compute the delta **synchronously** in `checkWin()` (:4681) into `PENDING_UNLOCKS`, persist asynchronously. `recordMatch()` is async and unawaited while `showResult` fires on a 700 ms timer
- **Exclude level-editor matches** (`CUSTOM_LEVEL != null`) from progression and tallies
- **World Cup:** award at `TOURNEY.champion = winners[0]` (:1526), gated on `mode==="normal" && champion===TOURNEY.myTeam && !TOURNEY.eliminated` (it fires in spectate too), guarded by an idempotence flag. Note a player can win the final and never be told — `TOURNEY.champion` is only set when they click a button labelled "Sim rest & Continue"
- **Boss Rush:** persist at the increments (:1815, :1827), not at run end — `go('title')` sets `BOSSRUSH.active=false` (:1030) and the only proper ending is death
- Tutorial completion grants unlock #1; drip advances on `matches`; profile is the **P1 seat**

**Test scenarios:**
- Happy path: a won FFA match increments `matches`, `wins`, `kos`
- Happy path: a **lost** match still increments `matches` and advances the drip
- Happy path: tutorial completion grants exactly one unlock, once
- Happy path: a hosted LAN match increments progression but writes no tally
- Edge case: level-editor playtest increments nothing
- Edge case: Test Mode and watched tournament matches increment nothing
- Edge case: a draw (`teamsAlive.length === 0`, reachable via simultaneous KO) is recorded coherently
- Edge case: Boss Rush progress persists when quitting mid-run
- Error path: World Cup title not awarded in spectate mode
- Error path: re-rendering the tournament hub does not double-award
- Integration: match ends → `PENDING_UNLOCKS` set synchronously → `showResult` reads → stash cleared, so Rematch does not re-announce

**Verification:** Every row of the table behaves as specified.

---

- [ ] **Unit 10: Unlock model and roster board**

**Goal:** Locked cells that teach, and one roster control. **(R4, R5)**

**Requirements:** R4, R5 · **Dependencies:** Unit 8

**Files:** Modify `artifacts/V1/index.html` · Test `test/unlock-board.test.js`

**Approach:**
- Hybrid model: fast drip (≥3 unlocks in 5 matches, first by match 2) plus 8–10 trophies
- `buildBoard()` (:1049, :1052) gains `isUnlocked(r)`; **`r.play` stays `true` for all 59**
- Locked cells must disclose their criterion. The cell is a 9px-font square in an 11-column grid with no room for text, and today's affordance is a `title` tooltip (:1056) that does not appear on Chromebook touch — use a click-driven detail panel or a strip below the grid
- Collapse `SHOW_ALL_CHARS` (:1046) and the escape hatch into **one three-state control**
- Persist view mode as a **view flag**, never by mutating `unlocked`
- Re-validate `chosen` when the view narrows — currently selecting in Everything mode then leaving starts a match with a locked fighter and no visible selection
- `chosen` defaults to `ROSTER.find(r=>r.play)` (:851) — must become the first *unlocked* fighter
- Update the legend at :432 (`All 59 fighters are playable` — false once locks exist) and the toggle label at :1064

**Patterns to follow:** `bindSeg()` :1071-1077; `syncModeUI()` :1112-1125 for reflecting persisted state

**Test scenarios:**
- Happy path: fresh profile shows 8 starters; an unlock adds exactly one selectable cell
- Happy path: Everything mode shows all 59 selectable
- Edge case: narrowing the view re-validates `chosen`
- Edge case: `chosen` on boot is never locked
- Edge case: view mode persists across reload and the control reflects it on entry
- Error path: turning the escape hatch off restores exactly the earned set
- Integration: unlock → persist → reload → fighter selectable
- Integration: locked fighters still appear as CPU opponents and World Cup teammates, confirming the pool is unaffected

**Verification:** R5 holds — no reachable state has less access than today.

---

- [ ] **Unit 11: Announcement surface**

**Goal:** Unlocks are actually seen, on every screen where they can be earned. **(R4)**

**Requirements:** R4 · **Dependencies:** Units 9, 10

**Files:** Modify `artifacts/V1/index.html` · Test `test/unlock-announce.test.js`

**Approach:**
- A dedicated container in `#result` between `#scorecard` (:640) and `#runReview` (:641), following the `runReview` pattern
- **Not `banner()`** — single node, shared `clearTimeout`; the Boss Rush loop-clear path fires three within 1.5s. Use a queued surface
- **Three terminal screens, not one.** `showResult()` (:4784) — which **does not route through `go()`**, it sets `.screen` classes directly at :4791; the Boss Rush death path (:1806-1810) which *does* call `go('result')`; and the tournament done-branch which writes `body.innerHTML` and returns at :1649 with no `#result` involvement. Clearing centrally in `go()` therefore covers only two of three — `showResult` must clear explicitly
- Handle 0 unlocks (common — render nothing) and 3+

**Test scenarios:**
- Happy path: one unlock shows on the result screen
- Happy path: three show coherently
- Edge case: zero renders nothing, no empty container artifact
- Edge case: Boss Rush loop-clear announcement survives the three competing banners
- Edge case: World Cup title announced in the tourney done-branch, which never routes through `#result`
- Error path: after Rematch, the previous unlock is not re-announced
- Error path: the Boss Rush death screen shows no stale announcement
- Integration: earned in Boss Rush → announced → persisted → visible on the board

**Verification:** Every achievement moment has a visible, non-clobbered announcement.

---

### Phase 4 — Verification

- [ ] **Unit 12: Harness origin and final re-records**

**Goal:** Make progression verifiable and attribute remaining behavior changes.

**Requirements:** All · **Dependencies:** Units 7, 11

**Files:** Modify `test/helpers/load-monolith.js`, `test/golden/*.json`

**Approach:**
- **Give the harness a real origin.** It constructs `new JSDOM(html, …)` with no `url`, so `window.localStorage` is undefined and **Workstream A is structurally invisible to the goldens**. Set `url: 'http://localhost/'` and add profile scenarios. Note this makes `recordMatch`'s `BStore` writes live during recording — re-verify goldens still reproduce before relying on them
- **Serialize Unit 7 before Unit 8** or attribution is lost; the dependency graph alone permits them in parallel
- Re-record after Unit 7, then after Units 8–11, separately
- ⚠️ **Correction to an earlier claim:** `teamStrength()` is called **zero times** by any recorded scenario (`worldcup-inf` sims no fixtures), and the Trace schema has no tournament fields at all. What actually moves the tournament golden is Unit 7's sampling change at :1410 altering the count of shared-PRNG draws. Do **not** write an acceptance criterion of the form "tournament fields changed" — none exist. Unit 7 is covered by `test/tournament-sim.test.js` only

**Test scenarios:**
- Happy path: harness runs with a real origin and `localStorage` is available to profile tests
- Happy path: goldens still reproduce byte-identically after the origin change, with no behavioral drift from now-live `BStore` writes
- Edge case: post-Unit-7 diff is explained by the sampling change alone

**Verification:** Progression is machine-verifiable; remaining diffs are attributed.

## System-Wide Impact

- **Interaction graph:** `checkWin()` is the hub — Test Mode, Boss Rush, tournament, LAN host/client, and normal matches all route through it with different early-returns. `buildBoard()` re-triggers `buildStages()` and `buildSettings()` (:1067).
- **Error propagation:** All storage failures degrade to "full roster unlocked", never a demoted player. `recordMatch()`'s blanket `try/catch` ("recording must never break the game") must be preserved while still reporting write failure internally.
- **State lifecycle risks:** Multi-tab profile merge; the hydration race at :6509; `PENDING_UNLOCKS` cleared after render; `__netRoster` cleared on leave.
- **API surface parity:** No public API. The DOM contract matters — see Risks.
- **Integration coverage:** LAN→solo, tutorial→first unlock, Boss Rush quit→persistence, tournament spectate→no award. None provable by unit tests alone.
- **Unchanged invariants:** `r.play` stays `true` for all 59, so tournament pool, CPU opponents, netplay roster, and default selection are untouched. `startMusic`/`stopMusic`/`SFX` unchanged. `.screen`/`.screen.active` preserved.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Unit 6 observation invalidates Units 7–11 | That is the point. Unit 6 names four explicit branch outcomes and is a hard dependency of both later phases |
| Deploy publishes something unintended | Units 2–4 precede it; `vercel.json` corrected to empty-string skip; grep gate runs against the deployed artifact |
| Unlocks make the game feel smaller | Three-state control, fast cadence, grandfathering, storage-failure-defaults-open |
| **Plan A churn is larger than origin §2.1 states** | Beyond Task 27 and Task 4's font work: Unit 2 removes **4 of the 44 inline handlers** (`saveHomeKey` :314, `clearHomeKey` :315, `oninput=syncTeamKey` :504, `planSetKey` :536) and Units 10–11 add more — Plan A hardcodes 44 in its architecture summary, its spec-coverage paragraph, and a test named `describe('handler coverage (44 not 32)')`. Task 4's `REQUIRED_IDS` list is "frozen" and loses 6 ids. The decomposition map is already 652 lines stale and Units 8–11 widen it. **Regenerating the map is a required hand-off item** |
| Progression invisible to goldens | Unit 12 gives the harness a real origin |
| Public fan-IP exposure | BFDI is jacknjellify's IP. Unit 5 now **owns** shipping a fan-work/non-commercial disclaimer |
| `autoJoinFromLink` becomes live surface | Latent today; Unit 5 decides gating before Plan D |

## Documentation / Operational Notes

- `artifacts/_adversarial_review.txt` is `.gitignore`d, so premises traced to it are unverifiable from a clone of the public repo. Consider committing it or summarising in-repo.
- Unit 6's observations go in `docs/superpowers/observations/` — a new directory, and the most valuable artifact this plan produces.
- **Regenerate `docs/superpowers/specs/2026-07-17-bfsi-decomposition-map.json`** before Plan A resumes.
- When Plan C's Lite build lands, `vercel.json`'s `outputDirectory` changes to `dist-lite` — one line, same URL.

## Sources & References

- **Origin document:** `docs/superpowers/specs/2026-07-21-bfsi-progression-share-deploy-design.md`
- Product audit: `artifacts/_adversarial_review.txt` (untracked)
- Downstream: `docs/superpowers/plans/2026-07-17-bfsi-modularization.md` (Tasks 4, 27, 30 affected)
- Decomposition map: `docs/superpowers/specs/2026-07-17-bfsi-decomposition-map.json` (stale: describes 5,861 lines; file is 6,513)
- Target: `artifacts/V1/index.html`
