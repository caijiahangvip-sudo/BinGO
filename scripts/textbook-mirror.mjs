// BinGO textbook mirror: sync junior-high textbooks from the national
// smartedu platform (ykt.cbern.com.cn) to local disk, incrementally.
//
// The original source PDFs are not publicly downloadable (the private
// storage hosts return 401, and c1.ykt.cbern.com.cn refuses the paths),
// so each book is mirrored from its public page-preview JPEGs on
// r3-ndr.ykt.cbern.com.cn and assembled into a single PDF, the same way
// the ai-api download route does as a fallback.
//
// Self-contained, no third-party dependencies. Runs one round, sleeps
// MIRROR_INTERVAL_HOURS, then repeats. Append-only, resume-safe.

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';

const CATALOG_URL = process.env.CATALOG_URL || 'http://bingo-ai-api:4000/api/textbooks/catalog';
const MIRROR_DIR = process.env.MIRROR_DIR || '/data/textbooks';
const INTERVAL_HOURS = Number(process.env.MIRROR_INTERVAL_HOURS || 12);
const CONCURRENCY = Math.max(1, Number(process.env.MIRROR_CONCURRENCY || 2));
const PAGE_CONCURRENCY = Math.max(1, Number(process.env.MIRROR_PAGE_CONCURRENCY || 3));
const ROOT_NAMES = (process.env.MIRROR_ROOTS || '初中,初中（五•四学制）')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const DETAIL_BASE = 'https://s-file-1.ykt.cbern.com.cn/zxx/ndrv2/resources/tch_material/details';
const THEMATIC_RESOURCE_BASE = 'https://s-file-1.ykt.cbern.com.cn/zxx/ndrs/special_edu/thematic_course';
const SPECIAL_DETAIL_BASE = 'https://s-file-1.ykt.cbern.com.cn/zxx/ndrs/special_edu/resources/details';
const IMAGE_BASE = 'https://r3-ndr.ykt.cbern.com.cn';

const GAP_MS = 300;
const PAGE_GAP_MS = 60;
const PAGE_TIMEOUT_MS = 60 * 1000;
const MIN_PAGES = 3;
const MAX_PAGES = 800;
// A 403/404 usually means the end of the book, but some books have
// mid-book transcode holes (page 3 missing, pages 4+ fine), so only
// stop after this many consecutive misses.
const END_MISSES = 12;
const RETRIES = 3;
const USER_AGENT = 'BinGO-TextbookMirror/1.0 (+https://bingo.mido.site)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log(new Date().toISOString(), ...args);

async function fetchJson(url, timeoutMs = 30_000) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Download a URL into a Buffer. TLS verification is relaxed only for
// cbern.com.cn hosts (some of them serve self-signed certificates);
// these are public textbook assets from the national platform.
function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const host = new URL(url).hostname;
    const lax = host === 'cbern.com.cn' || host.endsWith('.cbern.com.cn');
    const req = https.get(url, {
      headers: { 'user-agent': USER_AGENT },
      rejectUnauthorized: !lax,
      timeout: PAGE_TIMEOUT_MS,
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects < 5) {
        res.resume();
        resolve(fetchBuffer(new URL(res.headers.location, url).toString(), redirects + 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        const err = new Error(`HTTP ${status}`);
        err.status = status;
        reject(err);
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('download timeout')));
    req.on('error', reject);
  });
}

// Parse width/height from a JPEG's SOF marker (SOF0-15 except DHT/DAC).
function jpegDimensions(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) { offset += 1; continue; }
    const marker = buf[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

// Assemble JPEG pages into a single PDF (one image per page, DCTDecode).
function buildPdf(pages) {
  const objects = [];
  const addObject = (body) => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'binary'));
    return objects.length;
  };
  const catalogId = addObject('');
  const pagesId = addObject('');
  const pageIds = [];

  pages.forEach((page, index) => {
    const imageId = addObject(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`, 'binary'),
      page.bytes,
      Buffer.from('\nendstream', 'binary'),
    ]));
    const content = `q\n${page.width} 0 0 ${page.height} 0 0 cm\n/Im${index} Do\nQ`;
    const contentId = addObject(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    pageIds.push(addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  });

  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'binary');
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`, 'binary');

  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'binary'), object, Buffer.from('\nendobj\n', 'binary')]);
    chunks.push(chunk);
    offset += chunk.length;
  });
  const xrefOffset = offset;
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(Buffer.from(xref, 'binary'));
  return Buffer.concat(chunks);
}

