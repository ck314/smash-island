---
# Battle for Smash Island — Online Rooms (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **EXECUTION ORDER — Plan D runs LAST.** This plan (D, online rooms) **depends on Plan A (modularization), Plan B (music), and Plan C (web Lite, OFFLINE taster)** and executes strictly **after** all three: order is **A → B → C → D**. Plan D targets the **post-Plan-C** module + build layout. Concretely it assumes: (a) Plan A owns `src/core/build.js` (`BUILD.lite`), `src/core/state.js` (the setter / `rt.*` field / in-place-array rules and `setStage`/`setW`/`setH`/`setWW`/`setWH`/`replaceArr`/`filterInPlace`), `src/core/handler-coverage.js` (`assertHandlerCoverage(win, root)`), the single `test/` root with one Vitest config, `test/harness/index.js`, and `src/net/netcode.js` (Task 28: exports `NET`, `serializeState`, `applySnapshot`, `autoJoinFromLink`, `openLobby`; `window.NET = NET` at import; `applySnapshot` writes only through state setters; socket opens only in `NET.connect`); (b) Plan B owns the audio facade; (c) **Plan C** owns `index.lite.html`, `src/main.lite.js`, `src/ui/global-actions.lite.js`, the mode-switched `vite.config.js` with the `bfsi-lite-exclude` `resolveId` plugin, and the Lite test suite under `test/lite/` — including the **tree-shake test** (`test/lite/tree-shake.test.js`), the **handler-coverage test** (`test/lite/handler-coverage.test.js`), the **shell-contract test** (`test/lite/lite-shell-contract.test.js`), `test/lite/global-actions-lite.test.js`, and `test/lite/main-lite-boot.test.js`. In Plan C the Lite build **excludes** `net/netcode.js` (its tree-shake test asserts `net/netcode.js` is absent from `dist-lite`, redirected to `netcode.lite.js`). **Plan D reverses that for netcode only:** it adds `net/netcode.js` + a hosted relay server + a Rooms UI to the Lite build and **amends Plan C's Lite tests** so netcode is **allowed** in `dist-lite` from Plan D onward, while `editor/level-editor.js`, `modes/coop-planning.js`, `audio/music-director.js`, `audio/stem-player.js`, and `audio/manifest.js` **remain excluded**. Do not start Plan D until Plans A, B, and C are merged.

**Goal:** Add an online **Rooms** section to the Web Lite build — (a) **room-code join** (create a room, get a shareable 4-letter code + link, a friend joins by code) and (b) a **room browser** (a list of open public rooms with join buttons) — backed by a small always-on **relay server** (Node + `ws`) whose channels are keyed by room code and whose HTTP room-registry powers the browser list. Online play reuses the existing `src/net/netcode.js` (`NET`/`serializeState`/`applySnapshot`) and the **full roster + the trimmed Lite stage subset** (same content as the rest of Lite). No in-room chat, no spectating other rooms. Gameplay behavior stays identical to the monolith netcode; the only new surface is Rooms + the hosted relay.

**Architecture:** The relay is a stateless message forwarder plus an in-memory registry. Each WebSocket connection carries a `?room=CODE` query; the relay groups connections into per-code **channels** and forwards the monolith's existing protocol verbatim (`hello` → broadcast `roster`; client `input` → routed to the host; host `state` snapshot → broadcast to clients; `start`/`status` → broadcast). A separate `server/rooms.js` registry records open **public** rooms (`open`/`join`/`leave`/`markStarted`/`close`/`expire`) and exposes them over `GET /rooms` (JSON) for the browser list. The browser side changes are additive: `src/net/relay-config.js` resolves the relay endpoint from a build-time env var (`VITE_RELAY_URL`) with a same-origin `/api/ws` fallback; `src/net/netcode.js` is rewired to build its socket URL from that config, mark hosted rooms public, expose `NET.listRooms()`, and fire `onRoster`/`onStatus` callbacks so a UI can subscribe without netcode owning specific DOM ids; `src/ui/rooms.js` renders the `#rooms` `.screen` (create / join-by-code / browser list) using those callbacks. The Lite entry (`src/main.lite.js`) now imports `rooms.js` (which pulls in the real `netcode.js`), and `vite.config.js`'s `bfsi-lite-exclude` plugin drops **only** `coop-planning.js` from its stub map — netcode is no longer redirected. Because online uses the full roster, the Rooms path reads the **unfiltered** `ROSTER` while the Lite stage filter still applies (stages carry the Lite subset; roster does not).

**Tech Stack:** Node ≥ 18.19 (`http`, `URL`, top-level `await` in `.mjs`), `ws` ≥ 8.18 (server + Node test/smoke clients; browser uses native `WebSocket`), Vite (build-time `define`/env for `VITE_RELAY_URL`, mode-switched Lite target from Plan C), Vitest + jsdom (config + netcode + rooms unit/DOM), Playwright ≥ 1.44 (two-context real-browser rooms e2e). Depends on **Plan A's** `src/net/netcode.js` + `src/core/state.js` setters + `test/harness/index.js`, **Plan A's** `src/core/handler-coverage.js`, and **Plan C's** Lite entry/shell/config/tests. Executes after all three (order A → B → C → D).

## Global Constraints

_Every task implicitly includes this section._

