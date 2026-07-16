---
name: phase-handoff
description: Compact the current phase session into a handoff document so the next isolated LLM session can build the following phase.
argument-hint: "Which phase was just finished? (1-5)"
disable-model-invocation: true
---

Write a handoff document for PHASE `$ARGUMENTS` so a **fresh, isolated session** (the workflow in
[README.md](../../../README.md): one LLM session per phase) can pick up the next phase with zero
shared conversation context. Save to `artifacts/handoff-phase-$ARGUMENTS.md`.

## What the document contains

1. **Phase status** — the final `=== PHASE N REPORT ===` block verbatim (status, self-tests,
   state-path, notes). If the phase never passed, say so and list the last symptom.
2. **Exported contract as built** — the exact signatures this phase exposes
   (`LoginResult`, `GamePhaseInput`, `runLoginPhase`, `runGamePhase`, self-test functions), with any
   deviation from README.md's fixed contracts called out explicitly. The next phase consumes these
   without reading this session.
3. **Input for the next phase** — how phase N+1 gets its input: `artifacts/phase-2-output.json` for
   standalone P3/P4 runs, or the in-memory `LoginResult → GamePhaseInput` pass in `runPhase5()`.
4. **Known deviations & landmines** — anywhere the implementation diverges from PLANE.md, plus
   session-discovered quirks of the live server (e.g. skipped GGAuth, UserInfo before CharSelected)
   that the next session would otherwise rediscover the hard way.
5. **Suggested skills** — which skills the next session should invoke: `build-phase N+1` to build,
   `run-phase` to verify, `debug-l2` on FAIL, `l2-guardrails` before any wire/crypto/FSM code.

## Rules

- Do not duplicate content already captured elsewhere (PLANE.md sections, README.md phase prompts,
  commits, the artifacts JSON) — reference it by path instead.
- Redact credentials: never copy `.env` values (host is fine, login/password never).
