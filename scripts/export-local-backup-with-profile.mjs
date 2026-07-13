import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const BACKUP_MAGIC = 'bingo-local-backup';
const BACKUP_FORMAT_VERSION = 1;
const STORAGE_DECISION_KEY_PREFIX = 'bingo.localSeed.';
const DEFAULT_DATABASE_NAME = 'MAIC-Database';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : '1';
    args.set(key, value);
  }
  return args;
}

function ensureOutputPath(outputPath) {
  const resolvedPath = path.resolve(process.cwd(), outputPath);
  const relativePath = path.relative(process.cwd(), resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Output path must stay inside the project directory: ${outputPath}`);
  }
  return resolvedPath;
}

async function launchPersistentChromium(userDataDir, profileDirectory) {
  const baseOptions = {
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
  };

  if (profileDirectory) {
    baseOptions.args.push(`--profile-directory=${profileDirectory}`);
  }

  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launchPersistentContext(userDataDir, {
        ...baseOptions,
        channel,
      });
    } catch (error) {
      console.warn(`Failed to launch Chromium channel "${channel}": ${String(error)}`);
    }
  }

  return chromium.launchPersistentContext(userDataDir, baseOptions);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyEntryIfExists(sourcePath, destinationPath) {
  if (!(await pathExists(sourcePath))) {
    return;
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.cp(sourcePath, destinationPath, { recursive: true, force: true });
}

async function prepareChromiumUserDataDir(sourceProfilePath) {
  const tempUserDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bingo-profile-copy-'));
  const sourceProfileName = path.basename(sourceProfilePath);
  const isNamedChromiumProfile = sourceProfileName === 'Default' || /^Profile\s+\d+$/i.test(sourceProfileName);
  const destinationProfileRoot = isNamedChromiumProfile
    ? path.join(tempUserDataDir, sourceProfileName)
    : tempUserDataDir;

  await fs.mkdir(destinationProfileRoot, { recursive: true });

  for (const relativeEntry of [
    'IndexedDB',
    'Local Storage',
    'Session Storage',
    'WebStorage',
    'blob_storage',
    'File System',
    'Service Worker',
    'SharedStorage',
    'SharedStorage-wal',
    'Preferences',
  ]) {
    await copyEntryIfExists(
      path.join(sourceProfilePath, relativeEntry),
      path.join(destinationProfileRoot, relativeEntry),
    );
  }

  for (const localStateSource of [
    path.join(sourceProfilePath, 'Local State'),
    path.join(path.dirname(sourceProfilePath), 'Local State'),
  ]) {
    if (!(await pathExists(localStateSource))) {
      continue;
    }

    await fs.copyFile(localStateSource, path.join(tempUserDataDir, 'Local State'));
    break;
  }

  return {
    userDataDir: tempUserDataDir,
    profileDirectory: isNamedChromiumProfile ? sourceProfileName : null,
  };
}

function buildExportPageHtml(outputPath) {
  const encodedMagic = JSON.stringify(BACKUP_MAGIC);
  const encodedStoragePrefix = JSON.stringify(STORAGE_DECISION_KEY_PREFIX);
  const encodedDatabaseName = JSON.stringify(DEFAULT_DATABASE_NAME);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Bingo Local Backup</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="/__bingo__/jszip.min.js"></script>
  </head>
  <body>
    <main>
      <div data-backup-status="running">Preparing local backup export...</div>
    </main>
    <script>
      const BACKUP_MAGIC = ${encodedMagic};
      const BACKUP_FORMAT_VERSION = ${BACKUP_FORMAT_VERSION};
      const STORAGE_DECISION_KEY_PREFIX = ${encodedStoragePrefix};
      const DEFAULT_DATABASE_NAME = ${encodedDatabaseName};
      const BACKUP_CHUNK_SIZE = 512 * 1024;

      function setStatus(status, message) {
        const node = document.querySelector('[data-backup-status]');
        if (!node) return;
        node.setAttribute('data-backup-status', status);
        node.textContent = message;
      }

      function shouldSkipStorageKey(key) {
        return key.startsWith(STORAGE_DECISION_KEY_PREFIX);
      }

      function readStorageSnapshot(storage) {
        const snapshot = {};
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

      function requestToPromise(request) {
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
        });
      }

      function transactionDone(transaction) {
        return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
          transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
        });
      }

      async function openDatabase() {
        let databaseName = DEFAULT_DATABASE_NAME;
        let databaseVersion;

        if (typeof indexedDB.databases === 'function') {
          const databases = await indexedDB.databases();
          const exactMatch = databases.find((entry) => entry.name === DEFAULT_DATABASE_NAME);
          const candidate = exactMatch || databases.find((entry) => entry.name) || null;

          if (candidate && candidate.name) {
            databaseName = candidate.name;
            databaseVersion = candidate.version;
          } else if (!exactMatch) {
            throw new Error('No IndexedDB database found in the selected profile.');
          }
        }

        const openRequest = databaseVersion
          ? indexedDB.open(databaseName, databaseVersion)
          : indexedDB.open(databaseName);
        const database = await requestToPromise(openRequest);
        return {
          name: databaseName,
          version: database.version,
          instance: database,
        };
      }

      function isBrowserBlob(value) {
        return typeof Blob !== 'undefined' && value instanceof Blob;
      }

      async function exportTable(zip, database, tableName) {
        const transaction = database.transaction(tableName, 'readonly');
        const donePromise = transactionDone(transaction);
        const store = transaction.objectStore(tableName);
        const records = await requestToPromise(store.getAll());
        await donePromise;

        const blobFields = new Set();
        const serializedRecords = [];

        for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
          const record = records[recordIndex];
          const serializedRecord = record && typeof record === 'object' ? { ...record } : record;

          if (serializedRecord && typeof serializedRecord === 'object') {
            for (const [field, value] of Object.entries(serializedRecord)) {
              if (!isBrowserBlob(value)) continue;

              const blobPath = \`blobs/\${tableName}/\${recordIndex}/\${field}\`;
              zip.file(blobPath, value);
              serializedRecord[field] = {
                __bingoBlob: blobPath,
                type: value.type,
              };
              blobFields.add(field);
            }
          }

          serializedRecords.push(serializedRecord);
        }

        zip.file(\`tables/\${tableName}.json\`, JSON.stringify(serializedRecords));

        return {
          count: records.length,
          blobFields: Array.from(blobFields),
        };
      }

      async function exportLocalBackup() {
        const { name, version, instance } = await openDatabase();

        try {
          const zip = new JSZip();
          const manifestTables = {};
          const tableNames = Array.from(instance.objectStoreNames);

          if (tableNames.length === 0) {
            throw new Error(\`IndexedDB database "\${name}" has no object stores.\`);
          }

          for (const tableName of tableNames) {
            manifestTables[tableName] = await exportTable(zip, instance, tableName);
          }

          const localStorageSnapshot = readStorageSnapshot(window.localStorage);
          zip.file('storage/localStorage.json', JSON.stringify(localStorageSnapshot));

          const manifest = {
            magic: BACKUP_MAGIC,
            formatVersion: BACKUP_FORMAT_VERSION,
            exportedAt: Date.now(),
            dbName: name,
            dbVersion: version,
            origin: window.location.origin,
            tables: manifestTables,
            localStorageEntries: Object.keys(localStorageSnapshot).length,
          };

          zip.file('manifest.json', JSON.stringify(manifest, null, 2));

          return {
            buffer: await zip.generateAsync({
              type: 'uint8array',
              compression: 'DEFLATE',
              compressionOptions: { level: 6 },
            }),
            manifest,
          };
        } finally {
          instance.close();
        }
      }

      async function chunkToBase64(bufferChunk) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const commaIndex = result.indexOf(',');
            resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
          };
          reader.onerror = () => reject(reader.error || new Error('Failed to encode backup chunk.'));
          reader.readAsDataURL(new Blob([bufferChunk]));
        });
      }

      async function uploadBackup(buffer) {
        await window.__bingoBackupReset();
        for (let offset = 0; offset < buffer.length; offset += BACKUP_CHUNK_SIZE) {
          const chunk = buffer.subarray(offset, offset + BACKUP_CHUNK_SIZE);
          const encodedChunk = await chunkToBase64(chunk);
          await window.__bingoBackupAppendChunk(encodedChunk);
        }
        await window.__bingoBackupClose();
      }

      async function run() {
        try {
          const { buffer, manifest } = await exportLocalBackup();
          await uploadBackup(buffer);
          setStatus(
            'success',
            \`Backup export completed. \${Object.keys(manifest.tables).length} tables, \${manifest.localStorageEntries} localStorage entries.\`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setStatus('error', message);
          console.error(error);
        }
      }

      run();
    </script>
  </body>
</html>`;
}

async function registerOfflineExportRoutes(context, origin, outputFilePath) {
  const jsZipPath = path.resolve(process.cwd(), 'node_modules', 'jszip', 'dist', 'jszip.min.js');
  const jsZipContent = await fs.readFile(jsZipPath, 'utf8');
  const exportPageHtml = buildExportPageHtml(path.relative(process.cwd(), outputFilePath).replaceAll('\\', '/'));
  const originUrl = new URL(origin);

  await context.route(`${originUrl.origin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/local-backup') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: exportPageHtml,
      });
      return;
    }

    if (request.method() === 'GET' && url.pathname === '/__bingo__/jszip.min.js') {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: jsZipContent,
      });
      return;
    }

    if (request.method() === 'GET' && url.pathname === '/favicon.ico') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'text/plain; charset=utf-8',
      body: 'Not found',
    });
  });
}

async function installBackupBindings(context, outputFilePath) {
  await fs.mkdir(path.dirname(outputFilePath), { recursive: true });
  let fileHandle = await fs.open(outputFilePath, 'w');

  async function reopen() {
    if (fileHandle) {
      await fileHandle.close();
    }
    fileHandle = await fs.open(outputFilePath, 'w');
  }

  async function closeHandle() {
    if (!fileHandle) {
      return;
    }
    await fileHandle.close();
    fileHandle = null;
  }

  await context.exposeBinding('__bingoBackupReset', async () => {
    await reopen();
    return true;
  });

  await context.exposeBinding('__bingoBackupAppendChunk', async (_source, encodedChunk) => {
    if (typeof encodedChunk !== 'string' || encodedChunk.length === 0) {
      throw new Error('Backup chunk is empty.');
    }
    if (!fileHandle) {
      throw new Error('Backup file handle is closed.');
    }

    await fileHandle.write(Buffer.from(encodedChunk, 'base64'));
    return true;
  });

  await context.exposeBinding('__bingoBackupClose', async () => {
    await closeHandle();
    return true;
  });

  return async () => {
    await closeHandle();
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profilePath = args.get('profile-path');
  const origin = args.get('origin');
  const outputPath = args.get('output-path');

  if (!profilePath || !origin || !outputPath) {
    throw new Error(
      'Usage: node scripts/export-local-backup-with-profile.mjs --profile-path <dir> --origin <origin> --output-path <relativePath>',
    );
  }

  const outputFilePath = ensureOutputPath(outputPath);
  const preparedUserData = await prepareChromiumUserDataDir(profilePath);

  try {
    const context = await launchPersistentChromium(
      preparedUserData.userDataDir,
      preparedUserData.profileDirectory,
    );
    const cleanupBindings = await installBackupBindings(context, outputFilePath);

    try {
      await registerOfflineExportRoutes(context, origin, outputFilePath);

      const page = context.pages()[0] ?? (await context.newPage());
      const exportUrl = `${origin}/local-backup`;
      await page.goto(exportUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });

      await Promise.race([
        page.waitForSelector('[data-backup-status="success"]', { timeout: 15 * 60 * 1000 }),
        page.waitForSelector('[data-backup-status="error"]', { timeout: 15 * 60 * 1000 }),
      ]);

      const status = await page
        .locator('[data-backup-status]')
        .first()
        .getAttribute('data-backup-status');
      if (status !== 'success') {
        const message = await page.locator('[data-backup-status]').first().innerText();
        throw new Error(`Backup export failed. Page status: ${status ?? 'unknown'}. ${message}`);
      }

      console.log(`Backup export completed via offline origin ${origin}`);
    } finally {
      await cleanupBindings();
      await context.close();
    }
  } finally {
    await fs.rm(preparedUserData.userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
