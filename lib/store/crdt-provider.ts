import * as Y from 'yjs';
import type { WhiteboardActionRecord } from '@/lib/orchestration/director-prompt';

export const BINGO_LEDGER_ARRAY_NAME = 'binGoLedgerArray';
const BINGO_CLIENT_ID_STORAGE_KEY = 'bingo:crdt:client-id';
const DEFAULT_WEBRTC_ROOM_PREFIX = 'bingo-whiteboard';
const CRDT_GLOBAL_STATE_KEY = '__bingoCrdtProviderState';
const CRDT_DESTROY_DELAY_MS = 1500;
const DEFAULT_CRDT_PROVIDER: CrdtProviderKind = 'none';

export interface DistributedWhiteboardActionRecord extends WhiteboardActionRecord {
  recordId: string;
  clientId: string;
  roomId?: string;
  actorType: 'agent' | 'user';
  timestamp: number;
}

export type DistributedWhiteboardActionInput = Omit<
  DistributedWhiteboardActionRecord,
  'recordId' | 'clientId' | 'timestamp'
> &
  Partial<Pick<DistributedWhiteboardActionRecord, 'recordId' | 'clientId' | 'timestamp'>>;

export type BinGoLedgerArray = Y.Array<DistributedWhiteboardActionRecord>;

type CrdtProviderKind = 'webrtc' | 'none';

interface CrdtNetworkProvider {
  connect?: () => void;
  disconnect?: () => void;
  destroy?: () => void;
  on?: (eventName: string, callback: (event: unknown) => void) => void;
  off?: (eventName: string, callback: (event: unknown) => void) => void;
}

export interface CrdtProviderOptions {
  provider?: CrdtProviderKind;
  roomPrefix?: string;
  signaling?: string[];
}

export interface CrdtProviderConnection {
  roomId: string;
  roomName: string;
  ydoc: Y.Doc;
  ledgerArray: BinGoLedgerArray;
  provider: CrdtNetworkProvider | null;
  destroy: () => void;
}

interface CrdtProviderGlobalState {
  ydoc: Y.Doc;
  activeConnection: CrdtProviderConnection | null;
  destroyTimer: ReturnType<typeof setTimeout> | null;
}

type GlobalWithCrdtProvider = typeof globalThis & {
  [CRDT_GLOBAL_STATE_KEY]?: CrdtProviderGlobalState;
};

function getGlobalCrdtState(): CrdtProviderGlobalState {
  const globalRef = globalThis as GlobalWithCrdtProvider;
  if (!globalRef[CRDT_GLOBAL_STATE_KEY]) {
    globalRef[CRDT_GLOBAL_STATE_KEY] = {
      ydoc: new Y.Doc(),
      activeConnection: null,
      destroyTimer: null,
    };
  }
  return globalRef[CRDT_GLOBAL_STATE_KEY];
}

export const ydoc = getGlobalCrdtState().ydoc;

function getActiveConnection(): CrdtProviderConnection | null {
  return getGlobalCrdtState().activeConnection;
}

function setActiveConnection(connection: CrdtProviderConnection | null): void {
  getGlobalCrdtState().activeConnection = connection;
}

function cancelScheduledDestroy(): void {
  const state = getGlobalCrdtState();
  if (!state.destroyTimer) return;

  clearTimeout(state.destroyTimer);
  state.destroyTimer = null;
}

function isDuplicateWebrtcRoomError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('already exists');
}

