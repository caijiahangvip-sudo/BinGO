export type LocalCapabilityId =
  | 'speech-synthesis'
  | 'speech-recognition'
  | 'camera'
  | 'file-import'
  | 'pdf-preview'
  | 'pencil-input';

export type LocalCapabilitySupport = Record<LocalCapabilityId, boolean>;

function hasSpeechRecognition(): boolean {
  if (typeof window === 'undefined') return false;
  const browserWindow = window as typeof window & {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition);
}

export function getLocalCapabilitySupport(): LocalCapabilitySupport {
  if (typeof window === 'undefined') {
    return {
      'speech-synthesis': false,
      'speech-recognition': false,
      camera: false,
      'file-import': false,
      'pdf-preview': false,
      'pencil-input': false,
    };
  }

  return {
    'speech-synthesis':
      'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined',
    'speech-recognition': hasSpeechRecognition(),
    camera: Boolean(navigator.mediaDevices?.getUserMedia),
    'file-import': typeof File !== 'undefined' && typeof FileReader !== 'undefined',
    'pdf-preview':
      typeof Blob !== 'undefined' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function',
    'pencil-input': typeof PointerEvent !== 'undefined',
  };
}

export function isLocalCapabilitySupported(capability: LocalCapabilityId): boolean {
  return getLocalCapabilitySupport()[capability];
}
