import path from 'node:path';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  dataDir: process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'),
  /** How often the hydration loop runs. Default: 60 minutes. */
  hydrationIntervalMs: Number(process.env.HYDRATION_INTERVAL_MS ?? 60 * 60 * 1000),
  /** How far ahead of "today" the hydration loop materialises occurrences. */
  hydrationHorizonDays: Number(process.env.HYDRATION_HORIZON_DAYS ?? 1),
  /** Spoof the current date at boot, e.g. SPOOF_DATE=2026-08-01 */
  spoofDate: process.env.SPOOF_DATE ?? null,
  /** Seed these users on first run (only when the users file is empty). */
  seedUsers: (process.env.SEED_USERS ?? 'Alex,Jordan,Sam')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
