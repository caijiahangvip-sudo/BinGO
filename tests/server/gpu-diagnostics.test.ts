import { describe, expect, it } from 'vitest';
import { hasAmdDisplayAdapter, parseRocmProbe } from '@/lib/server/gpu-diagnostics';

describe('GPU diagnostics', () => {
  it('parses a ready WSL ROCm probe', () => {
    expect(
      parseRocmProbe(
        [
          'ROCM_READY=1',
          'GPU_NAME=AMD Radeon RX 7900 GRE',
          'ROCM_VERSION=6.4.2.60402-120~24.04',
        ].join('\n'),
      ),
    ).toEqual({
      ready: true,
      name: 'AMD Radeon RX 7900 GRE',
      version: '6.4.2.60402-120~24.04',
    });
  });

  it('detects AMD adapters from Windows hardware identifiers', () => {
    expect(hasAmdDisplayAdapter('PCI\\VEN_1002&DEV_744C')).toBe(true);
    expect(hasAmdDisplayAdapter('NVIDIA GeForce RTX 4090')).toBe(false);
  });
});
