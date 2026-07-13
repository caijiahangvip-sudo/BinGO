import { createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopDist = join(root, 'desktop-dist');
const serverDist = join(desktopDist, 'server');
const binariesDir = join(root, 'src-tauri', 'binaries');
const nodeVersion = process.env.BINGO_NODE_VERSION || '22.22.0';
const nodeArchive = `node-v${nodeVersion}-win-x64.zip`;
const nodeUrl = `https://nodejs.org/dist/v${nodeVersion}/${nodeArchive}`;
const archivePath = join(binariesDir, nodeArchive);
const nodePath = join(binariesDir, 'node.exe');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  await pipeline(response.body, createWriteStream(destination));
}

async function ensureNodeRuntime() {
  await mkdir(binariesDir, { recursive: true });
  if (await exists(nodePath)) return;
  console.log(`[desktop] Downloading Node.js ${nodeVersion} runtime...`);
  await download(nodeUrl, archivePath);
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${binariesDir.replaceAll("'", "''")}' -Force`]);
  } else {
    execFileSync('unzip', ['-q', '-o', archivePath, '-d', binariesDir]);
  }
  const extractedDir = join(binariesDir, `node-v${nodeVersion}-win-x64`);
  await cp(join(extractedDir, 'node.exe'), nodePath);
  await rm(extractedDir, { recursive: true, force: true });
  await rm(archivePath, { force: true });
}

async function copyIfPresent(source, destination) {
  if (await exists(source)) {
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, dereference: true });
  }
}

async function prepareStandalone() {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const standaloneRoot = join(root, '.next', 'standalone');
  if (!(await exists(join(standaloneRoot, 'server.js')))) {
    throw new Error('Next standalone output is missing. Run `pnpm build` before preparing desktop assets.');
  }
  await rm(desktopDist, { recursive: true, force: true });
  await mkdir(serverDist, { recursive: true });
  await cp(join(standaloneRoot, 'server.js'), join(serverDist, 'server.js'));
  await cp(join(standaloneRoot, 'package.json'), join(serverDist, 'package.json'));
  await cp(join(standaloneRoot, '.next'), join(serverDist, '.next'), { recursive: true, dereference: true });
  await cp(join(standaloneRoot, 'node_modules'), join(serverDist, 'node_modules'), { recursive: true, dereference: true });
  await copyIfPresent(join(root, '.next', 'static'), join(serverDist, '.next', 'static'));
  await copyIfPresent(join(root, 'public'), join(serverDist, 'public'));
  await copyIfPresent(join(root, 'scripts'), join(serverDist, 'scripts'));
  await copyIfPresent(join(root, 'data'), join(serverDist, 'data'));
  console.log(`[desktop] Prepared BinGO ${packageJson.version} standalone server.`);
}

await ensureNodeRuntime();
await prepareStandalone();
