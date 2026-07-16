# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A sandbox for testing how well LLMs implement a complex network client from one long self-contained prompt. The deliverable is a **headless Lineage 2 auto-login client** (chronicle HighFive, protocol 267) in Node.js 24 + TypeScript that logs into a login server, enters the game world with a chosen character, prints `IN_GAME`, and answers server pings for 60 seconds.

- **[PLANE.md](PLANE.md) is the source of truth**: full protocol spec, HighFive opcode map, verbatim crypto implementations (Blowfish, RSA, login/game XOR), login/game FSMs, PHASE dispatcher semantics, report format, and troubleshooting table. Read the relevant section before writing protocol/crypto/FSM code.
- **README.md** (Russian) describes the phase-by-phase LLM workflow and per-phase prompts.
- **`src/` is generated per phase** and may be absent — that is the expected initial state, not a broken checkout.
- **Never overwrite `.env`** — it contains real server credentials; only read it. `artifacts/` is gitignored runtime output.

## Commands

There is no test suite or linter; verification is `tsc` + running phases against a live server (self-tests run inside each phase).

```powershell
npm install                     # after PHASE 1 creates package.json
npx tsc --noEmit                # typecheck (the gate for every phase)

# Run a single phase (PowerShell; use PHASE=2 npm run dev in bash)
$env:PHASE=2; npm run dev

# Full chain (PHASE 1 → 2 → 4; PHASE 3 is skipped)
npm run dev                     # same as PHASE=full / 0 / 5
```

Each phase prints a `=== PHASE <n> REPORT ===` block (status PASS/FAIL, self-tests, state path, artifacts).

## Phase architecture

Five independent phases, each built in an isolated LLM session; the `PHASE` env var routes execution in `src/index.ts`:

1. **PHASE 1 — Setup & Config**: project scaffold, `config.ts` (.env validation), entry point. Dispatch must read `process.env.PHASE` directly — never `cfg.phase` (it's `NaN` for `"full"`).
2. **PHASE 2 — Login Server**: `Connection`/`PacketReader`/`PacketWriter` + login crypto (Blowfish, NewCrypt, ScrambledRsaKey, RsaCrypt, LoginCrypt), `LoginClient.ts` FSM `WAIT_INIT → WAIT_GG_AUTH → WAIT_LOGIN_OK → WAIT_SERVER_LIST → WAIT_PLAY_OK`. Exports `runLoginPhase(cfg): Promise<LoginResult>`. Writes `artifacts/phase-2-output.json` (4 session ids + game host/port) for standalone PHASE 3/4 runs.
3. **PHASE 3 — Game Auth & Character** (standalone debug only, not in the full chain): `GameCrypt.ts` + `runGamePhase(cfg, input, 3)`.
4. **PHASE 4 — Enter World & Keepalive**: full game FSM through `IN_GAME`, `RequestKeyMapping` + `EnterWorld`, ping replies, 60s keepalive. Extends `runGamePhase(..., phase: 3 | 4)`.
5. **PHASE 5 / full**: in-memory chain P1 → P2 → P4 via `runPhase5()`; passes `LoginResult` directly as `GamePhaseInput` without touching the artifacts file.

Cross-phase API contracts (`LoginResult`, `GamePhaseInput`, `runLoginPhase`, `runGamePhase`, `runLoginCryptoSelfTests`, `runGameCryptoSelfTests` in `src/debug/DebugTools.ts`) are fixed in README.md's phase prompts — preserve their exact signatures.

## Hard constraints

The **l2-guardrails** skill is the checklist of build-breaking mistakes — read it before touching packet framing, opcodes, crypto, FSMs, the dispatcher, or keepalive; it is the single skill-level source of these constraints. The three most expensive to get wrong:

- Copy the reusable crypto from PLANE.md **verbatim**; pure TS, no `node:crypto`. Run crypto self-tests before any socket I/O.
- Use PLANE.md's HighFive opcode map, never "textbook" L2 opcodes.
- `Connection.send()` prepends the 2-byte LE length itself — never add it manually.

Project skills: `build-phase` (implement a phase, user-invoked), `run-phase` (run + parse the report), `debug-l2` (map a failure symptom to the fix), `phase-handoff` (write the handoff doc for the next phase's isolated session, user-invoked).
