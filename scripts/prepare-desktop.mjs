import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopDist = join(root, 'desktop-dist');
const serverDist = join(desktopDist, 'server');
const binariesDir = join(root, 'src-tauri', 'binaries');
const nodeVersion = process.env.BINGO_NODE_VERSION || '22.22.0';
const nodeArchive = `node-v${nodeVersion}-win-x64.zip`;
const nodeUrl = `https://nodejs.org/dist/v${nodeVersion}/${nodeArchive}`;
const archivePath = join(binariesDir, nodeArchive);
const nodePath = join(binariesDir, 'node.exe');
const gzipAsync = promisify(gzip);
const knownNodeHashes = {
  '22.22.0': 'c97fa376d2becdc8863fcd3ca2dd9a83a9f3468ee7ccf7a6d076ec66a645c77a',
};

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

async function sha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function verifyNodeArchive() {
  const expected = process.env.BINGO_NODE_SHA256 || knownNodeHashes[nodeVersion];
  if (!expected) {
    throw new Error(`No trusted SHA-256 configured for Node.js ${nodeVersion}. Set BINGO_NODE_SHA256.`);
  }
  const actual = await sha256(archivePath);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    await rm(archivePath, { force: true });
    throw new Error(`Node.js archive SHA-256 mismatch: expected ${expected}, received ${actual}`);
  }
}

async function ensureNodeRuntime() {
  await mkdir(binariesDir, { recursive: true });
  if (await exists(nodePath)) return;
  console.log(`[desktop] Downloading Node.js ${nodeVersion} runtime...`);
  await download(nodeUrl, archivePath);
  await verifyNodeArchive();
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

async function pruneDesktopRuntime(directory) {
  const removableDirectories = new Set(['__MACOSX', '.github', 'coverage', 'docs', 'examples', 'test', 'tests']);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (removableDirectories.has(entry.name)) {
        await rm(path, { recursive: true, force: true });
      } else {
        await pruneDesktopRuntime(path);
      }
      continue;
    }
    if (entry.name === 'desktop.ini' || entry.name === '.DS_Store' || entry.name.endsWith('.map')) {
      await rm(path, { force: true });
    }
  }
}

async function compressChineseXinhuaData() {
  const dataDirectory = join(serverDist, 'data', 'chinese-xinhua', 'data');
  for (const fileName of ['word.json', 'ci.json', 'idiom.json', 'xiehouyu.json']) {
    const source = join(dataDirectory, fileName);
    if (!(await exists(source))) continue;
    const compressed = await gzipAsync(await readFile(source), { level: 9 });
    compressed[9] = 255;
    await writeFile(`${source}.gz`, compressed);
    await rm(source, { force: true });
  }
}

async function pruneNextProductionRuntime() {
  const nextDist = join(serverDist, 'node_modules', 'next', 'dist');
  const paths = [
    'bundle-analyzer',
    'esm',
    'next-devtools',
    'compiled/@babel',
    'compiled/babel',
    'compiled/babel-packages',
    'compiled/next-devtools',
    'compiled/postcss',
    'compiled/postcss-preset-env',
    'compiled/react-dom-experimental',
    'compiled/react-server-dom-turbopack-experimental',
    'compiled/react-server-dom-webpack-experimental',
    'compiled/terser',
    'compiled/webpack',
  ];
  await Promise.all(paths.map((relativePath) => rm(join(nextDist, relativePath), { recursive: true, force: true })));
}

async function ensureNextRuntime() {
  await mkdir(join(serverDist, 'node_modules'), { recursive: true });
  const runtimePackages = ['next', '@swc/helpers', 'styled-jsx', 'sharp'];
  for (const packageName of runtimePackages) {
    const bundledPackage = join(serverDist, 'node_modules', packageName);
    if (await exists(join(bundledPackage, 'package.json'))) continue;
    const sourcePackage = join(root, 'node_modules', packageName);
    if (!(await exists(join(sourcePackage, 'package.json')))) {
      throw new Error(`Required desktop runtime package is missing: ${packageName}`);
    }
    await cp(sourcePackage, bundledPackage, { recursive: true, dereference: true });
  }
}

async function validateStandaloneRuntime() {
  const required = [
    join(serverDist, 'node_modules', 'next', 'package.json'),
    join(serverDist, 'node_modules', 'next', 'dist', 'server', 'lib', 'start-server.js'),
    join(serverDist, 'node_modules', '@swc', 'helpers', 'package.json'),
    join(serverDist, 'node_modules', 'styled-jsx', 'package.json'),
    join(serverDist, 'node_modules', 'sharp', 'package.json'),
  ];
  for (const path of required) {
    if (!(await exists(path))) {
      throw new Error(`Desktop server runtime is incomplete: missing ${path}`);
    }
  }
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
  await ensureNextRuntime();
  await rm(join(serverDist, 'data', 'homework-jobs'), { recursive: true, force: true });
  await rm(join(serverDist, 'public', 'fonts', 'custom'), { recursive: true, force: true });
  await rm(join(serverDist, 'node_modules', 'typescript'), { recursive: true, force: true });
  await compressChineseXinhuaData();
  await rm(join(serverDist, 'data', 'chinese-xinhua', 'data', 'ci.json.gz'), { force: true });
  await pruneNextProductionRuntime();
  await pruneDesktopRuntime(serverDist);
  await validateStandaloneRuntime();
  console.log(`[desktop] Prepared BinGO ${packageJson.version} standalone server.`);
}

await ensureNodeRuntime();
await prepareStandalone();
