---
name: l2-guardrails
description: The HARD CONSTRAINTS and recurring failure modes for the headless Lineage 2 (HighFive, protocol 267) client in this repo. Use whenever writing or reviewing packet framing, opcodes, login/game crypto, the login/game FSMs, or keepalive code — these are the mistakes that make the build fail. Source of truth: PLANE.md.
---

Fast checklist to keep the L2 client build correct. Each item cites where PLANE.md explains it —
read that section when in doubt; **never invent values.** This skill owns the *constraints*; for the
*order* of building the client from scratch, use the `build-l2` skill.

## Framing & wire format (PLANE.md → HARD CONSTRAINTS)
- Every packet is `[uint16LE size][1-byte opcode][payload]`; the size field **includes itself**.
- `Connection.send(body)` prepends the 2-byte LE length internally. **Never prepend length yourself** —
  double-prefixing corrupts every frame.
- All integers little-endian. Strings UTF-16LE, null-terminated (two `0x00`), unless stated otherwise.
- Client extended packets: `[0xD0][2-byte sub-opcode LE][…]`. Server extended packets are prefixed
  `0xFE` — treat `0xFE 0x00D3` as `NetPingRequest`. Store `ExtendedOpcode=0xD0`, `ServerExtendedOpcode=0xFE`.

## Opcodes (PLANE.md → OPCODE MAP)
- Use the **HighFive** map from PLANE.md, **never textbook L2 opcodes**. Wrong opcodes = silent
  no-op on the game server.

## Login crypto (PLANE.md → LoginCrypt / TROUBLESHOOTING)
- Init: static-key Blowfish decrypt → `decXORPass` → drop the last 8 bytes. No checksum on Init.
- Copy Blowfish / NewCrypt / ScrambledRsaKey / RsaCrypt / LoginCrypt / GameCrypt **verbatim**. Blowfish is
  ECB, no padding, 8-byte blocks, pure TS (no `node:crypto`); RsaCrypt is the exception and uses `node:crypto`
  for RSA. Verify
  `blowfishDecrypt(blowfishEncrypt(x,k),k).equals(x)` before socket I/O.
- RSA: unscramble the 128-byte modulus first, `RSA_NO_PADDING`, 128-byte plaintext with login at
  `0x5E`, password at `0x6E` (ASCII).
- Outgoing login packets after the session key: pad to 4, append 8 zero bytes, pad to 8, write the XOR
  checksum into the 4 bytes before the final pad, then Blowfish-encrypt. Length prefix is measured on
  the **encrypted** body.
- Skipped GGAuth: if `LoginOk`-shaped data arrives before GGAuth, use `ggResponse = 0`.

## Game crypto (PLANE.md → HARD CONSTRAINTS #7 / GameCrypt)
- **Flag-driven**: after `CryptInit 0x2E`, `gameCrypt.init(xorKey, encryptionFlag !== 0)`. Apply the
  16-byte shifting XOR to every subsequent body only when the flag is non-zero; plaintext otherwise.
- `ProtocolVersion 0x0E` is always sent **raw**, before CryptInit.
- Static key tail: `c8 27 93 01 a1 6c 31 97`. Verify `decrypt(encrypt(x)).equals(x)`.

## Game FSM & enter-world (PLANE.md → PART B / TROUBLESHOOTING)
- `AuthRequest 0x2B` key order: `playOkId2, playOkId1, loginOkId1, loginOkId2`. **No trailing language field.**
- `CharacterSelected 0x12`: slot index + **exactly 14 zero bytes**.
- Enter world = `RequestKeyMapping` (`0xD0 0x0021`) **then** `EnterWorld 0x11` + **exactly 104 zero bytes**.
  Skipping either → no `UserInfo`, silent disconnect.
- Skipped CharSelected: if `UserInfo 0x32` arrives while waiting for CharSelected confirm, transition to
  `WAIT_USER_INFO` and proceed — but **guard RequestKeyMapping/EnterWorld to send at most once**.
- Tolerate up to 10 unknown packets in `WAIT_CHAR_LIST`/`WAIT_CHAR_SELECTED`/`WAIT_USER_INFO` (any
  pre-`IN_GAME` state after CryptInit); once `IN_GAME`, silently drop all non-ping packets.
- If the server closes before `UserInfo`, settle the run promise (never leave it pending) and report FAIL.

## Keepalive
- Reply to every `0xD3` (or `0xFE 0x00D3`) with the 13-byte pong: `0xA8 + D pingId + D 0 + D 0x00080000`.
  Missing pongs = disconnect at ~60s.

## Flow & config (PLANE.md → PROJECT SETUP / Entry point)
- `index.ts` is a single linear program — one `npm run dev` runs config → self-tests → login → game →
  final report. **No `PHASE` env var, no per-stage report.**
- `config.ts` loads `.env` via `dotenv`, `parseInt` numbers, throws a clear error on any missing value.
  Do not overwrite the existing `.env`.

## Self-tests
- Run crypto self-tests **before any socket I/O**. A failing self-test stops the run and prints the
  report — never open sockets with broken crypto.
