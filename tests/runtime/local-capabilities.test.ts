import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocalCapabilitySupport, isLocalCapabilitySupported } from '@/lib/runtime/local-capabilities';

afterEach(() => vi.unstubAllGlobals());

describe('iPad local capabilities', () => {
  it('reports browser-backed local classroom capabilities', () => {
    vi.stubGlobal('window', {
      SpeechSynthesisUtterance: class {},
      speechSynthesis: {},
      SpeechRecognition: class {},
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });
    vi.stubGlobal('File', class {});
    vi.stubGlobal('FileReader', class {});
    vi.stubGlobal('Blob', class {});
    vi.stubGlobal('URL', { createObjectURL: vi.fn() });
    vi.stubGlobal('PointerEvent', class {});

    expect(getLocalCapabilitySupport()).toEqual({
      'speech-synthesis': true,
      'speech-recognition': true,
      camera: true,
      'file-import': true,
      'pdf-preview': true,
      'pencil-input': true,
    });
  });

  it('returns false when no browser APIs are available', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {});
    expect(isLocalCapabilitySupported('speech-synthesis')).toBe(false);
    expect(isLocalCapabilitySupported('camera')).toBe(false);
  });
});
