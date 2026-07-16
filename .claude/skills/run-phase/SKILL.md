---
name: run-phase
description: Run one phase (1-5) of the L2 client with PowerShell-correct PHASE env-var passing, then parse the === PHASE N REPORT === block. Use when a phase needs to be run or verified end-to-end.
argument-hint: "Which phase to run? (1-5)"
---

Run PHASE `$ARGUMENTS` of the L2 client and report the result. This repo is **Windows/PowerShell-first**.

## Process

### 1. Run with correct env passing
This shell is PowerShell — the bash form `PHASE=N npm run dev` does **not** pass the variable and the
dispatcher will silently default to `full`. Use:

```powershell
$env:PHASE="N"; npm run dev
```

For P4/P5 the process stays alive ~60s (keepalive), so allow a generous timeout (~75s).

If the variable still isn't picked up (some setups strip it), the README fallback is to add `cross-env`
to `devDependencies` and wrap the script: `"dev": "cross-env ts-node src/index.ts"`.

Precondition: `package.json`/`src/` must exist (build the phase first with `/build-phase N`) and
`npm install` has run.

### 2. Parse the report
Locate the `=== PHASE N REPORT ===` block in stdout and read:
- `status:` — `PASS` or `FAIL`
- `self-tests: <passed>/<total>`
- `state-path:` — the FSM path reached
- `notes:` — the first failing assertion / error, if any

### 3. Report back
State PASS/FAIL, the self-test count, and — on FAIL — the `notes:` line and the last state reached.
Phase-specific success criteria (from the README Definition of Done):
- **P1**: prints a valid loaded config; `tsc --noEmit` clean.
- **P2**: reaches `PlayOk`; report carries 4 session ids + `gameHost`/`gamePort`.
- **P3**: character selected (or `UserInfo` already arriving); ends in `WAIT_USER_INFO`.
- **P4 / P5 / full**: `IN_GAME` printed, ≥1 ping answered, connection held ~60s, final report PASS.

On FAIL, hand off to the `debug-l2` skill with the observed symptom.
