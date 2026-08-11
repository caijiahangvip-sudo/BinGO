import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { hashPassword, hashToken, verifyPassword } from './auth.js';
import { pool, transaction } from './db.js';
import { canAdminDirectRead, decryptPayload, privacyLabel, roleLabel } from './privacy.js';
import { releaseMetadata } from './release.js';

const ADMIN_COOKIE = 'bingo_admin_session';
const ADMIN_IDLE_SECONDS = 30 * 60;
const ADMIN_ABSOLUTE_SECONDS = 8 * 60 * 60;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_MAX_ATTEMPTS = 8;
const teacherRoleToInternal = Object.freeze({ homeroom: 'vesta', core: 'minerva', elective: 'apollo' } as const);
const teacherRoleLabels = Object.freeze({ vesta: '班主任', minerva: '主课老师', apollo: '副科老师' } as const);

const adminLoginAttempts = new Map<string, { count: number; blockedUntil: number }>();

interface AdminIdentity {
  id: string;
  organizationId: string;
  username: string;
  displayName: string;
  csrfTokenHash: string;
}

function cookieValue(request: FastifyRequest, name: string): string {
  const cookies = request.headers.cookie?.split(';') ?? [];
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

function setAdminCookie(reply: FastifyReply, token: string): void {
  reply.header(
    'Set-Cookie',
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_ABSOLUTE_SECONDS}`,
  );
}

function clearAdminCookie(reply: FastifyReply): void {
  reply.header('Set-Cookie', `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

async function audit(
  adminId: string | null,
  request: FastifyRequest,
  action: string,
  succeeded: boolean,
  targetType?: string,
  targetId?: string,
  details?: unknown,
): Promise<void> {
  await pool.query(
    `INSERT INTO admin_audit_logs
       (administrator_id, action, target_type, target_id, details, ip_address, succeeded)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [adminId, action, targetType ?? null, targetId ?? null, details ?? null, request.ip, succeeded],
  );
}

async function requireAdmin(request: FastifyRequest, mutating = false): Promise<AdminIdentity> {
  const token = cookieValue(request, ADMIN_COOKIE);
  if (!token) throw Object.assign(new Error('管理员登录已过期'), { statusCode: 401 });
  const result = await pool.query<{
    id: string;
    organization_id: string;
    username: string;
    display_name: string;
    csrf_token_hash: string;
  }>(
    `SELECT account.id, account.organization_id, account.username, account.display_name,
            session.csrf_token_hash
     FROM admin_sessions session
     JOIN accounts account ON account.id = session.account_id
     WHERE session.token_hash = $1
       AND session.revoked_at IS NULL
       AND session.idle_expires_at > now()
       AND session.expires_at > now()
       AND account.role = 'admin'
       AND account.disabled_at IS NULL
       AND account.deleted_at IS NULL`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (!row) throw Object.assign(new Error('管理员登录已过期'), { statusCode: 401 });
  if (mutating) {
    const origin = request.headers.origin;
    const csrfToken = String(request.headers['x-bingo-csrf'] ?? '');
    if (origin !== config.BINGO_ADMIN_ORIGIN || !csrfToken || hashToken(csrfToken) !== row.csrf_token_hash) {
      throw Object.assign(new Error('安全校验失败，请刷新管理员页面'), { statusCode: 403 });
    }
  }
  void pool.query(
    `UPDATE admin_sessions
     SET last_seen_at = now(), idle_expires_at = now() + ($2 || ' seconds')::interval
     WHERE token_hash = $1`,
    [hashToken(token), ADMIN_IDLE_SECONDS],
  );
  return {
    id: row.id,
    organizationId: row.organization_id,
    username: row.username,
    displayName: row.display_name,
    csrfTokenHash: row.csrf_token_hash,
  };
}

function typedConfirmation(value: unknown, expected: string): void {
  if (value !== expected) throw Object.assign(new Error(`请输入“${expected}”确认操作`), { statusCode: 400 });
}

async function agentRequest(path: string, init?: RequestInit): Promise<unknown> {
  if (!config.BINGO_ADMIN_AGENT_SECRET) throw Object.assign(new Error('服务器控制代理尚未配置'), { statusCode: 503 });
  const response = await fetch(`${config.BINGO_ADMIN_AGENT_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.BINGO_ADMIN_AGENT_SECRET}`,
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw Object.assign(new Error(body.error || '服务器控制操作失败'), { statusCode: response.status });
  return body;
}

export function registerAdminRoutes(app: FastifyInstance): void {
  app.post('/v1/admin/auth/login', async (request, reply) => {
    const now = Date.now();
    const loginAttempt = adminLoginAttempts.get(request.ip);
    if (loginAttempt && loginAttempt.blockedUntil > now && loginAttempt.count >= ADMIN_LOGIN_MAX_ATTEMPTS) {
      return reply.code(429).send({ error: '管理员登录失败次数过多，请稍后再试' });
    }
    const input = z.object({ username: z.string().trim().min(2), password: z.string().min(10).max(300) }).parse(request.body);
    const result = await pool.query<{
      id: string;
      organization_id: string;
      username: string;
      display_name: string;
      password_hash: string;
    }>(
      `SELECT id, organization_id, username, display_name, password_hash
       FROM accounts
       WHERE lower(username) = lower($1) AND role = 'admin'
         AND disabled_at IS NULL AND deleted_at IS NULL`,
      [input.username],
    );
    const account = result.rows[0];
    if (!account || !(await verifyPassword(input.password, account.password_hash))) {
      const nextCount = loginAttempt && loginAttempt.blockedUntil > now ? loginAttempt.count + 1 : 1;
      adminLoginAttempts.set(request.ip, { count: nextCount, blockedUntil: now + ADMIN_LOGIN_WINDOW_MS });
      await audit(account?.id ?? null, request, 'admin.login', false, 'account', account?.id);
      return reply.code(401).send({ error: '管理员用户名或密码错误' });
    }
    adminLoginAttempts.delete(request.ip);
    const token = randomBytes(48).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO admin_sessions
         (token_hash, account_id, csrf_token_hash, ip_address, user_agent, idle_expires_at, expires_at)
       VALUES ($1, $2, $3, $4, $5,
               now() + ($6 || ' seconds')::interval,
               now() + ($7 || ' seconds')::interval)`,
      [hashToken(token), account.id, hashToken(csrfToken), request.ip, request.headers['user-agent'] ?? '', ADMIN_IDLE_SECONDS, ADMIN_ABSOLUTE_SECONDS],
    );
    setAdminCookie(reply, token);
    await audit(account.id, request, 'admin.login', true, 'account', account.id);
    return { csrfToken, administrator: { id: account.id, username: account.username, displayName: account.display_name } };
  });

  app.get('/v1/admin/auth/session', async (request) => {
    const admin = await requireAdmin(request);
    const token = cookieValue(request, ADMIN_COOKIE);
    const csrfToken = randomBytes(32).toString('base64url');
    await pool.query(
      'UPDATE admin_sessions SET csrf_token_hash = $1 WHERE token_hash = $2 AND revoked_at IS NULL',
      [hashToken(csrfToken), hashToken(token)],
    );
    return { csrfToken, administrator: { id: admin.id, username: admin.username, displayName: admin.displayName } };
  });

  app.post('/v1/admin/auth/logout', async (request, reply) => {
    await requireAdmin(request, true);
    const token = cookieValue(request, ADMIN_COOKIE);
    if (token) await pool.query('UPDATE admin_sessions SET revoked_at = now() WHERE token_hash = $1', [hashToken(token)]);
    clearAdminCookie(reply);
    return reply.code(204).send();
  });

  app.get('/v1/admin/dashboard', async (request) => {
    const admin = await requireAdmin(request);
    const [accounts, sessions, records, requests, auditLogs] = await Promise.all([
      pool.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE disabled_at IS NULL AND deleted_at IS NULL)::int AS active,
        count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS new_today
        FROM accounts WHERE organization_id = $1`, [admin.organizationId]),
      pool.query(`SELECT count(*) FILTER (WHERE revoked_at IS NULL AND refresh_expires_at > now())::int AS active
        FROM device_sessions session JOIN accounts account ON account.id = session.account_id
        WHERE account.organization_id = $1`, [admin.organizationId]),
      pool.query(`SELECT count(*)::int AS total, COALESCE(sum(pg_column_size(payload)), 0)::bigint AS bytes
        FROM sync_records WHERE organization_id = $1`, [admin.organizationId]),
      pool.query(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending
        FROM support_access_requests WHERE organization_id = $1`, [admin.organizationId]),
      pool.query(`SELECT action, succeeded, created_at AS "createdAt" FROM admin_audit_logs
        WHERE administrator_id = $1 ORDER BY created_at DESC LIMIT 8`, [admin.id]),
    ]);
    return {
      accounts: accounts.rows[0],
      activeDevices: sessions.rows[0]?.active ?? 0,
      records: { total: records.rows[0]?.total ?? 0, bytes: Number(records.rows[0]?.bytes ?? 0) },
      pendingSupportRequests: requests.rows[0]?.pending ?? 0,
      recentActivity: auditLogs.rows,
      serverVersion: releaseMetadata().version,
      release: releaseMetadata(),
    };
  });

  app.get('/v1/admin/users', async (request) => {
    const admin = await requireAdmin(request);
    const query = z.object({ search: z.string().trim().max(80).default(''), status: z.enum(['all', 'active', 'disabled', 'deleting']).default('all') }).parse(request.query);
    const search = `%${query.search.toLowerCase()}%`;
    const result = await pool.query(
      `SELECT account.id, account.username, account.display_name AS "displayName", account.role,
              account.privacy_tier AS "privacyTier", account.admin_alias AS "adminAlias",
              account.created_at AS "createdAt", account.last_login_at AS "lastLoginAt",
              account.disabled_at AS "disabledAt", account.pending_deletion_at AS "pendingDeletionAt",
              count(session.id)::int AS "deviceCount"
       FROM accounts account
       LEFT JOIN device_sessions session ON session.account_id = account.id AND session.revoked_at IS NULL
       WHERE account.organization_id = $1 AND account.deleted_at IS NULL
         AND ($2 = '%%' OR lower(COALESCE(account.username, '') || ' ' || account.display_name) LIKE $2)
         AND ($3 = 'all'
           OR ($3 = 'active' AND account.disabled_at IS NULL AND account.pending_deletion_at IS NULL)
           OR ($3 = 'disabled' AND account.disabled_at IS NOT NULL AND account.pending_deletion_at IS NULL)
           OR ($3 = 'deleting' AND account.pending_deletion_at IS NOT NULL))
       GROUP BY account.id ORDER BY account.created_at DESC LIMIT 500`,
      [admin.organizationId, search, query.status],
    );
    return {
      users: result.rows.map((user) => user.privacyTier === 'A'
        ? { ...user, roleLabel: roleLabel(user.role), privacyLabel: privacyLabel(user.privacyTier) }
        : {
            ...user,
            username: null,
            displayName: `用户 ${user.adminAlias}`,
            roleLabel: roleLabel(user.role),
            privacyLabel: privacyLabel(user.privacyTier),
          }),
    };
  });

  app.patch('/v1/admin/users/:id', async (request) => {
    const admin = await requireAdmin(request, true);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ action: z.enum(['disable', 'enable', 'change-role', 'schedule-delete', 'restore']), role: z.enum(['teacher', 'student']).optional(), confirmation: z.string().optional() }).parse(request.body);
    if (params.id === admin.id) throw Object.assign(new Error('不能通过后台修改当前超级管理员'), { statusCode: 400 });
    if (input.action === 'schedule-delete') typedConfirmation(input.confirmation, '删除用户');
    const result = await transaction(async (client) => {
      const target = await client.query<{ username: string; role: string }>(
        'SELECT username, role FROM accounts WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE',
        [params.id, admin.organizationId],
      );
      if (!target.rowCount || target.rows[0].role === 'admin') throw Object.assign(new Error('用户不存在或不可修改'), { statusCode: 404 });
      if (input.action === 'disable') await client.query('UPDATE accounts SET disabled_at = now() WHERE id = $1', [params.id]);
      if (input.action === 'enable') await client.query('UPDATE accounts SET disabled_at = NULL WHERE id = $1', [params.id]);
      if (input.action === 'change-role') await client.query('UPDATE accounts SET role = $2 WHERE id = $1', [params.id, input.role]);
      if (input.action === 'schedule-delete') await client.query("UPDATE accounts SET disabled_at = now(), pending_deletion_at = now() + interval '30 days' WHERE id = $1", [params.id]);
      if (input.action === 'restore') await client.query('UPDATE accounts SET disabled_at = NULL, pending_deletion_at = NULL WHERE id = $1', [params.id]);
      if (['disable', 'schedule-delete'].includes(input.action)) await client.query('UPDATE device_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [params.id]);
      return target.rows[0];
    });
    await audit(admin.id, request, `user.${input.action}`, true, 'account', params.id, { username: result.username, role: input.role });
    return { ok: true };
  });

  app.post('/v1/admin/users/:id/reset-code', async (request) => {
    const admin = await requireAdmin(request, true);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const code = randomBytes(9).toString('base64url');
    const result = await pool.query(
      `INSERT INTO password_reset_codes (account_id, created_by, code_hash, expires_at)
       SELECT id, $2, $3, now() + interval '15 minutes'
       FROM accounts WHERE id = $1 AND organization_id = $4 AND role <> 'admin' AND deleted_at IS NULL
       RETURNING account_id`,
      [params.id, admin.id, hashToken(code), admin.organizationId],
    );
    if (!result.rowCount) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
    await audit(admin.id, request, 'user.reset-code', true, 'account', params.id);
    return { code, expiresInSeconds: 900 };
  });

  app.get('/v1/admin/devices', async (request) => {
    const admin = await requireAdmin(request);
    const result = await pool.query(
      `SELECT session.id, account.username, account.display_name AS "displayName",
              session.device_name AS "deviceName", session.platform,
              session.created_at AS "createdAt", session.last_seen_at AS "lastSeenAt",
              session.revoked_at AS "revokedAt"
       FROM device_sessions session JOIN accounts account ON account.id = session.account_id
       WHERE account.organization_id = $1 ORDER BY session.last_seen_at DESC LIMIT 1000`,
      [admin.organizationId],
    );
    return { devices: result.rows };
  });

  app.get('/v1/admin/users/:id/records', async (request) => {
    const admin = await requireAdmin(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const accountResult = await pool.query<{ privacyTier: string; adminAlias: string }>(
      `SELECT privacy_tier AS "privacyTier", admin_alias AS "adminAlias"
       FROM accounts WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [params.id, admin.organizationId],
    );
    if (!accountResult.rowCount) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
    const result = await pool.query(
      `SELECT record.entity_type AS "entityType", record.entity_id AS "entityId",
              record.version, record.updated_at AS "updatedAt",
              record.data_category AS "dataCategory",
              COALESCE(length(record.encrypted_payload), pg_column_size(record.payload))::int AS "sizeBytes",
              EXISTS (
                SELECT 1 FROM support_access_requests request
                WHERE request.user_id = $2 AND request.administrator_id = $3
                  AND request.entity_type = record.entity_type AND request.entity_id = record.entity_id
                  AND request.status IN ('pending', 'approved')
              ) AS "hasOpenRequest"
       FROM sync_records record
       WHERE record.organization_id = $1 AND record.owner_account_id = $2
         AND record.visibility = 'private' AND record.deleted_at IS NULL
         AND account.organization_id = $1
       ORDER BY record.updated_at DESC LIMIT 500`,
      [admin.organizationId, params.id, admin.id],
    );
    const privacyTier = accountResult.rows[0].privacyTier;
    return {
      privacyTier,
      privacyLabel: privacyLabel(privacyTier),
      records: result.rows.map((record) => ({
        entityType: record.entityType,
        entityId: record.entityId,
        version: record.version,
        updatedAt: record.updatedAt,
        dataCategory: record.dataCategory,
        sizeBytes: record.sizeBytes,
        directlyReadable: canAdminDirectRead(privacyTier, record.dataCategory),
        hasOpenRequest: record.hasOpenRequest,
      })),
    };
  });

  app.post('/v1/admin/users/:id/records/read', async (request) => {
    const admin = await requireAdmin(request, true);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ entityType: z.string().min(1).max(80), entityId: z.string().min(1).max(160) }).parse(request.body);
    const result = await pool.query(
      `SELECT account.privacy_tier AS "privacyTier", record.entity_type AS "entityType",
              record.entity_id AS "entityId", record.payload,
              record.encrypted_payload, record.encryption_iv, record.encryption_tag,
              record.version, record.updated_at AS "updatedAt", record.data_category AS "dataCategory"
       FROM sync_records record JOIN accounts account ON account.id = record.owner_account_id
       WHERE record.organization_id = $1 AND record.owner_account_id = $2
         AND record.entity_type = $3 AND record.entity_id = $4 AND record.deleted_at IS NULL`,
      [admin.organizationId, params.id, input.entityType, input.entityId],
    );
    const row = result.rows[0];
    if (!row || !canAdminDirectRead(row.privacyTier, row.dataCategory)) {
      throw Object.assign(new Error('当前等级或数据类别需要用户授权'), { statusCode: 403 });
    }
    await audit(admin.id, request, 'support.direct-read', true, 'record', `${params.id}:${input.entityType}:${input.entityId}`);
    return { record: { ...row, payload: decryptPayload(row) } };
  });

  app.delete('/v1/admin/devices/:id', async (request) => {
    const admin = await requireAdmin(request, true);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await pool.query(
      `UPDATE device_sessions session SET revoked_at = now()
       FROM accounts account WHERE session.id = $1 AND account.id = session.account_id
         AND account.organization_id = $2`,
      [params.id, admin.organizationId],
    );
    await audit(admin.id, request, 'device.revoke', true, 'device', params.id);
    return { ok: true };
  });

  app.get('/v1/admin/audit', async (request) => {
    const admin = await requireAdmin(request);
    const result = await pool.query(
      `SELECT id, action, target_type AS "targetType", target_id AS "targetId",
              details, ip_address AS "ipAddress", succeeded, created_at AS "createdAt"
       FROM admin_audit_logs WHERE administrator_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [admin.id],
    );
    return { entries: result.rows };
  });

  app.get('/v1/admin/invite', async (request) => {
    const admin = await requireAdmin(request);
    const result = await pool.query(
      `SELECT invite_code_enabled AS enabled, invite_code_updated_at AS "updatedAt"
       FROM organizations WHERE id = $1`,
      [admin.organizationId],
    );
    return result.rows[0] ?? { enabled: false, updatedAt: null };
  });

  app.post('/v1/admin/invite', async (request) => {
    const admin = await requireAdmin(request, true);
    const input = z.object({ inviteCode: z.string().trim().min(4).max(64) }).parse(request.body);
    await pool.query(
      `UPDATE organizations SET invite_code_hash = $2, invite_code_enabled = true,
              invite_code_updated_at = now() WHERE id = $1`,
      [admin.organizationId, hashToken(input.inviteCode.toLowerCase())],
    );
    await audit(admin.id, request, 'invite.rotate', true, 'organization', admin.organizationId);
    return { ok: true, enabled: true };
  });

  app.delete('/v1/admin/invite', async (request) => {
    const admin = await requireAdmin(request, true);
    await pool.query('UPDATE organizations SET invite_code_enabled = false WHERE id = $1', [admin.organizationId]);
    await audit(admin.id, request, 'invite.revoke', true, 'organization', admin.organizationId);
    return { ok: true, enabled: false };
  });

  app.get('/v1/admin/invites', async (request) => {
    const admin = await requireAdmin(request);
    const result = await pool.query(
      `SELECT id, code_hint AS "codeHint", tier, name, max_uses AS "maxUses",
              used_count AS "usedCount", expires_at AS "expiresAt", enabled,
              created_at AS "createdAt", disabled_at AS "disabledAt"
       FROM tiered_invites WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [admin.organizationId],
    );
    return { invites: result.rows.map((invite) => ({ ...invite, label: privacyLabel(invite.tier) })) };
  });

  app.post('/v1/admin/invites', async (request) => {
    const admin = await requireAdmin(request, true);
    const input = z.object({
      tier: z.enum(['A', 'B', 'C']),
      name: z.string().trim().min(1).max(80),
      code: z.string().trim().min(6).max(80).optional(),
      maxUses: z.number().int().positive().max(100000).nullable().default(null),
      expiresAt: z.string().datetime().nullable().default(null),
    }).parse(request.body);
    const code = input.code || randomBytes(12).toString('base64url');
    const result = await pool.query(
      `INSERT INTO tiered_invites
        (organization_id, code_hash, code_hint, tier, name, max_uses, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, tier, name, max_uses AS "maxUses", expires_at AS "expiresAt"`,
      [admin.organizationId, hashToken(code.toLowerCase()), `…${code.slice(-4)}`, input.tier, input.name, input.maxUses, input.expiresAt, admin.id],
    );
    await audit(admin.id, request, 'invite.create', true, 'invite', result.rows[0].id, { tier: input.tier, label: privacyLabel(input.tier) });
    return { ...result.rows[0], code, label: privacyLabel(input.tier) };
  });

  app.post('/v1/admin/invites/:id/disable', async (request) => {
    const admin = await requireAdmin(request, true);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await pool.query(
      'UPDATE tiered_invites SET enabled = false, disabled_at = now() WHERE id = $1 AND organization_id = $2 RETURNING id',
      [params.id, admin.organizationId],
    );
    if (!result.rowCount) throw Object.assign(new Error('邀请码不存在'), { statusCode: 404 });
    await audit(admin.id, request, 'invite.disable', true, 'invite', params.id);
    return { ok: true };
  });

  app.post('/v1/admin/invites/:id/restore', async (request) => {
    const admin = await requireAdmin(request, true);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await pool.query(
      'UPDATE tiered_invites SET enabled = true, disabled_at = NULL WHERE id = $1 AND organization_id = $2 RETURNING id',
      [params.id, admin.organizationId],
    );
    if (!result.rowCount) throw Object.assign(new Error('邀请码不存在'), { statusCode: 404 });
    await audit(admin.id, request, 'invite.restore', true, 'invite', params.id);
    return { ok: true };
  });

  app.delete('/v1/admin/invites/:id', async (request) => {
    const admin = await requireAdmin(request, true);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ confirmation: z.string() }).parse(request.body);
    typedConfirmation(input.confirmation, '删除邀请码');
    const result = await pool.query<{ id: string; name: string; tier: string }>(
      'DELETE FROM tiered_invites WHERE id = $1 AND organization_id = $2 RETURNING id, name, tier',
      [params.id, admin.organizationId],
    );
    const invite = result.rows[0];
    if (!invite) throw Object.assign(new Error('邀请码不存在'), { statusCode: 404 });
    await audit(admin.id, request, 'invite.delete', true, 'invite', params.id, {
      name: invite.name,
      tier: invite.tier,
    });
    return { ok: true };
  });

  app.get('/v1/admin/teaching', async (request) => {
    const admin = await requireAdmin(request);
    const [classes, teacherInvites, teachers, proposals] = await Promise.all([
      pool.query(
        `SELECT class.id, class.name, class.description, class.enabled,
                class.created_at AS "createdAt",
                count(DISTINCT member.student_id)::int AS "studentCount",
                count(DISTINCT assignment.teacher_id)::int AS "teacherCount"
         FROM learning_classes class
         LEFT JOIN class_memberships member ON member.class_id = class.id AND member.left_at IS NULL
         LEFT JOIN teacher_assignments assignment ON assignment.class_id = class.id AND assignment.active = true
         WHERE class.organization_id = $1
         GROUP BY class.id ORDER BY class.created_at DESC`,
        [admin.organizationId],
      ),
      pool.query(
        `SELECT invite.id, invite.name, invite.code_hint AS "codeHint", invite.subject_name AS "subjectName",
                invite.assignment_role, invite.enabled, invite.expires_at AS "expiresAt", invite.used_at AS "usedAt",
                class.name AS "className"
         FROM teacher_invites invite LEFT JOIN learning_classes class ON class.id = invite.class_id
         WHERE invite.organization_id = $1 ORDER BY invite.created_at DESC LIMIT 300`,
        [admin.organizationId],
      ),
      pool.query(
        `SELECT account.id, account.username, assignment.id AS "assignmentId", assignment.class_id AS "classId",
                class.name AS "className", assignment.assignment_role, assignment.subject_name AS "subjectName"
         FROM accounts account
         LEFT JOIN teacher_assignments assignment ON assignment.teacher_id = account.id AND assignment.active = true
         LEFT JOIN learning_classes class ON class.id = assignment.class_id
         WHERE account.organization_id = $1 AND account.role = 'teacher' AND account.deleted_at IS NULL
         ORDER BY account.username, class.name`,
        [admin.organizationId],
      ),
      pool.query(
        `SELECT proposal.id, proposal.subject_name AS "subjectName", proposal.assignment_role,
                proposal.created_at AS "createdAt", class.name AS "className",
                proposer.username AS "proposedBy", teacher.username AS "teacherName"
         FROM teacher_assignment_proposals proposal
         JOIN learning_classes class ON class.id = proposal.class_id
         JOIN accounts proposer ON proposer.id = proposal.proposed_by
         JOIN accounts teacher ON teacher.id = proposal.teacher_id
         WHERE class.organization_id = $1 AND proposal.status = 'pending'
         ORDER BY proposal.created_at DESC`,
        [admin.organizationId],
      ),
    ]);
    const externalRole = (internal: string) => ({
      roleName: teacherRoleLabels[internal as keyof typeof teacherRoleLabels] ?? '教师',
      roleKey: internal === 'vesta' ? 'homeroom' : internal === 'minerva' ? 'core' : 'elective',
    });
    return {
      classes: classes.rows,
      teacherInvites: teacherInvites.rows.map((item) => ({ ...item, ...externalRole(item.assignment_role) })),
      teachers: teachers.rows.map((item) => ({ ...item, ...(item.assignment_role ? externalRole(item.assignment_role) : {}) })),
      proposals: proposals.rows.map((item) => ({ ...item, ...externalRole(item.assignment_role) })),
    };
  });

  app.post('/v1/admin/classes', async (request) => {
    const admin = await requireAdmin(request, true);
    const input = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).default('') }).parse(request.body);
    const result = await pool.query(
      `INSERT INTO learning_classes (organization_id, name, description, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id, name, description, enabled, created_at AS "createdAt"`,
      [admin.organizationId, input.name, input.description, admin.id],
    );
    await audit(admin.id, request, 'class.create', true, 'class', result.rows[0].id, { name: input.name });
    return { class: result.rows[0] };
  });

  app.post('/v1/admin/classes/:id/invites', async (request) => {
    const admin = await requireAdmin(request, true);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({
      code: z.string().trim().min(6).max(80).optional(),
      maxUses: z.number().int().positive().max(100000).nullable().default(null),
      expiresAt: z.string().datetime().nullable().default(null),
    }).parse(request.body);
    const owned = await pool.query('SELECT 1 FROM learning_classes WHERE id = $1 AND organization_id = $2 AND enabled = true', [params.id, admin.organizationId]);
    if (!owned.rowCount) throw Object.assign(new Error('班级不存在'), { statusCode: 404 });
    const code = input.code || randomBytes(12).toString('base64url');
    const result = await pool.query(
      `INSERT INTO class_invites (class_id, code_hash, code_hint, max_uses, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [params.id, hashToken(code.toLowerCase()), `…${code.slice(-4)}`, input.maxUses, input.expiresAt, admin.id],
    );
    await audit(admin.id, request, 'class.invite.create', true, 'class-invite', result.rows[0].id, { classId: params.id });
    return { id: result.rows[0].id, code };
  });

  app.post('/v1/admin/teacher-invites', async (request) => {
    const admin = await requireAdmin(request, true);
    const input = z.object({
      name: z.string().trim().min(1).max(100),
      classId: z.string().uuid().nullable().default(null),
      role: z.enum(['homeroom', 'core', 'elective']),
      subjectName: z.string().trim().max(80).default(''),
      code: z.string().trim().min(6).max(80).optional(),
      expiresAt: z.string().datetime().nullable().default(null),
    }).parse(request.body);
    if (input.classId) {
      const owned = await pool.query('SELECT 1 FROM learning_classes WHERE id = $1 AND organization_id = $2 AND enabled = true', [input.classId, admin.organizationId]);
      if (!owned.rowCount) throw Object.assign(new Error('班级不存在'), { statusCode: 404 });
    }
    const code = input.code || randomBytes(16).toString('base64url');
    const internalRole = teacherRoleToInternal[input.role];
    const result = await pool.query(
      `INSERT INTO teacher_invites
        (organization_id, class_id, code_hash, code_hint, name, assignment_role, subject_name, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now() + interval '7 days'), $9)
       RETURNING id, expires_at AS "expiresAt"`,
      [admin.organizationId, input.classId, hashToken(code.toLowerCase()), `…${code.slice(-4)}`, input.name, internalRole, input.subjectName, input.expiresAt, admin.id],
    );
    await audit(admin.id, request, 'teacher.invite.create', true, 'teacher-invite', result.rows[0].id, { role: input.role, classId: input.classId });
    return { ...result.rows[0], code, roleName: teacherRoleLabels[internalRole] };
  });

  app.post('/v1/admin/teacher-assignments', async (request) => {
    const admin = await requireAdmin(request, true);
    const input = z.object({ teacherId: z.string().uuid(), classId: z.string().uuid(), role: z.enum(['homeroom', 'core', 'elective']), subjectName: z.string().trim().max(80).default('') }).parse(request.body);
    const result = await pool.query(
      `INSERT INTO teacher_assignments (class_id, teacher_id, assignment_role, subject_name, assigned_by)
       SELECT class.id, account.id, $4, $5, $1 FROM learning_classes class, accounts account
       WHERE class.id = $2 AND class.organization_id = $6 AND account.id = $3
         AND account.organization_id = $6 AND account.role = 'teacher'
       ON CONFLICT (class_id, teacher_id, assignment_role, subject_name)
       DO UPDATE SET active = true, assigned_by = EXCLUDED.assigned_by, assigned_at = now()
       RETURNING id`,
      [admin.id, input.classId, input.teacherId, teacherRoleToInternal[input.role], input.subjectName, admin.organizationId],
    );
    if (!result.rowCount) throw Object.assign(new Error('教师或班级不存在'), { statusCode: 404 });
    await audit(admin.id, request, 'teacher.assignment.create', true, 'teacher-assignment', result.rows[0].id, { role: input.role });
    return { ok: true, id: result.rows[0].id };
  });

  app.post('/v1/admin/teacher-proposals/:id/decision', async (request) => {
    const admin = await requireAdmin(request, true);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ decision: z.enum(['approved', 'rejected']) }).parse(request.body);
    const proposal = await transaction(async (client) => {
      const result = await client.query<{ class_id: string; teacher_id: string; assignment_role: string; subject_name: string }>(
        `SELECT proposal.class_id, proposal.teacher_id, proposal.assignment_role, proposal.subject_name
         FROM teacher_assignment_proposals proposal JOIN learning_classes class ON class.id = proposal.class_id
         WHERE proposal.id = $1 AND proposal.status = 'pending' AND class.organization_id = $2 FOR UPDATE`,
        [params.id, admin.organizationId],
      );
      if (!result.rowCount) return null;
      const row = result.rows[0];
      if (input.decision === 'approved') {
        await client.query(
          `INSERT INTO teacher_assignments (class_id, teacher_id, assignment_role, subject_name, assigned_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (class_id, teacher_id, assignment_role, subject_name) DO UPDATE SET active = true, assigned_by = EXCLUDED.assigned_by, assigned_at = now()`,
          [row.class_id, row.teacher_id, row.assignment_role, row.subject_name, admin.id],
        );
      }
      await client.query('UPDATE teacher_assignment_proposals SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1', [params.id, input.decision, admin.id]);
      return row;
    });
    if (!proposal) throw Object.assign(new Error('申请不存在或已处理'), { statusCode: 404 });
    await audit(admin.id, request, `teacher.proposal.${input.decision}`, true, 'teacher-proposal', params.id);
    return { ok: true };
  });

  app.get('/v1/admin/support/requests', async (request) => {
    const admin = await requireAdmin(request);
    const result = await pool.query(
      `SELECT request.id, account.username, account.display_name AS "displayName",
              account.privacy_tier AS "privacyTier", account.admin_alias AS "adminAlias",
              request.entity_type AS "entityType", request.entity_id AS "entityId",
              request.scope, request.grant_type AS "grantType", request.expires_at AS "expiresAt",
              request.status, request.requested_at AS "requestedAt",
              request.decided_at AS "decidedAt", request.consumed_at AS "consumedAt"
       FROM support_access_requests request JOIN accounts account ON account.id = request.user_id
       WHERE request.organization_id = $1 ORDER BY request.requested_at DESC LIMIT 500`,
      [admin.organizationId],
    );
    return {
      requests: result.rows.map((item) => item.privacyTier === 'A'
        ? { ...item, privacyLabel: privacyLabel(item.privacyTier) }
        : {
            ...item,
            username: null,
            displayName: `用户 ${item.adminAlias}`,
            privacyLabel: privacyLabel(item.privacyTier),
          }),
    };
  });

  app.post('/v1/admin/support/requests', async (request) => {
    const admin = await requireAdmin(request, true);
    const input = z.object({ userId: z.string().uuid(), entityType: z.string().min(1).max(80), entityId: z.string().min(1).max(160), scope: z.enum(['record', 'category', 'all']).default('record'), grantType: z.enum(['once', 'day', 'week', 'persistent']).default('once') }).parse(request.body);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO support_access_requests (organization_id, user_id, administrator_id, entity_type, entity_id, scope, grant_type)
       SELECT $1, account.id, $2, $3, $4, $6, $7 FROM accounts account
       WHERE account.id = $5 AND account.organization_id = $1 AND account.role <> 'admin'
       RETURNING id`,
      [admin.organizationId, admin.id, input.entityType, input.entityId, input.userId, input.scope, input.grantType],
    );
    if (!result.rowCount) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
    await audit(admin.id, request, 'support.request', true, 'support-request', result.rows[0].id, input);
    return { id: result.rows[0].id, status: 'pending' };
  });

  app.post('/v1/admin/support/requests/:id/cancel', async (request) => {
    const admin = await requireAdmin(request, true);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await pool.query("UPDATE support_access_requests SET status = 'cancelled', decided_at = now() WHERE id = $1 AND administrator_id = $2 AND status = 'pending'", [params.id, admin.id]);
    await audit(admin.id, request, 'support.cancel', true, 'support-request', params.id);
    return { ok: true };
  });

  app.post('/v1/admin/support/requests/:id/read', async (request) => {
    const admin = await requireAdmin(request, true);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const record = await transaction(async (client) => {
      const grant = await client.query<{ organization_id: string; user_id: string; entity_type: string; entity_id: string; grant_type: string; expires_at: string | null }>(
        `SELECT organization_id, user_id, entity_type, entity_id, grant_type, expires_at FROM support_access_requests
         WHERE id = $1 AND administrator_id = $2 AND status = 'approved'
           AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE`,
        [params.id, admin.id],
      );
      if (!grant.rowCount) throw Object.assign(new Error('用户尚未授权或授权已经使用'), { statusCode: 403 });
      const item = grant.rows[0];
      const result = await client.query(
        `SELECT entity_type AS "entityType", entity_id AS "entityId", payload,
                encrypted_payload, encryption_iv, encryption_tag, version,
                updated_at AS "updatedAt" FROM sync_records
         WHERE organization_id = $1 AND owner_account_id = $2 AND entity_type = $3 AND entity_id = $4`,
        [item.organization_id, item.user_id, item.entity_type, item.entity_id],
      );
      if (grant.rows[0].grant_type === 'once') {
        await client.query("UPDATE support_access_requests SET status = 'consumed', consumed_at = now(), read_count = read_count + 1 WHERE id = $1", [params.id]);
      } else {
        await client.query("UPDATE support_access_requests SET read_count = read_count + 1 WHERE id = $1", [params.id]);
      }
      const row = result.rows[0];
      return row ? { ...row, payload: decryptPayload(row) } : null;
    });
    await audit(admin.id, request, 'support.read', true, 'support-request', params.id);
    return { record };
  });

  app.get('/v1/admin/system/status', async (request) => {
    await requireAdmin(request);
    return agentRequest('/status');
  });

  app.get('/v1/admin/release', async (request) => {
    await requireAdmin(request);
    return releaseMetadata();
  });

  app.get('/v1/admin/events', async (request, reply) => {
    await requireAdmin(request);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    const writeStatus = async () => {
      if (closed) return;
      try {
        const status = await agentRequest('/status');
        reply.raw.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
      } catch (error) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'status unavailable' })}\n\n`);
      }
    };
    await writeStatus();
    const timer = setInterval(() => void writeStatus(), 3000);
    request.raw.on('close', () => {
      closed = true;
      clearInterval(timer);
    });
  });

  app.get('/v1/admin/system/logs', async (request) => {
    await requireAdmin(request);
    const query = z.object({ service: z.enum(['sync', 'postgres', 'frpc', 'admin-web']), lines: z.coerce.number().int().min(10).max(500).default(200) }).parse(request.query);
    return agentRequest(`/logs?service=${encodeURIComponent(query.service)}&lines=${query.lines}`);
  });

  app.post('/v1/admin/system/restart', async (request) => {
    const admin = await requireAdmin(request, true);
    const input = z.object({ service: z.enum(['sync', 'postgres', 'frpc', 'admin-web']), confirmation: z.string() }).parse(request.body);
    typedConfirmation(input.confirmation, '重启服务');
    const result = await agentRequest('/restart', { method: 'POST', body: JSON.stringify({ service: input.service }) });
    await audit(admin.id, request, 'system.restart', true, 'service', input.service);
    return result;
  });

  for (const action of ['start', 'stop'] as const) {
    app.post(`/v1/admin/system/${action}`, async (request) => {
      const admin = await requireAdmin(request, true);
      const input = z.object({ service: z.enum(['sync', 'postgres', 'frpc', 'admin-web']), confirmation: z.string() }).parse(request.body);
      typedConfirmation(input.confirmation, action === 'start' ? '启动服务' : '停止服务');
      const result = await agentRequest(`/${action}`, { method: 'POST', body: JSON.stringify({ service: input.service }) });
      await audit(admin.id, request, `system.${action}`, true, 'service', input.service);
      return result;
    });
  }

  app.post('/v1/admin/system/exec', async (request) => {
    const admin = await requireAdmin(request, true);
    const input = z.object({ service: z.enum(['sync', 'postgres', 'frpc', 'admin-web']), command: z.string().trim().min(1).max(5000) }).parse(request.body);
    const result = await agentRequest('/exec', { method: 'POST', body: JSON.stringify(input) });
    await audit(admin.id, request, 'system.exec', true, 'service', input.service, { commandLength: input.command.length });
    return result;
  });

  app.get('/v1/admin/system/backups', async (request) => {
    await requireAdmin(request);
    return agentRequest('/backups');
  });

  app.post('/v1/admin/system/restore', async (request) => {
    const admin = await requireAdmin(request, true);
    const input = z.object({ file: z.string().regex(/^bingo-[A-Za-z0-9_.-]+\.dump$/), confirmation: z.string() }).parse(request.body);
    typedConfirmation(input.confirmation, '恢复数据库');
    const result = await agentRequest('/restore', { method: 'POST', body: JSON.stringify({ file: input.file }) });
    await audit(admin.id, request, 'system.restore', true, 'backup', input.file);
    return result;
  });

  app.post('/v1/admin/system/backup', async (request) => {
    const admin = await requireAdmin(request, true);
    const result = await agentRequest('/backup', { method: 'POST', body: '{}' });
    await audit(admin.id, request, 'system.backup', true, 'database');
    return result;
  });
}

