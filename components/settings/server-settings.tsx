'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import type { BinGoAccount, BinGoDevice, SupportAccessRequest } from '@/lib/sync/types';
import {
  applyAccountFromServer,
  clearSyncSession,
  createSyncClient,
  getSyncConfiguration,
  refreshSyncSession,
  saveSyncSession,
  syncClientState,
} from '@/lib/sync/session';
import { LearningNetworkSection } from './learning-network-section';

export function ServerSettings() {
  const initial = useMemo(() => getSyncConfiguration(), []);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [account, setAccount] = useState<BinGoAccount | null>(initial.account);
  // null = 尚未检查（避免首次渲染就显示"离线"）
  const [online, setOnline] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [inviteCode, setInviteCode] = useState('welcome');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [devices, setDevices] = useState<BinGoDevice[]>([]);
  const [supportRequests, setSupportRequests] = useState<SupportAccessRequest[]>([]);
  const [newInviteCode, setNewInviteCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadAccount() {
    const client = await createSyncClient(baseUrl);
    try {
      const health = await client.health();
      setOnline(health.ok);
      if (!account) return;
      let me;
      try {
        me = await client.me();
      } catch {
        const refreshed = await refreshSyncSession();
        if (!refreshed) throw new Error('登录已过期');
        me = { account: refreshed.account };
      }
      setAccount(me.account);
      applyAccountFromServer(me.account);
      setDevices((await client.devices()).devices);
      setSupportRequests((await client.listSupportRequests()).requests);
    } catch {
      setOnline(false);
    }
  }

  useEffect(() => {
    void loadAccount();
    // 健康检查只在挂载时跑一次，瞬时失败会一直显示"离线"；
    // 因此每 30s 复测，并在窗口重新聚焦/网络恢复时立即复测。
    const recheck = () => void loadAccount();
    const interval = window.setInterval(recheck, 30_000);
    window.addEventListener('focus', recheck);
    window.addEventListener('online', recheck);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', recheck);
      window.removeEventListener('online', recheck);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    setBusy(true);
    try {
      const client = await createSyncClient(baseUrl);
      const deviceName =
        typeof navigator === 'undefined'
          ? 'Windows 设备'
          : navigator.userAgent.includes('Windows')
            ? 'Windows PC'
            : 'BinGO 设备';
      const session =
        mode === 'register'
          ? await client.register({
              inviteCode,
              username,
              password,
              deviceName,
              platform: 'windows',
            })
          : await client.login(identifier, password, deviceName, 'windows');
      await saveSyncSession(baseUrl, session);
      setAccount(session.account);
      setPassword('');
      toast.success(mode === 'register' ? '注册并登录成功' : '登录成功');
      await loadAccount();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '连接服务器失败');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await (await createSyncClient(baseUrl)).logout();
    } catch {}
    await clearSyncSession();
    setAccount(null);
    setDevices([]);
  }

  async function syncNow() {
    setBusy(true);
    try {
      const result = await syncClientState();
      toast.success(
        `同步完成：上传 ${result.uploaded}，下载 ${result.applied}，冲突 ${result.conflicts}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '同步失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <section className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">BinGO 同步服务器</h3>
            <p className="text-sm text-muted-foreground">账号、设备和学习数据跨端同步</p>
          </div>
          <span
            className={
              online === null
                ? 'text-sm text-muted-foreground'
                : online
                  ? 'text-sm text-green-600'
                  : 'text-sm text-red-500'
            }
          >
            {online === null ? '检查中…' : online ? '在线' : '离线'}
          </span>
        </div>
        <Label htmlFor="sync-server-url">服务器地址</Label>
        <Input
          id="sync-server-url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </section>

      {!account ? (
        <section className="rounded-lg border p-4 space-y-4">
          <div className="flex gap-2">
            <Button
              variant={mode === 'login' ? 'default' : 'outline'}
              onClick={() => setMode('login')}
            >
              登录
            </Button>
            <Button
              variant={mode === 'register' ? 'default' : 'outline'}
              onClick={() => setMode('register')}
            >
              邀请码注册
            </Button>
          </div>
          {mode === 'register' ? (
            <>
              <div>
                <Label>组织邀请码</Label>
                <Input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} />
              </div>
              <div>
                <Label>用户名（同时作为昵称）</Label>
                <Input value={username} onChange={(event) => setUsername(event.target.value)} />
              </div>
            </>
          ) : (
            <div>
              <Label>用户名</Label>
              <Input value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
            </div>
          )}
          <div>
            <Label>密码（至少 10 位）</Label>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <Button disabled={busy} onClick={submit}>
            {busy ? '处理中…' : mode === 'register' ? '注册并进入' : '登录'}
          </Button>
        </section>
      ) : (
        <>
          <section className="rounded-lg border p-4 space-y-3">
            <h3 className="font-semibold">{account.username || account.displayName}</h3>
            <p className="text-sm text-muted-foreground">{account.role}</p>
            <div className="flex gap-2">
              <Button disabled={busy} onClick={syncNow}>
                立即同步
              </Button>
              <Button variant="outline" onClick={logout}>
                退出登录
              </Button>
            </div>
          </section>
          <section className="rounded-lg border p-4 space-y-3">
            <div>
              <h3 className="font-semibold">管理员访问申请</h3>
              <p className="text-sm text-muted-foreground">
                管理员只能在你逐条同意后读取一次指定记录。
              </p>
            </div>
            {supportRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无访问申请</p>
            ) : (
              supportRequests.map((request) => (
                <div key={request.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{request.administratorName}</div>
                      <div className="text-xs text-muted-foreground break-all">
                        {request.entityType} · {request.entityId}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">{request.status}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(request.requestedAt).toLocaleString()}
                  </div>
                  {request.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={async () => {
                          await (
                            await createSyncClient(baseUrl)
                          ).decideSupportRequest(request.id, 'approve', 'once');
                          toast.success('已允许管理员读取一次');
                          await loadAccount();
                        }}
                      >
                        同意一次
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await (
                            await createSyncClient(baseUrl)
                          ).decideSupportRequest(request.id, 'reject');
                          toast.success('已拒绝访问申请');
                          await loadAccount();
                        }}
                      >
                        拒绝
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </section>
          <section className="rounded-lg border p-4 space-y-3">
            <h3 className="font-semibold">已登录设备</h3>
            {devices.map((device) => (
              <div key={device.id} className="flex items-center justify-between border-t pt-2">
                <div>
                  <div className="text-sm">{device.deviceName}</div>
                  <div className="text-xs text-muted-foreground">
                    {device.platform} · {new Date(device.lastSeenAt).toLocaleString()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await (await createSyncClient(baseUrl)).revokeDevice(device.id);
                    await loadAccount();
                  }}
                >
                  撤销
                </Button>
              </div>
            ))}
          </section>
          {account.role === 'student' && <LearningNetworkSection baseUrl={baseUrl} />}
          {account.role === 'admin' && (
            <section className="rounded-lg border p-4 space-y-3">
              <h3 className="font-semibold">组织邀请码</h3>
              <p className="text-sm text-muted-foreground">
                更换后旧邀请码立即失效，已注册账号不受影响。
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="输入新的邀请码"
                  value={newInviteCode}
                  onChange={(event) => setNewInviteCode(event.target.value)}
                />
                <Button
                  onClick={async () => {
                    await (await createSyncClient(baseUrl)).rotateInviteCode(newInviteCode);
                    setNewInviteCode('');
                    toast.success('邀请码已更新');
                  }}
                >
                  更换
                </Button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
