/**
 * Cross-platform production launcher: starts the compiled Express API and the
 * standalone Next.js web server with production env vars, without needing
 * shell-specific `VAR=value` syntax (works on Windows PowerShell and the Pi's
 * bash alike). Used by the root `npm run start:prod`.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const procs = [
  {
    name: 'server',
    args: ['dist/index.js'],
    cwd: path.join(root, 'server'),
    // Pin PORT so the API always matches the web proxy's default
    // API_INTERNAL_URL (http://127.0.0.1:4000/api), regardless of any PORT
    // inherited from the shell.
    env: { NODE_ENV: 'production', PORT: '4000' },
  },
  {
    name: 'web',
    args: ['server.js'],
    cwd: path.join(root, 'web', 'dist-standalone'),
    env: { NODE_ENV: 'production', PORT: '3000', HOSTNAME: '0.0.0.0' },
  },
];

const children = procs.map(({ name, args, cwd, env }) => {
  const child = spawn('node', args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    console.log(`[start:prod] ${name} exited with code ${code}`);
    // If either process dies, shut the other down so a process manager can
    // restart the pair cleanly.
    shutdown(code ?? 0);
  });
  return child;
});

function shutdown(code) {
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
