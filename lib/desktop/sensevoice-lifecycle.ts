import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';

const log = createLogger('SenseVoiceLifecycle');

let lifecycleStarted = false;

/**
 * 在桌面会话就绪后异步拉起 SenseVoice。
 * 启动失败时显示 toast 提示，不抛异常、不阻塞主界面。
 */
export async function startSenseVoiceLifecycle(): Promise<void> {
  if (lifecycleStarted) return;
  lifecycleStarted = true;

  const toastId = toast.loading('正在启动 SenseVoice 语音识别服务...');

  try {
    const response = await fetch('/api/local-services/sensevoice/start', {
      method: 'POST',
    });
    const body = await response.json();

    if (body.success) {
      toast.success('SenseVoice 语音识别已就绪', { id: toastId });
      log.info('SenseVoice started successfully:', body.message);
    } else {
      toast.error('SenseVoice 启动失败，语音识别不可用', {
        id: toastId,
        description: body.error || body.details || '请检查 WSL 和 ROCm 环境',
        duration: 8000,
      });
      log.warn('SenseVoice start failed:', body.error);
    }
  } catch (error) {
    toast.error('SenseVoice 启动失败，语音识别不可用', {
      id: toastId,
      description: error instanceof Error ? error.message : '网络请求失败',
      duration: 8000,
    });
    log.error('SenseVoice lifecycle start error:', error);
  }
}

/**
 * 重置协调器状态（仅供测试使用）。
 */
export function resetSenseVoiceLifecycle(): void {
  lifecycleStarted = false;
}
