import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] || 'artifacts/bingo-sbom.cdx.json');
const lock = yaml.load(await readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8'));
const snapshots = lock.snapshots || lock.packages || {};
const components = new Map();

for (const rawKey of Object.keys(snapshots)) {
  const key = rawKey.replace(/^\//, '').split('(')[0];
  const separator = key.lastIndexOf('@');
  if (separator <= 0) continue;
  const name = key.slice(0, separator);
  const version = key.slice(separator + 1);
  if (!name || !version || version.startsWith('link:')) continue;
  const id = `${name}@${version}`;
  components.set(id, {
    type: 'library',
    name,
    version,
    'bom-ref': `pkg:npm/${encodeURIComponent(name)}@${version}`,
    purl: `pkg:npm/${encodeURIComponent(name)}@${version}`,
  });
}

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: 'application',
      name: packageJson.name || 'bingo',
      version: packageJson.version,
    },
  },
  components: [...components.values()].sort((left, right) =>
    left['bom-ref'].localeCompare(right['bom-ref']),
  ),
};

await writeFile(output, `${JSON.stringify(sbom, null, 2)}\n`);
console.log(`[release] Wrote ${components.size} SBOM components to ${output}`);
