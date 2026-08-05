import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { config } from './config.js';
import { pool } from './db.js';
import { verifyAccessToken, type AccessClaims } from './auth.js';

interface CollaborationContext {
  account: AccessClaims;
}

function parseDocumentName(documentName: string) {
  const match = /^org\/([^/]+)\/(stage|whiteboard|annotation|answer)\/([^/]+)$/.exec(documentName);
  if (!match) throw new Error('Invalid collaboration document name');
  return { organizationId: match[1], kind: match[2] };
}

export async function startCollaborationServer() {
  const server = new Server<CollaborationContext>({
    port: config.BINGO_COLLAB_PORT,
    address: config.BINGO_SYNC_HOST,
    debounce: 1500,
    maxDebounce: 10_000,
    timeout: 30_000,
    websocketOptions: { maxPayload: 5 * 1024 * 1024 },
    maxUnauthenticatedQueueSize: 1024 * 1024,
    maxUnauthenticatedQueueMessages: 100,
    maxPendingDocuments: 10,
    extensions: [
      new Database({
        fetch: async ({ documentName }) => {
          const result = await pool.query<{ state: Buffer }>(
            'SELECT state FROM collaboration_documents WHERE document_name = $1',
            [documentName],
          );
          return result.rows[0]?.state ?? null;
        },
        store: async ({ documentName, state }) => {
          await pool.query(
            `INSERT INTO collaboration_documents (document_name, state)
             VALUES ($1, $2)
             ON CONFLICT (document_name) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
            [documentName, Buffer.from(state)],
          );
        },
      }),
    ],
    async onAuthenticate({ documentName, token, connectionConfig }) {
      const account = verifyAccessToken(token);
      const document = parseDocumentName(documentName);
      if (account.organizationId !== document.organizationId) throw new Error('Organization denied');
      if (account.role === 'student' && !['annotation', 'answer'].includes(document.kind)) {
        connectionConfig.readOnly = true;
      }
      return { account };
    },
  });
  await server.listen();
  return server;
}
