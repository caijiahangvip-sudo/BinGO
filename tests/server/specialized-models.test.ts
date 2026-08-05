import { describe, expect, it } from 'vitest';
import {
  SPECIALIZED_MODEL_CATALOG,
  recommendSpecializedModels,
  type SpecializedHardwareProfile,
  type SpecializedModelState,
} from '@/lib/server/specialized-models';

const GB = 1024 ** 3;

function hardware(memoryGB = 32, diskGB = 300): SpecializedHardwareProfile {
  return {
    platform: 'win32',
    cpuModel: 'Test CPU',
    logicalCores: 16,
    totalMemoryBytes: memoryGB * GB,
    freeMemoryBytes: memoryGB * 0.6 * GB,
    freeDiskBytes: diskGB * GB,
    gpuAvailable: false,
    gpuName: '',
    gpuVendor: 'unknown',
    gpuRuntime: 'none',
  };
}

function states(installed: string[] = []): SpecializedModelState[] {
  return SPECIALIZED_MODEL_CATALOG.map((model) => ({
    id: model.id,
    installed: installed.includes(model.id),
    running: false,
  }));
}

describe('specialized model recommendations', () => {
  it('returns a recommendation for every specialized task', () => {
    const recommendations = recommendSpecializedModels(hardware(), states(), 'balanced');
    expect(recommendations.map((item) => item.task)).toEqual([
      'ocr',
      'document',
      'asr',
      'tts',
      'embedding',
    ]);
  });

  it('uses the balanced installable models after adapters are registered', () => {
    const recommendations = recommendSpecializedModels(
      hardware(),
      states(['tesseract-zh-en', 'sensevoice-small', 'mineru', 'bge-base-zh-v1.5']),
      'balanced',
    );
    const ocr = recommendations.find((item) => item.task === 'ocr');
    const document = recommendations.find((item) => item.task === 'document');
    expect(ocr?.primary.id).toBe('pp-ocrv6-medium');
    expect(ocr?.usable.id).toBe('pp-ocrv6-medium');
    expect(document?.primary.id).toBe('pp-structure-v3');
    expect(document?.usable.id).toBe('pp-structure-v3');
  });

  it('does not recommend models that exceed the hardware memory limit', () => {
    const recommendations = recommendSpecializedModels(hardware(8), states(), 'quality');
    expect(recommendations.find((item) => item.task === 'document')?.primary.id).not.toBe('mineru');
    expect(recommendations.find((item) => item.task === 'tts')?.primary.id).not.toBe('cosyvoice');
  });

  it('prefers lightweight system models in speed mode', () => {
    const recommendations = recommendSpecializedModels(hardware(), states(), 'speed');
    expect(recommendations.find((item) => item.task === 'tts')?.usable.id).toBe('windows-tts');
  });
});
