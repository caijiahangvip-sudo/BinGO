import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { pool, transaction } from './db.js';
import {
  bearerToken,
  hashPassword,
  issueAccessToken,
  verifyAccessToken,
  verifyPassword,
  type AccessClaims,
} from './auth.js';
import { applySyncRecords, syncRecordSchema } from './records.js';

declare module 'fastify' {
  interface FastifyRequest {
    account?: AccessClaims;
  }
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const inviteSchema = z.object({ role: z.enum(['teacher', 'student']), expiresInHours: z.number().int().min(1).max(168).default(48) });
const acceptInviteSchema = z.object({ token: z.string().min(20), email: z.string().email(), password: z.string().min(10), displayName: z.string().min(1).max(120) });
const pushSchema = z.object({ records: z.array(syncRecordSchema).max(500) });

function requireAccount(request: { headers: { authorization?: string } }): AccessClaims {
  return verifyAccessToken(bearerToken(request.headers.authorization));
}

export async function startRestServer() {
  const app = Fastify({ logger: true, bodyLimit: 32 * 1024 * 1024 });

  app.get('/health', async () => ({ ok: true, service: 'bingo-sync', version: '0.1.0' }));

  app.post('/v1/auth/login', async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const result = await pool.query<{
      id: string;
      organization_id: string;
      role: AccessClaims['role'];
      password_hash: string;
      display_name: string;
    }>(
      `SELECT id, organization_id, role, password_hash, display_name
       FROM accounts WHERE lower(email) = lower($1) AND disabled_at IS NULL`,
      [input.email],
    );
    const account = result.rows[0];
    if (!account || !(await verifyPassword(input.password, account.password_hash))) {
      return reply.code(401).send({ error: '邮箱或密码错误' });
    }
    return {
      accessToken: issueAccessToken({
        sub: account.id,
        organizationId: account.organization_id,
        role: account.role,
      }),
      account: {
        id: account.id,
        organizationId: account.organization_id,
        role: account.role,
        displayName: account.display_name,
      },
    };
  });

  app.post('/v1/invitations', async (request, reply) => {
    const account = requireAccount(request);
    const input = inviteSchema.parse(request.body);
    if (account.role === 'student' || (account.role === 'teacher' && input.role !== 'student')) {
      return reply.code(403).send({ error: '没有创建此邀请的权限' });
    }
    const token = randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO invitations (token_hash, organization_id, role, created_by, expires_at)
       VALUES (encode(digest($1, 'sha256'), 'hex'), $2, $3, $4, now() + ($5 || ' hours')::interval)`,
      [token, account.organizationId, input.role, account.sub, input.expiresInHours],
    );
    return reply.code(201).send({ token });
  });

  app.post('/v1/invitations/accept', async (request, reply) => {
    const input = acceptInviteSchema.parse(request.body);
    const result = await transaction(async (client) => {
      const invitationResult = await client.query<{
        id: string;
        organization_id: string;
        role: AccessClaims['role'];
      }>(
        `SELECT id, organization_id, role FROM invitations
         WHERE token_hash = encode(digest($1, 'sha256'), 'hex')
           AND accepted_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [input.token],
      );
      const invitation = invitationResult.rows[0];
      if (!invitation) return null;
      const accountId = randomUUID();
      await client.query(
        `INSERT INTO accounts (id, organization_id, email, display_name, role, password_hash)
         VALUES ($1, $2, lower($3), $4, $5, $6)`,
        [
          accountId,
          invitation.organization_id,
          input.email,
          input.displayName,
          invitation.role,
          await hashPassword(input.password),
        ],
      );
      await client.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [invitation.id]);
      return { accountId, organizationId: invitation.organization_id, role: invitation.role };
    });
    if (!result) return reply.code(400).send({ error: '邀请已失效' });
    return reply.code(201).send({
      accessToken: issueAccessToken({
        sub: result.accountId,
        organizationId: result.organizationId,
        role: result.role,
      }),
    });
  });

  app.get('/v1/me', async (request) => {
    const account = requireAccount(request);
    return { account };
  });

  app.get('/v1/sync/records', async (request) => {
    const account = requireAccount(request);
    const query = z.object({ cursor: z.coerce.number().int().nonnegative().default(0) }).parse(request.query);
    const result = await pool.query(
      `SELECT entity_type AS "entityType", entity_id AS "entityId", payload, version,
              deleted_at AS "deletedAt", updated_at AS "updatedAt"
       FROM sync_records
       WHERE organization_id = $1 AND change_sequence > $2
       ORDER BY change_sequence ASC LIMIT 1000`,
      [account.organizationId, query.cursor],
    );
    const cursorResult = await pool.query<{ cursor: string }>(
      'SELECT COALESCE(max(change_sequence), $2) AS cursor FROM sync_records WHERE organization_id = $1',
      [account.organizationId, query.cursor],
    );
    return { records: result.rows, cursor: Number(cursorResult.rows[0].cursor) };
  });

  app.post('/v1/sync/records', async (request) => {
    const account = requireAccount(request);
    const input = pushSchema.parse(request.body);
    return applySyncRecords(account.organizationId, account.sub, input.records);
  });

  await app.listen({ host: config.BINGO_SYNC_HOST, port: config.BINGO_SYNC_PORT });
  return app;
}
