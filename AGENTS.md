# AGENTS.md

Guidance for AI agents working in this repository. The reader knows nothing about the project — start with the "Overview" section.

## Project overview

This is a **benchmark sandbox**: testing how well different LLMs implement a complex network client from a single long self-contained prompt.

The output of each model is a **headless Lineage 2 client** (HighFive chronicle, protocol `267`) on **Node.js 24 + TypeScript** that, with no human involvement:

1. Connects to the Login Server, authenticates with login/password, receives 4 session ids and the game server address.
2. Connects to the Game Server with those keys, selects a character by slot, enters the world.
3. Prints `IN_GAME`.
4. Answers server pings and keeps the connection alive for ≥ 60 seconds, then exits cleanly.

No web frameworks, databases, or gameplay logic (combat, movement, inventory) — autologin only.

**Source of truth — [PLANE.md](PLANE.md)** (~970 lines, English): full protocol specification, HighFive opcode map, "COPY VERBATIM" cryptography implementations (Blowfish, NewCrypt, ScrambledRsaKey, RsaCrypt, LoginCrypt, GameCrypt), login- and game-server FSMs, report format, TROUBLESHOOTING table. Do not invent values — take them only from PLANE.md.

## Repository structure and branches

**Critical: one branch = one run of one model.**

- `main` contains **only scaffolding**: `PLANE.md`, `README.md`, `INFO.md`, `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.env`, `.mcp.json`. There is **no** `package.json`, `tsconfig.json`, or `src/` on `main` — that is the expected state, not a broken checkout.
- Every other branch (`deepseek-v4-pro`, `kimi-for-coding-k2.7`, `qwen3.6-27b-mtp`, …) is a generated client from one model with its own `package.json`, `tsconfig.json`, `.env.example`, `src/`. The `-skills` / `-agents` suffixes mean that skills/subagents from `.claude/` were available during generation.
- A new client is generated on a branch named after the model, branched off `main`. Generated `src/` never lands on `main`.
- A stray `node_modules/` on `main` is a leftover from checking out another branch, not a sign of scaffolding.

