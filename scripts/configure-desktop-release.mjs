import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const configPath = resolve(root, 'src-tauri', 'tauri.conf.json');
const cargoPath = resolve(root, 'src-tauri', 'Cargo.toml');
const owner = process.env.BINGO_GITHUB_OWNER?.trim();
const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim();

if (!owner || !publicKey) {
  throw new Error('BINGO_GITHUB_OWNER and TAURI_UPDATER_PUBLIC_KEY are required for a release build.');
}

const config = JSON.parse(await readFile(configPath, 'utf8'));
config.version = packageJson.version;
config.plugins.updater.endpoints = [`https://github.com/${owner}/BinGO/releases/latest/download/latest.json`];
config.plugins.updater.pubkey = publicKey;
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

const cargo = await readFile(cargoPath, 'utf8');
await writeFile(cargoPath, cargo.replace(/^version = "[^"]+"/m, `version = "${packageJson.version}"`));
console.log(`[desktop] Configured BinGO ${packageJson.version} releases for ${owner}/BinGO.`);
