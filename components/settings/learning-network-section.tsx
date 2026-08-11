'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { createSyncClient } from '@/lib/sync/session';
import type { LearningTask, TeachingBootstrap, TeachingNotification } from '@/lib/sync/types';

export function LearningNetworkSection({ baseUrl }: { baseUrl: string }) {
  const [bootstrap, setBootstrap] = useState<TeachingBootstrap | null>(null);
  const [tasks, setTasks] = useState<LearningTask[]>([]);
  const [notifications, setNotifications] = useState<TeachingNotification[]>([]);
  const [classCode, setClassCode] = useState('');
  const [groupCode, setGroupCode] = useState('');

  async function load() {
    const client = await createSyncClient(baseUrl);
    const [nextBootstrap, nextTasks, nextNotifications] = await Promise.all([
      client.teachingBootstrap(),
      client.listLearningTasks(),
      client.listTeachingNotifications(),
    ]);
    setBootstrap(nextBootstrap);
    setTasks(nextTasks.tasks);
    setNotifications(nextNotifications.notifications);
  }

  useEffect(() => {
    void load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  return (
    <section className="rounded-lg border p-4 space-y-4">
      <div>
        <h3 className="font-semibold">班级、目标与学习小组</h3>
        <p className="text-sm text-muted-foreground">
          教师只会看到你提交的成果包和统计摘要，私人课堂详情仍需要你授权。
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border p-3 space-y-2">
          <Label>主要班级</Label>
          <div className="text-sm">{bootstrap?.primaryClass?.name || '尚未加入主要班级'}</div>
          {!bootstrap?.primaryClass && (
            <div className="flex gap-2">
              <Input value={classCode} onChange={(event) => setClassCode(event.target.value)} placeholder="管理员提供的班级邀请码" />
              <Button onClick={async () => { await (await createSyncClient(baseUrl)).joinPrimaryClass(classCode); setClassCode(''); toast.success('已加入班级'); await load(); }}>加入</Button>
            </div>
          )}
        </div>
        <div className="rounded-md border p-3 space-y-2">
          <Label>跨组织学习小组</Label>
          <div className="text-sm text-muted-foreground">已加入 {bootstrap?.groups.length || 0} 个小组</div>
          <div className="flex gap-2">
            <Input value={groupCode} onChange={(event) => setGroupCode(event.target.value)} placeholder="学习小组邀请码" />
            <Button variant="outline" onClick={async () => { await (await createSyncClient(baseUrl)).joinStudyGroup(groupCode); setGroupCode(''); toast.success('已加入学习小组'); await load(); }}>加入</Button>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">教师学习目标</h4>
        {tasks.length === 0 ? <p className="text-sm text-muted-foreground">暂无学习目标</p> : tasks.map((task) => (
          <div key={task.id} className="rounded-md border p-3 space-y-2">
            <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-medium">{task.title}</div><div className="text-xs text-muted-foreground">{task.className || task.groupName} · {task.requirement === 'required' ? '必做' : '选做'}</div></div>{task.teacherGrade && <span className="text-xs">已评价</span>}</div>
            <p className="text-sm text-muted-foreground">{task.description}</p>
            <Button size="sm" variant="outline" onClick={async () => { const summary = window.prompt('填写要提交给教师的学习总结'); if (summary === null) return; await (await createSyncClient(baseUrl)).submitLearningTask(task.id, summary); toast.success('成果包已提交'); await load(); }}>提交成果包</Button>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">教学通知</h4>
        {notifications.slice(0, 8).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 border-t pt-2 text-sm"><span>{item.title}</span><Button size="sm" variant="ghost" disabled={Boolean(item.readAt)} onClick={async () => { await (await createSyncClient(baseUrl)).readTeachingNotification(item.id); await load(); }}>{item.readAt ? '已读' : '标为已读'}</Button></div>)}
      </div>
    </section>
  );
}
