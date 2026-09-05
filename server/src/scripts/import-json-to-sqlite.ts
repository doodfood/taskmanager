/**
 * Compiled entry point for the one-off JSON -> SQLite import, so it can run on
 * the Pi with plain `node dist/scripts/import-json-to-sqlite.js` (no tsx / dev
 * deps needed in production). The heavy lifting lives in importJsonToSqlite().
 */
import { importJsonToSqlite } from '../storage/importJson.js';

const [jsonDir, dataDir] = process.argv.slice(2);
importJsonToSqlite(jsonDir, dataDir).catch((err: unknown) => {
  console.error('[import] fatal:', err);
  process.exit(1);
});
