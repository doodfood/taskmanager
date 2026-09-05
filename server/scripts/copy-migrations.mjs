/**
 * Copy the SQL migration files into the compiled output tree so the migration
 * runner can find them at runtime (tsc only emits .ts sources, not .sql).
 * Runs as part of `npm run build`.
 */
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'src', 'storage', 'migrations');
const dest = path.join(here, '..', 'dist', 'storage', 'migrations');

if (existsSync(src)) {
  cpSync(src, dest, { recursive: true });
  console.log(`[build] copied migrations -> ${path.relative(process.cwd(), dest)}`);
}