function createFallbackId(prefix: string): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && 'randomUUID' in cryptoRef) {
    return `${prefix}-${cryptoRef.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getCrdtClientId(): string {
  if (typeof window === 'undefined') {
    return `server-${ydoc.clientID}`;
  }

  try {
    const existing = window.localStorage.getItem(BINGO_CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;

    const nextId = createFallbackId('client');
    window.localStorage.setItem(BINGO_CLIENT_ID_STORAGE_KEY, nextId);
    return nextId;
  } catch {
    return `client-${ydoc.clientID}`;
  }
}

export function getBinGoLedgerArray(doc: Y.Doc = ydoc): BinGoLedgerArray {
  return doc.getArray<DistributedWhiteboardActionRecord>(BINGO_LEDGER_ARRAY_NAME);
}

export function getActiveCrdtProvider(): CrdtProviderConnection | null {
  return getActiveConnection();
}

function cloneLedgerRecord(
  record: DistributedWhiteboardActionRecord,
): DistributedWhiteboardActionRecord {
  return JSON.parse(JSON.stringify(record)) as DistributedWhiteboardActionRecord;
}

export function normalizeDistributedWhiteboardAction(
  record: DistributedWhiteboardActionInput,
  roomId?: string,
): DistributedWhiteboardActionRecord {
  return {
    ...record,
    actorType: record.actorType ?? 'user',
    recordId: record.recordId ?? createFallbackId('wb-ledger'),
    clientId: record.clientId ?? getCrdtClientId(),
    roomId: record.roomId ?? roomId,
    timestamp: record.timestamp ?? Date.now(),
    params: record.params ?? {},
  };
}

export function pushWhiteboardLedgerRecord(
  record: DistributedWhiteboardActionInput,
): DistributedWhiteboardActionRecord {
  const connection = getActiveCrdtProvider();
  const ledgerArray = connection?.ledgerArray ?? getBinGoLedgerArray();
  const normalized = normalizeDistributedWhiteboardAction(record, connection?.roomId);

  ydoc.transact(() => {
    ledgerArray.push([cloneLedgerRecord(normalized)]);
  }, 'bingo-whiteboard-ledger');

  return normalized;
}

export async function initializeCrdtProvider(
  roomId: string,
  options: CrdtProviderOptions = {},
): Promise<CrdtProviderConnection> {
  const normalizedRoomId = roomId.trim();
  if (!normalizedRoomId) {
    throw new Error('[CRDT] roomId is required to initialize the whiteboard provider.');
  }

  const currentConnection = getActiveConnection();
  if (currentConnection?.roomId === normalizedRoomId) {
    cancelScheduledDestroy();
    return currentConnection;
  }

  destroyCrdtProvider({ immediate: true });

  const ledgerArray = getBinGoLedgerArray();
  const roomName = `${options.roomPrefix ?? DEFAULT_WEBRTC_ROOM_PREFIX}-${normalizedRoomId}`;
  let provider: CrdtNetworkProvider | null = null;
  let statusHandler: ((event: unknown) => void) | null = null;
  let destroyed = false;

  const connection: CrdtProviderConnection = {
    roomId: normalizedRoomId,
    roomName,
    ydoc,
    ledgerArray,
    provider: null,
    destroy: () => {
      destroyed = true;

      if (provider && statusHandler) {
        provider.off?.('status', statusHandler);
      }
      try {
        provider?.destroy?.();
        provider?.disconnect?.();
      } catch (error) {
        console.warn('[CRDT] Failed to destroy whiteboard provider cleanly.', error);
      } finally {
        provider = null;
        connection.provider = null;
      }

      if (getActiveConnection() === connection) {
        setActiveConnection(null);
      }
    },
  };

  // Mark the connection active before the async provider import. React StrictMode,
  // HMR, and whiteboard/tour remounts can call this twice in the same tick.
  setActiveConnection(connection);

  if (typeof window !== 'undefined' && (options.provider ?? DEFAULT_CRDT_PROVIDER) === 'webrtc') {
    try {
      const { WebrtcProvider } = await import('y-webrtc');
      const nextProvider = new WebrtcProvider(roomName, ydoc, {
        signaling: options.signaling,
      }) as CrdtNetworkProvider;

      if (destroyed || getActiveConnection() !== connection) {
        try {
          nextProvider.destroy?.();
          nextProvider.disconnect?.();
        } catch (destroyError) {
          console.warn('[CRDT] Failed to dispose stale whiteboard provider.', destroyError);
        }
        return getActiveConnection() ?? connection;
      }

      provider = nextProvider;
      connection.provider = provider;

      statusHandler = (event: unknown) => {
        if (typeof event === 'object' && event !== null && 'connected' in event) {
          console.info('[CRDT] Whiteboard provider status:', event);
        }
      };
      provider.on?.('status', statusHandler);
    } catch (error) {
      if (isDuplicateWebrtcRoomError(error)) {
        console.warn(
          `[CRDT] WebRTC room "${roomName}" is already active; reusing the local Y.Doc ledger without creating another provider.`,
        );
        return connection;
      }
      console.warn('[CRDT] Failed to initialize y-webrtc provider; using local Y.Doc only.', error);
    }
  }
  return connection;
}

export function destroyCrdtProvider(options: { immediate?: boolean } = {}): void {
  const state = getGlobalCrdtState();
  const connection = state.activeConnection;
  if (!connection) return;

  cancelScheduledDestroy();

  const destroyConnection = () => {
    if (state.activeConnection !== connection) return;
    connection.destroy();
    state.activeConnection = null;
  };

  if (options.immediate) {
    destroyConnection();
    return;
  }

  state.destroyTimer = setTimeout(() => {
    destroyConnection();
    state.destroyTimer = null;
  }, CRDT_DESTROY_DELAY_MS);
}