- **Version floors:** Node ≥ 18.19; `ws` ≥ 8.18; Vite ≥ 5; Vitest ≥ 2; Playwright ≥ 1.44. `package.json` has `"type": "module"` (Plan A), so `server/*.js` and `scripts/*.mjs` are ESM.
- **ESM live-binding / setter rule (from Plan A):** never reassign an imported binding. `applySnapshot` already routes pool swaps through `replaceArr(...)`, scalars through `setW/setH/setWW/setWH`/`setStage`, and `hazardT`/`camX`/`camY` through `rt.*` (Plan A Task 28). Plan D does **not** loosen this — the netcode edits touch only URL construction, the public-room flag, `listRooms`, and callback hooks; the `applySnapshot`/`serializeState` bodies are unchanged.
- **The ONE permitted import-time side effect stays `window.NET = NET`** in `src/net/netcode.js` (Plan A). Every other module Plan D adds (`relay-config.js`, `rooms.js`, `server/*.js`) has **zero** import-time DOM/canvas/`AudioContext`/`WebSocket`/`fetch`/network/`listen` effects. The relay socket opens only inside `NET.connect()`; the room-list `fetch` fires only inside `NET.listRooms()`/`refreshRoomBrowser()`; the relay server binds a port only inside `createRelay(...).listen()`, never at module eval. `server/relay.js`'s CLI-entry `listen()` is guarded behind an `import.meta.url === pathToFileURL(process.argv[1]).href` check so importing it in tests binds nothing.
- **Gameplay identical to the monolith netcode:** the relay forwards the exact message set the monolith `NET` already speaks (`hello`/`roster`/`input`/`state`/`start`/`status`); `serializeState`/`applySnapshot` are unchanged. The only new surface is Rooms UI + the hosted relay + the registry. No sim/HUD/draw code changes.
- **Online content = full roster + trimmed stages.** Rooms reads the **unfiltered** `ROSTER` (Plan C's D-1 decision: roster is FULL in Lite; only STAGES carry a `lite` flag). No task re-introduces a roster lite-flag. Stage selection online still uses the Lite stage subset (the same `STAGES` binding the rest of Lite sees).
- **Per-build handler-coverage contract (Plan A/C):** every new inline `on*=` handler in `index.lite.html` must be assigned to `window` by the Lite bridge, and `assertHandlerCoverage(window, document)` at boot (Plan C `main.lite.js`) must still pass. Plan D extends the Lite bridge from 12 → 18 symbols and amends the Plan C handler tests accordingly.
- **Amend, do not fork, Plan C's Lite tests.** Plan D edits Plan-C-owned test files in place (`test/lite/tree-shake.test.js`, `test/lite/handler-coverage.test.js`, `test/lite/lite-shell-contract.test.js`, `test/lite/global-actions-lite.test.js`, `test/lite/main-lite-boot.test.js`) rather than adding parallel copies. Each such task additionally gates on the full `npm test` harness so the whole suite stays green.
- **Copyright boundary (non-negotiable):** unchanged — no third-party recordings anywhere; Rooms adds no assets. Room codes avoid vowels and `0/O/1/I` lookalikes (monolith `makeRoomCode`), preserved verbatim.
- **Relay endpoint config:** the browser resolves the relay from `VITE_RELAY_URL` (Vite build-time env) with a **same-origin `/api/ws`** production fallback (matching the monolith's `wss://host/api/ws` convention) and a `ws://localhost:8080/ws` bare-Node fallback. No relay hostname is hard-coded in game code.
- Every test command below is run from the repo root `C:/Users/pkupe/Aardvark/smash-island`.

---

### Task 1: Relay endpoint config leaf — `src/net/relay-config.js`

**Files:**
- Create: `src/net/relay-config.js`
- Test: `test/net/relay-config.test.js`
**Interfaces:**
- Consumes: `import.meta.env.VITE_RELAY_URL` (Vite build-time env; `undefined` under Vitest and in the same-origin production deploy).
- Produces: `relayWsUrl(roomCode, loc?)` → the `ws(s)://…?room=CODE` endpoint; `relayHttpUrl(path?, loc?)` → the sibling `http(s)://…/rooms` registry endpoint. Pure functions, zero side effects. Consumed by `src/net/netcode.js` (Task 3) and `src/ui/rooms.js` (Task 4).

- [ ] **Step 1: Write the failing test**
```js
// test/net/relay-config.test.js
import { describe, it, expect } from 'vitest';
import { relayWsUrl, relayHttpUrl } from '../../src/net/relay-config.js';

describe('relay-config (env/build-time endpoint resolution)', () => {
  it('derives ws:// + /ws?room from a plain-http origin (dev/same-origin http)', () => {
    const loc = { protocol: 'http:', host: 'localhost:5174', origin: 'http://localhost:5174' };
    expect(relayWsUrl('ABCD', loc)).toBe('ws://localhost:5174/ws?room=ABCD');
    expect(relayWsUrl(null, loc)).toBe('ws://localhost:5174/ws');
    expect(relayHttpUrl('/rooms', loc)).toBe('http://localhost:5174/rooms');
  });

  it('derives wss:// + /api/ws?room and https /api/rooms from an https origin (prod same-origin)', () => {
    const loc = { protocol: 'https:', host: 'play.example.com', origin: 'https://play.example.com' };
    expect(relayWsUrl('WXYZ', loc)).toBe('wss://play.example.com/api/ws?room=WXYZ');
    expect(relayHttpUrl('/rooms', loc)).toBe('https://play.example.com/api/rooms');
  });

  it('percent-encodes the room code and has no import-time side effects', () => {
    const loc = { protocol: 'http:', host: 'h', origin: 'http://h' };
    expect(relayWsUrl('A B', loc)).toBe('ws://h/ws?room=A%20B');
    expect(typeof relayWsUrl).toBe('function');
    expect(typeof relayHttpUrl).toBe('function');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**
```
npx vitest run test/net/relay-config.test.js
```
Expected: `FAIL` — `Failed to resolve import "../../src/net/relay-config.js"`.

- [ ] **Step 3: Minimal implementation**
```js
// src/net/relay-config.js
// Build-time relay endpoint resolution. VITE_RELAY_URL (e.g. wss://relay.example.com/ws)
// is injected by Vite's env at build time; when unset, derive from the page origin —
// production reverse-proxies the relay under the same origin at /api/ws + /api/rooms
// (matching the monolith's wss://host/api/ws convention). ZERO side effects: pure
// string computation, no socket, no fetch, no DOM.
const ENV_URL =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_RELAY_URL) || '';

function currentLoc(loc) {
  if (loc) return loc;
  return typeof location !== 'undefined' ? location : null;
}

export function relayWsUrl(roomCode, loc) {
  const q = roomCode ? '?room=' + encodeURIComponent(roomCode) : '';
  if (ENV_URL) return ENV_URL + q;
  const l = currentLoc(loc);
  if (!l) return 'ws://localhost:8080/ws' + q;
  const secure = l.protocol === 'https:';
  const scheme = secure ? 'wss://' : 'ws://';
  const path = secure ? '/api/ws' : '/ws';
  return scheme + l.host + path + q;
}

export function relayHttpUrl(path = '/rooms', loc) {
  if (ENV_URL) {
    // wss://relay/ws -> https://relay/rooms ; ws://relay/ws -> http://relay/rooms
    return ENV_URL.replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/ws$/, '') + path;
  }
  const l = currentLoc(loc);
  if (!l) return 'http://localhost:8080' + path;
  const base = l.protocol === 'https:' ? l.origin + '/api' : l.origin;
  return base + path;
}
```

- [ ] **Step 4: Run tests, verify pass**
```
npx vitest run test/net/relay-config.test.js
```
Expected: `PASS` — 3 passed.

- [ ] **Step 5: Commit**
```
git add src/net/relay-config.js test/net/relay-config.test.js
git commit -m "feat(net): relay-config leaf — env/same-origin relay endpoint resolution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Relay server + room registry (`server/relay.js`, `server/rooms.js`)

**Files:**
- Create: `server/rooms.js` (in-memory registry)
- Create: `server/relay.js` (Node + `ws` relay + `GET /rooms` + CLI entry)
- Modify: `package.json` (add `"ws"` dependency; `"relay"` script)
- Test: `test/net/relay-server.test.js`
**Interfaces:**
- Consumes: `ws` (`WebSocketServer` server-side, `WebSocket` client-side in tests), Node `http`/`node:url`.
- Produces: `createRooms({ ttlMs?, capacity? })` → `{ open, join, leave, markStarted, close, get, count, list, expire }`; `createRelay({ port?, roomTTLms? })` → `{ httpServer, wss, rooms, listen(), port(), close() }`. Channels are keyed by `?room=CODE`; the relay forwards the monolith protocol (`hello`→`roster`, `input`→host, `state`→clients, `start`/`status`→broadcast). `GET /rooms` returns `{ rooms: [{ code, host, count, createdAt }] }` (open, public, not-started). No port binds at import. `npm run relay` starts it on `PORT` (default 8080).

