'use client';

import { type ReactNode, useEffect, useState } from 'react';

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function DesktopRuntimeGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isTauriRuntime()) {
      const timer = window.setTimeout(() => setReady(true), 0);
      return () => window.clearTimeout(timer);
    }

    const token = new URLSearchParams(window.location.hash.slice(1)).get('desktopToken');
    if (!token) {
      if (window.location.hostname === 'localhost') {
        const timer = window.setTimeout(() => setReady(true), 0);
        return () => window.clearTimeout(timer);
      }
      const timer = window.setTimeout(
        () => setError('桌面会话令牌缺失，请重新启动 BinGO。'),
        0,
      );
      return () => window.clearTimeout(timer);
    }

    let disposed = false;
    async function establishSession() {
      try {
        const response = await fetch('/api/desktop/session', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (disposed) return;
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        setError(null);
        setReady(true);
      } catch (reason) {
        if (!disposed) setError(`无法建立安全桌面会话：${String(reason)}`);
      }
    }
    void establishSession();
    return () => {
      disposed = true;
    };
  }, [attempt]);

  if (ready) return children;
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <section className="max-w-lg rounded-2xl border bg-card p-6 text-center shadow-xl">
        <h1 className="text-xl font-semibold">{error ? 'BinGO 安全启动失败' : '正在建立安全会话'}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{error || '正在验证本地教学服务…'}</p>
        {error && (
          <button
            className="mt-5 rounded-lg bg-primary px-4 py-2 text-primary-foreground"
            onClick={() => setAttempt((value) => value + 1)}
          >
            重试
          </button>
        )}
      </section>
    </main>
  );
}
