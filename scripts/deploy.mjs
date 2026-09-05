/**
 * Deploy the production build to the Raspberry Pi over scp/ssh.
 *
 * Builds the server + web standalone bundle (via build-prod.mjs), then copies
 * the runtime artifacts into ~/taskmanager on the Pi and restarts the
 * taskmanager.service. No on-device compilation (no OOM).
 *
 * Native modules: the standalone bundle built on Windows contains Windows
 * binaries (sharp/@next/swc/lightningcss win32-x64), which won't run on ARM.
 * So we copy dist-standalone WITHOUT node_modules and run `npm install
 * --omit=dev` on the Pi (in both server/ and web/dist-standalone/) to fetch
 * the correct ARM-native deps. The rest of the bundle (compiled app, .next
 * server output, static assets) is plain JS and portable.
 *
 * Single password entry: the script prompts once for the Pi password, writes a
 * temporary SSH_ASKPASS helper, and sets SSH_ASKPASS_REQUIRE=force so every
 * ssh/scp in the run uses it — no per-step prompts, no sshpass/plink needed.
 * The helper file is deleted when the deploy finishes.
 *
 * npm on the Pi is installed via nvm, which isn't on the PATH for
 * non-interactive ssh. We source the nvm profile before running npm.
 *
 * Layout produced on the Pi:
 *   ~/taskmanager/
 *     package.json                 (root scripts, incl. start:prod)
 *     scripts/start-prod.mjs       (launcher)
 *     server/package.json
 *     server/.env                  (NODE_ENV=production)
 *     server/dist/                 (compiled API)
 *     server/node_modules/         (ARM prod deps, installed on Pi)
 *     web/dist-standalone/         (Next server + assets, node_modules from Pi)
 *
 * Usage:  npm run deploy
 * Requires scp + ssh on PATH and passwordless sudo for `systemctl restart`.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const PI_USER = process.env.PI_USER ?? 'pi';
const PI_HOST = process.env.PI_HOST ?? '192.168.0.27';
const PI_DIR = process.env.PI_DIR ?? '~/taskmanager';
const SERVICE = process.env.PI_SERVICE ?? 'taskmanager.service';
const TARGET = `${PI_USER}@${PI_HOST}`;

// nvm's default install location on the Pi; sourcing it puts npm on PATH.
const NVM_SETUP = 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"';

// ---------------------------------------------------------------------------
// Single-password SSH_ASKPASS setup
// ---------------------------------------------------------------------------

let askpassPath = null;
let askpassDataPath = null;

/** Prompt for a password without echoing it. */
function promptPassword(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Mute echo by writing over the prompt line.
    const onData = (char) => {
      const c = char.toString();
      if (c === '\n' || c === '\r' || c === '') return;
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(query);
    };
    process.stdin.on('data', onData);
    rl.question(query, (answer) => {
      process.stdin.removeListener('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

/**
 * Write a temporary askpass helper that prints the password, and return the
 * env vars that make ssh/scp use it. Works with stock Windows OpenSSH.
 *
 * The password is written to a data file and the .bat uses `type` to print it
 * verbatim — `echo ${password}` would break (and be unsafe) if the password
 * contains cmd-special characters like % & | > < ^.
 */
function setupAskpass(password) {
  const pid = process.pid;
  askpassDataPath = path.join(os.tmpdir(), `tm-askpass-${pid}.txt`);
  askpassPath = path.join(os.tmpdir(), `tm-askpass-${pid}.bat`);
  writeFileSync(askpassDataPath, password, { mode: 0o600 });
  writeFileSync(askpassPath, `@echo off\r\ntype "${askpassDataPath}"\r\n`);
  return {
    SSH_ASKPASS: askpassPath,
    SSH_ASKPASS_REQUIRE: 'force',
    // Ensure ssh doesn't try to read from the console directly.
    DISPLAY: process.env.DISPLAY ?? 'localhost:0',
  };
}

function cleanupAskpass() {
  for (const p of [askpassPath, askpassDataPath]) {
    if (p && existsSync(p)) {
      try { unlinkSync(p); } catch { /* best-effort */ }
    }
  }
  askpassPath = null;
  askpassDataPath = null;
}

// ---------------------------------------------------------------------------
// Command runners
// ---------------------------------------------------------------------------

let sshEnv = {};

function run(label, command, args, options = {}) {
  console.log(`\n[deploy] ${label}...`);
  const isSsh = command === 'ssh' || command === 'scp';
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: !isSsh,
    env: isSsh ? { ...process.env, ...sshEnv } : process.env,
    ...options,
  });
  if (result.status !== 0) {
    console.error(`[deploy] ${label} failed (code ${result.status})`);
    cleanupAskpass();
    process.exit(result.status ?? 1);
  }
}

/** Run an ssh command, piping `input` to its stdin (avoids shell quoting). */
function runSshStdin(label, remoteCmd, input) {
  console.log(`\n[deploy] ${label}...`);
  const result = spawnSync('ssh', [TARGET, remoteCmd], {
    cwd: root,
    input,
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, ...sshEnv },
  });
  if (result.status !== 0) {
    console.error(`[deploy] ${label} failed (code ${result.status})`);
    cleanupAskpass();
    process.exit(result.status ?? 1);
  }
}

// ---------------------------------------------------------------------------
// Deploy steps
// ---------------------------------------------------------------------------

async function main() {
  // 1. Build everything (server dist + web standalone bundle).
  run('build', 'node', [path.join('scripts', 'build-prod.mjs')]);

  // 2. Stage a node_modules-free copy of the standalone bundle so we don't
  //    ship Windows native binaries to the Pi.
  const staging = path.join(root, 'web', '.deploy-staging');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const standaloneDir = path.join(root, 'web', 'dist-standalone');
  if (!existsSync(path.join(standaloneDir, 'server.js'))) {
    console.error('[deploy] web/dist-standalone/server.js not found — build first.');
    process.exit(1);
  }
  cpSync(standaloneDir, staging, {
    recursive: true,
    // Exclude node_modules DIRECTORIES only. A plain substring match on
    // 'node_modules' would also drop Turbopack's shared chunk files named
    // 'node_modules_<hash>._.js' (they live in .next/server/chunks/), which
    // causes ChunkLoadError / MODULE_NOT_FOUND on the Pi at runtime.
    filter: (src) => !src.includes(`${path.sep}node_modules${path.sep}`) && !src.endsWith(`${path.sep}node_modules`),
  });

  // 3. Prompt once for the Pi password and arm the askpass helper.
  const password = await promptPassword(`[deploy] password for ${TARGET}: `);
  sshEnv = setupAskpass(password);

  // 4. Make sure the target directories exist on the Pi.
  run('prepare remote dirs', 'ssh', [
    TARGET,
    `mkdir -p ${PI_DIR}/scripts ${PI_DIR}/server ${PI_DIR}/web/dist-standalone`,
  ]);

  // 5. Copy root + launcher + server manifests.
  run('copy root files', 'scp', [path.join(root, 'package.json'), `${TARGET}:${PI_DIR}/`]);
  run('copy launcher', 'scp', [path.join(root, 'scripts', 'start-prod.mjs'), `${TARGET}:${PI_DIR}/scripts/`]);
  run('copy server package.json', 'scp', [path.join(root, 'server', 'package.json'), `${TARGET}:${PI_DIR}/server/`]);

  // 6. Write a production .env on the Pi via stdin (no shell quoting issues).
  runSshStdin('write server .env', `cat > ${PI_DIR}/server/.env`, 'NODE_ENV=production\n');

  // 7. Replace the compiled API and the standalone web bundle on the Pi.
  //    Turbopack names .next chunks with content hashes, so a new build has
  //    different chunk filenames — `scp -r` would merge into the old dir and
  //    leave stale chunks, causing ChunkLoadError / MODULE_NOT_FOUND at
  //    runtime. So we delete the old build output first, then copy fresh.
  //    We keep web/dist-standalone/node_modules (the ARM deps installed on the
  //    Pi) so step 8 only has to install what changed.
  run('clean old build on Pi', 'ssh', [
    TARGET,
    `rm -rf ${PI_DIR}/server/dist ${PI_DIR}/web/dist-standalone/.next ${PI_DIR}/web/dist-standalone/public ${PI_DIR}/web/dist-standalone/server.js ${PI_DIR}/web/dist-standalone/package.json`,
  ]);
  run('copy server dist', 'scp', ['-r', path.join(root, 'server', 'dist'), `${TARGET}:${PI_DIR}/server/`]);
  run('copy web standalone', 'scp', ['-r', `${staging}/.`, `${TARGET}:${PI_DIR}/web/dist-standalone/`]);

  // 8. Install production deps on the Pi so native modules are ARM builds.
  //    Source nvm first so npm is on PATH for the non-interactive shell.
  run('install server deps on Pi', 'ssh', [TARGET, `${NVM_SETUP} && cd ${PI_DIR}/server && npm install --omit=dev`]);
  run('install web deps on Pi', 'ssh', [TARGET, `${NVM_SETUP} && cd ${PI_DIR}/web/dist-standalone && npm install --omit=dev`]);

  // 9. Restart the service to pick up the new build.
  run(`restart ${SERVICE}`, 'ssh', [TARGET, `sudo systemctl restart ${SERVICE}`]);

  // 10. Clean up the local staging dir and the askpass helper.
  rmSync(staging, { recursive: true, force: true });
  cleanupAskpass();

  console.log('\n[deploy] done.');
  console.log(`[deploy] check status:  ssh ${TARGET} "systemctl status ${SERVICE}"`);
}

main().catch((err) => {
  console.error('[deploy] fatal:', err);
  cleanupAskpass();
  process.exit(1);
});
