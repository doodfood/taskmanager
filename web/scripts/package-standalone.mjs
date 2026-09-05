/**
 * Assemble a complete, deployable standalone bundle in web/dist-standalone/.
 *
 * `next build` (with output:'standalone') emits a self-contained Node server at
 * .next/standalone/server.js plus a minimal node_modules — but it deliberately
 * does NOT copy the static assets (.next/static) or public/ folder, which the
 * server expects to find relative to itself. This script copies those in so the
 * result can be rsync'd to a low-memory host (Raspberry Pi) and run with
 * `node server.js` — no `next dev`, no on-device compilation, no OOM.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const standalone = path.join(webDir, '.next', 'standalone');
const out = path.join(webDir, 'dist-standalone');

if (!existsSync(path.join(standalone, 'server.js'))) {
  console.error('[package] .next/standalone/server.js not found — run `npm run build` first.');
  process.exit(1);
}

// Start from a clean output dir mirroring the standalone tree.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(standalone, out, { recursive: true });

// Static assets (JS/CSS chunks) — served from .next/static relative to server.js.
cpSync(path.join(webDir, '.next', 'static'), path.join(out, '.next', 'static'), { recursive: true });

// Public assets (favicon, svgs) — served from public/ relative to server.js.
const publicDir = path.join(webDir, 'public');
if (existsSync(publicDir)) {
  cpSync(publicDir, path.join(out, 'public'), { recursive: true });
}

console.log(`[package] deployable bundle ready at ${path.relative(webDir, out)}/`);
console.log('[package] copy it to the Pi and run:  PORT=3000 node server.js');
