---
name: build-l2
description: The build order for generating the headless Lineage 2 (HighFive, protocol 267) client from scratch out of PLANE.md — crypto first, self-tests before sockets, then net → login FSM → game FSM → one linear index.ts. Use when src/ is empty/absent, or the user asks to build, scaffold, generate, or start the client from the single prompt.
---

Build the L2 client from [PLANE.md](../../../PLANE.md) in a fixed order that surfaces crypto mistakes
before any socket exists. This skill owns the **order**; the `l2-guardrails` skill owns the **constraints**
(offsets, byte counts, opcode values, key order) — read a rule there, never reconstruct it here.

## Build order

Each step ends on a checkable criterion. Do not start a step until the previous criterion holds.

### 1. Read the spec

Read PLANE.md sections `PROJECT SETUP`, `REUSABLE CODE — COPY VERBATIM`, `OPCODE MAP`, and the `l2-guardrails`
skill. **Done when** you can name the six crypto modules and the `src/` layout without re-opening the file.

### 2. Scaffold the project

Create `package.json`, `tsconfig.json`, `.env.example`, and the `src/` layout (`net/ crypto/ login/ game/
debug/`). Add a `dev` script (`npm run dev`) and a `typecheck` script; run `npm install`. **Never overwrite
`.env`** — it holds real credentials; only read it. **Done when** `npm install` completes and `npx tsc --noEmit`
runs (errors from empty files are expected at this point).

### 3. Crypto first

Copy **verbatim** from PLANE.md `REUSABLE CODE`: `Blowfish.ts`, `NewCrypt.ts`, `ScrambledRsaKey.ts`,
`RsaCrypt.ts`, `LoginCrypt.ts` into `src/crypto/`, and `GameCrypt.ts` into `src/game/GameCrypt.ts`,
plus `debug/DebugTools.ts` (self-tests + `[STATE]` log +
report). Blowfish/NewCrypt/LoginCrypt/GameCrypt are pure TS (no `node:crypto`); `RsaCrypt` is the one
exception (uses `node:crypto` for RSA-1024, NO_PADDING). **Done when** all six modules + DebugTools compile.

### 4. Gate 1 — crypto green before any socket

This is the **tightest feedback loop** in the build: crypto self-tests run without a network, in milliseconds.
Wire `runLoginCryptoSelfTests()` + `runGameCryptoSelfTests()` and run them. **Done when** `npx tsc --noEmit`
is clean **and** all round-trips pass: Blowfish round-trip, LoginCrypt round-trip, GameCrypt round-trip
(first and second packet), and GameCrypt disabled-passthrough. A red self-test means the crypto was not pasted
verbatim — go back to step 3; do not write socket code over broken crypto.

### 5. Net layer

Write `net/Connection.ts` (TCP + reassembly of `[uint16LE size][opcode][payload]`; `send()` prepends the
2-byte LE length itself — callers never add it), `net/PacketReader.ts`, `net/PacketWriter.ts`. **Done when**
they compile and framing matches `l2-guardrails` → Framing.

### 6. Login FSM

Write `game/Opcodes.ts` first — it holds the **whole** HighFive map, login-server opcodes included
(`LoginServerIn`/`LoginClientOut`), and `login/LoginClient.ts` imports from it. Then write
`login/LoginClient.ts`: `WAIT_INIT → WAIT_GG_AUTH → WAIT_LOGIN_OK → WAIT_SERVER_LIST → WAIT_PLAY_OK`.
**Done when** it resolves a `LoginResult` carrying `loginOkId1/2`, `playOkId1/2`, `gameHost`, `gamePort`.

### 7. Game FSM → IN_GAME

Write `game/GameClient.ts` (game opcodes are already in `game/Opcodes.ts` from step 6):
`WAIT_CRYPT_INIT → WAIT_CHAR_LIST → WAIT_CHAR_SELECTED → WAIT_USER_INFO → IN_GAME`, including
`RequestKeyMapping` + `EnterWorld` (each sent at most once), ping replies, and the 60s keepalive.
**Done when** the enter-world and keepalive rules in `l2-guardrails` → Game FSM / Keepalive are satisfied.

### 8. One linear index.ts

Write `index.ts` as a single straight-line `main()`: config → self-tests → `runLogin` → `runGame` → one final
`report()`. **No `PHASE` env var, no per-stage functions, no per-stage report blocks.** The `statePath` array
is owned by `index.ts` and shared into both stages so the report shows one `IDLE → … → IN_GAME` sequence.
**Done when** the flow is a single pass with exactly one `=== REPORT ===`.

### 9. Gate 2 — typecheck then run

**Done when** `npx tsc --noEmit` is clean. Then hand off to the `run` skill to execute against the live server;
on FAIL, hand off to `debug-l2` with the observed symptom.

## Who owns which step (agent chain)

The steps above are owned by specialized subagents; the **orchestrator** (the main thread) drives the chain
and is the only party that can spawn a subagent — a subagent cannot spawn another, so any "escalate to X"
in an agent's report is a recommendation back to the orchestrator, not a direct call.

| Steps | Owner | Gate after |
| ----- | ----- | ---------- |
| 1–2 (scaffold + `npm install`) | **orchestrator** (do this before calling `crypto-porter`) | — |
| 3–4 (crypto + self-tests) | `crypto-porter` | gate 1 green, then `guardrails-reviewer` |
| 5–8 (net + login/game FSM + linear `index.ts`) | `fsm-builder` | then `guardrails-reviewer` |
| 9 (typecheck + run against server) | `run-debugger` (via `run`/`debug-l2`) | gate 2 |

So a from-scratch build is: orchestrator scaffolds → `crypto-porter` (gate 1) → `guardrails-reviewer` →
`fsm-builder` → `guardrails-reviewer` → `run-debugger` (gate 2). Re-run `guardrails-reviewer` after any fix
that touches framing, opcodes, crypto, the FSMs, or keepalive.
