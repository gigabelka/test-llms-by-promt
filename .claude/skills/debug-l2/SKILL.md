---
name: debug-l2
description: Diagnose a failing phase of the headless L2 client by mapping the symptom to PLANE.md's TROUBLESHOOTING table, verifying crypto in isolation before blaming the socket, and instrumenting the failing FSM transition. Use when a phase reports FAIL, the client disconnects, packets look scrambled, or IN_GAME never prints.
argument-hint: "What symptom are you seeing?"
disable-model-invocation: true
---

Diagnose the L2 client symptom: `$ARGUMENTS`. Source of truth for fixes is the **TROUBLESHOOTING**
section of [PLANE.md](../../../PLANE.md); constraints are in the `l2-guardrails` skill.

## Process

### 1. Verify crypto in isolation first
Before suspecting the socket or the FSM, confirm the crypto round-trips (these run without any network):
- `blowfishDecrypt(blowfishEncrypt(x, k), k).equals(x)`
- `gameCrypt.decrypt(gameCrypt.encrypt(x)).equals(x)` (two instances, same 8-byte key, `enabled=true`)

If either fails, the bug is in the copied crypto — it was not pasted verbatim. Re-copy from PLANE.md.

### 2. Map the symptom → cause → fix

| Symptom | Likely cause | Fix (PLANE.md) |
| ------- | ------------ | -------------- |
| Blowfish garbage / round-trip fails | not verbatim; used `node:crypto`; padding added | pure-TS Blowfish, ECB, no padding, 8-byte blocks |
| Init won't decode | wrong Init path | static-key Blowfish decrypt → `decXORPass` → drop last 8 bytes; no checksum |
| LoginFail right after AuthLogin | RSA setup | unscramble modulus, `RSA_NO_PADDING`, login `@0x5E` / password `@0x6E` |
| Server drops you on login (checksum) | outgoing packet build | pad to 4, +8 zero bytes, pad to 8, XOR checksum before final pad, then Blowfish-encrypt |
| Nothing happens on game server | textbook opcodes used | use HighFive OPCODE MAP exactly |
| AuthRequest rejected | wrong field order | key order `playOkId2, playOkId1, loginOkId1, loginOkId2`; no language field |
| CharacterSelected ignored | missing padding | append exactly 14 zero bytes after slot index |
| No UserInfo / silent disconnect | enter-world incomplete | send RequestKeyMapping `0xD0 0x0021`, then `0x11` + 104 zero bytes |
| Game packets scrambled | crypt flag / key tail | `gameCrypt.init(xorKey, flag !== 0)`; static tail `c8 27 93 01 a1 6c 31 97` |
| Disconnect at ~60s | not answering pings | reply to `0xD3` / `0xFE 0x00D3` with 13-byte `0xA8` pong |
| Server rejects frames | double length prefix | `Connection.send(body)` prepends length — don't add it yourself |
| Duplicate EnterWorld warning | UserInfo before CharSelected | guard enter-world sequence to run at most once |
| Phase hangs / never settles | promise left pending | on server close before UserInfo, settle promise + report FAIL |
| Runs `full` instead of chosen phase | env not passed / `cfg.phase` routing | PowerShell `$env:PHASE="N"`; route on `process.env.PHASE` |

### 3. Instrument the failing transition
The FSM already logs transitions via `logState(from, to)`. Add a temporary hexdump
(`console.error(buf.subarray(0, n).toString('hex'))`) at the opcode dispatch of the state where it
stalls, compare the bytes against the PROTOCOL REFERENCE layout for that packet, then remove the
instrumentation once fixed.

### 4. Re-run
After the fix, re-run via the `run-phase` skill and confirm the report flips to `status: PASS`.
