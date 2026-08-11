import { createServer, request as httpRequest } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';

const PORT = Number(process.env.PORT || 4103);
const SECRET = process.env.BINGO_ADMIN_AGENT_SECRET || '';
const DOCKER_SOCKET = '/var/run/docker.sock';
const SERVICES = Object.freeze({
  sync: { name: 'bingo-sync-api', label: '同步 API' },
  postgres: { name: 'bingo-sync-postgres', label: 'PostgreSQL' },
  frpc: { name: 'bingo-frpc', label: 'FRP 客户端' },
  'admin-web': { name: 'bingo-admin-web', label: '管理员网页' },
});

if (SECRET.length < 32) throw new Error('BINGO_ADMIN_AGENT_SECRET must be at least 32 characters');

function send(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(payload);
}

function authorized(request) {
  const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expected = Buffer.from(SECRET);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function dockerRequest(path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = createServerRequest({
      socketPath: DOCKER_SOCKET,
      path,
      method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, resolve, reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function createServerRequest(options, resolve, reject) {
  return httpRequest(options, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => {
      const raw = Buffer.concat(chunks);
      const text = raw.toString('utf8');
      let value = text;
      if ((response.headers['content-type'] || '').includes('application/json') && text) {
        try { value = JSON.parse(text); } catch { value = { error: text }; }
      }
      if ((response.statusCode || 500) >= 400) {
        reject(Object.assign(new Error(value?.message || value?.error || 'Docker operation failed'), { statusCode: response.statusCode }));
      } else resolve({ statusCode: response.statusCode, headers: response.headers, body: value, raw });
    });
  }).on('error', reject);
}

function stripDockerStream(buffer) {
  const chunks = [];
  let offset = 0;
  while (offset + 8 <= buffer.length && (buffer[offset] === 1 || buffer[offset] === 2)) {
    const length = buffer.readUInt32BE(offset + 4);
    if (offset + 8 + length > buffer.length) break;
    chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  return (chunks.length ? Buffer.concat(chunks) : buffer).toString('utf8');
}

function cleanLogs(value) {
  return value
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/(authorization|cookie|accessToken|refreshToken|api[_ -]?key|database[_ -]?url)(["'=: ]+)([^\s,"'}]+)/gi, '$1$2[REDACTED]');
}

async function inspectService(key) {
  const service = SERVICES[key];
  try {
    const result = await dockerRequest(`/containers/${encodeURIComponent(service.name)}/json`);
    const state = result.body.State || {};
    let metrics = null;
    if (state.Running) {
      try {
        const stats = await dockerRequest(`/containers/${encodeURIComponent(service.name)}/stats?stream=false`);
        const cpuDelta = Number(stats.body.cpu_stats?.cpu_usage?.total_usage || 0) - Number(stats.body.precpu_stats?.cpu_usage?.total_usage || 0);
        const systemDelta = Number(stats.body.cpu_stats?.system_cpu_usage || 0) - Number(stats.body.precpu_stats?.system_cpu_usage || 0);
        const cpuCount = Number(stats.body.cpu_stats?.online_cpus || 1);
        metrics = {
          cpuPercent: systemDelta > 0 ? Math.max(0, Math.round((cpuDelta / systemDelta) * cpuCount * 1000) / 10) : 0,
          memoryBytes: Number(stats.body.memory_stats?.usage || 0),
          memoryLimitBytes: Number(stats.body.memory_stats?.limit || 0),
          networkRxBytes: Object.values(stats.body.networks || {}).reduce((sum, item) => sum + Number(item.rx_bytes || 0), 0),
          networkTxBytes: Object.values(stats.body.networks || {}).reduce((sum, item) => sum + Number(item.tx_bytes || 0), 0),
        };
      } catch {}
    }
    return {
      key,
      name: service.name,
      label: service.label,
      status: state.Status || 'unknown',
      running: Boolean(state.Running),
      health: state.Health?.Status || null,
      startedAt: state.StartedAt || null,
      restartCount: Number(state.RestartCount || 0),
      metrics,
    };
  } catch (error) {
    if (error.statusCode === 404) return { key, name: service.name, label: service.label, status: 'missing', running: false, health: null };
    throw error;
  }
}

async function runExec(container, command) {
  const created = await dockerRequest(`/containers/${encodeURIComponent(container)}/exec`, {
    method: 'POST',
    body: { AttachStdout: true, AttachStderr: true, Cmd: command },
  });
  const execId = created.body.Id;
  const started = await dockerRequest(`/exec/${encodeURIComponent(execId)}/start`, {
    method: 'POST',
    body: { Detach: false, Tty: false },
  });
  const inspected = await dockerRequest(`/exec/${encodeURIComponent(execId)}/json`);
  const output = cleanLogs(stripDockerStream(started.raw));
  if (inspected.body.ExitCode !== 0) throw Object.assign(new Error(output || 'Container command failed'), { statusCode: 500 });
  return output.trim();
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); }
}

createServer(async (request, response) => {
  try {
    if (!authorized(request)) return send(response, 401, { error: 'Unauthorized' });
    const url = new URL(request.url || '/', 'http://admin-agent');

    if (request.method === 'GET' && url.pathname === '/status') {
      const version = await dockerRequest('/version');
      const services = await Promise.all(Object.keys(SERVICES).map(inspectService));
      return send(response, 200, { dockerVersion: version.body.Version, checkedAt: new Date().toISOString(), services });
    }

    if (request.method === 'GET' && url.pathname === '/logs') {
      const key = url.searchParams.get('service') || '';
      const service = SERVICES[key];
      if (!service) return send(response, 400, { error: 'Unsupported service' });
      const lines = Math.max(1, Math.min(500, Number(url.searchParams.get('lines') || 200) || 200));
      const result = await dockerRequest(`/containers/${encodeURIComponent(service.name)}/logs?stdout=1&stderr=1&timestamps=1&tail=${lines}`);
      return send(response, 200, { service: key, logs: cleanLogs(stripDockerStream(result.raw)) });
    }

    if (request.method === 'POST' && url.pathname === '/restart') {
      const body = await readJson(request);
      const service = SERVICES[body.service];
      if (!service) return send(response, 400, { error: 'Unsupported service' });
      await dockerRequest(`/containers/${encodeURIComponent(service.name)}/restart?t=20`, { method: 'POST' });
      return send(response, 200, { ok: true, service: body.service, restartedAt: new Date().toISOString() });
    }

    if (request.method === 'POST' && ['/start', '/stop'].includes(url.pathname)) {
      const body = await readJson(request);
      const service = SERVICES[body.service];
      if (!service) return send(response, 400, { error: 'Unsupported service' });
      await dockerRequest(`/containers/${encodeURIComponent(service.name)}/${url.pathname.slice(1)}`, { method: 'POST' });
      return send(response, 200, { ok: true, service: body.service, action: url.pathname.slice(1), changedAt: new Date().toISOString() });
    }

    if (request.method === 'POST' && url.pathname === '/exec') {
      const body = await readJson(request);
      const service = SERVICES[body.service];
      const command = String(body.command || '').trim();
      if (!service || !command || command.length > 5000) return send(response, 400, { error: 'Invalid terminal request' });
      const output = await runExec(service.name, ['sh', '-lc', `timeout 120s sh -lc ${JSON.stringify(command)}`]);
      return send(response, 200, { ok: true, service: body.service, output });
    }

    if (request.method === 'GET' && url.pathname === '/backups') {
      const entries = await readdir('/backups', { withFileTypes: true });
      const backups = [];
      for (const entry of entries) {
        if (!entry.isFile() || !/^bingo-[A-Za-z0-9_.-]+\.dump$/.test(entry.name)) continue;
        const details = await stat(`/backups/${entry.name}`);
        backups.push({ file: entry.name, sizeBytes: details.size, modifiedAt: details.mtime.toISOString() });
      }
      backups.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
      return send(response, 200, { backups: backups.slice(0, 100) });
    }

    if (request.method === 'POST' && url.pathname === '/backup') {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
      const file = `bingo-${stamp}.dump`;
      await runExec(SERVICES.postgres.name, ['sh', '-lc', `umask 077 && pg_dump -U bingo -d bingo -Fc -f /backups/${file}`]);
      const sizeText = await runExec(SERVICES.postgres.name, ['sh', '-lc', `stat -c %s /backups/${file}`]);
      const sizeBytes = Number(sizeText);
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error('Backup file is empty');
      return send(response, 200, { ok: true, file, sizeBytes, createdAt: new Date().toISOString() });
    }

    if (request.method === 'POST' && url.pathname === '/restore') {
      const body = await readJson(request);
      const file = String(body.file || '');
      if (!/^bingo-[A-Za-z0-9_.-]+\.dump$/.test(file)) return send(response, 400, { error: 'Invalid backup file' });
      const backup = await stat(`/backups/${file}`).catch(() => null);
      if (!backup || backup.size <= 0) return send(response, 404, { error: 'Backup not found' });
      await runExec(SERVICES.postgres.name, ['sh', '-lc', `pg_restore -U bingo -d bingo --clean --if-exists /backups/${file}`]);
      return send(response, 200, { ok: true, file, restoredAt: new Date().toISOString() });
    }

    if (request.method === 'POST' && url.pathname === '/update') {
      return send(response, 501, { error: 'GitHub Release 更新清单尚未配置' });
    }

    return send(response, 404, { error: 'Not found' });
  } catch (error) {
    return send(response, Number(error.statusCode) || 500, { error: error.message || 'Internal error' });
  }
}).listen(PORT, '0.0.0.0', () => console.log(`BinGO admin agent listening on ${PORT}`));
