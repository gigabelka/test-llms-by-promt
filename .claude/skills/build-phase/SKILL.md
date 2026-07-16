---
name: build-phase
description: Build one phase (1-5) of the headless Lineage 2 client from PLANE.md. Scaffolds and wires the exact src/ files that phase owns, copies the reusable crypto verbatim, honors the phase's exported API contract, then typechecks. Use when the user asks to implement/build a phase or the whole client.
argument-hint: "Which phase? (1-5)"
disable-model-invocation: true
---

Build PHASE `$ARGUMENTS` of the headless L2 auto-login client. The single source of truth is
[PLANE.md](../../../PLANE.md); the per-phase acceptance prompts live in [README.md](../../../README.md).
**Do not invent opcodes, byte layouts, or crypto — copy them from PLANE.md.**

Before writing any wire/crypto/FSM code, consult the `l2-guardrails` skill — it lists the mistakes
that break this build.

## Process

### 1. Read the spec for this phase
- Open the matching `#### PHASE N` prompt block in [README.md](../../../README.md) — it is the
  acceptance checklist for the phase.
- Read the relevant PLANE.md sections: **PROJECT SETUP** (structure, `package.json`, `tsconfig.json`),
  **OPCODE MAP**, **REUSABLE CODE — COPY VERBATIM**, **PROTOCOL REFERENCE**, **DebugTools**.

### 2. Copy reusable code verbatim
These are correct, working implementations — paste them, do **not** re-derive the algorithms:
`net/PacketReader.ts`, `net/PacketWriter.ts`, `net/Connection.ts`, `crypto/Blowfish.ts`,
`crypto/NewCrypt.ts`, `crypto/ScrambledRsaKey.ts`, `crypto/RsaCrypt.ts`, `crypto/LoginCrypt.ts`,
`game/GameCrypt.ts`. Your job is to **wire them into the flow**.

### 3. Create only the files this phase owns, and honor its API contract

| Phase | Creates / extends | Exported contract |
| ----- | ----------------- | ----------------- |
| 1 | `package.json`, `tsconfig.json`, `.env.example`, `src/config.ts`, `src/index.ts` (PHASE dispatcher), `src/game/opcodes.ts`, `src/debug/DebugTools.ts` | dispatcher routes on `process.env.PHASE` (never `cfg.phase`) |
| 2 | `net/*`, login `crypto/*`, `login/LoginClient.ts` | `runLoginPhase(cfg): Promise<LoginResult>`; `runLoginCryptoSelfTests()` |
| 3 | `game/GameCrypt.ts`, `game/GameClient.ts` (WAIT_CRYPT_INIT→WAIT_CHAR_LIST→WAIT_CHAR_SELECTED) | `runGamePhase(cfg, input, phase: 3\|4)` — `phase===3` branch; `runGameCryptoSelfTests()` |
| 4 | extend `game/GameClient.ts` (…→WAIT_USER_INFO→IN_GAME, keepalive) | `runGamePhase(cfg, input, phase: 3\|4)` — `phase===4` branch |
| 5 | `runPhase5()` in `src/index.ts`, dispatcher wiring | `PHASE=full\|0\|5` → `runPhase5()` (chains P1→P2→P4, in-memory, skips P3) |

`config.ts`: load `.env` via `dotenv`, `parseInt` numbers, throw a clear error on any missing required
value. **Never overwrite the existing `.env`** — it holds real credentials; only read it.

### 4. Run crypto self-tests before any socket I/O
`runLoginCryptoSelfTests()` (Blowfish round-trip) at the start of P2/P5-login;
`runGameCryptoSelfTests()` (GameCrypt round-trip) at the start of P3/P4/P5-game. If any self-test
fails, **stop and print the report** — do not open sockets with broken crypto.

### 5. Print the canonical report
Emit `=== PHASE <n> REPORT ===` exactly as defined in PLANE.md's DebugTools section
(status / self-tests / state-path / artifacts / notes). Log every FSM transition via `logState` and
guard handlers with `assertState`.

### 6. Gate and hand off
Run `npx tsc --noEmit` — it must be clean (strict mode). Then run the phase with the `run-phase`
skill (`/run-phase N`) to exercise it end-to-end and parse the report.

## Reminders specific to this build
- `Connection.send(body)` prepends the 2-byte LE length itself — never prepend it yourself.
- Game-server crypto is **flag-driven**: `gameCrypt.init(xorKey, encryptionFlag !== 0)`.
  `ProtocolVersion 0x0E` is always sent raw.
- The full chain (`full`/`0`/`5`) is P1→P2→P4; **P3 is skipped** and exists only as a standalone
  entry point.