- [ ] **Step 1: Write the failing test**
```js
// test/net/relay-server.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { createRooms } from '../../server/rooms.js';
import { createRelay } from '../../server/relay.js';

describe('room registry (createRooms)', () => {
  it('lists only open, public, not-started rooms with capacity, newest first', () => {
    const rooms = createRooms({ capacity: 4 });
    rooms.open('AAAA', { host: 'H1', isPublic: true });
    rooms.open('BBBB', { host: 'H2', isPublic: false }); // private -> hidden
    rooms.open('CCCC', { host: 'H3', isPublic: true });
    rooms.markStarted('CCCC');                            // started -> hidden
    const list = rooms.list();
    expect(list.map(r => r.code)).toEqual(['AAAA']);
    expect(list[0].host).toBe('H1');
    rooms.join('AAAA'); rooms.join('AAAA'); rooms.join('AAAA'); // count now 4 == capacity -> full -> hidden
    expect(rooms.list().map(r => r.code)).toEqual([]);
  });

  it('expire() drops rooms untouched past the TTL', () => {
    const rooms = createRooms({ ttlMs: 1000 });
    const r = rooms.open('DDDD', { host: 'H', isPublic: true });
    r.touchedAt = Date.now() - 5000;
    rooms.expire();
    expect(rooms.get('DDDD')).toBeNull();
  });
});

describe('relay server (rooms + registry)', () => {
  const relay = createRelay({ port: 0 });
  let PORT;
  beforeAll(async () => { PORT = await relay.listen(); });
  afterAll(async () => { await relay.close(); });

  function connect(code) {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws?room=${code}`);
    return new Promise((res, rej) => { ws.once('open', () => res(ws)); ws.once('error', rej); });
  }
  function next(ws, pred) {
    return new Promise((res) => {
      const on = (buf) => {
        const m = JSON.parse(buf.toString());
        if (!pred || pred(m)) { ws.off('message', on); res(m); }
      };
      ws.on('message', on);
    });
  }

  it('boots on an ephemeral port', () => { expect(PORT).toBeGreaterThan(0); });

  it('host creates a room, a client joins by code, they exchange a snapshot and input', async () => {
    const host = await connect('ABCD');
    const hostRoster = next(host, m => m.t === 'roster' && m.players.length === 2);
    host.send(JSON.stringify({ t: 'hello', id: 'h1', host: true, name: 'Firey', public: true }));

    const client = await connect('ABCD');
    client.send(JSON.stringify({ t: 'hello', id: 'c1', host: false, name: 'Leafy' }));

    const roster = await hostRoster;
    expect(roster.players.map(p => p.id).sort()).toEqual(['c1', 'h1']);
    expect(roster.players.find(p => p.id === 'h1').isHost).toBe(true);

    // host -> clients: state snapshot
    const gotState = next(client, m => m.t === 'state');
    host.send(JSON.stringify({ t: 'state', s: { t: 7, fighters: [{ name: 'Firey' }] } }));
    expect((await gotState).s.t).toBe(7);

    // client -> host only: input
    const gotInput = next(host, m => m.t === 'input');
    client.send(JSON.stringify({ t: 'input', idx: 1, input: { left: true } }));
    expect((await gotInput).input.left).toBe(true);

    host.close(); client.close();
  });

  it('a third party lists the open public room over HTTP', async () => {
    const host = await connect('WXYZ');
    const seated = next(host, m => m.t === 'roster');
    host.send(JSON.stringify({ t: 'hello', id: 'h2', host: true, name: 'Bomby', public: true }));
    await seated;
    const body = await (await fetch(`http://localhost:${PORT}/rooms`)).json();
    expect(body.rooms.some(r => r.code === 'WXYZ' && r.host === 'Bomby')).toBe(true);
    host.close();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**
```
npx vitest run test/net/relay-server.test.js
```
Expected: `FAIL` — `Failed to resolve import "../../server/rooms.js"` (and `ws` may be unresolved until Step 3 installs it).

- [ ] **Step 3: Minimal implementation**

Add the dependency and script to `package.json` (merge into existing `dependencies`/`scripts`):
```json
{
  "dependencies": { "ws": "^8.18.0" },
  "scripts": {
    "relay": "node server/relay.js",
    "dev:relay": "node server/relay.js"
  }
}
```
Then install:
```
npm install ws@^8.18.0
```

`server/rooms.js`:
```js
// server/rooms.js
// In-memory room registry powering the public browser list. No I/O and no timers
// of its own — the relay drives expire(); pure data so it unit-tests directly.
export function createRooms({ ttlMs = 1000 * 60 * 30, capacity = 8 } = {}) {
  const map = new Map(); // code -> { code, host, count, isPublic, started, createdAt, touchedAt }
  const now = () => Date.now();
  return {
    open(code, { host = 'host', isPublic = true } = {}) {
      const t = now();
      const rec = { code, host, count: 1, isPublic, started: false, createdAt: t, touchedAt: t };
      map.set(code, rec);
      return rec;
    },
    join(code) { const r = map.get(code); if (r) { r.count++; r.touchedAt = now(); } },
    leave(code) { const r = map.get(code); if (r) { r.count = Math.max(0, r.count - 1); r.touchedAt = now(); } },
    markStarted(code) { const r = map.get(code); if (r) { r.started = true; r.touchedAt = now(); } },
    close(code) { map.delete(code); },
    get(code) { return map.get(code) || null; },
    count() { return map.size; },
    list() {
      return [...map.values()]
        .filter(r => r.isPublic && !r.started && r.count < capacity)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(r => ({ code: r.code, host: r.host, count: r.count, createdAt: r.createdAt }));
    },
    expire(ts = now()) {
      for (const [code, r] of map) if (ts - r.touchedAt > ttlMs) map.delete(code);
    },
  };
}
```

`server/relay.js`:
```js
// server/relay.js
// Always-on relay: rooms are message channels keyed by a ?room=CODE query. Forwards
// the exact monolith protocol (hello->roster, input->host, state->clients, start/status
// ->broadcast) and serves the public room registry at GET /rooms for the browser list.
// No port binds at import — only createRelay(...).listen() (or the CLI entry) binds.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { createRooms } from './rooms.js';

const CAPACITY = 8; // max humans per room

export function createRelay({ port = 0, roomTTLms = 1000 * 60 * 30 } = {}) {
  const rooms = createRooms({ ttlMs: roomTTLms, capacity: CAPACITY });
  const channels = new Map(); // code -> Set<ws>

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/^\/api/, '');
    res.setHeader('Access-Control-Allow-Origin', '*'); // browser list may be cross-origin
    if (req.method === 'GET' && path === '/rooms') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ rooms: rooms.list() }));
      return;
    }
    if (req.method === 'GET' && path === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, rooms: rooms.count() }));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const code = (url.searchParams.get('room') || 'LOBBY').toUpperCase();
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._room = code; ws._id = null; ws._name = null; ws._isHost = false;
      if (!channels.has(code)) channels.set(code, new Set());
      channels.get(code).add(ws);
      wss.emit('connection', ws, req);
    });
  });

  function broadcast(code, obj, except) {
    const peers = channels.get(code);
    if (!peers) return;
    const data = JSON.stringify(obj);
    for (const p of peers) if (p !== except && p.readyState === 1) p.send(data);
  }
  function rosterOf(code) {
    const peers = channels.get(code);
    if (!peers) return [];
    return [...peers].filter(p => p._id).map(p => ({ id: p._id, name: p._name || 'player', isHost: p._isHost }));
  }

  wss.on('connection', (ws) => {
    ws.on('message', (buf) => {
      let m;
      try { m = JSON.parse(buf.toString()); } catch { return; }
      const code = ws._room;
      if (m.t === 'hello') {
        ws._id = m.id; ws._name = m.name; ws._isHost = !!m.host;
        if (m.host) rooms.open(code, { host: m.name || 'host', isPublic: m.public !== false });
        else rooms.join(code);
        broadcast(code, { t: 'roster', players: rosterOf(code) });
      } else if (m.t === 'input') {
        const peers = channels.get(code);
        if (peers) for (const p of peers) if (p._isHost && p.readyState === 1) p.send(JSON.stringify(m));
      } else if (m.t === 'state') {
        broadcast(code, m, ws); // host -> clients
      } else if (m.t === 'start') {
        rooms.markStarted(code);
        broadcast(code, m, ws);
      } else if (m.t === 'status') {
        broadcast(code, m, ws);
      }
    });
    ws.on('close', () => {
      const code = ws._room;
      const peers = channels.get(code);
      if (!peers) return;
      peers.delete(ws);
      if (ws._isHost || peers.size === 0) { rooms.close(code); channels.delete(code); }
      else { rooms.leave(code); broadcast(code, { t: 'roster', players: rosterOf(code) }); }
    });
  });

  const sweep = setInterval(() => rooms.expire(), 60_000);
  if (sweep.unref) sweep.unref();

  return {
    httpServer, wss, rooms,
    listen() { return new Promise((r) => httpServer.listen(port, () => r(httpServer.address().port))); },
    port() { const a = httpServer.address(); return a && a.port; },
    close() { clearInterval(sweep); wss.close(); return new Promise((r) => httpServer.close(r)); },
  };
}

// CLI entry: `node server/relay.js` / `npm run relay`. Guarded so importing this
// module in tests binds no port.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8080);
  createRelay({ port }).listen().then((p) =>
    console.log(`[relay] listening on :${p}  (ws /ws?room=CODE, list GET /rooms, GET /health)`));
}
```

- [ ] **Step 4: Run tests, verify pass**
```
npx vitest run test/net/relay-server.test.js
```
Expected: `PASS` — 5 passed (2 registry + 3 server). Then smoke the CLI entry binds no port at import and starts on demand:
```
node -e "import('./server/relay.js').then(()=>console.log('imported: no port bound'))"
```
Expected: prints `imported: no port bound` and exits 0 (no `listening` line, proving import is side-effect-free).

- [ ] **Step 5: Commit**
```
git add server/rooms.js server/relay.js package.json package-lock.json test/net/relay-server.test.js
git commit -m "feat(relay): ws relay + room registry (channels by code, GET /rooms) + npm run relay

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Rewire `src/net/netcode.js` to the relay + rooms model

> **Ownership:** `src/net/netcode.js` is **created by Plan A (Task 28)**. Plan D **edits it in place** — it does not create a new netcode module. The edits are surgical: (1) build the socket URL from `relay-config` instead of `location.host`; (2) mark hosted rooms public and send a `public` flag in `hello`; (3) add `NET.listRooms()`; (4) add `onRoster`/`onStatus`/`openRoomsUI` callback hooks so a UI can subscribe without netcode hard-coding DOM ids; (5) adapt `autoJoinFromLink` to the rooms model. `serializeState`/`applySnapshot` bodies are **untouched** (they already route through state setters per Plan A).

**Files:**
- Modify: `src/net/netcode.js`
- Test: `test/net/netcode-rooms.test.js`
**Interfaces:**
- Consumes: `relayWsUrl`/`relayHttpUrl` (`src/net/relay-config.js`, Task 1); existing Plan A imports unchanged.
- Produces: `NET.wsURL()` returns the relay-config URL; `NET.isPublic` (default `true`); `hello` carries `public`; `NET.listRooms()` → `Promise<Array<{code,host,count,createdAt}>>`; `NET.onRoster(players)`/`NET.onStatus(msg)`/`NET.openRoomsUI()` callback slots (null by default; fired if set); `autoJoinFromLink()` returns the code and opens the rooms UI via `openRoomsUI` (falling back to `go('lobby')` for desktop). Still `window.NET = NET` at import; still no socket at import.

- [ ] **Step 1: Write the failing test**
```js
// test/net/netcode-rooms.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NET } from '../../src/net/netcode.js';

beforeEach(() => { NET.onRoster = null; NET.onStatus = null; NET.openRoomsUI = null; });

describe('netcode rooms wiring', () => {
  it('wsURL is built from relay-config with the room code as ?room=', () => {
    NET.room = 'ABCD';
    const url = NET.wsURL();
    expect(url).toMatch(/\/ws\?room=ABCD$|\/api\/ws\?room=ABCD$/);
  });

  it('status() fires the onStatus callback when a UI subscribes', () => {
    const seen = [];
    NET.onStatus = (m) => seen.push(m);
    NET.status('hello world');
    expect(seen).toContain('hello world');
  });

  it('a roster message fires onRoster with the players list', () => {
    const rosters = [];
    NET.onRoster = (players) => rosters.push(players);
    NET.role = 'client';
    NET.onMessage({ t: 'roster', players: [{ id: NET.myId, name: 'Firey', isHost: false }] });
    expect(rosters.at(-1)).toHaveLength(1);
  });

  it('listRooms() fetches the registry and returns the rooms array', async () => {
    const fakeRooms = [{ code: 'WXYZ', host: 'Bomby', count: 1, createdAt: 1 }];
    globalThis.fetch = vi.fn().mockResolvedValue({ json: async () => ({ rooms: fakeRooms }) });
    const rooms = await NET.listRooms();
    expect(rooms).toEqual(fakeRooms);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('host() opens a PUBLIC room (isPublic true) and never opens a socket in this unit test', () => {
    // Stub connect so no real WebSocket is constructed under jsdom.
    const origConnect = NET.connect;
    NET.connect = () => {};
    NET.host();
    expect(NET.isPublic).toBe(true);
    expect(typeof NET.room).toBe('string');
    expect(NET.room).toMatch(/^[A-Z0-9]{4}$/);
    NET.connect = origConnect;
  });
});
```

- [ ] **Step 2: Run it, verify it fails**
```
npx vitest run test/net/netcode-rooms.test.js
```
Expected: `FAIL` — `NET.wsURL()` still uses `location.host` (no relay-config), `NET.listRooms`/`NET.onStatus` undefined, `NET.isPublic` undefined.

- [ ] **Step 3: Minimal implementation** — apply these edits to `src/net/netcode.js`.

  1. Add the config import near the top imports:
```js
import { relayWsUrl, relayHttpUrl } from './relay-config.js';
```
  2. Add callback + public fields to the `NET` object literal (next to `room`, `role`, …):
```js
  isPublic: true,        // public rooms appear in the browser list (Plan D)
  onRoster: null,        // UI hook: fn(players)  — set by ui/rooms.js
  onStatus: null,        // UI hook: fn(msg)      — set by ui/rooms.js
  openRoomsUI: null,     // UI hook: fn()         — set by ui/rooms.js (Lite rooms screen)
```
  3. Replace the whole `wsURL(addr){…}` method with the relay-config version:
```js
  // Rooms model: the relay shards on ?room=CODE; the endpoint comes from relay-config
  // (VITE_RELAY_URL at build, else same-origin /api/ws). No manual IP entry anymore.
  wsURL() { return relayWsUrl(this.room); },
```
  4. In `host()`, set `this.isPublic = true` before `this.connect(...)`:
```js
  host(){
    this.role="host"; this.myIdx=0;
    this.room = this.makeRoomCode();
    this.isPublic = true;
    this.connect(null, true);
    this.showAddress();
  },
```
  5. In `connect(addr, asHost)`, include the public flag in the `hello`:
```js
      this.send({t:"hello", id:this.myId, host:!!asHost, name:(chosen?chosen.name:"?"), public:this.isPublic});
```
  6. In `onMessage`, after `this.players=m.players; this.renderLobby();`, fire the roster hook:
```js
    if(m.t==="roster"){ this.players=m.players; this.renderLobby();
      if(this.onRoster) try{ this.onRoster(m.players); }catch(e){}
      const me=this.players.findIndex(p=>p.id===this.myId);
      if(me>=0 && this.role==="client") this.myIdx=me;
    }
```
  7. In `status(msg)`, fire the status hook (keep the existing DOM write for desktop):
```js
  status(msg){ if(this.onStatus) try{ this.onStatus(msg); }catch(e){} const el=document.getElementById('lobbyStatus'); if(el) el.textContent=msg; },
```
  8. Add `listRooms()` to the `NET` object (before the closing `}`):
```js
  // Fetch the public room registry for the browser list. Never called at import.
  async listRooms(){
    try{ const res = await fetch(relayHttpUrl('/rooms')); return (await res.json()).rooms || []; }
    catch(e){ return []; }
  },
```
  9. Replace `autoJoinFromLink` with the rooms-model version:
```js
// If someone opened a shared invite link (…#room=ABCD), open the rooms UI and join.
export function autoJoinFromLink(){
  const m = (location.hash||"").match(/room=([A-Za-z0-9]{2,8})/);
  if(!m) return false;
  const code = m[1].toUpperCase();
  if(typeof NET.openRoomsUI === "function") NET.openRoomsUI(); else go('lobby');
  setTimeout(()=>{ try{ NET.join(code); }catch(e){} }, 60);
  return code;
}
```
  > `serializeState`, `applySnapshot`, `join`, `leave`, `send`, `renderLobby`, `showAddress`, `startAsHost`, `beginMatch`, `broadcastState`, `sendInput`, `makeRoomCode`, and `openLobby` are **unchanged**. Desktop (`main.js`) keeps working: it never sets `onRoster`/`onStatus`/`openRoomsUI`, so those hooks stay null and the existing `#lobbyRoster`/`#lobbyStatus` DOM writes still drive the desktop lobby.

- [ ] **Step 4: Run tests, verify pass**
```
npx vitest run test/net/netcode-rooms.test.js test/netcode.test.js
```
Expected: `PASS` — the new rooms wiring passes AND Plan A's `test/netcode.test.js` (window.NET at import, no socket at eval, `applySnapshot` in-place) stays green (the `applySnapshot`/`serializeState` bodies were not touched). Then confirm the whole suite:
```
npm test
```
Expected: `PASS` — full harness green (including `test/modules-eval.test.js` still asserting `WebSocket === 0` at module eval, since only `window.NET = NET` runs at import and the socket opens in `connect()`).

- [ ] **Step 5: Commit**
```
git add src/net/netcode.js test/net/netcode-rooms.test.js
git commit -m "feat(net): rewire netcode to relay-config rooms model (public rooms, listRooms, UI hooks)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Rooms UI module — `src/ui/rooms.js`

**Files:**
- Create: `src/ui/rooms.js`
- Test: `test/rooms/rooms-ui.test.js`
**Interfaces:**
- Consumes: `go` (`ui/router.js`); `NET` (`net/netcode.js`); `relayHttpUrl` is reached via `NET.listRooms()` (no direct dep). Reads the `#rooms` shell DOM (Task 5).
- Produces: `initRooms()` (subscribes `NET.onStatus`/`NET.onRoster`/`NET.openRoomsUI`), `openRooms()`, `createRoom()`, `joinRoomByCode(code?)`, `refreshRoomBrowser()`, `copyRoomLink()`, `leaveRoom()`. No import-time side effects (no socket, no fetch, no DOM at eval). Online uses the **full** `ROSTER` (unfiltered) — this module adds no content filtering.

- [ ] **Step 1: Write the failing test**
```js
// test/rooms/rooms-ui.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { NET } from '../../src/net/netcode.js';
import {
  initRooms, openRooms, createRoom, joinRoomByCode, refreshRoomBrowser, leaveRoom,
} from '../../src/ui/rooms.js';

function mountShell() {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="title" class="screen active"></div>
    <div id="rooms" class="screen">
      <div id="roomStatus"></div>
      <div id="roomInvite" style="display:none"></div>
      <input id="roomCodeInput" />
      <div id="roomBrowser"></div>
      <div id="roomRoster"></div>
    </div></body>`);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  return dom;
}

beforeEach(() => { mountShell(); NET.onRoster = null; NET.onStatus = null; NET.openRoomsUI = null; });

describe('rooms UI', () => {
  it('initRooms subscribes the NET callbacks', () => {
    initRooms();
    expect(typeof NET.onStatus).toBe('function');
    expect(typeof NET.onRoster).toBe('function');
    expect(typeof NET.openRoomsUI).toBe('function');
  });

  it('onStatus writes #roomStatus; onRoster renders the roster list', () => {
    initRooms();
    NET.onStatus('Hosting — waiting');
    expect(document.getElementById('roomStatus').textContent).toBe('Hosting — waiting');
    NET.onRoster([{ id: 'x', name: 'Firey', isHost: true }, { id: 'y', name: 'Leafy' }]);
    expect(document.getElementById('roomRoster').children).toHaveLength(2);
    expect(document.getElementById('roomRoster').textContent).toMatch(/Firey/);
  });

  it('createRoom hosts a public room and shows a copyable invite with the code', () => {
    NET.connect = () => {};      // no real socket under jsdom
    createRoom();
    expect(NET.isPublic).toBe(true);
    const inv = document.getElementById('roomInvite');
    expect(inv.style.display).toBe('block');
    expect(inv.querySelector('.inv-code').textContent).toMatch(/^[A-Z0-9]{4}$/);
    expect(inv.querySelector('#roomInviteLink').value).toMatch(/#room=/);
  });

  it('joinRoomByCode passes the input value to NET.join', () => {
    const spy = vi.spyOn(NET, 'join').mockImplementation(() => {});
    document.getElementById('roomCodeInput').value = 'abcd';
    joinRoomByCode();
    expect(spy).toHaveBeenCalledWith('abcd');
    spy.mockRestore();
  });

  it('refreshRoomBrowser lists open rooms with Join buttons', async () => {
    vi.spyOn(NET, 'listRooms').mockResolvedValue([{ code: 'WXYZ', host: 'Bomby', count: 1 }]);
    await refreshRoomBrowser();
    const browser = document.getElementById('roomBrowser');
    expect(browser.textContent).toMatch(/WXYZ/);
    expect(browser.querySelector('button')).not.toBeNull();
  });

  it('leaveRoom calls NET.leave without throwing', () => {
    const spy = vi.spyOn(NET, 'leave').mockImplementation(() => {});
    expect(() => leaveRoom()).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**
```
npx vitest run test/rooms/rooms-ui.test.js
```
Expected: `FAIL` — `Failed to resolve import "../../src/ui/rooms.js"`.

- [ ] **Step 3: Minimal implementation**
```js
// src/ui/rooms.js
// The Lite "Online Rooms" section: create a room (code + shareable link), join by
// code, and a browser of open public rooms from the relay registry. Reuses window.NET
// (netcode.js) for the socket + serializeState/applySnapshot; adds no game logic and
// no import-time side effects (no socket, no fetch, no DOM at module eval). Online
// play uses the FULL roster (unfiltered) + the trimmed Lite stage subset.
import { go } from './router.js';
import { NET } from '../net/netcode.js';

function el(id) { return document.getElementById(id); }

// Wire the rooms UI to NET events. netcode calls these hooks if set (Task 3).
export function initRooms() {
  NET.onStatus = (msg) => { const s = el('roomStatus'); if (s) s.textContent = msg; };
  NET.onRoster = (players) => renderRoster(players);
  NET.openRoomsUI = () => openRooms();
}

export function openRooms() {
  go('rooms');
  const inv = el('roomInvite'); if (inv) { inv.style.display = 'none'; inv.innerHTML = ''; }
  const st = el('roomStatus'); if (st) st.textContent = 'Not connected';
  renderRoster([]);
  refreshRoomBrowser();
}

export function createRoom() {
  NET.isPublic = true;
  NET.host();          // makes a code, connects, marks the room public (Task 3)
  showInvite();
}

export function joinRoomByCode(code) {
  const raw = code != null ? code : (el('roomCodeInput') ? el('roomCodeInput').value : '');
  NET.join(String(raw));
}

export function copyRoomLink() {
  const input = el('roomInviteLink');
  if (!input) return;
  try {
    input.select();
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(input.value);
    else document.execCommand('copy');
    NET.status('Invite link copied — send it to a friend');
  } catch (e) { NET.status('Select the link and copy it manually'); }
}

export function leaveRoom() { try { NET.leave(); } catch (e) {} }

export async function refreshRoomBrowser() {
  const list = el('roomBrowser'); if (!list) return;
  list.innerHTML = '<div class="tag">Loading open rooms…</div>';
  const rooms = await NET.listRooms();
  list.innerHTML = '';
  if (!rooms.length) { list.innerHTML = '<div class="tag">No open rooms — create one!</div>'; return; }
  for (const r of rooms) {
    const row = document.createElement('div');
    row.className = 'lobbyplayer';
    row.textContent = r.code + ' · ' + (r.host || 'host') + ' · ' + (r.count || 1) + ' in ';
    const join = document.createElement('button');
    join.className = 'btn alt xs'; join.textContent = 'Join';
    join.onclick = () => joinRoomByCode(r.code);
    row.appendChild(join);
    list.appendChild(row);
  }
}

function showInvite() {
  const box = el('roomInvite'); if (!box) return;
  const code = NET.room || '----';
  const link = location.origin + location.pathname + '#room=' + code;
  box.style.display = 'block';
  box.innerHTML =
    '<div class="inv-code">' + code + '</div>' +
    '<div class="inv-sub">Tell a friend this code, or send the link.</div>' +
    '<div class="inv-row"><input class="netinput" id="roomInviteLink" readonly value="' + link + '"/>' +
    '<button class="btn alt sm" onclick="copyRoomLink()">📋 Copy link</button></div>';
}

function renderRoster(players) {
  const box = el('roomRoster'); if (!box) return;
  box.innerHTML = '';
  (players || []).forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'lobbyplayer' + (p.isHost ? ' host' : '');
    d.textContent = (i + 1) + '. ' + (p.name || 'player') + (p.id === NET.myId ? ' (you)' : '');
    box.appendChild(d);
  });
}
```

- [ ] **Step 4: Run tests, verify pass**
```
npx vitest run test/rooms/rooms-ui.test.js
```
Expected: `PASS` — 6 passed.

- [ ] **Step 5: Commit**
```
git add src/ui/rooms.js test/rooms/rooms-ui.test.js
git commit -m "feat(ui): rooms.js — create/join-by-code/browser section over window.NET

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `index.lite.html` — add the `#rooms` screen + title entry (amends Plan C shell contract)

**Files:**
- Modify: `index.lite.html` (add `#rooms` `.screen`, add a "Play Online" title button)
- Modify (amend, Plan C): `test/lite/lite-shell-contract.test.js`
**Interfaces:**
- Consumes: the existing `.lobbywrap`/`.lobbycol`/`.netinput`/`.roomcode`/`.lobbyroster`/`.lobbyinvite`/`.inv-code`/`.inv-sub`/`.inv-row` CSS classes (already in `styles/app.css` from the monolith LAN lobby styles — reused verbatim, no new CSS).
- Produces: a `#rooms` screen whose inline handlers (`openRooms`, `createRoom`, `joinRoomByCode`, `refreshRoomBrowser`, `copyRoomLink`, `leaveRoom`, `go`) are all Lite-bridged (Task 6), plus a title button `onclick="openRooms()"`. The Plan C shell test is amended to expect `rooms` among the screens and to move the rooms handlers out of the "banned" set into the "needed" set.

- [ ] **Step 1: Amend the failing test** — edit `test/lite/lite-shell-contract.test.js`:

  1. In the first `it(...)` (screen id list), add `'rooms'` to the expected set:
```js
    expect(ids).toEqual(
      ['controls', 'result', 'rooms', 'select', 'title', 'tourneyHub', 'tourneySetup', 'tutorial'].sort()
    );
```
  2. In the "references no handler for a dropped module" `it(...)`, **remove** `'openLobby'` from the `banned` array (Lite now has an online section) — leave the editor/test/stats/co-op bans intact — and extend the `need` array with the rooms handlers:
```js
    for (const need of ['go', 'startMatch', 'startTutorial', 'kickOffTournament', 'toggleSound',
                        'openRooms', 'createRoom', 'joinRoomByCode', 'refreshRoomBrowser',
                        'copyRoomLink', 'leaveRoom']) {
      expect([...idents], need).toContain(need);
    }
```
  Add a fresh `it(...)` asserting the rooms screen scaffolding exists:
```js
  it('includes the online rooms screen with create/join/browser scaffolding', () => {
    const rooms = doc.getElementById('rooms');
    expect(rooms).not.toBeNull();
    expect(rooms.classList.contains('screen')).toBe(true);
    for (const id of ['roomStatus', 'roomInvite', 'roomCodeInput', 'roomBrowser', 'roomRoster']) {
      expect(doc.getElementById(id), id).not.toBeNull();
    }
  });
```

- [ ] **Step 2: Run it, verify it fails**
```
npx vitest run test/lite/lite-shell-contract.test.js
```
Expected: `FAIL` — `#rooms` screen absent; `openRooms` not found among needed handlers.

- [ ] **Step 3: Minimal implementation** — edit `index.lite.html`:

  1. On the title screen `.row`, add the online entry next to the existing Lite buttons:
```html
      <button class="btn alt sm" onclick="openRooms()">🌐 Play Online</button>
```
  2. Add the `#rooms` screen block (place it after `#tourneyHub`, before `#result`; classes are the monolith LAN-lobby styles reused verbatim):
```html
  <!-- ONLINE ROOMS (Plan D) — create/join by code + public room browser -->
  <div id="rooms" class="screen">
    <div class="brand">🌐 Online Rooms</div>
    <div class="tag" id="roomStatus">Not connected</div>
    <div class="lobbywrap">
      <div class="lobbycol">
        <div class="brand">Create a room</div>
        <p>Get a 4-letter code and a link to share with a friend.</p>
        <button class="btn" onclick="createRoom()">Create Room</button>
        <div id="roomInvite" class="lobbyinvite" style="display:none"></div>
      </div>
      <div class="lobbycol">
        <div class="brand">Join by code</div>
        <input id="roomCodeInput" class="netinput roomcode" maxlength="4" placeholder="CODE" autocomplete="off" spellcheck="false" />
        <button class="btn alt" onclick="joinRoomByCode()">Join Room</button>
      </div>
    </div>
    <div class="brand">Open rooms <button class="btn ghost xs" onclick="refreshRoomBrowser()">↻ Refresh</button></div>
    <div id="roomBrowser" class="lobbyroster"></div>
    <div id="roomRoster" class="lobbyroster"></div>
    <button class="btn ghost sm" onclick="leaveRoom(); go('title')">◀ Back</button>
  </div>
```

- [ ] **Step 4: Run tests, verify pass**
```
npx vitest run test/lite/lite-shell-contract.test.js
```
Expected: `PASS` — all shell-contract assertions green, now including the `#rooms` screen and the six rooms handlers.

- [ ] **Step 5: Commit**
```
git add index.lite.html test/lite/lite-shell-contract.test.js
git commit -m "feat(lite): add #rooms screen + Play Online entry to the Lite shell

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire netcode + rooms into the Lite build (entry, bridge, vite exclude, handler coverage)

**Files:**
- Modify: `src/main.lite.js` (import rooms, `initRooms()`, `autoJoinFromLink()`)
- Modify: `src/ui/global-actions.lite.js` (add the 6 rooms handlers → 18-symbol bridge)
- Modify: `vite.config.js` (drop `netcode.js` from the `bfsi-lite-exclude` STUBS map; keep `coop-planning.js`)
- Modify (amend, Plan C): `test/lite/global-actions-lite.test.js`, `test/lite/main-lite-boot.test.js`, `test/lite/handler-coverage.test.js`, `test/lite/vite-config.test.js`
**Interfaces:**
- Consumes: `src/ui/rooms.js` (Task 4), the rewired `src/net/netcode.js` (Task 3), `autoJoinFromLink` (netcode), `assertHandlerCoverage` (Plan A).
- Produces: the Lite entry now imports `rooms.js` (pulling in real `netcode.js`), calls `initRooms()` and `autoJoinFromLink()` at boot; the Lite bridge assigns 18 symbols (the 12 Plan-C symbols + `openRooms`,`createRoom`,`joinRoomByCode`,`refreshRoomBrowser`,`copyRoomLink`,`leaveRoom`); `vite.config.js` redirects **only** `coop-planning.js` to a Lite stub (netcode is bundled for real).

- [ ] **Step 1: Amend the failing tests**

  `test/lite/global-actions-lite.test.js` — (a) remove `'netcode.js'` from the banned-import list (keep editor/coop/music), (b) update the exact assigned-symbol set to 18:
```js
  it('imports no excluded module', () => {
    for (const bad of ['level-editor', 'coop-planning.js', 'music-director', 'stem-player']) {
      expect(src, bad).not.toMatch(new RegExp(`from\\s+['"][^'"]*${bad.replace('.', '\\.')}`));
    }
  });
  it('assigns exactly the 18 Lite handler symbols to window', () => {
    const assigned = [...src.matchAll(/window\.(\w+)\s*=/g)].map(m => m[1]).sort();
    expect(assigned).toEqual([
      'copyRoomLink', 'createRoom', 'endTournament', 'finishTutorial', 'go', 'joinRoomByCode',
      'kickOffTournament', 'leaveRoom', 'openRooms', 'openTournamentSetup', 'openTutorial',
      'refreshRoomBrowser', 'resetKeys', 'simRestOfRound', 'startMatch', 'startTutorial',
      'toggleSound', 'tutorialSeen',
    ].sort());
  });
  it('wraps each assignment in try/catch', () => {
    expect((src.match(/try\s*{/g) || []).length).toBeGreaterThanOrEqual(18);
  });
```

  `test/lite/main-lite-boot.test.js` — reverse the Plan C netcode/auto-join bans:
```js
  it('imports the rooms section and the Lite bridge', () => {
    expect(src).toMatch(/global-actions\.lite\.js/);
    expect(src).toMatch(/from\s+['"]\.\/ui\/rooms\.js['"]/);
    expect(src).not.toMatch(/from\s+['"][^'"]*\/global-actions\.js/);
  });
  it('opens the rooms UI on an invite link (autoJoinFromLink) and initialises rooms', () => {
    expect(src).toMatch(/initRooms\s*\(/);
    expect(src).toMatch(/autoJoinFromLink\s*\(/);
  });
  it('still imports NO editor/music module and never registers a music director', () => {
    for (const bad of ['level-editor', 'coop-planning.js', 'music-director', 'stem-player', 'manifest']) {
      expect(src, bad).not.toMatch(new RegExp(`from\\s+['"][^'"]*${bad.replace('.', '\\.')}`));
    }
    expect(src).not.toMatch(/setMusicDirector/);
  });
  it('asserts handler coverage at boot with (win, root) argument order', () => {
    expect(src).toMatch(/assertHandlerCoverage\s*\(\s*window\s*,\s*document\s*\)/);
  });
```

  `test/lite/handler-coverage.test.js` — extend `LITE_BRIDGE` to 18 and update the dropped-handler set (drop `openLobby` from "gone" only if you keep it excluded; it remains excluded since Lite uses `openRooms`, not `openLobby`):
```js
const LITE_BRIDGE = [
  'go', 'toggleSound', 'openTutorial', 'startTutorial', 'finishTutorial', 'tutorialSeen',
  'openTournamentSetup', 'kickOffTournament', 'endTournament', 'simRestOfRound',
  'startMatch', 'resetKeys',
  'openRooms', 'createRoom', 'joinRoomByCode', 'refreshRoomBrowser', 'copyRoomLink', 'leaveRoom',
];
```
  (The "dropped-module handlers must be absent" check keeps `openEditor`, `openTest`, `openStats`, `planSend`, and `openLobby` — the desktop lobby entry — in its `gone` list.)

  `test/lite/vite-config.test.js` — the "redirects only the two stubbed basenames" test must now assert netcode is **not** redirected while coop still is:
```js
  it('the exclude plugin redirects only coop-planning in lite (netcode is bundled for real)', async () => {
    const mod = await import('../../vite.config.js');
    const cfg = mod.default({ mode: 'lite', command: 'build' });
    const plugin = cfg.plugins.flat().find(p => p && p.name === 'bfsi-lite-exclude');
    expect(plugin.resolveId('./coop-planning.js')).toMatch(/coop-planning\.lite\.js$/);
    expect(plugin.resolveId('../net/netcode.js')).toBeNull();   // Plan D: netcode ships in Lite
    expect(plugin.resolveId('../engine/fighter.js')).toBeNull();
  });
```

- [ ] **Step 2: Run them, verify they fail**
```
npx vitest run test/lite/global-actions-lite.test.js test/lite/main-lite-boot.test.js test/lite/handler-coverage.test.js test/lite/vite-config.test.js
```
Expected: `FAIL` — main.lite.js doesn't import rooms/auto-join, bridge assigns only 12, vite still stubs netcode.

- [ ] **Step 3: Minimal implementation**

  `src/ui/global-actions.lite.js` — add the rooms imports + bridge entries:
```js
import { openRooms, createRoom, joinRoomByCode, refreshRoomBrowser, copyRoomLink, leaveRoom } from './rooms.js';
```
  Extend the `bridge` object with the six symbols:
```js
const bridge = {
  go, toggleSound,
  openTutorial, startTutorial, finishTutorial, tutorialSeen,
  openTournamentSetup, kickOffTournament, endTournament, simRestOfRound,
  startMatch, resetKeys,
  openRooms, createRoom, joinRoomByCode, refreshRoomBrowser, copyRoomLink, leaveRoom,
};
```
  (The existing `for…try/catch` loop already isolates each assignment — now 18 iterations.)

  `src/main.lite.js` — add the rooms wiring to the Lite boot (imports at top; calls in `boot()`):
```js
import { initRooms } from './ui/rooms.js';
import { autoJoinFromLink } from './net/netcode.js';
```
  In `boot()`, after `assertHandlerCoverage(window, document);` and `buildBoard();`, add:
```js
  initRooms();          // subscribe the rooms UI to NET events
  autoJoinFromLink();   // if the page opened via …#room=CODE, open Rooms and join
```
  > Note the Plan C `main.lite.js` comment block said "NO autoJoinFromLink() — Lite has no room links." Update that comment to reflect Plan D: Lite now has online rooms; `autoJoinFromLink` opens the rooms screen (via `NET.openRoomsUI`, set by `initRooms`) and joins. The music contract is unchanged — `main.lite.js` still never imports `music-director.js` and never calls `setMusicDirector`.

  `vite.config.js` — drop `netcode.js` from the stub map inside `liteExcludePlugin`:
```js
  const STUBS = {
    // Plan D: netcode.js now ships in Lite (online rooms), so it is NOT redirected.
    'coop-planning.js': r('./src/modes/coop-planning.lite.js'),
  };
```
  Add the build-time env passthrough so `VITE_RELAY_URL` reaches `relay-config.js` (Vite exposes `import.meta.env.VITE_*` automatically; no config change needed for that, but document it). No other config change.

- [ ] **Step 4: Run tests, verify pass**
```
npx vitest run test/lite/global-actions-lite.test.js test/lite/main-lite-boot.test.js test/lite/handler-coverage.test.js test/lite/vite-config.test.js
```
Expected: `PASS` — all four amended suites green. Then the full suite (these edit Plan-C/Plan-A-shared files):
```
npm test
```
Expected: `PASS` — whole harness green.

- [ ] **Step 5: Commit**
```
git add src/main.lite.js src/ui/global-actions.lite.js vite.config.js test/lite/global-actions-lite.test.js test/lite/main-lite-boot.test.js test/lite/handler-coverage.test.js test/lite/vite-config.test.js
git commit -m "feat(lite): ship netcode + rooms in the Lite build (18-symbol bridge, netcode un-stubbed)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Amend the Lite tree-shake test — netcode ALLOWED, editor/co-op/music still excluded

> **This is the explicit edit the design (D-3) calls for.** Plan C's `test/lite/tree-shake.test.js` asserted `dist-lite` contains **no** netcode (`new WebSocket`/`broadcastState`/`sendInput`). From Plan D onward netcode is a shipped Lite feature, so that assertion is **inverted**: the bundle must now **contain** netcode/rooms markers, while `editor`/`coop-planning`/`music-director`/`stem-player`/`manifest` remain provably absent.

**Files:**
- Modify (amend, Plan C): `test/lite/tree-shake.test.js`
**Interfaces:**
- Consumes: a built `dist-lite/` (the test builds it if missing).
- Produces: the Lite bundle-symbol contract from Plan D onward — netcode + rooms present; editor / co-op LLM / music engine / manifest / stats absent.

- [ ] **Step 1: Amend the test** — in `test/lite/tree-shake.test.js`, **replace** the `it('contains NO LAN/netcode code', …)` block with an inverted assertion, and add a rooms-present check; leave the editor/co-op/music/stats blocks unchanged:
```js
  it('DOES contain netcode + rooms code (Plan D: online rooms ship in Lite)', () => {
    expect(js).toMatch(/new WebSocket/);      // NET.connect opens a real socket in Lite now
    expect(js).toMatch(/broadcastState/);     // host snapshot relay retained
    expect(js).toMatch(/serializeState|applySnapshot/);
    expect(js).toMatch(/listRooms|roomBrowser|Create Room|createRoom/); // rooms UI present
  });

  it('still contains NO level-editor code', () => {
    expect(js).not.toMatch(/playCustomLevel/);
    expect(js).not.toMatch(/edRenderList/);
  });
  it('still contains NO co-op LLM code', () => {
    expect(js).not.toMatch(/api\.anthropic\.com/);
    expect(js).not.toMatch(/planLLM/);
  });
  it('still contains NO music-engine code (music-director / stem-player / manifest)', () => {
    expect(js).not.toMatch(/decodeAudioData/);
    expect(js).not.toMatch(/AudioBufferSourceNode/);
    expect(js).not.toMatch(/sampleMatchIntensity/);
    expect(js).not.toMatch(/koStinger/);
    expect(js).not.toMatch(/assets\/music/);
  });
  it('still contains NO stats-viewer code', () => {
    expect(js).not.toMatch(/exportStats/);
  });
```
  (The final "DOES contain the kept modes + SFX" sanity block is unchanged.)

- [ ] **Step 2: Run it, verify state**
```
npm run build:lite && npx vitest run test/lite/tree-shake.test.js
```
Expected before Task 6 is complete: the netcode-present assertion `FAIL`s (netcode still stubbed out). After Task 6: netcode/rooms markers are present.

- [ ] **Step 3: No product code** — this task is purely the test amendment. If the "still contains NO …" assertions fail, a kept module has pulled an excluded one into the graph (e.g. `rooms.js` accidentally importing `coop-planning.js`) — trace and fix the stray import rather than loosening the assertion. The netcode-present assertions failing means Task 6's un-stubbing or `main.lite.js` import didn't land.

- [ ] **Step 4: Run tests, verify pass**
```
npm run build:lite && npx vitest run test/lite/tree-shake.test.js
```
Expected: `PASS` — netcode + rooms present; editor / co-op / music / manifest / stats absent.

- [ ] **Step 5: Commit**
```
git add test/lite/tree-shake.test.js
git commit -m "test(lite): amend tree-shake — netcode/rooms allowed in dist-lite; editor/coop/music still excluded

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Relay deployment — host config, endpoint env, and a smoke test

**Files:**
- Create: `server/Dockerfile`
- Create: `server/Procfile` (for buildpack/PaaS hosts)
- Create: `scripts/smoke-rooms.mjs`
- Create: `docs/superpowers/plans/relay-deploy.md` (short runbook)
- Modify: `package.json` (`"smoke:rooms"` script)
**Interfaces:**
- Consumes: `server/relay.js` (Task 2), `ws` (smoke client). The deployed relay listens on `$PORT`; the Lite build is built with `VITE_RELAY_URL` pointing at the relay's `wss://…/ws` (or same-origin `/api/ws` behind a reverse proxy).
- Produces: a container/PaaS-hostable relay, a build-time endpoint wiring, and a `node scripts/smoke-rooms.mjs <wsBase> <httpList>` that verifies create → join → snapshot-exchange → browse against any deployed relay.

- [ ] **Step 1: Write the failing smoke check** — the smoke script IS the test; verify it fails cleanly with no relay running:
```
node scripts/smoke-rooms.mjs ws://localhost:8080/ws http://localhost:8080/rooms
```
Expected before Step 3: `FAIL` — `Error: connect ECONNREFUSED` (no `scripts/smoke-rooms.mjs` yet → `Cannot find module`, then once written, connection refused with no relay up).

- [ ] **Step 2: Start a local relay to test against**
```
npm run relay
```
Expected (in a second shell): `[relay] listening on :8080  (ws /ws?room=CODE, list GET /rooms, GET /health)`.

- [ ] **Step 3: Minimal implementation**

  `scripts/smoke-rooms.mjs`:
```js
// scripts/smoke-rooms.mjs
// Smoke-test a DEPLOYED (or local) relay end to end: a host creates a public room,
// a client joins by code, they exchange a snapshot, and the room shows in the public
// browser list. Usage:
//   node scripts/smoke-rooms.mjs wss://relay.example.com/ws https://relay.example.com/rooms
import WebSocket from 'ws';

const wsBase = process.argv[2] || 'ws://localhost:8080/ws';
const httpList = process.argv[3] || 'http://localhost:8080/rooms';
const code = 'SMOK';

const open = (url) => new Promise((res, rej) => {
  const ws = new WebSocket(url);
  ws.once('open', () => res(ws)); ws.once('error', rej);
});
const once = (ws, pred) => new Promise((res) => {
  const on = (b) => { const m = JSON.parse(b.toString()); if (!pred || pred(m)) { ws.off('message', on); res(m); } };
  ws.on('message', on);
});

const host = await open(`${wsBase}?room=${code}`);
host.send(JSON.stringify({ t: 'hello', id: 'smoke-host', host: true, name: 'SmokeHost', public: true }));
await once(host, (m) => m.t === 'roster');

const client = await open(`${wsBase}?room=${code}`);
const gotRoster = once(client, (m) => m.t === 'roster');
client.send(JSON.stringify({ t: 'hello', id: 'smoke-client', host: false, name: 'SmokeClient' }));
if ((await gotRoster).players.length !== 2) throw new Error('roster did not reach 2 players');

const gotState = once(client, (m) => m.t === 'state');
host.send(JSON.stringify({ t: 'state', s: { t: 1, ok: true } }));
if (!(await gotState).s.ok) throw new Error('snapshot not relayed to client');

const list = await (await fetch(httpList)).json();
if (!list.rooms.some((r) => r.code === code)) throw new Error('room not in public browser list');

console.log('SMOKE OK: create + join + snapshot + browse against', wsBase);
host.close(); client.close();
process.exit(0);
```

  `server/Dockerfile`:
```dockerfile
# Lightweight relay host. Copies only the server + ws dependency.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/relay.js"]
```

  `server/Procfile` (buildpack/PaaS hosts like Railway/Render/Fly/Heroku):
```
web: node server/relay.js
```

  `package.json` script:
```json
{ "scripts": { "smoke:rooms": "node scripts/smoke-rooms.mjs" } }
```

  `docs/superpowers/plans/relay-deploy.md` (runbook):
```md
# Relay deployment runbook

The relay is a single stateless Node process (`server/relay.js`, deps: `ws`). Any host
that runs Node ≥ 18 and exposes a `$PORT` works.

## Host it
- **Container:** `docker build -f server/Dockerfile -t bfsi-relay . && docker run -p 8080:8080 bfsi-relay`
- **PaaS (Railway/Render/Fly/Heroku):** deploy the repo; the `server/Procfile` runs `node server/relay.js`; the platform injects `$PORT`.
- Endpoints: `GET /health`, `GET /rooms` (public list), WS upgrade at `/ws?room=CODE`.

## Point the Lite build at it
Build the web app with the relay endpoint baked in:
```
VITE_RELAY_URL=wss://<your-relay-host>/ws npm run build:lite
```
Or, if you reverse-proxy the relay under the site's own origin at `/api/ws` + `/api/rooms`,
leave `VITE_RELAY_URL` unset — `src/net/relay-config.js` falls back to same-origin `/api/*`.

## Smoke-test the deployed relay
```
node scripts/smoke-rooms.mjs wss://<your-relay-host>/ws https://<your-relay-host>/rooms
```
Expect: `SMOKE OK: create + join + snapshot + browse against wss://<your-relay-host>/ws`.
```

- [ ] **Step 4: Run the smoke test against the local relay, verify pass** (with `npm run relay` running from Step 2)
```
npm run smoke:rooms -- ws://localhost:8080/ws http://localhost:8080/rooms
```
Expected: `SMOKE OK: create + join + snapshot + browse against ws://localhost:8080/ws`, exit 0. Also verify a built Lite bundle bakes the endpoint:
```
VITE_RELAY_URL=wss://relay.example.com/ws npm run build:lite
```
Expected: build succeeds; grepping `dist-lite/assets/*.js` for `relay.example.com` finds the baked endpoint (proves `VITE_RELAY_URL` reaches `relay-config.js`).

- [ ] **Step 5: Commit**
```
git add server/Dockerfile server/Procfile scripts/smoke-rooms.mjs docs/superpowers/plans/relay-deploy.md package.json
git commit -m "chore(relay): deployment (Dockerfile/Procfile), endpoint env wiring, rooms smoke test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Two-browser rooms e2e — create + join by code + browse against a live relay

**Files:**
- Create: `test/rooms/e2e/rooms.spec.js`
- Create: `test/rooms/e2e/global-setup.mjs` (builds `dist-lite` with a test relay endpoint + starts the relay)
- Modify: `playwright.config.js` (add the rooms e2e project + preview webServer)
- Modify: `package.json` (`"test:rooms:e2e"` script)
**Interfaces:**
- Consumes: `createRelay` (Task 2), the built `dist-lite/` served by `vite preview --mode lite`.
- Produces: a headless-Chromium proof that two independent browser contexts complete the full room-code flow — host creates a room and sees its 4-letter code, the joiner sees that room in the public browser list AND joins it by code, and the host's roster grows to 2 — end to end through the real relay.

- [ ] **Step 1: Write the failing test**
```js
// test/rooms/e2e/rooms.spec.js
import { test, expect } from '@playwright/test';

test('two players: host creates a room, joiner browses + joins by code', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  await host.goto('/index.lite.html');
  await host.getByRole('button', { name: /Play Online/i }).click();
  await host.getByRole('button', { name: /Create Room/i }).click();
  const codeEl = host.locator('#roomInvite .inv-code');
  await expect(codeEl).toHaveText(/^[A-Z0-9]{4}$/);
  const code = (await codeEl.textContent()).trim();

  const joinCtx = await browser.newContext();
  const joiner = await joinCtx.newPage();
  await joiner.goto('/index.lite.html');
  await joiner.getByRole('button', { name: /Play Online/i }).click();

  // The public browser list shows the host's room.
  await joiner.getByRole('button', { name: /Refresh/i }).click();
  await expect(joiner.locator('#roomBrowser')).toContainText(code);

  // Join by code.
  await joiner.locator('#roomCodeInput').fill(code);
  await joiner.getByRole('button', { name: /Join Room/i }).click();

  // Host's roster grows to two players.
  await expect(host.locator('#roomRoster')).toContainText('2.');

  await hostCtx.close(); await joinCtx.close();
});
```

  `test/rooms/e2e/global-setup.mjs`:
```js
// Builds dist-lite with a fixed test relay endpoint and starts the relay in-process.
// Returns a teardown that stops the relay. Playwright calls this once before the run.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRelay } from '../../../server/relay.js';

const RELAY_PORT = 8090;

export default async function globalSetup() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  execSync('npm run build:lite', {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, VITE_RELAY_URL: `ws://localhost:${RELAY_PORT}/ws` },
  });
  const relay = createRelay({ port: RELAY_PORT });
  await relay.listen();
  return async () => { await relay.close(); };
}
```

- [ ] **Step 2: Run it, verify it fails**
```
npx playwright test test/rooms/e2e/rooms.spec.js
```
Expected: `FAIL` — no rooms e2e project / preview server / global setup configured yet.

- [ ] **Step 3: Minimal implementation** — merge the rooms project into `playwright.config.js` (Plan C already added a Lite preview project; add a second project for rooms with the global setup):
```js
// playwright.config.js — rooms e2e (merge into the existing config's `projects`/`webServer`)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/rooms/e2e',
  globalSetup: './test/rooms/e2e/global-setup.mjs',
  use: { baseURL: 'http://localhost:4174' },
  webServer: {
    // dist-lite is already built by global-setup with VITE_RELAY_URL baked in.
    command: 'vite preview --mode lite --port 4174',
    url: 'http://localhost:4174/index.lite.html',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```
  > If Plan C's `playwright.config.js` already exports a single config object, convert it to the multi-`projects` form and add this as a distinct project (`name: 'rooms'`, its own `testDir`/`globalSetup`), so the Lite-boot spec (Plan C) and rooms spec (Plan D) run under one `playwright test`. The rooms build's `VITE_RELAY_URL` (baked by `global-setup.mjs`) points at the in-process relay on `:8090`.

  `package.json`:
```json
{ "scripts": { "test:rooms:e2e": "playwright test test/rooms/e2e" } }
```

- [ ] **Step 4: Run tests, verify pass**
```
npm run test:rooms:e2e
```
Expected: `1 passed` — host sees a 4-letter code, joiner's `#roomBrowser` shows that code, join-by-code succeeds, and the host `#roomRoster` reaches `2.` — the full create/join/browse loop verified through the live relay.

- [ ] **Step 5: Commit**
```
git add test/rooms/e2e/rooms.spec.js test/rooms/e2e/global-setup.mjs playwright.config.js package.json
git commit -m "test(rooms): two-browser e2e — create + browse + join-by-code over the live relay

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Cross-plan contract & execution order.** Plan D executes **last (A → B → C → D)** and only *consumes* prior deliverables: Plan A's `src/net/netcode.js` (Task 28 — `NET`/`serializeState`/`applySnapshot`/`autoJoinFromLink`/`openLobby`, `window.NET = NET` at import, `applySnapshot` via state setters), `src/core/state.js` setters/`rt.*`/`replaceArr`, `src/core/handler-coverage.js` (`assertHandlerCoverage(win, root)`); Plan B's audio facade (untouched, still no music in Lite — `main.lite.js` still never imports `music-director.js` nor calls `setMusicDirector`); and Plan C's Lite entry/shell/config/tests. The netcode edits (Task 3) are surgical and leave `serializeState`/`applySnapshot` bodies byte-identical, preserving the ESM live-binding/setter rule and the "gameplay identical to the monolith netcode" constraint.
- **Spec coverage (D-1/D-2/D-3).** D-1 (roster full, only stages trimmed): the Rooms path reads the **unfiltered `ROSTER`**; no roster lite-flag is introduced; stages keep the Lite subset (Task 4 note + Global Constraints). D-2 (rooms = code-join + public browser, no chat, no spectating; small always-on relay; reuses netcode): Tasks 2 (relay + registry), 3 (netcode rewire), 4 (rooms UI create/join/browser), with no chat/spectate surface anywhere. D-3 (rooms is a separate final Plan D; Plan C ships Lite without netcode and its tree-shake test asserts netcode absent; Plan D adds netcode + relay + rooms and **amends** the tree-shake test to allow netcode from Plan D onward while editor/co-op/music-director/stem-player/manifest stay excluded): Task 6 un-stubs netcode + wires the Lite entry, Task 7 is the explicit tree-shake test amendment.
- **Relay + server tests.** Task 2 spins the `ws` server up in-process on an ephemeral port; two mock clients create + join a room by code and exchange a `state` snapshot (and a routed `input`), and a third party lists the open public room over `GET /rooms` — exactly the required server unit tests, plus a standalone registry unit test. The endpoint URL is configurable via `VITE_RELAY_URL` (build-time) with a same-origin `/api/ws` fallback (Task 1), and `npm run relay` / `npm run dev:relay` provide the local dev script.
- **No import-time side effects.** `relay-config.js`, `rooms.js`, `server/rooms.js` are pure; `server/relay.js` binds a port only in `listen()` (CLI entry guarded by `pathToFileURL(process.argv[1])`); the relay socket opens only in `NET.connect()`; the room-list `fetch` fires only in `listRooms()`/`refreshRoomBrowser()`. The one permitted import-time effect (`window.NET = NET`) is Plan A's and unchanged — `test/modules-eval.test.js`'s `WebSocket === 0`-at-eval check still holds (verified in Task 3 Step 4).
- **Handler-coverage / DOM contract.** The new `#rooms` `.screen` reuses monolith LAN-lobby CSS classes verbatim (no new CSS); its six inline handlers are bridged (18-symbol Lite bridge, Task 6) and the boot `assertHandlerCoverage(window, document)` still passes; the amended `test/lite/handler-coverage.test.js` proves the shell is exactly covered and that dropped handlers (`openEditor`/`openTest`/`openStats`/`planSend`/`openLobby`) remain absent.
- **Amendments, not forks.** Every Plan-C test Plan D touches (`tree-shake`, `handler-coverage`, `lite-shell-contract`, `global-actions-lite`, `main-lite-boot`, `vite-config`) is edited in place with the exact replacement shown, and each such task additionally gates on the full `npm test` harness. The tree-shake amendment inverts only the netcode assertions and keeps editor/co-op/music/manifest/stats exclusions intact.
- **End-to-end proof.** Task 9's two-context Playwright e2e drives the real create → browse → join-by-code loop through a live in-process relay (built with a baked `VITE_RELAY_URL`), and Task 8's `scripts/smoke-rooms.mjs` verifies create/join/snapshot/browse against any deployed relay — together proving the hosted rooms feature works, not merely that the modules load.
- **Placeholders.** None. Every code step shows complete, real code (server, config, UI, tests, Dockerfile/Procfile, smoke + e2e); every command shows a concrete expected result. Edits to prior-plan files are given as exact before/after snippets rather than prose.
