// Self-debug toolkit.

interface Counts {
  passed: number;
  failed: number;
}

let passed = 0;
let failed = 0;

export function check(name: string, cond: unknown): boolean {
  if (cond) {
    console.log(`[ok] ${name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${name}`);
    failed++;
  }
  return Boolean(cond);
}

export function selfTestCounts(): Counts {
  return { passed, failed };
}

export function logState(from: string, to: string): void {
  console.log(`[STATE] ${from} -> ${to}`);
}

export function assertState(actual: string, expected: string, ctx: string): void {
  if (actual !== expected) {
    throw new Error(`State mismatch in ${ctx}: expected ${expected}, got ${actual}`);
  }
}

export function report(
  phase: number,
  statePath: string,
  artifacts: Record<string, string>,
  notes = "none",
): void {
  const { passed: p, failed: f } = selfTestCounts();
  const status = f === 0 ? "PASS" : "FAIL";
  const artifactList = Object.entries(artifacts)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  console.log(`=== PHASE ${phase} REPORT ===`);
  console.log(`status: ${status}`);
  console.log(`self-tests: ${p}/${p + f}`);
  console.log(`state-path: ${statePath}`);
  console.log(`artifacts: ${artifactList}`);
  console.log(`notes: ${notes}`);
}

export function runLoginCryptoSelfTests(): void {
  // Placeholder: will be implemented in Phase 2.
}

export function runGameCryptoSelfTests(): void {
  // Placeholder: will be implemented in Phase 3/4.
}
