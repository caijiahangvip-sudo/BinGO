import { ensureBootstrapAdmin } from './bootstrap.js';
import { startCollaborationServer } from './collaboration-server.js';
import { migrate, pool } from './db.js';
import { startRestServer } from './rest-server.js';

await migrate();
await ensureBootstrapAdmin();
const [restServer, collaborationServer] = await Promise.all([
  startRestServer(),
  startCollaborationServer(),
]);

async function shutdown() {
  await Promise.allSettled([restServer.close(), collaborationServer.destroy(), pool.end()]);
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
