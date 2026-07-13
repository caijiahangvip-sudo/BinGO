import JSZip from 'jszip';
import {
  clearDatabase,
  DATABASE_NAME,
  DATABASE_VERSION,
  db,
  getDatabaseStats,
  initDatabase,
} from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';

const log = createLogger('LocalBackup');

const BACKUP_MAGIC = 'bingo-local-backup';
const BACKUP_FORMAT_VERSION = 1;
const STORAGE_DECISION_KEY_PREFIX = 'bingo.localSeed.';

const TABLE_BLOB_FIELDS = {
  stages: [],
  scenes: [],
  audioFiles: ['blob'],
  imageFiles: ['blob'],
  snapshots: [],
  chatSessions: [],
  playbackState: [],
  stageOutlines: [],
  mediaFiles: ['blob', 'poster'],
  generatedAgents: [],
  bookLearningPlans: [],
  bookPracticeSessions: [],
  homeworkSessions: [],
  studentLearningProfiles: [],
  knowledgeMastery: [],
  learningEvidence: [],
  lessonSummaries: [],
  learningVoiceRecords: ['audioBlob'],
} as const satisfies Record<string, readonly string[]>;

export type BackupTableName = keyof typeof TABLE_BLOB_FIELDS;

export interface LocalBackupManifest {
  magic: typeof BACKUP_MAGIC;
  formatVersion: number;
  exportedAt: number;
  dbName: string;
  dbVersion: number;
  origin: string;
  tables: Record<
    BackupTableName,
    {
      count: number;
      blobFields: string[];
    }
  >;
  localStorageEntries: number;
}

interface BlobPointer {
  __bingoBlob: string;
  type: string;
}

type SerializableRecord = Record<string, unknown>;
type StorageSnapshot = Record<string, string>;

export interface LocalBackupExportResult {
  blob: Blob;
  manifest: LocalBackupManifest;
}

export interface LocalBackupImportResult {
  manifest: LocalBackupManifest;
  stats: Awaited<ReturnType<typeof getDatabaseStats>>;
  localStorageEntries: number;
}

function isBlobPointer(value: unknown): value is BlobPointer {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__bingoBlob' in value &&
    typeof (value as { __bingoBlob?: unknown }).__bingoBlob === 'string'
  );
}

function shouldSkipStorageKey(key: string): boolean {
  return key.startsWith(STORAGE_DECISION_KEY_PREFIX);
}

function readStorageSnapshot(storage: Storage): StorageSnapshot {
  const snapshot: StorageSnapshot = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || shouldSkipStorageKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

function restoreStorageSnapshot(storage: Storage, snapshot: StorageSnapshot): void {
  storage.clear();
  for (const [key, value] of Object.entries(snapshot)) {
    storage.setItem(key, value);
  }
}

function isBrowserBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

function getTableNames(): BackupTableName[] {
  return Object.keys(TABLE_BLOB_FIELDS) as BackupTableName[];
}

function isDatabaseStatEmpty(stats: Awaited<ReturnType<typeof getDatabaseStats>>): boolean {
  return Object.values(stats).every((count) => count === 0);
}

async function exportTable(
  zip: JSZip,
  tableName: BackupTableName,
): Promise<{ count: number; blobFields: string[] }> {
  const table = db.table(tableName);
  const records = (await table.toArray()) as SerializableRecord[];
  const blobFields = [...TABLE_BLOB_FIELDS[tableName]];
  const serializedRecords: SerializableRecord[] = [];

  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    const serializedRecord: SerializableRecord = { ...record };

    for (const field of blobFields) {
      const value = serializedRecord[field];
      if (!isBrowserBlob(value)) continue;

      const blobPath = `blobs/${tableName}/${recordIndex}/${field}`;
      zip.file(blobPath, value);
      serializedRecord[field] = {
        __bingoBlob: blobPath,
        type: value.type,
      } satisfies BlobPointer;
    }

    serializedRecords.push(serializedRecord);
  }

  zip.file(`tables/${tableName}.json`, JSON.stringify(serializedRecords));

  return {
    count: records.length,
    blobFields,
  };
}

async function importTable(
  zip: JSZip,
  tableName: BackupTableName,
  blobFields: readonly string[],
): Promise<void> {
  const tableFile = zip.file(`tables/${tableName}.json`);
  if (!tableFile) return;

  const records = JSON.parse(await tableFile.async('text')) as SerializableRecord[];
  if (!Array.isArray(records) || records.length === 0) return;

  const restoredRecords: SerializableRecord[] = [];
  for (const record of records) {
    const restoredRecord: SerializableRecord = { ...record };
    for (const field of blobFields) {
      const value = restoredRecord[field];
      if (!isBlobPointer(value)) continue;

      const blobFile = zip.file(value.__bingoBlob);
      if (!blobFile) {
        throw new Error(`Missing blob payload: ${value.__bingoBlob}`);
      }
      restoredRecord[field] = await blobFile.async('blob');
    }
    restoredRecords.push(restoredRecord);
  }

  await db.table(tableName).bulkPut(restoredRecords);
}

export async function exportLocalBackup(): Promise<LocalBackupExportResult> {
  await initDatabase();

  const zip = new JSZip();
  const manifestTables = {} as LocalBackupManifest['tables'];

  for (const tableName of getTableNames()) {
    manifestTables[tableName] = await exportTable(zip, tableName);
  }

  const localStorageSnapshot = readStorageSnapshot(window.localStorage);
  zip.file('storage/localStorage.json', JSON.stringify(localStorageSnapshot));

  const manifest: LocalBackupManifest = {
    magic: BACKUP_MAGIC,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: Date.now(),
    dbName: DATABASE_NAME,
    dbVersion: DATABASE_VERSION,
    origin: window.location.origin,
    tables: manifestTables,
    localStorageEntries: Object.keys(localStorageSnapshot).length,
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { blob, manifest };
}

export async function importLocalBackup(file: Blob): Promise<LocalBackupImportResult> {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error('Backup manifest is missing.');
  }

  const manifest = JSON.parse(await manifestFile.async('text')) as LocalBackupManifest;
  if (manifest.magic !== BACKUP_MAGIC) {
    throw new Error('Backup format is not supported.');
  }

  const localStorageFile = zip.file('storage/localStorage.json');
  const localStorageSnapshot = localStorageFile
    ? (JSON.parse(await localStorageFile.async('text')) as StorageSnapshot)
    : {};

  await clearDatabase();
  await initDatabase();

  for (const tableName of getTableNames()) {
    const blobFields = manifest.tables[tableName]?.blobFields ?? TABLE_BLOB_FIELDS[tableName];
    await importTable(zip, tableName, blobFields);
  }

  restoreStorageSnapshot(window.localStorage, localStorageSnapshot);

  const stats = await getDatabaseStats();
  log.info('Imported local backup successfully');

  return {
    manifest,
    stats,
    localStorageEntries: Object.keys(localStorageSnapshot).length,
  };
}

export async function getLocalBackupPreview(file: Blob): Promise<LocalBackupManifest> {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error('Backup manifest is missing.');
  }

  const manifest = JSON.parse(await manifestFile.async('text')) as LocalBackupManifest;
  if (manifest.magic !== BACKUP_MAGIC) {
    throw new Error('Backup format is not supported.');
  }

  return manifest;
}

export async function getCurrentLocalDataState() {
  await initDatabase();
  const stats = await getDatabaseStats();
  return {
    stats,
    isEmpty: isDatabaseStatEmpty(stats),
    localStorageEntries: Object.keys(readStorageSnapshot(window.localStorage)).length,
  };
}
