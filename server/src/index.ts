import { buildApp } from './app.js';
import { setSpoofedDate, todayStr } from './clock.js';
import { config } from './config.js';
import { startScheduler } from './scheduler.js';
import { createUserService } from './services/userService.js';
import { JsonFileStorage } from './storage/JsonFileStorage.js';

async function main(): Promise<void> {
  if (config.spoofDate) {
    setSpoofedDate(config.spoofDate);
    console.log(`[boot] clock spoofed to ${config.spoofDate}`);
  }

  // Swap this one line for a DB-backed StorageProvider when ready.
  const storage = await JsonFileStorage.create(config.dataDir);

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