export function registerAccountRecoveryRoutes(app: FastifyInstance): void {
  app.post('/v1/auth/reset-password', async (request, reply) => {
    const input = z.object({ username: z.string().trim().min(2), code: z.string().min(8).max(64), newPassword: z.string().min(10).max(200) }).parse(request.body);
    const result = await transaction(async (client) => {
      const code = await client.query<{ id: string; account_id: string }>(
        `SELECT reset.id, reset.account_id FROM password_reset_codes reset
         JOIN accounts account ON account.id = reset.account_id
         WHERE reset.code_hash = $1 AND lower(account.username) = lower($2)
           AND reset.used_at IS NULL AND reset.expires_at > now() FOR UPDATE`,
        [hashToken(input.code), input.username],
      );
      if (!code.rowCount) return false;
      await client.query('UPDATE accounts SET password_hash = $2, must_reset_password = false WHERE id = $1', [code.rows[0].account_id, await hashPassword(input.newPassword)]);
      await client.query('UPDATE password_reset_codes SET used_at = now() WHERE id = $1', [code.rows[0].id]);
      await client.query('UPDATE device_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [code.rows[0].account_id]);
      return true;
    });
    if (!result) return reply.code(400).send({ error: '重置码无效或已过期' });
    return { ok: true };
  });
}

export async function deleteExpiredAccounts(): Promise<void> {
  const accounts = await pool.query<{ id: string }>('SELECT id FROM accounts WHERE pending_deletion_at <= now() AND deleted_at IS NULL');
  for (const account of accounts.rows) {
    await transaction(async (client) => {
      await client.query('DELETE FROM sync_records WHERE owner_account_id = $1', [account.id]);
      await client.query('UPDATE accounts SET deleted_at = now(), username = NULL, email = NULL, display_name = $2 WHERE id = $1', [account.id, `已删除用户-${account.id.slice(0, 8)}`]);
    });
  }
}

export async function resetAdminPasswordFromEnvironment(): Promise<boolean> {
  const username = process.env.BINGO_ADMIN_RESET_USERNAME;
  const password = process.env.BINGO_ADMIN_RESET_PASSWORD;
  if (!username || !password) return false;
  if (password.length < 20) throw new Error('管理员新密码至少需要20个字符');
  const result = await pool.query<{ id: string }>(
    `UPDATE accounts SET password_hash = $1 WHERE lower(username) = lower($2) AND role = 'admin' RETURNING id`,
    [await hashPassword(password), username],
  );
  if (!result.rowCount) throw new Error('未找到管理员账号');
  await pool.query('UPDATE admin_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [result.rows[0].id]);
  await pool.query('UPDATE device_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [result.rows[0].id]);
  return true;
}