function collectLeaves(node, out) {
  const children = node.children || [];
  if (children.length === 0) {
    if (node.id && node.name) {
      out.push({ id: node.id, name: node.name, contentType: node.textbook?.contentType });
    }
    return out;
  }
  for (const child of children) collectLeaves(child, out);
  return out;
}

// Find the public transcode/image folder for a book and return the base
// URL that page JPEGs live under (`<base>/<n>.jpg`).
function findImageBase(items) {
  for (const item of items || []) {
    const storage = item.ti_storage || '';
    if (item.ti_format === 'folder' && storage.includes('/transcode/image')) {
      const clean = storage.replace('cs_path:${ref-path}', '');
      if (clean.startsWith('/')) return IMAGE_BASE + clean;
    }
  }
  return undefined;
}

async function resolveBook(book) {
  const contentId = book.id;
  let detail;
  try {
    detail = await fetchJson(`${DETAIL_BASE}/${encodeURIComponent(contentId)}.json`);
  } catch {
    detail = await fetchJson(`${SPECIAL_DETAIL_BASE}/${encodeURIComponent(contentId)}.json`);
  }
  let imageBase = findImageBase(detail.ti_items);
  if (!imageBase) {
    // Thematic courses (e.g. PE textbooks) keep the document under a
    // separate resources list.
    try {
      const resources = await fetchJson(
        `${THEMATIC_RESOURCE_BASE}/${encodeURIComponent(contentId)}/resources/list.json`,
      );
      // A thematic course bundles many documents (the textbook itself,
      // slide decks, a short usage pamphlet, ...). Pick the one whose
      // PDF is largest — that is the main book.
      let bestSize = -1;
      for (const resource of resources || []) {
        const base = findImageBase(resource.ti_items);
        if (!base) continue;
        const size = Math.max(
          0,
          ...(resource.ti_items || [])
            .filter((item) => item.ti_format === 'pdf')
            .map((item) => Number(item.ti_size) || 0),
        );
        if (size > bestSize) {
          bestSize = size;
          imageBase = base;
        }
      }
    } catch {
      // fall through to the error below
    }
  }
  if (!imageBase) throw new Error(`no page image folder for ${contentId}`);
  const title = detail.title || detail.global_title?.['zh-CN'] || contentId;
  return { imageBase, title };
}

