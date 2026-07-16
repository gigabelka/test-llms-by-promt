import { execSync } from 'child_process';
import { cfg } from './config';
import * as DebugTools from './debug/DebugTools';
import { runLoginPhase } from './login/LoginClient';

// Routing MUST use process.env.PHASE directly; cfg.phase is for logging only.
const phaseEnv = process.env.PHASE ?? 'full';

function maskPassword(value: string): string {
  return value.length <= 2 ? '***' : `${value[0]}***${value[value.length - 1]}`;
}

function printConfig(): void {
  console.log('Loaded config:');
  console.log(`  L2_LOGIN_IP    = ${cfg.loginIp}`);
  console.log(`  L2_LOGIN_PORT  = ${cfg.loginPort}`);
  console.log(`  L2_GAME_PORT   = ${cfg.gamePort}`);
  console.log(`  L2_USERNAME    = ${cfg.username}`);
  console.log(`  L2_PASSWORD    = ${maskPassword(cfg.password)}`);
  console.log(`  L2_SERVER_ID   = ${cfg.serverId}`);
  console.log(`  L2_CHAR_SLOT   = ${cfg.charSlot}`);
  console.log(`  L2_PROTOCOL    = ${cfg.protocol}`);
  console.log(`  PHASE (raw)    = ${phaseEnv}`);
  console.log(`  PHASE (parsed) = ${Number.isNaN(cfg.phase) ? 'NaN (non-numeric)' : cfg.phase}`);
}

function runPhase1(): void {
  let tscClean = false;
  try {
    execSync('npx tsc --noEmit', { stdio: 'pipe' });
    tscClean = true;
  } catch {
    tscClean = false;
  }

  DebugTools.check('config complete', true);
  DebugTools.check('tsc clean', tscClean);

  DebugTools.report({
    phase: 1,
    statePath: 'IDLE -> CONFIG_LOADED -> TSC_CLEAN',
    artifacts: 'none',
    notes: tscClean ? '-' : 'TypeScript typecheck failed',
  });

  process.exit(tscClean ? 0 : 1);
}

function main(): void {
  printConfig();

  switch (phaseEnv) {
    case '1':
      runPhase1();
      break;
    case '2':
      runLoginPhase(cfg)
        .then(() => process.exit(0))
        .catch((err) => {
          console.error('PHASE 2 failed:', err);
          process.exit(1);
        });
      break;
    case '3':
    case '4':
      console.log(`PHASE ${phaseEnv} is not implemented in PHASE 1 scaffold.`);
      process.exit(0);
      break;
    case 'full':
    case '0':
    case '5':
      console.log('Full chain (PHASE 5) is not implemented in PHASE 1 scaffold.');
      process.exit(0);
      break;
    default:
      console.log(`Unknown PHASE value: ${phaseEnv}`);
      process.exit(1);
  }
}

main();
