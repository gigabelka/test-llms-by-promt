export interface CheckResult {
  name: string;
  passed: boolean;
}

const checks: CheckResult[] = [];

/**
 * Record a pass/fail check and print it immediately.
 * Returns the pass status so callers can chain on it.
 */
export function check(name: string, condition: boolean): boolean {
  checks.push({ name, passed: condition });
  console.log(`${condition ? '[PASS]' : '[FAIL]'} ${name}`);
  return condition;
}

export function getChecks(): readonly CheckResult[] {
  return checks;
}

export function resetChecks(): void {
  checks.length = 0;
}

export function passedCount(): number {
  return checks.filter((c) => c.passed).length;
}

export function totalCount(): number {
  return checks.length;
}

export interface ReportInput {
  phase: number | string;
  statePath: string;
  artifacts?: string;
  notes?: string;
}

/**
 * Print the standard phase report block used by every phase.
 */
export function report(input: ReportInput): void {
  const passed = passedCount();
  const total = totalCount();
  const status = passed === total && total > 0 ? 'PASS' : 'FAIL';
  console.log(`=== PHASE ${input.phase} REPORT ===`);
  console.log(`status: ${status}`);
  console.log(`self-tests: ${passed}/${total}`);
  console.log(`state-path: ${input.statePath}`);
  console.log(`artifacts: ${input.artifacts ?? 'none'}`);
  console.log(`notes: ${input.notes ?? '-'}`);
}
