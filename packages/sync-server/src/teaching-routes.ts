import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAccount, requireRole, HTTPError } from './account-access.js';
import { hashToken, type AccessClaims } from './auth.js';
import { pool, transaction } from './db.js';
import { decryptPayload, encryptPayload } from './privacy.js';
import { readEncryptedObject, storeEncryptedObject } from './object-store.js';

const assignmentRoleLabel = Object.freeze({
  vesta: '班主任',
  minerva: '主课老师',
  apollo: '副科老师',
} as const);

type AssignmentRole = keyof typeof assignmentRoleLabel;

function capabilities(role: AssignmentRole): string[] {
  if (role === 'vesta') return ['class:overview', 'class:announce', 'class:goal', 'teacher:propose', 'student:message'];
  if (role === 'minerva') return ['subject:detail', 'task:required', 'task:assessment', 'task:grade', 'student:message'];
  return ['subject:summary', 'task:optional', 'task:grade', 'student:message'];
}

async function teacherAssignment(account: AccessClaims, classId: string) {
  const result = await pool.query<{ assignment_role: AssignmentRole; subject_name: string }>(
    `SELECT assignment_role, subject_name FROM teacher_assignments
     WHERE teacher_id = $1 AND class_id = $2 AND active = true
     ORDER BY assigned_at LIMIT 1`,
    [account.sub, classId],
  );
  const assignment = result.rows[0];
  if (!assignment) throw new HTTPError(403, '你没有该班级的教学权限');
  return assignment;
}

async function groupMembership(accountId: string, groupId: string) {
  const result = await pool.query<{ member_role: string }>(
    'SELECT member_role FROM study_group_members WHERE account_id = $1 AND group_id = $2',
    [accountId, groupId],
  );
  if (!result.rowCount) throw new HTTPError(403, '你不是该学习小组成员');
  return result.rows[0];
}

async function requireGroupOwner(accountId: string, groupId: string) {
  const membership = await groupMembership(accountId, groupId);
  if (membership.member_role !== 'owner') throw new HTTPError(403, '只有学习小组创建者可以执行该操作');
}

type AttachmentDetail = { id: string; fileName: string; mimeType: string; sizeBytes: number };

async function attachmentDetails(accountId: string, objectIds: string[]): Promise<AttachmentDetail[]> {
  if (!objectIds.length) return [];
  const result = await pool.query<{ id: string; file_name: string; mime_type: string; size_bytes: string | number }>(
    `SELECT object.id, object.file_name, object.mime_type, object.size_bytes
     FROM encrypted_objects object
     WHERE object.id = ANY($1::uuid[]) AND (object.owner_id = $2 OR EXISTS (
       SELECT 1 FROM encrypted_object_grants grant_table
       WHERE grant_table.object_id = object.id AND grant_table.account_id = $2
     ))`,
    [objectIds, accountId],
  );
  const byId = new Map(result.rows.map((row) => [row.id, {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
  }]));
  return objectIds.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
}

async function hydrateMessages(accountId: string, rows: Array<Record<string, unknown>>) {
  return Promise.all(rows.map(async (row) => {
    const payload = decryptPayload(row as { encrypted_payload?: string; encryption_iv?: string; encryption_tag?: string }) as {
      text?: string;
      attachments?: string[];
    };
    const attachments = payload.attachments ?? [];
    return {
      id: row.id,
      senderId: row.sender_id,
      createdAt: row.created_at,
      text: payload.text ?? '',
      attachments,
      attachmentDetails: await attachmentDetails(accountId, attachments),
    };
  }));
}

async function notify(accountIds: string[], type: string, title: string, body: string, data: unknown) {
  for (const accountId of [...new Set(accountIds)]) {
    await pool.query(
      'INSERT INTO notifications (account_id, notification_type, title, body, data) VALUES ($1, $2, $3, $4, $5)',
      [accountId, type, title, body, data],
    );
  }
}

