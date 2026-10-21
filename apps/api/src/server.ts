export { startServer } from './app.js';
export { loadConfig } from './config.js';

import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { startServer } from './app.js';
import { loadConfig } from './config.js';

const projectRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
dotenv.config({ path: resolve(projectRoot, '.env'), quiet: true });

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  startServer(loadConfig()).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Startup failed.';
    console.error(JSON.stringify({ level: 'error', event: 'startup_failed', message }));
    process.exitCode = 1;
  });
}