**Isolation rule:** work ONLY in the current model branch. You must not read, copy, diff, or cherry-pick code from other branches (`git show <branch>:src/...`, checking out neighboring branches, analyzing other branches' commits) — each branch is an independent benchmark, and borrowing someone else's solution devalues the comparison. Do not switch branches mid-run.

## Build and run

There is no test suite and no linter. Verification = typecheck + a run against the live server (crypto self-tests run at startup, before any socket I/O).

Commands only work on a model branch where `package.json`/`tsconfig.json` have already been generated (they don't exist on `main`):

```bash
npm install
npx tsc --noEmit          # typecheck — mandatory gate (or npm run typecheck)
npm run dev               # the whole scenario in one run: login → IN_GAME → 60s keepalive
npm run build             # tsc → dist/
npm start                 # node dist/index.js
```

A full run takes ~60+ seconds because of the keepalive — set a timeout of ~75 s. At the end a single block is printed:

```
=== REPORT ===
status: PASS | FAIL
self-tests: <passed>/<total>
state-path: IDLE -> ... -> <final>
artifacts: <session data>
notes: <first failed check / error>
```

**Definition of Done:** `npx tsc --noEmit` is clean; the client reaches `PlayOk` and receives 4 session ids; prints `IN_GAME`; keeps the connection ≥ 60 s while answering pings; final report with `status: PASS`.

## Generated client architecture

`src/index.ts` is **one linear program**: a single `npm run dev` run executes the whole scenario. No phases and no `PHASE` variable. Order:

1. **Config** — load and validate `.env` (a clear error on any missing/invalid value).
2. **Crypto self-tests** — `runLoginCryptoSelfTests()` + `runGameCryptoSelfTests()` once, **before any socket I/O**; failure → FAIL report and exit.
3. **Login server** (`login/LoginClient.ts`) — FSM `WAIT_INIT → WAIT_GG_AUTH → WAIT_LOGIN_OK → WAIT_SERVER_LIST → WAIT_PLAY_OK`; result is a `LoginResult` (4 session ids + game host/port).
4. **Game server** (`game/GameClient.ts`) — FSM `WAIT_CRYPT_INIT → WAIT_CHAR_LIST → WAIT_CHAR_SELECTED → WAIT_USER_INFO → IN_GAME`; `RequestKeyMapping` + `EnterWorld` (each at most once), ping replies, 60-second keepalive.
5. **Report** — one final `=== REPORT ===`; any error → a single FAIL report and a non-zero exit code.

Typical `src/` layout: `net/` (Connection — TCP + packet reassembly `[uint16LE size][opcode][payload]`, PacketReader, PacketWriter), `crypto/` (Blowfish, NewCrypt, ScrambledRsaKey, RsaCrypt, LoginCrypt), `game/` (GameCrypt, GameClient, Opcodes), `login/` (LoginClient), `debug/` (DebugTools — self-tests, `[STATE]` log, report).

The `statePath` array belongs to `index.ts` and is shared across stages, so the report shows a single sequence `IDLE → … → IN_GAME`.

## Hard constraints (these break builds most often)

Full checklist — the `l2-guardrails` skill. The three most expensive mistakes:

- **Copy crypto verbatim from PLANE.md.** Blowfish/NewCrypt/LoginCrypt/GameCrypt — pure TS without `node:crypto`; the exception is RsaCrypt (uses `node:crypto`, RSA-1024 / NO_PADDING). Self-tests run before any socket.
- **Only the HighFive opcode map from PLANE.md**, never "textbook" L2 opcodes.
- **`Connection.send()` adds the 2-byte little-endian length prefix itself** — do not add it manually.

Other important details: XOR encryption of the game stream is enabled only if `CryptInit` sent `encryptionFlag !== 0`; the key order in `AuthRequest` is `playOkId2, playOkId1, loginOkId1, loginOkId2`; `EnterWorld` requires a prior `RequestKeyMapping` (`0xD0 0x0021`) and exactly 104 zero bytes after opcode `0x11`; if the server skips `CharSelected` and immediately sends `UserInfo` — proceed to the enter-world sequence without sending packets twice.

## Skills and subagents (`.claude/`)

Skills (`.claude/skills/`): `build-l2` (client build order from scratch out of PLANE.md), `l2-guardrails` (checklist of breaking mistakes), `debug-l2` (FAIL diagnostics: crypto in isolation → TROUBLESHOOTING table), `run` (run + report analysis), `writing-great-skills` (skill-writing reference).

Subagents (`.claude/agents/`): `crypto-porter` (verbatim crypto + self-tests to green, gate 1) → `fsm-builder` (net layer, FSMs, `index.ts`, up to `IN_GAME`); for audit/runs — `guardrails-reviewer` (read-only audit of `src/` against guardrails), `run-debugger` (run and FAIL diagnostics), `plane-navigator` (targeted answers from PLANE.md without rereading the whole spec).

Catalog with descriptions — [INFO.md](INFO.md); **update it when adding/changing entries in `.claude/`**.

Typical flows: build from scratch — `crypto-porter` → `fsm-builder`; audit and run — `guardrails-reviewer` → `run-debugger`.

## Code style

- TypeScript, strict typecheck (`npx tsc --noEmit` is the gate). No linter/formatter.
- Crypto and protocol code — verbatim from PLANE.md; do not "improve" it.
- User-facing conversation language — **Russian** (see CLAUDE.md). Code, identifiers, and repository artifacts are in English, matching the surrounding code and PLANE.md.

## Security

- **Never overwrite `.env`** — it holds real server credentials (IP/ports, login, password, `L2_SERVER_ID`, `L2_CHAR_SLOT`, `L2_PROTOCOL`). Read-only. The file is intentionally tracked in git (shared across all model branches) — do not "fix" that.
- Do not print the contents of `.env` in replies and do not transmit it externally.
- `/artifacts` (runtime output with session ids) is gitignored — do not commit it.
- The client is intended only for servers you have permission to access (educational/research purposes).
