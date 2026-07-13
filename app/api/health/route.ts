import { apiSuccess } from '@/lib/server/api-response';
import {
  getServerVectorProviders,
  getServerWebSearchProviders,
  getServerTTSProviders,
} from '@/lib/server/provider-config';

import packageJson from '@/package.json';

const version = process.env.npm_package_version || packageJson.version;
const startedAt = new Date().toISOString();

export async function GET() {
  return apiSuccess({
    status: 'ok',
    version,
    desktop: process.env.BINGO_DESKTOP === '1',
    startedAt,
    capabilities: {
      webSearch: Object.keys(getServerWebSearchProviders()).length > 0,
      tts: Object.keys(getServerTTSProviders()).length > 0,
      vector: Object.keys(getServerVectorProviders()).length > 0,
    },
  });
}
