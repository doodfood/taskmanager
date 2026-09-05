import { buildApp } from './app.js';
import { setSpoofedDate, todayStr } from './clock.js';
import { config } from './config.js';
import { startScheduler } from './scheduler.js';
import { createUserService } from './services/userService.js';
import { JsonFileStorage } from './storage/JsonFileStorage.js';
import { SqliteStorage } from './storage/SqliteStorage.js';
import type { StorageProvider } from './storage/StorageProvider.js';

async function main(): Promise<void> {
  if (config.spoofDate) {
    setSpoofedDate(config.spoofDate);
    console.log(`[boot] clock spoofed to ${config.spoofDate}`);
  }

  // Storage backend: SQLite by default, legacy JSON files when STORAGE=json.
  const storage: StorageProvider =
    config.storage === 'json'
      ? await JsonFileStorage.create(config.dataDir)
      : SqliteStorage.create(config.dataDir);
  console.log(`[boot] storage backend: ${config.storage}`);

  await createUserService(storage).ensureSeeded(config.seedUsers);

  const app = buildApp(storage);
  app.listen(config.port, () => {
    console.log(`[boot] API listening on http://localhost:${config.port} (today = ${todayStr()})`);
  });

  startScheduler(storage, config.hydrationIntervalMs, config.hydrationHorizonDays);
}

main().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
