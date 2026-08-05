import { ensureLocalModelServiceRunning } from '@/lib/server/local-model-services';
import { installSpecializedModel } from '@/lib/server/specialized-models';

async function baseUrl() {
  const result = await ensureLocalModelServiceRunning('specialized');
  return result.baseUrl || 'http://localhost:50004';
}

export async function specializedMultipart(
  endpoint: 'ocr' | 'document' | 'tts',
  formData: FormData,
  modelId: string,
): Promise<Response> {
  await installSpecializedModel(modelId);
  return fetch(`${await baseUrl()}/${endpoint}`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
}

export async function specializedJson(
  endpoint: 'embeddings',
  body: unknown,
  modelId: string,
): Promise<Response> {
  await installSpecializedModel(modelId);
  return fetch(`${await baseUrl()}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
}
