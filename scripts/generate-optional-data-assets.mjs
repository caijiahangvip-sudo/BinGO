import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const outputDirectory = resolve(process.argv[2] || 'artifacts');
const outputPath = resolve(outputDirectory, 'chinese-xinhua-ci.json.gz');
const source = resolve('data/chinese-xinhua/data/ci.json');
const bytes = await promisify(gzip)(await readFile(source), { level: 9 });
bytes[9] = 255;

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, bytes);
console.log(createHash('sha256').update(bytes).digest('hex'));
