/**
 * Cross-platform production build: builds the server, then builds + packages
 * the web app with NEXT_PUBLIC_APP_ENV=production forced on.
 *
 * Why force it here: Next.js inlines NEXT_PUBLIC_* vars into the client bundle
 * at BUILD time, and .env.local (which sets it to development for `next dev`)
 * takes priority over .env.production. Setting the var in the build process
 * env overrides both, so the production bundle always hides the dev tools —
 * without touching the developer's local .env.local.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(name, command, args, cwd, extraEnv = {}) {
  console.log(`[build:prod] ${name}...`);
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    console.error(`[build:prod] ${name} failed with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

// 1. Compile the Express API to server/dist.
run('server build', 'npm', ['run', 'build'], path.join(root, 'server'));

// 2. Build the web app with the dev tools disabled in the client bundle.
run('web build', 'npm', ['run', 'build'], path.join(root, 'web'), {
  NEXT_PUBLIC_APP_ENV: 'production',
});

// 3. Assemble the deployable standalone bundle (server.js + .next/static + public).
run('web package', 'npm', ['run', 'package'], path.join(root, 'web'));

console.log('[build:prod] done — run `npm run start:prod` to serve.');
