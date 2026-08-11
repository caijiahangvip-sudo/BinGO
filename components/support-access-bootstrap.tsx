'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { createSyncClient, getSyncConfiguration } from '@/lib/sync/session';
import type { SupportAccessRequest } from '@/lib/sync/types';

const POLL_INTERVAL_MS = 60_000;

export function SupportAccessBootstrap() {
  const [request, setRequest] = useState<SupportAccessRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [grantType, setGrantType] = useState<'once' | 'day' | 'week' | 'persistent'>('once');

  useEffect(() => {
    let stopped = false;

    const poll = async () => {
      if (stopped || !getSyncConfiguration().account || !navigator.onLine) return;
      try {
        const client = await createSyncClient();
        const pending = (await client.listSupportRequests()).requests.find(
          (item) => item.status === 'pending',
        );
        if (!stopped) setRequest(pending || null);
      } catch {
        // Background polling must not interrupt normal classroom work.
      }
    };

    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    const handleOnline = () => void poll();
    window.addEventListener('online', handleOnline);
    void poll();
    return () => {
      stopped = true;
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  async function decide(decision: 'approve' | 'reject') {
    if (!request) return;
    setBusy(true);
    try {
      await (await createSyncClient()).decideSupportRequest(request.id, decision, grantType);
      toast.success(decision === 'approve' ? '已允许管理员访问' : '已拒绝管理员访问');
      setRequest(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '处理访问申请失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={Boolean(request)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>管理员申请读取一条记录</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">申请人：{request?.administratorName}</span>
            <span className="block break-all">记录类型：{request?.entityType}</span>
            <span className="block break-all">记录编号：{request?.entityId}</span>
            <span className="block">同意后管理员只能读取一次这条记录。</span>
            <label className="mt-3 flex items-center gap-2">
              <span>授权范围</span>
              <select value={grantType} onChange={(event) => setGrantType(event.target.value as typeof grantType)} disabled={busy}>
                <option value="once">读取一次</option>
                <option value="day">24小时</option>
                <option value="week">7天</option>
                <option value="persistent">长期，直到撤销</option>
              </select>
            </label>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={() => void decide('reject')}>
            拒绝
          </AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={() => void decide('approve')}>
            同意一次
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
