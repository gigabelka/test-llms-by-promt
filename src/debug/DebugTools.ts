import type { Artifacts } from "../types.ts";

let passed = 0;
let failed = 0;

// Truthy cond -> "[ok] name" and passed++. Falsy -> "[FAIL] name" and failed++.
export function check(name: string, cond: unknown): boolean {
  if (cond) {
    console.log(`[ok] ${name}`);
    passed += 1;
    return true;
  }
  console.log(`[FAIL] ${name}`);
  failed += 1;
  return false;
}

export function selfTestCounts(): { passed: number; failed: number } {
  return { passed, failed };
}

export function logState(from: string, to: string): void {
  console.log(`[STATE] ${from} -> ${to}`);
}

export function assertState<T>(actual: T, expected: T, ctx: string): void {
  if (actual !== expected) {
    throw new Error(`bad state in ${ctx}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

// The single final report. status is PASS only when nothing failed and no error was passed in.
export function report(statePath: string[], artifacts: Artifacts, notes?: string): void {
  const total = passed + failed;
  const status = failed === 0 && !notes ? "PASS" : "FAIL";
  const arts = Object.entries(artifacts)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log("=== REPORT ===");
  console.log(`status: ${status}`);
  console.log(`self-tests: ${passed}/${total}`);
  console.log(`state-path: ${statePath.join(" -> ")}`);
  console.log(`artifacts: ${arts}`);
  console.log(`notes: ${notes ?? ""}`);
}

export const DebugTools = { check, selfTestCounts, logState, assertState, report };