export function registerTeachingRoutes(app: FastifyInstance): void {
  app.get('/v1/teaching/bootstrap', async (request) => {
    const account = await requireAccount(request);
    const [profile, primaryClass, assignments, groups, unread] = await Promise.all([
      pool.query('SELECT username, display_name AS "displayName", role FROM accounts WHERE id = $1', [account.sub]),
      pool.query(
        `SELECT class.id, class.name, class.description FROM class_memberships membership
         JOIN learning_classes class ON class.id = membership.class_id
         WHERE membership.student_id = $1 AND membership.left_at IS NULL`,
        [account.sub],
      ),
      pool.query<{ id: string; class_id: string; class_name: string; assignment_role: AssignmentRole; subject_name: string }>(
        `SELECT assignment.id, assignment.class_id, class.name AS class_name,
                assignment.assignment_role, assignment.subject_name
         FROM teacher_assignments assignment JOIN learning_classes class ON class.id = assignment.class_id
         WHERE assignment.teacher_id = $1 AND assignment.active = true ORDER BY class.name, assignment.subject_name`,
        [account.sub],
      ),
      pool.query(
        `SELECT group_table.id, group_table.name, group_table.description, member.member_role AS "memberRole"
         FROM study_group_members member JOIN study_groups group_table ON group_table.id = member.group_id
         WHERE member.account_id = $1 AND group_table.enabled = true ORDER BY group_table.updated_at DESC`,
        [account.sub],
      ),
      pool.query('SELECT count(*)::int AS count FROM notifications WHERE account_id = $1 AND read_at IS NULL', [account.sub]),
    ]);
    return {
      account: profile.rows[0],
      primaryClass: primaryClass.rows[0] ?? null,
      teacherAssignments: assignments.rows.map((item) => ({
        id: item.id,
        classId: item.class_id,
        className: item.class_name,
        subjectName: item.subject_name,
        roleName: assignmentRoleLabel[item.assignment_role],
        capabilities: capabilities(item.assignment_role),
      })),
      groups: groups.rows,
      unreadNotifications: unread.rows[0]?.count ?? 0,
    };
  });

  app.post('/v1/classes/join', async (request) => {
    const account = await requireAccount(request);
    requireRole(account, 'student');
    const input = z.object({ inviteCode: z.string().trim().min(4).max(80) }).parse(request.body);
    const result = await transaction(async (client) => {
      const existing = await client.query('SELECT 1 FROM class_memberships WHERE student_id = $1 AND left_at IS NULL', [account.sub]);
      if (existing.rowCount) throw new HTTPError(409, '你已经加入一个主要班级，转班需要管理员处理');
      const invite = await client.query<{ id: string; class_id: string }>(
        `SELECT invite.id, invite.class_id FROM class_invites invite
         JOIN learning_classes class ON class.id = invite.class_id
         WHERE invite.code_hash = $1 AND invite.enabled = true AND class.enabled = true
           AND (invite.expires_at IS NULL OR invite.expires_at > now())
           AND (invite.max_uses IS NULL OR invite.used_count < invite.max_uses) FOR UPDATE`,
        [hashToken(input.inviteCode.toLowerCase())],
      );
      if (!invite.rowCount) return null;
      await client.query('UPDATE class_invites SET used_count = used_count + 1 WHERE id = $1', [invite.rows[0].id]);
      await client.query('INSERT INTO class_memberships (class_id, student_id) VALUES ($1, $2)', [invite.rows[0].class_id, account.sub]);
      return invite.rows[0];
    });
    if (!result) throw new HTTPError(400, '班级邀请码无效或已停用');
    return { ok: true, classId: result.class_id };
  });

  app.post('/v1/groups', async (request) => {
    const account = await requireAccount(request);
    requireRole(account, 'student', 'teacher');
    const input = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).default('') }).parse(request.body);
    const code = randomBytes(12).toString('base64url');
    const group = await transaction(async (client) => {
      const created = await client.query<{ id: string }>(
        'INSERT INTO study_groups (owner_id, name, description) VALUES ($1, $2, $3) RETURNING id',
        [account.sub, input.name, input.description],
      );
      const id = created.rows[0].id;
      await client.query("INSERT INTO study_group_members (group_id, account_id, member_role) VALUES ($1, $2, 'owner')", [id, account.sub]);
      await client.query('INSERT INTO study_group_invites (group_id, code_hash, code_hint) VALUES ($1, $2, $3)', [id, hashToken(code.toLowerCase()), `…${code.slice(-4)}`]);
      return { id };
    });
    return { ...group, code };
  });

  app.post('/v1/groups/join', async (request) => {
    const account = await requireAccount(request);
    requireRole(account, 'student', 'teacher');
    const input = z.object({ inviteCode: z.string().trim().min(4).max(80) }).parse(request.body);
    const group = await transaction(async (client) => {
      const invite = await client.query<{ id: string; group_id: string }>(
        `SELECT invite.id, invite.group_id FROM study_group_invites invite
         JOIN study_groups group_table ON group_table.id = invite.group_id
         WHERE invite.code_hash = $1 AND invite.enabled = true AND group_table.enabled = true
           AND (invite.expires_at IS NULL OR invite.expires_at > now())
           AND (invite.max_uses IS NULL OR invite.used_count < invite.max_uses) FOR UPDATE`,
        [hashToken(input.inviteCode.toLowerCase())],
      );
      if (!invite.rowCount) return null;
      await client.query('UPDATE study_group_invites SET used_count = used_count + 1 WHERE id = $1', [invite.rows[0].id]);
      await client.query(
        `INSERT INTO study_group_members (group_id, account_id) VALUES ($1, $2)
         ON CONFLICT (group_id, account_id) DO NOTHING`,
        [invite.rows[0].group_id, account.sub],
      );
      return invite.rows[0];
    });
    if (!group) throw new HTTPError(400, '学习小组邀请码无效或已停用');
    return { ok: true, groupId: group.group_id };
  });

  app.get('/v1/groups/:id/members', async (request) => {
    const account = await requireAccount(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await groupMembership(account.sub, params.id);
    const result = await pool.query(
      `SELECT account.id, account.username, account.display_name AS "displayName", account.role,
              member.member_role AS "memberRole", member.joined_at AS "joinedAt"
       FROM study_group_members member JOIN accounts account ON account.id = member.account_id
       WHERE member.group_id = $1 AND account.deleted_at IS NULL
       ORDER BY CASE member.member_role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
                member.joined_at`,
      [params.id],
    );
    return { members: result.rows };
  });

  app.post('/v1/groups/:id/invite/rotate', async (request) => {
    const account = await requireAccount(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await requireGroupOwner(account.sub, params.id);
    const code = randomBytes(12).toString('base64url');
    await transaction(async (client) => {
      await client.query('UPDATE study_group_invites SET enabled = false WHERE group_id = $1 AND enabled = true', [params.id]);
      await client.query(
        'INSERT INTO study_group_invites (group_id, code_hash, code_hint) VALUES ($1, $2, $3)',
        [params.id, hashToken(code.toLowerCase()), `…${code.slice(-4)}`],
      );
      await client.query('UPDATE study_groups SET updated_at = now() WHERE id = $1', [params.id]);
    });
    return { code };
  });

  app.delete('/v1/groups/:id/members/:accountId', async (request) => {
    const account = await requireAccount(request);
    const params = z.object({ id: z.string().uuid(), accountId: z.string().uuid() }).parse(request.params);
    await requireGroupOwner(account.sub, params.id);
    if (params.accountId === account.sub) throw new HTTPError(400, '创建者不能移除自己，请直接删除学习小组');
    const result = await pool.query(
      `DELETE FROM study_group_members
       WHERE group_id = $1 AND account_id = $2 AND member_role <> 'owner' RETURNING account_id`,
      [params.id, params.accountId],
    );
    if (!result.rowCount) throw new HTTPError(404, '小组成员不存在');
    return { ok: true };
  });

  app.delete('/v1/groups/:id', async (request) => {
    const account = await requireAccount(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await requireGroupOwner(account.sub, params.id);
    await transaction(async (client) => {
      await client.query('UPDATE study_groups SET enabled = false, updated_at = now() WHERE id = $1', [params.id]);
      await client.query('UPDATE study_group_invites SET enabled = false WHERE group_id = $1', [params.id]);
    });
    return { ok: true };
  });

  app.get('/v1/tasks', async (request) => {
    const account = await requireAccount(request);
    const query = z.object({ status: z.enum(['draft', 'published', 'closed', 'archived', 'all']).default('all') }).parse(request.query);
    const statusSql = query.status === 'all' ? '' : 'AND task.status = $2';
    const params = query.status === 'all' ? [account.sub] : [account.sub, query.status];
    const result = account.role === 'teacher'
      ? await pool.query(
        `SELECT task.*, class.name AS "className", group_table.name AS "groupName",
                count(submission.id)::int AS "submissionCount"
         FROM learning_tasks task
         LEFT JOIN learning_classes class ON class.id = task.class_id
         LEFT JOIN study_groups group_table ON group_table.id = task.group_id
         LEFT JOIN task_submissions submission ON submission.task_id = task.id
         WHERE task.author_id = $1 ${statusSql}
         GROUP BY task.id, class.name, group_table.name ORDER BY task.updated_at DESC`,
        params,
      )
      : await pool.query(
        `SELECT DISTINCT task.*, class.name AS "className", group_table.name AS "groupName",
                submission.status AS "submissionStatus", submission.teacher_grade AS "teacherGrade"
         FROM learning_tasks task
         LEFT JOIN learning_classes class ON class.id = task.class_id
         LEFT JOIN study_groups group_table ON group_table.id = task.group_id
         LEFT JOIN class_memberships class_member ON class_member.class_id = task.class_id AND class_member.student_id = $1 AND class_member.left_at IS NULL
         LEFT JOIN study_group_members group_member ON group_member.group_id = task.group_id AND group_member.account_id = $1
         LEFT JOIN task_submissions submission ON submission.task_id = task.id AND submission.student_id = $1
         WHERE task.status = 'published' AND (class_member.id IS NOT NULL OR group_member.account_id IS NOT NULL)
         ORDER BY task.updated_at DESC`,
        [account.sub],
      );
    return { tasks: result.rows };
  });

  app.get('/v1/teacher/classes/:id/students', async (request) => {
    const account = await requireAccount(request);
    requireRole(account, 'teacher');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await teacherAssignment(account, params.id);
    const result = await pool.query(
      `SELECT student.id, student.username,
              count(DISTINCT task.id) FILTER (WHERE task.status = 'published')::int AS "assignedCount",
              count(DISTINCT submission.id)::int AS "submittedCount",
              count(DISTINCT submission.id) FILTER (WHERE submission.status = 'graded')::int AS "gradedCount"
       FROM class_memberships membership
       JOIN accounts student ON student.id = membership.student_id
       LEFT JOIN learning_tasks task ON task.class_id = membership.class_id
       LEFT JOIN task_submissions submission ON submission.task_id = task.id AND submission.student_id = student.id
       WHERE membership.class_id = $1 AND membership.left_at IS NULL
       GROUP BY student.id ORDER BY student.username`,
      [params.id],
    );
    return { students: result.rows };
  });

  app.post('/v1/teacher/tasks', async (request) => {
    const account = await requireAccount(request);
    requireRole(account, 'teacher');
    const input = z.object({
      classId: z.string().uuid().nullable().default(null),
      groupId: z.string().uuid().nullable().default(null),
      title: z.string().trim().min(1).max(160),
      description: z.string().trim().max(5000).default(''),
      resources: z.array(z.record(z.string(), z.unknown())).max(50).default([]),
      rubric: z.array(z.record(z.string(), z.unknown())).max(30).default([]),
      taskKind: z.enum(['goal', 'practice', 'assessment']),
      requirement: z.enum(['required', 'optional']),
      subjectName: z.string().trim().max(80).default(''),
      dueAt: z.string().datetime().nullable().default(null),
    }).refine((value) => Boolean(value.classId) !== Boolean(value.groupId), { message: '必须且只能选择班级或学习小组' }).parse(request.body);
    let assignment: { assignment_role: AssignmentRole; subject_name: string } | null = null;
    if (input.classId) assignment = await teacherAssignment(account, input.classId);
    if (input.groupId) await groupMembership(account.sub, input.groupId);
    if (assignment?.assignment_role === 'apollo' && (input.requirement !== 'optional' || input.taskKind === 'assessment')) {
      throw new HTTPError(403, '副科老师只能发布选做目标或普通练习');
    }
    if (assignment?.assignment_role === 'vesta' && input.taskKind === 'assessment') {
      throw new HTTPError(403, '班主任不能以班主任身份发布正式学科测评');
    }
    const result = await pool.query(
      `INSERT INTO learning_tasks
        (author_id, organization_id, class_id, group_id, title, description, resources, rubric,
         task_kind, requirement, subject_name, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [account.sub, account.organizationId, input.classId, input.groupId, input.title, input.description, JSON.stringify(input.resources), JSON.stringify(input.rubric), input.taskKind, input.requirement, input.subjectName || assignment?.subject_name || '', input.dueAt],
    );
    return { task: result.rows[0] };
  });

  app.post('/v1/teacher/tasks/:id/publish', async (request) => {
    const account = await requireAccount(request);
    requireRole(account, 'teacher');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await pool.query<{ id: string; title: string; class_id: string | null; group_id: string | null }>(
      `UPDATE learning_tasks SET status = 'published', published_at = now(), updated_at = now()
       WHERE id = $1 AND author_id = $2 AND status = 'draft' RETURNING id, title, class_id, group_id`,
      [params.id, account.sub],
    );
    const task = result.rows[0];
    if (!task) throw new HTTPError(404, '任务不存在或已经发布');
    const recipients = task.class_id
      ? await pool.query<{ id: string }>('SELECT student_id AS id FROM class_memberships WHERE class_id = $1 AND left_at IS NULL', [task.class_id])
      : await pool.query<{ id: string }>('SELECT account_id AS id FROM study_group_members WHERE group_id = $1 AND account_id <> $2', [task.group_id, account.sub]);
    await notify(recipients.rows.map((item) => item.id), 'task.published', '新的学习目标', task.title, { taskId: task.id });
    return { ok: true };
  });

  app.post('/v1/tasks/:id/submissions', async (request) => {
    const account = await requireAccount(request);
    requireRole(account, 'student');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ summary: z.string().trim().max(10000).default(''), evidence: z.array(z.record(z.string(), z.unknown())).max(100).default([]) }).parse(request.body);
    const visible = await pool.query(
      `SELECT task.id FROM learning_tasks task
       LEFT JOIN class_memberships class_member ON class_member.class_id = task.class_id AND class_member.student_id = $2 AND class_member.left_at IS NULL
       LEFT JOIN study_group_members group_member ON group_member.group_id = task.group_id AND group_member.account_id = $2
       WHERE task.id = $1 AND task.status = 'published' AND (class_member.id IS NOT NULL OR group_member.account_id IS NOT NULL)`,
      [params.id, account.sub],
    );
    if (!visible.rowCount) throw new HTTPError(404, '任务不存在或你无权提交');
    const result = await pool.query(
      `INSERT INTO task_submissions (task_id, student_id, summary, evidence)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (task_id, student_id) DO UPDATE SET summary = EXCLUDED.summary,
         evidence = EXCLUDED.evidence, status = 'submitted', submitted_at = now(), updated_at = now()
       RETURNING *`,
      [params.id, account.sub, input.summary, JSON.stringify(input.evidence)],
    );
    const author = await pool.query<{ author_id: string; title: string }>('SELECT author_id, title FROM learning_tasks WHERE id = $1', [params.id]);
    if (author.rows[0]) await notify([author.rows[0].author_id], 'task.submitted', '学生提交了成果包', author.rows[0].title, { taskId: params.id, submissionId: result.rows[0].id });
    return { submission: result.rows[0] };
  });

  app.get('/v1/teacher/tasks/:id/submissions', async (request) => {
    const account = await requireAccount(request);
    requireRole(account, 'teacher');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const task = await pool.query('SELECT 1 FROM learning_tasks WHERE id = $1 AND author_id = $2', [params.id, account.sub]);
    if (!task.rowCount) throw new HTTPError(404, '任务不存在');
    const result = await pool.query(
      `SELECT submission.*, account.username FROM task_submissions submission
       JOIN accounts account ON account.id = submission.student_id
       WHERE submission.task_id = $1 ORDER BY submission.submitted_at DESC`,
      [params.id],
    );
    return { submissions: result.rows };
  });

  app.post('/v1/teacher/submissions/:id/grade', async (request) => {
    const account = await requireAccount(request);
    requireRole(account, 'teacher');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ score: z.number().min(0).max(100).nullable().default(null), rubric: z.array(z.record(z.string(), z.unknown())).max(30).default([]), feedback: z.string().trim().max(10000).default('') }).parse(request.body);
    const result = await pool.query<{ student_id: string; task_id: string }>(
      `UPDATE task_submissions submission SET teacher_grade = $3, status = 'graded', graded_at = now(), graded_by = $2, updated_at = now()
       FROM learning_tasks task WHERE submission.id = $1 AND task.id = submission.task_id AND task.author_id = $2
       RETURNING submission.student_id, submission.task_id`,
      [params.id, account.sub, JSON.stringify({ score: input.score, rubric: input.rubric, feedback: input.feedback })],
    );
    const graded = result.rows[0];
    if (!graded) throw new HTTPError(404, '成果包不存在或你无权批改');
    await notify([graded.student_id], 'task.graded', '教师已完成评价', input.feedback.slice(0, 200), { taskId: graded.task_id, submissionId: params.id });
    return { ok: true };
  });

  app.post('/v1/teacher/submissions/:id/ai-suggestion', async (request) => {
    const account = await requireAccount(request);
    requireRole(account, 'teacher');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const submission = await pool.query(
      `SELECT 1 FROM task_submissions submission
       JOIN learning_tasks task ON task.id = submission.task_id
       WHERE submission.id = $1 AND task.author_id = $2`,
      [params.id, account.sub],
    );
    if (!submission.rowCount) throw new HTTPError(404, '成果包不存在或你无权查看');
    throw new HTTPError(501, 'AI 评分建议功能未配置：服务器尚未接入可用模型，不会生成评分');
  });

  app.post('/v1/messages/direct', async (request) => {
    const account = await requireAccount(request);
    requireRole(account, 'student', 'teacher');
    const input = z.object({ recipientId: z.string().uuid(), text: z.string().trim().max(20000).default(''), attachments: z.array(z.string().uuid()).max(20).default([]) }).parse(request.body);
    if (input.recipientId === account.sub) throw new HTTPError(400, '不能给自己发送消息');
    const target = await pool.query<{ role: string }>('SELECT role FROM accounts WHERE id = $1 AND disabled_at IS NULL AND deleted_at IS NULL', [input.recipientId]);
    if (!target.rowCount || !['student', 'teacher'].includes(target.rows[0].role) || target.rows[0].role === account.role) throw new HTTPError(403, '一对一私聊仅支持教师与学生');
    const allowed = await pool.query(
      `SELECT 1 FROM teacher_assignments assignment
       JOIN class_memberships member ON member.class_id = assignment.class_id AND member.left_at IS NULL
       WHERE assignment.active = true AND ((assignment.teacher_id = $1 AND member.student_id = $2) OR (assignment.teacher_id = $2 AND member.student_id = $1))
       UNION ALL
       SELECT 1 FROM study_group_members first_member JOIN study_group_members second_member ON second_member.group_id = first_member.group_id
       WHERE first_member.account_id = $1 AND second_member.account_id = $2 LIMIT 1`,
      [account.sub, input.recipientId],
    );
    if (!allowed.rowCount) throw new HTTPError(403, '你与该用户没有共同班级或学习小组');
    const [low, high] = [account.sub, input.recipientId].sort();
    if (input.attachments.length) {
      const owned = await pool.query<{ id: string }>('SELECT id FROM encrypted_objects WHERE owner_id = $1 AND id = ANY($2::uuid[])', [account.sub, input.attachments]);
      if (owned.rowCount !== input.attachments.length) throw new HTTPError(403, '附件不存在或不属于当前账号');
      for (const objectId of input.attachments) {
        await pool.query(
          `INSERT INTO encrypted_object_grants (object_id, account_id) VALUES ($1, $2)
           ON CONFLICT (object_id, account_id) DO NOTHING`,
          [objectId, input.recipientId],
        );
      }
    }
    const encrypted = encryptPayload({ text: input.text, attachments: input.attachments });
    const message = await transaction(async (client) => {
      const conversation = await client.query<{ id: string }>(
        `INSERT INTO direct_conversations (participant_low, participant_high) VALUES ($1, $2)
         ON CONFLICT (participant_low, participant_high) DO UPDATE SET updated_at = now() RETURNING id`,
        [low, high],
      );
      return client.query<{ id: string; created_at: string }>(
        `INSERT INTO direct_messages (conversation_id, sender_id, encrypted_payload, encryption_iv, encryption_tag, encryption_key_version)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
        [conversation.rows[0].id, account.sub, encrypted.encryptedPayload, encrypted.iv, encrypted.tag, encrypted.keyVersion],
      );
    });
    await notify([input.recipientId], 'message.direct', '新私聊消息', '你收到了一条新消息', { senderId: account.sub, messageId: message.rows[0].id });
    return {
      message: {
        ...message.rows[0],
        senderId: account.sub,
        text: input.text,
        attachments: input.attachments,
        attachmentDetails: await attachmentDetails(account.sub, input.attachments),
      },
    };
  });

  app.get('/v1/messages/direct/:accountId', async (request) => {
    const account = await requireAccount(request);
    requireRole(account, 'student', 'teacher');
    const params = z.object({ accountId: z.string().uuid() }).parse(request.params);
    const [low, high] = [account.sub, params.accountId].sort();
    const result = await pool.query(
      `SELECT message.id, message.sender_id, message.encrypted_payload, message.encryption_iv,
              message.encryption_tag, message.created_at
       FROM direct_conversations conversation JOIN direct_messages message ON message.conversation_id = conversation.id
       WHERE conversation.participant_low = $1 AND conversation.participant_high = $2 AND message.deleted_at IS NULL
       ORDER BY message.created_at ASC LIMIT 1000`,
      [low, high],
    );
    return { messages: await hydrateMessages(account.sub, result.rows) };
  });

  app.delete('/v1/messages/:id', async (request) => {
    const account = await requireAccount(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await pool.query('UPDATE direct_messages SET deleted_at = now() WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL RETURNING id', [params.id, account.sub]);
    if (!result.rowCount) throw new HTTPError(404, '消息不存在或不能删除');
    return { ok: true };
  });

  app.post('/v1/groups/:id/messages', async (request) => {
    const account = await requireAccount(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ text: z.string().trim().max(20000).default(''), attachments: z.array(z.string().uuid()).max(20).default([]) }).parse(request.body);
    await groupMembership(account.sub, params.id);
    if (input.attachments.length) {
      const owned = await pool.query<{ id: string }>('SELECT id FROM encrypted_objects WHERE owner_id = $1 AND id = ANY($2::uuid[])', [account.sub, input.attachments]);
      if (owned.rowCount !== input.attachments.length) throw new HTTPError(403, '附件不存在或不属于当前账号');
      const members = await pool.query<{ id: string }>('SELECT account_id AS id FROM study_group_members WHERE group_id = $1 AND account_id <> $2', [params.id, account.sub]);
      for (const objectId of input.attachments) {
        for (const member of members.rows) {
          await pool.query(
            `INSERT INTO encrypted_object_grants (object_id, account_id) VALUES ($1, $2)
             ON CONFLICT (object_id, account_id) DO NOTHING`,
            [objectId, member.id],
          );
        }
      }
    }
    const encrypted = encryptPayload({ text: input.text, attachments: input.attachments });
    const result = await pool.query(
      `INSERT INTO group_messages (group_id, sender_id, encrypted_payload, encryption_iv, encryption_tag, encryption_key_version)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at AS "createdAt"`,
      [params.id, account.sub, encrypted.encryptedPayload, encrypted.iv, encrypted.tag, encrypted.keyVersion],
    );
    const members = await pool.query<{ id: string }>('SELECT account_id AS id FROM study_group_members WHERE group_id = $1 AND account_id <> $2', [params.id, account.sub]);
    await notify(members.rows.map((item) => item.id), 'message.group', '学习小组新消息', '你所在的学习小组有新消息', { groupId: params.id, messageId: result.rows[0].id });
    return {
      message: {
        ...result.rows[0],
        senderId: account.sub,
        text: input.text,
        attachments: input.attachments,
        attachmentDetails: await attachmentDetails(account.sub, input.attachments),
      },
    };
  });

  app.get('/v1/groups/:id/messages', async (request) => {
    const account = await requireAccount(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await groupMembership(account.sub, params.id);
    const result = await pool.query(
      `SELECT id, sender_id, encrypted_payload, encryption_iv, encryption_tag, created_at
       FROM group_messages WHERE group_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1000`,
      [params.id],
    );
    return { messages: await hydrateMessages(account.sub, result.rows) };
  });

  app.post('/v1/objects', async (request) => {
    const account = await requireAccount(request);
    const input = z.object({ fileName: z.string().trim().min(1).max(240), mimeType: z.string().trim().min(1).max(160), dataBase64: z.string().max(24 * 1024 * 1024) }).parse(request.body);
    const bytes = Buffer.from(input.dataBase64, 'base64');
    if (bytes.length > 16 * 1024 * 1024) throw new HTTPError(413, '单个附件不能超过16MB');
    const encrypted = encryptPayload({ dataBase64: bytes.toString('base64') });
    const storagePath = await storeEncryptedObject(encrypted.encryptedPayload);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO encrypted_objects (owner_id, mime_type, file_name, size_bytes, storage_path, encryption_iv, encryption_tag, encryption_key_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [account.sub, input.mimeType, input.fileName, bytes.length, storagePath, encrypted.iv, encrypted.tag, encrypted.keyVersion],
    );
    return { id: result.rows[0].id, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: bytes.length };
  });

  app.get('/v1/objects/:id', async (request, reply) => {
    const account = await requireAccount(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await pool.query(
      `SELECT object.* FROM encrypted_objects object
       WHERE object.id = $1 AND (object.owner_id = $2 OR EXISTS (
         SELECT 1 FROM encrypted_object_grants grant_table
         WHERE grant_table.object_id = object.id AND grant_table.account_id = $2
       ))`,
      [params.id, account.sub],
    );
    const object = result.rows[0];
    if (!object) throw new HTTPError(404, '附件不存在');
    const encryptedPayload = object.encrypted_payload || await readEncryptedObject(object.storage_path);
    const decrypted = decryptPayload({ ...object, encrypted_payload: encryptedPayload }) as { dataBase64: string };
    reply.header('Content-Type', object.mime_type);
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(object.file_name)}`);
    return reply.send(Buffer.from(decrypted.dataBase64, 'base64'));
  });

  app.get('/v1/objects/:id/metadata', async (request) => {
    const account = await requireAccount(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const details = await attachmentDetails(account.sub, [params.id]);
    if (!details[0]) throw new HTTPError(404, '附件不存在');
    return details[0];
  });

  app.get('/v1/notifications', async (request) => {
    const account = await requireAccount(request);
    const result = await pool.query(
      `SELECT id, notification_type AS type, title, body, data, created_at AS "createdAt", read_at AS "readAt"
       FROM notifications WHERE account_id = $1 ORDER BY created_at DESC LIMIT 300`,
      [account.sub],
    );
    return { notifications: result.rows };
  });

  app.post('/v1/notifications/:id/read', async (request) => {
    const account = await requireAccount(request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await pool.query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND account_id = $2', [params.id, account.sub]);
    return { ok: true };
  });
}
