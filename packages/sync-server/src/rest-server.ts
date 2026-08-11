import { randomBytes, randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { pool, transaction } from './db.js';
import {
  hashPassword,
  hashToken,
  issueAccessToken,
  verifyPassword,
  type AccessClaims,
  type AccountRole,
} from './auth.js';
import { HTTPError, requireAccount } from './account-access.js';
import { applySyncRecords, syncRecordSchema } from './records.js';
import { decryptPayload } from './privacy.js';
import { registerAccountRecoveryRoutes, registerAdminRoutes } from './admin-routes.js';
import { registerTeachingRoutes } from './teaching-routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    account?: AccessClaims;
  }
}

const identifierSchema = z.string().trim().min(2).max(160);
const usernameSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[\p{L}\p{N}_.-]+$/u);
const passwordSchema = z.string().min(10).max(200);
const deviceSchema = z.object({
  deviceName: z.string().trim().min(1).max(120).default('未命名设备'),
  platform: z.string().trim().min(1).max(40).default('unknown'),
});
const loginSchema = z
  .object({
    identifier: identifierSchema.optional(),
    username: identifierSchema.optional(),
    email: z.string().email().optional(),
    password: passwordSchema,
    deviceName: deviceSchema.shape.deviceName,
    platform: deviceSchema.shape.platform,
  })
  .refine((value) => value.identifier || value.username || value.email, {
    message: '用户名或邮箱不能为空',
  });
const registerSchema = z.object({
  inviteCode: z.string().trim().min(4).max(64),
  username: usernameSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(120).optional(),
  deviceName: deviceSchema.shape.deviceName,
  platform: deviceSchema.shape.platform,
});
const teacherRegisterSchema = z.object({
  inviteCode: z.string().trim().min(6).max(80),
  username: usernameSchema,
  password: passwordSchema,
  deviceName: deviceSchema.shape.deviceName,
  platform: deviceSchema.shape.platform,
});
const refreshSchema = z.object({ refreshToken: z.string().min(20).max(300) });
const inviteCodeSchema = z.object({ inviteCode: z.string().trim().min(4).max(64) });
const legacyInviteSchema = z.object({
  role: z.enum(['teacher', 'student']),
  expiresInHours: z.number().int().min(1).max(168).default(48),
});
const acceptInviteSchema = z.object({
  token: z.string().min(20),
  email: z.string().email(),
  password: passwordSchema,
  displayName: z.string().min(1).max(120),
});
const pushSchema = z.object({ records: z.array(syncRecordSchema).max(500) });

const attempts = new Map<string, { count: number; resetAt: number }>();
function enforceRateLimit(
  request: FastifyRequest,
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
): boolean {
  const key = request.ip;
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  current.count += 1;
  if (current.count > 30) {
    reply.code(429).send({ error: '请求过于频繁，请稍后再试' });
    return false;
  }
  return true;
}

function accountResponse(account: {
  id: string;
  organization_id: string;
  username: string | null;
  role: AccountRole;
  display_name: string;
}) {
  return {
    id: account.id,
    organizationId: account.organization_id,
    username: account.username,
    role: account.role,
    displayName: account.display_name,
  };
}

async function createSession(
  account: { id: string; organization_id: string; role: AccountRole },
  device: { deviceName: string; platform: string },
) {
  const sessionId = randomUUID();
  const refreshToken = randomBytes(48).toString('base64url');
  await pool.query(
    `INSERT INTO device_sessions
       (id, account_id, refresh_token_hash, device_name, platform, refresh_expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)`,
    [
      sessionId,
      account.id,
      hashToken(refreshToken),
      device.deviceName,
      device.platform,
      config.BINGO_REFRESH_TOKEN_SECONDS,
    ],
  );
  return {
    accessToken: issueAccessToken({
      sub: account.id,
      organizationId: account.organization_id,
      role: account.role,
      sessionId,
    }),
    refreshToken,
  };
}

