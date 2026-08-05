'use client';

import { useEffect } from 'react';
import { getRuntimePlatform } from '@/lib/runtime/platform';
import { getLocalCapabilitySupport } from '@/lib/runtime/local-capabilities';
import { installRuntimeFetchBridge } from '@/lib/runtime/api-client';

function capabilityDataKey(capability: string): string {
  return `bingoCapability${capability.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}`;
}

export function IPadRuntimeBootstrap() {
  useEffect(() => {
    const platform = getRuntimePlatform();
    const uninstallFetchBridge = installRuntimeFetchBridge();
    document.documentElement.dataset.bingoPlatform = platform;
    if (platform === 'ipados') {
      document.documentElement.dataset.bingoLocalFirst = 'true';
      const capabilities = getLocalCapabilitySupport();
      for (const [capability, supported] of Object.entries(capabilities)) {
        document.documentElement.dataset[capabilityDataKey(capability)] = supported ? 'true' : 'false';
      }
    }
    return () => {
      uninstallFetchBridge();
      delete document.documentElement.dataset.bingoPlatform;
      delete document.documentElement.dataset.bingoLocalFirst;
      for (const capability of Object.keys(getLocalCapabilitySupport())) {
        delete document.documentElement.dataset[capabilityDataKey(capability)];
      }
    };
  }, []);
  return null;
}
