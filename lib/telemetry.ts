export type TelemetryValue = string | number | boolean | null | undefined;
export type TelemetryProperties = Record<string, TelemetryValue | TelemetryValue[]>;

type BrowserTelemetryWindow = Window & {
  posthog?: {
    capture: (eventName: string, properties?: TelemetryProperties) => void;
  };
  mixpanel?: {
    track: (eventName: string, properties?: TelemetryProperties) => void;
  };
};

export type LlmTelemetryStatus = 'success' | 'error' | 'aborted';

export interface LlmTelemetryRecord {
  route: string;
  model?: string;
  providerType?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  messageCount?: number;
  tags: string[];
  status: LlmTelemetryStatus;
  error?: string;
}

function redactLargeDataUrls(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('data:image/')) {
    return `[image:${Math.round(value.length / 1024)}KB]`;
  }

  return value;
}

export function estimateTokensFromText(text: string): number {
  if (!text) return 0;

  return Math.ceil(text.length / 4);
}

export function estimateTokensFromUnknown(value: unknown): number {
  try {
    return estimateTokensFromText(JSON.stringify(value, redactLargeDataUrls));
  } catch {
    return 0;
  }
}

export function containsImagePayload(value: unknown): boolean {
  if (value == null) return false;

  if (typeof value === 'string') {
    return value.startsWith('data:image/');
  }

  if (Array.isArray(value)) {
    return value.some(containsImagePayload);
  }

  if (typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;
  if (record.type === 'image' || record.type === 'image_url') return true;

  if (typeof record.url === 'string' && record.url.startsWith('data:image/')) {
    return true;
  }

  const imageUrl = record.image_url;
  if (imageUrl && typeof imageUrl === 'object') {
    const url = (imageUrl as Record<string, unknown>).url;
    if (typeof url === 'string' && url.startsWith('data:image/')) return true;
  }

  return Object.values(record).some(containsImagePayload);
}

export function trackEvent(eventName: string, properties: TelemetryProperties = {}): void {
  try {
    if (typeof window !== 'undefined') {
      const telemetryWindow = window as BrowserTelemetryWindow;
      let delivered = false;

      telemetryWindow.posthog?.capture(eventName, properties);
      delivered = delivered || Boolean(telemetryWindow.posthog);

      telemetryWindow.mixpanel?.track(eventName, properties);
      delivered = delivered || Boolean(telemetryWindow.mixpanel);

      // TODO: wire PostHog/Mixpanel project keys in production bootstrap.
      if (!delivered && process.env.NODE_ENV !== 'production') {
        console.debug('[Telemetry]', eventName, properties);
      }

      return;
    }

    console.info('[Telemetry]', { eventName, ...properties });
  } catch (error) {
    console.warn('[Telemetry] Failed to track event:', error);
  }
}

export function recordLlmTelemetry(record: LlmTelemetryRecord): void {
  try {
    // TODO: send to LangSmith/Helicone
    console.info('[LLM Telemetry]', record);
  } catch (error) {
    console.warn('[LLM Telemetry] Failed to record metric:', error);
  }
}