function requireAdmin(account: AccessClaims): void {
  if (account.role !== 'admin') throw new HTTPError(403, '需要管理员权限');
}

export async function startRestServer() {
  const app = Fastify({ logger: true, bodyLimit: 32 * 1024 * 1024, trustProxy: true });
  const teacherOrigins = new Set(['https://teacher.bingo.mido.site', 'http://tauri.localhost', 'tauri://localhost']);

  app.options('*', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && teacherOrigins.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      reply.header('Vary', 'Origin');
    }
    return reply.code(204).send();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HTTPError)
      return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof z.ZodError)
      return reply.code(400).send({ error: '请求参数无效', details: z.flattenError(error) });
    if ((error as { code?: string }).code === '23505')
      return reply.code(409).send({ error: '数据已存在' });
    const statusError = error as { statusCode?: number; message?: string };
    if (typeof statusError.statusCode === 'number' && statusError.statusCode < 500) {
      return reply.code(statusError.statusCode).send({ error: statusError.message || '请求无效' });
    }
    request.log.error(error);
    return reply.code(500).send({ error: '服务器内部错误' });
  });

  app.addHook('onSend', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && teacherOrigins.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      reply.header('Vary', 'Origin');
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
  });

  app.get('/', async () => ({
    ok: true,
    service: 'bingo-sync',
    message: 'BinGO 同步服务器运行中',
  }));
  app.get('/health', async () => ({ ok: true, service: 'bingo-sync', version: '0.1.0' }));
  app.get('/api/health', async () => ({ ok: true, service: 'bingo-sync', version: '0.1.0' }));

  registerAccountRecoveryRoutes(app);
  registerAdminRoutes(app);
  registerTeachingRoutes(app);

  app.post('/v1/auth/register', async (request, reply) => {
    if (!enforceRateLimit(request, reply)) return;
    const input = registerSchema.parse(request.body);
    const username = input.username.toLowerCase();
    try {
      const result = await transaction(async (client) => {
        const tieredInvite = await client.query<{ id: string; organization_id: string; tier: 'A' | 'B' | 'C'; max_uses: number | null; used_count: number }>(
          `SELECT id, organization_id, tier, max_uses, used_count
           FROM tiered_invites
           WHERE code_hash = $1 AND enabled = true
             AND (expires_at IS NULL OR expires_at > now())
             AND (max_uses IS NULL OR used_count < max_uses)
           FOR UPDATE`,
          [hashToken(input.inviteCode.toLowerCase())],
        );
        let organization: { id: string; tier: 'A' | 'B' | 'C' } | undefined;
        if (tieredInvite.rowCount) {
          const invite = tieredInvite.rows[0];
          await client.query('UPDATE tiered_invites SET used_count = used_count + 1 WHERE id = $1', [invite.id]);
          organization = { id: invite.organization_id, tier: invite.tier };
        }
        const organizationResult = await client.query<{ id: string }>(
          `SELECT id FROM organizations
           WHERE invite_code_hash = $1 AND invite_code_enabled = true`,
          [hashToken(input.inviteCode.toLowerCase())],
        );
        organization ??= organizationResult.rows[0] ? { id: organizationResult.rows[0].id, tier: 'B' } : undefined;
        if (!organization) return null;
        const accountId = randomUUID();
        await client.query(
          `INSERT INTO accounts (id, organization_id, username, display_name, role, password_hash, privacy_tier)
           VALUES ($1, $2, $3, $4, 'student', $5, $6)`,
          [
            accountId,
            organization.id,
            username,
            username,
            await hashPassword(input.password),
            organization.tier,
          ],
        );
        return { id: accountId, organization_id: organization.id, role: 'student' as const };
      });
      if (!result) return reply.code(400).send({ error: '邀请码无效或已停用' });
      const session = await createSession(result, input);
      return reply
        .code(201)
        .send({
          ...session,
          account: {
            ...result,
            username,
            displayName: username,
            organizationId: result.organization_id,
          },
        });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '23505')
        return reply.code(409).send({ error: '用户名已存在' });
      throw error;
    }
  });

  app.post('/v1/auth/register-teacher', async (request, reply) => {
    if (!enforceRateLimit(request, reply)) return;
    const input = teacherRegisterSchema.parse(request.body);
    const username = input.username.toLowerCase();
    try {
      const result = await transaction(async (client) => {
        const invite = await client.query<{
          id: string;
          organization_id: string;
          class_id: string | null;
          assignment_role: 'vesta' | 'minerva' | 'apollo';
          subject_name: string;
        }>(
          `SELECT id, organization_id, class_id, assignment_role, subject_name
           FROM teacher_invites WHERE code_hash = $1 AND enabled = true AND used_at IS NULL
             AND expires_at > now() FOR UPDATE`,
          [hashToken(input.inviteCode.toLowerCase())],
        );
        const invitation = invite.rows[0];
        if (!invitation) return null;
        const accountId = randomUUID();
        await client.query(
          `INSERT INTO accounts (id, organization_id, username, display_name, role, password_hash, privacy_tier)
           VALUES ($1, $2, $3, $3, 'teacher', $4, 'B')`,
          [accountId, invitation.organization_id, username, await hashPassword(input.password)],
        );
        if (invitation.class_id) {
          await client.query(
            `INSERT INTO teacher_assignments (class_id, teacher_id, assignment_role, subject_name)
             VALUES ($1, $2, $3, $4)`,
            [invitation.class_id, accountId, invitation.assignment_role, invitation.subject_name],
          );
        }
        await client.query(
          'UPDATE teacher_invites SET enabled = false, used_by = $2, used_at = now() WHERE id = $1',
          [invitation.id, accountId],
        );
        return { id: accountId, organization_id: invitation.organization_id, role: 'teacher' as const };
      });
      if (!result) return reply.code(400).send({ error: '教师邀请码无效、已过期或已使用' });
      const session = await createSession(result, input);
      return reply.code(201).send({
        ...session,
        account: {
          ...result,
          username,
          displayName: username,
          organizationId: result.organization_id,
        },
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: '用户名已存在' });
      throw error;
    }
  });

  app.post('/v1/auth/login', async (request, reply) => {
    if (!enforceRateLimit(request, reply)) return;
    const input = loginSchema.parse(request.body);
    const identifier = (input.identifier || input.username || input.email || '')
      .trim()
      .toLowerCase();
    const result = await pool.query<{
      id: string;
      organization_id: string;
      username: string | null;
      role: AccountRole;
      password_hash: string;
      display_name: string;
    }>(
      `SELECT id, organization_id, username, role, password_hash, display_name
       FROM accounts
       WHERE (lower(username) = $1 OR lower(email) = $1) AND disabled_at IS NULL`,
      [identifier],
    );
    const account = result.rows[0];
    if (!account || !(await verifyPassword(input.password, account.password_hash))) {
      return reply.code(401).send({ error: '用户名或密码错误' });
    }
    const session = await createSession(account, input);
    await pool.query('UPDATE accounts SET last_login_at = now() WHERE id = $1', [account.id]);
    return {
      ...session,
      account: accountResponse(account),
    };
  });

  app.post('/v1/auth/refresh', async (request, reply) => {
    const input = refreshSchema.parse(request.body);
    const result = await pool.query<{
      session_id: string;
      account_id: string;
      organization_id: string;
      role: AccountRole;
      username: string | null;
      display_name: string;
    }>(
      `SELECT session.id AS session_id, account.id AS account_id,
              account.organization_id, account.role, account.username, account.display_name
       FROM device_sessions session
       JOIN accounts account ON account.id = session.account_id
       WHERE session.refresh_token_hash = $1
         AND session.revoked_at IS NULL
         AND session.refresh_expires_at > now()
         AND account.disabled_at IS NULL`,
      [hashToken(input.refreshToken)],
    );
    const session = result.rows[0];
    if (!session) return reply.code(401).send({ error: '刷新令牌无效或已过期' });
    await pool.query('UPDATE device_sessions SET last_seen_at = now() WHERE id = $1', [
      session.session_id,
    ]);
    return {
      accessToken: issueAccessToken({
        sub: session.account_id,
        organizationId: session.organization_id,
        role: session.role,
        sessionId: session.session_id,
      }),
      account: {
        id: session.account_id,
        organizationId: session.organization_id,
        username: session.username,
        role: session.role,
        displayName: session.display_name,
      },
    };
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    const account = await requireAccount(request);
    await pool.query('UPDATE device_sessions SET revoked_at = now() WHERE id = $1', [
      account.sessionId,
    ]);
    return reply.code(204).send();
  });

  app.get('/v1/me', async (request) => {
    const account = await requireAccount(request);
    const result = await pool.query(
      `SELECT id, organization_id, username, role, display_name
       FROM accounts WHERE id = $1`,
      [account.sub],
    );
    return { account: accountResponse(result.rows[0]) };
  });

  app.get('/v1/devices', async (request) => {
    const account = await requireAccount(request);
    const result = await pool.query(
      `SELECT id, device_name AS "deviceName", platform, created_at AS "createdAt",
              last_seen_at AS "lastSeenAt", (revoked_at IS NOT NULL) AS revoked
       FROM device_sessions WHERE account_id = $1 ORDER BY last_seen_at DESC`,
      [account.sub],
    );
    return { devices: result.rows };
  });

  app.delete('/v1/devices/:id', async (request, reply) => {
    const account = await requireAccount(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await pool.query(
      `UPDATE device_sessions session
       SET revoked_at = now()
       FROM accounts target
       WHERE session.id = $1
         AND session.account_id = target.id
         AND (session.account_id = $2 OR (target.organization_id = $3 AND $4 = 'admin'))`,
      [params.id, account.sub, account.organizationId, account.role],
    );
    return reply.code(204).send();
  });

  app.get('/v1/admin/invite-code', async (request) => {
    const account = await requireAccount(request);
    requireAdmin(account);
    const result = await pool.query<{
      invite_code_updated_at: string | null;
      invite_code_enabled: boolean;
    }>('SELECT invite_code_updated_at, invite_code_enabled FROM organizations WHERE id = $1', [
      account.organizationId,
    ]);
    return {
      enabled: result.rows[0]?.invite_code_enabled ?? false,
      updatedAt: result.rows[0]?.invite_code_updated_at ?? null,
    };
  });

  app.post('/v1/admin/invite-code/rotate', async (request) => {
    const account = await requireAccount(request);
    requireAdmin(account);
    const input = inviteCodeSchema.parse(request.body);
    await pool.query(
      `UPDATE organizations
       SET invite_code_hash = $2, invite_code_updated_at = now(), invite_code_enabled = true
       WHERE id = $1`,
      [account.organizationId, hashToken(input.inviteCode.toLowerCase())],
    );
    return { enabled: true, inviteCode: input.inviteCode };
  });

  app.post('/v1/admin/invite-code/revoke', async (request) => {
    const account = await requireAccount(request);
    requireAdmin(account);
    await pool.query('UPDATE organizations SET invite_code_enabled = false WHERE id = $1', [
      account.organizationId,
    ]);
    return { enabled: false };
  });

  app.post('/v1/invitations', async (request, reply) => {
    const account = await requireAccount(request);
    const input = legacyInviteSchema.parse(request.body);
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
        role: AccountRole;
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
        `INSERT INTO accounts (id, organization_id, email, username, display_name, role, password_hash)
         VALUES ($1, $2, lower($3), lower($3), $4, $5, $6)`,
        [
          accountId,
          invitation.organization_id,
          input.email,
          input.displayName,
          invitation.role,
          await hashPassword(input.password),
        ],
      );
      await client.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [
        invitation.id,
      ]);
      return {
        id: accountId,
        organization_id: invitation.organization_id,
        role: invitation.role,
        username: input.email.split('@')[0],
        display_name: input.displayName,
      };
    });
    if (!result) return reply.code(400).send({ error: '邀请已失效' });
    const session = await createSession(result, { deviceName: '未命名设备', platform: 'unknown' });
    return reply.code(201).send({ ...session, account: accountResponse(result) });
  });

  app.get('/v1/sync/records', async (request) => {
    const account = await requireAccount(request);
    const query = z
      .object({ cursor: z.coerce.number().int().nonnegative().default(0) })
      .parse(request.query);
    const result = await pool.query(
      `SELECT entity_type AS "entityType", entity_id AS "entityId", payload,
              encrypted_payload, encryption_iv, encryption_tag, version,
              visibility, deleted_at AS "deletedAt", updated_at AS "updatedAt"
       FROM sync_records
       WHERE organization_id = $1
         AND change_sequence > $2
         AND (visibility = 'organization' OR owner_account_id = $3)
       ORDER BY change_sequence ASC LIMIT 1000`,
      [account.organizationId, query.cursor, account.sub],
    );
    const cursorResult = await pool.query<{ cursor: string }>(
      `SELECT COALESCE(max(change_sequence), $2) AS cursor
       FROM sync_records
       WHERE organization_id = $1
         AND (visibility = 'organization' OR owner_account_id = $3)`,
      [account.organizationId, query.cursor, account.sub],
    );
    return {
      records: result.rows.map((row) => ({
        entityType: row.entityType,
        entityId: row.entityId,
        payload: decryptPayload(row),
        version: row.version,
        visibility: row.visibility,
        deletedAt: row.deletedAt,
        updatedAt: row.updatedAt,
      })),
      cursor: Number(cursorResult.rows[0].cursor),
    };
  });

  app.post('/v1/sync/records', async (request) => {
    const account = await requireAccount(request);
    const input = pushSchema.parse(request.body);
    return applySyncRecords(account.organizationId, account.sub, input.records);
  });

  app.get('/v1/support/requests', async (request) => {
    const account = await requireAccount(request);
    const result = await pool.query(
      `SELECT request.id, administrator.display_name AS "administratorName",
              request.entity_type AS "entityType", request.entity_id AS "entityId",
              request.status, request.requested_at AS "requestedAt",
              request.decided_at AS "decidedAt", request.consumed_at AS "consumedAt"
       FROM support_access_requests request
       JOIN accounts administrator ON administrator.id = request.administrator_id
       WHERE request.user_id = $1 ORDER BY request.requested_at DESC LIMIT 200`,
      [account.sub],
    );
    return { requests: result.rows };
  });

  app.post('/v1/support/requests/:id/decision', async (request, reply) => {
    const account = await requireAccount(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ decision: z.enum(['approve', 'reject']), grantType: z.enum(['once', 'day', 'week', 'persistent']).default('once') }).parse(request.body);
    const status = input.decision === 'approve' ? 'approved' : 'rejected';
    const result = await pool.query(
      `UPDATE support_access_requests
       SET status = $3, grant_type = $4,
           expires_at = CASE WHEN $3 <> 'approved' THEN NULL
             WHEN $4 = 'day' THEN now() + interval '1 day'
             WHEN $4 = 'week' THEN now() + interval '7 days'
             ELSE NULL END,
           decided_at = now()
       WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id`,
      [params.id, account.sub, status, input.grantType],
    );
    if (!result.rowCount) return reply.code(409).send({ error: '申请已经处理或不存在' });
    return { ok: true, status };
  });

  await app.listen({ host: config.BINGO_SYNC_HOST, port: config.BINGO_SYNC_PORT });
  return app;
}
