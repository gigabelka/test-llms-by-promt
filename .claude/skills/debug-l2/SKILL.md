---
name: debug-l2
description: Diagnose a failing phase of the headless L2 client by mapping the symptom to PLANE.md's TROUBLESHOOTING table, verifying crypto in isolation first. Use when a phase reports FAIL, the client disconnects, packets look scrambled, or IN_GAME never prints.
argument-hint: "What symptom are you seeing?"
---

Diagnose the L2 client symptom: `$ARGUMENTS`. Source of truth for fixes is the **TROUBLESHOOTING**
section of [PLANE.md](../../../PLANE.md); constraints are in the `l2-guardrails` skill.

## Process

### 1. Verify crypto in isolation first
Before suspecting the socket or the FSM, confirm the crypto round-trips (these run without any network):
- `blowfishDecrypt(blowfishEncrypt(x, k), k).equals(x)`
- `gameCrypt.decrypt(gameCrypt.encrypt(x)).equals(x)` (two instances, same 8-byte key, `enabled=true`)

If either fails, the bug is in the copied crypto — it was not pasted verbatim. Re-copy from PLANE.md.

### 2. Map the symptom → cause → where the fix lives

The exact values (offsets, byte counts, key tails, field order) live in **one place** — the
`l2-guardrails` skill, backed by PLANE.md. This table only routes a symptom to the right rule;
read that rule, don't reconstruct it from memory.

| Symptom | Likely cause | Fix lives in |
| ------- | ------------ | ------------ |
| Blowfish garbage / round-trip fails | crypto not pasted verbatim / `node:crypto` / padding added | guardrails → Login crypto; PLANE.md → LoginCrypt |
| Init won't decode | wrong Init decode path | guardrails → Login crypto (Init) |
| LoginFail right after AuthLogin | RSA setup (modulus / padding / offsets) | guardrails → Login crypto (RSA) |
| Server drops you on login (checksum) | outgoing login packet build order | guardrails → Login crypto (outgoing) |
| Nothing happens on game server | textbook opcodes used | guardrails → Opcodes; PLANE.md → OPCODE MAP |
| AuthRequest rejected | wrong session-key field order | guardrails → Game FSM (AuthRequest) |
| CharacterSelected ignored | missing zero padding | guardrails → Game FSM (CharacterSelected) |
| No UserInfo / silent disconnect | enter-world sequence incomplete | guardrails → Game FSM (enter world) |
| Game packets scrambled | crypt flag ignored / wrong key tail | guardrails → Game crypto |
| Disconnect at ~60s | pings not answered | guardrails → Keepalive |
| Server rejects frames | double length prefix | guardrails → Framing |
| Duplicate EnterWorld warning | UserInfo arrived before CharSelected confirm | guardrails → Game FSM (skipped CharSelected) |
| Phase hangs / never settles | phase promise left pending on close | guardrails → Game FSM (server close) |
| Runs `full` instead of chosen phase | env not passed / `cfg.phase` routing | guardrails → Dispatcher; `run-phase` skill |

### 3. Instrument the failing transition
The FSM already logs transitions via `logState(from, to)`. Add a temporary hexdump
(`console.error(buf.subarray(0, n).toString('hex'))`) at the opcode dispatch of the state where it
stalls, compare the bytes against the PROTOCOL REFERENCE layout for that packet, then remove the
instrumentation once fixed.

### 4. Re-run
After the fix, re-run via the `run-phase` skill and confirm the report flips to `status: PASS`.