async function loadManifest() {
  try {
    return JSON.parse(await readFile(path.join(MIRROR_DIR, 'manifest.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function saveManifest(manifest) {
  const file = path.join(MIRROR_DIR, 'manifest.json');
  await writeFile(file + '.tmp', JSON.stringify(manifest, null, 1));
  await rename(file + '.tmp', file);
}

async function fileSize(filePath) {
  try {
    const st = await stat(filePath);
    return st.isFile() ? st.size : 0;
  } catch {
    return 0;
  }
}

// Download pages 1.jpg, 2.jpg, ... until two consecutive pages miss
// (403/404 = end of book), then assemble everything into one PDF.
async function downloadBook(book, manifest, counters) {
  const finalPath = path.join(MIRROR_DIR, `${book.id}.pdf`);
  const tmpPath = `${finalPath}.tmp`;
  const existingSize = await fileSize(finalPath);
  const recorded = manifest[book.id];
  if (existingSize > 0 && recorded && recorded.size === existingSize) {
    counters.skipped += 1;
    return;
  }

  const { imageBase, title } = await resolveBook(book);
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const pages = [];
      let misses = 0;
      let cursor = 1;
      const pageWorker = async () => {
        while (cursor <= MAX_PAGES && misses < END_MISSES) {
          const n = cursor;
          cursor += 1;
          try {
            const bytes = await fetchBuffer(`${imageBase}/${n}.jpg`);
            const dims = jpegDimensions(bytes);
            if (!dims) throw new Error(`page ${n}: not a valid JPEG`);
            pages[n - 1] = { bytes, width: dims.width, height: dims.height };
            misses = 0;
          } catch (error) {
            if (error && (error.status === 403 || error.status === 404)) {
              misses += 1;
            } else {
              throw error;
            }
          }
          await sleep(PAGE_GAP_MS);
        }
      };
      await Promise.all(Array.from({ length: PAGE_CONCURRENCY }, pageWorker));

      // Mid-book transcode holes are dropped; the PDF just skips them.
      const complete = pages.filter(Boolean);
      if (complete.length < MIN_PAGES) {
        throw new Error(`too few pages: got ${complete.length}`);
      }
      const pdf = buildPdf(complete);
      if (pdf.length <= 0) throw new Error('empty pdf');
      await writeFile(tmpPath, pdf);
      await rename(tmpPath, finalPath);
      manifest[book.id] = {
        title,
        size: pdf.length,
        pages: complete.length,
        syncedAt: new Date().toISOString(),
      };
      counters.done += 1;
      return;
    } catch (error) {
      lastError = error;
      await sleep(1000 * attempt);
    }
  }
  counters.failed += 1;
  log(`book failed: ${book.name} (${book.id}): ${String(lastError).slice(0, 160)}`);
  counters.failures.push({ id: book.id, name: book.name, error: String(lastError).slice(0, 200) });
}

async function runRound() {
  log('round started');
  const catalog = await fetchJson(CATALOG_URL, 60_000);
  const roots = (catalog.catalog || []).filter((node) => ROOT_NAMES.includes(node.name));
  if (roots.length === 0) throw new Error(`no matching roots found; wanted: ${ROOT_NAMES.join(', ')}`);

  const books = roots.flatMap((root) => collectLeaves(root, []));
  log(`catalog loaded: ${books.length} junior-high textbooks under roots: ${roots.map((r) => r.name).join(', ')}`);

  const manifest = await loadManifest();
  const counters = { done: 0, skipped: 0, failed: 0, failures: [] };

  let cursor = 0;
  const worker = async () => {
    while (cursor < books.length) {
      const index = cursor;
      cursor += 1;
      const book = books[index];
      try {
        await downloadBook(book, manifest, counters);
      } catch (error) {
        counters.failed += 1;
        log(`book error: ${book.name} (${book.id}): ${String(error && error.message ? error.message : error).slice(0, 160)}`);
        counters.failures.push({ id: book.id, name: book.name, error: String(error).slice(0, 200) });
      }
      const processed = counters.done + counters.skipped + counters.failed;
      if (processed % 10 === 0) {
        log(`progress ${processed}/${books.length} done=${counters.done} skip=${counters.skipped} fail=${counters.failed}`);
        await saveManifest(manifest);
      }
      await sleep(GAP_MS);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await saveManifest(manifest);

  const status = {
    lastRunAt: new Date().toISOString(),
    roots: roots.map((r) => r.name),
    total: books.length,
    done: counters.done,
    skipped: counters.skipped,
    failed: counters.failed,
    mirroredFiles: Object.keys(manifest).length,
    failures: counters.failures.slice(0, 50),
  };
  await writeFile(path.join(MIRROR_DIR, 'mirror-status.json'), JSON.stringify(status, null, 1));
  log(`round finished: done=${status.done} skip=${status.skipped} fail=${status.failed} mirrored=${status.mirroredFiles}/${status.total}`);
}

async function main() {
  await mkdir(MIRROR_DIR, { recursive: true });
  for (;;) {
    try {
      await runRound();
    } catch (error) {
      log(`round aborted: ${error instanceof Error ? error.message : error}`);
    }
    log(`sleeping ${INTERVAL_HOURS}h until next round`);
    await sleep(INTERVAL_HOURS * 3600 * 1000);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
