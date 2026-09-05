/**
 * Local (dev) entry point for the one-off JSON -> SQLite import, run via tsx.
 * Delegates to the shared logic in src/storage/importJson.ts. The production
 * (Pi) entry point is src/scripts/import-json-to-sqlite.ts, compiled to dist/.
 *
 * Usage:
 *   npm run migrate:json-to-sqlite -- [jsonDir] [dataDir]
 */
import { importJsonToSqlite } from '../src/storage/importJson.js';

const [jsonDir, dataDir] = process.argv.slice(2);
importJsonToSqlite(jsonDir, dataDir).catch((err) => {
  console.error('[import] fatal:', err);
  process.exit(1);
});
