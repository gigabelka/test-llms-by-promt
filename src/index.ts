import { execSync } from 'child_process';
import { readFileSync } from 'node:fs';
import { cfg } from './config';
import * as DebugTools from './debug/DebugTools';
import { runLoginPhase, type LoginResult } from './login/LoginClient';
import { runGamePhase, type GamePhaseInput } from './game/GameClient';

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

function buildLoginArtifacts(result: LoginResult): string {
  return (
    `loginOkId1=${result.loginOkId1}, loginOkId2=${result.loginOkId2}, ` +
    `playOkId1=${result.playOkId1}, playOkId2=${result.playOkId2}, ` +
    `gameHost=${result.gameHost}, gamePort=${result.gamePort}`
  );
}

async function runPhase5(): Promise<void> {
  DebugTools.resetChecks();

  let tscClean = false;
  try {
    execSync('npx tsc --noEmit', { stdio: 'pipe' });
    tscClean = true;
  } catch {
    tscClean = false;
  }

  DebugTools.check('config complete', true);
  DebugTools.check('tsc clean', tscClean);

  if (!tscClean) {
    DebugTools.report({
      phase: 5,
      statePath: 'CONFIG_LOADED',
      artifacts: 'none',
      notes: 'TypeScript typecheck failed',
    });
    throw new Error('TypeScript typecheck failed');
  }

  let loginResult: LoginResult | undefined;
  let statePath = 'CONFIG_LOADED';
  let artifacts = 'none';

  try {
    loginResult = await runLoginPhase(cfg);
    statePath = 'CONFIG_LOADED -> LOGIN_OK';
    artifacts = buildLoginArtifacts(loginResult);

    await runGamePhase(cfg, loginResult, 4);
    statePath = 'CONFIG_LOADED -> LOGIN_OK -> IN_GAME';
  } catch (err) {
    DebugTools.resetChecks();
    DebugTools.check('config complete', true);
    DebugTools.check('tsc clean', true);
    if (statePath === 'CONFIG_LOADED') {
      DebugTools.check('login succeeded', false);
    } else {
      DebugTools.check('login succeeded', true);
      DebugTools.check('game entered', false);
    }
    DebugTools.report({
      phase: 5,
      statePath,
      artifacts,
      notes: String(err),
    });
    throw err;
  }

  DebugTools.resetChecks();
  DebugTools.check('config complete', true);
  DebugTools.check('tsc clean', true);
  DebugTools.check('login succeeded', true);
  DebugTools.check('game entered', true);
  DebugTools.report({
    phase: 5,
    statePath: 'CONFIG_LOADED -> LOGIN_OK -> IN_GAME',
    artifacts,
    notes: '-',
  });
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
    case '3': {
      let input: GamePhaseInput;
      try {
        const raw = readFileSync('artifacts/phase-2-output.json', 'utf8');
        input = JSON.parse(raw);
      } catch (err) {
        console.error('Failed to load artifacts/phase-2-output.json:', err);
        process.exit(1);
      }
      runGamePhase(cfg, input, 3)
        .then(() => process.exit(0))
        .catch((err) => {
          console.error('PHASE 3 failed:', err);
          process.exit(1);
        });
      break;
    }
    case '4': {
      let input: GamePhaseInput;
      try {
        const raw = readFileSync('artifacts/phase-2-output.json', 'utf8');
        input = JSON.parse(raw);
      } catch (err) {
        console.error('Failed to load artifacts/phase-2-output.json:', err);
        process.exit(1);
      }
      runGamePhase(cfg, input, 4)
        .then(() => process.exit(0))
        .catch((err) => {
          console.error('PHASE 4 failed:', err);
          process.exit(1);
        });
      break;
    }
    case 'full':
    case '0':
    case '5':
      runPhase5()
        .then(() => process.exit(0))
        .catch((err) => {
          console.error('PHASE 5 failed:', err);
          process.exit(1);
        });
      break;
    default:
      console.log(`Unknown PHASE value: ${phaseEnv}`);
      process.exit(1);
  }
}

main();
