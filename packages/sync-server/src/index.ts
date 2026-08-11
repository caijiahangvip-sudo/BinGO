import { ensureBootstrapAdmin } from './bootstrap.js';
import { startCollaborationServer } from './collaboration-server.js';
import { migrate, pool } from './db.js';
import { startRestServer } from './rest-server.js';
import { deleteExpiredAccounts, resetAdminPasswordFromEnvironment } from './admin-routes.js';

await migrate();
await ensureBootstrapAdmin();
if (await resetAdminPasswordFromEnvironment()) {
  await pool.end();
  process.exit(0);
}
const [restServer, collaborationServer] = await Promise.all([
  startRestServer(),
  startCollaborationServer(),
]);

const cleanupTimer = setInterval(() => void deleteExpiredAccounts(), 60 * 60 * 1000);

async function shutdown() {
  clearInterval(cleanupTimer);
  await Promise.allSettled([restServer.close(), collaborationServer.destroy(), pool.end()]);
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
