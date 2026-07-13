import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const targetUrl =
  'https://www.jyeoo.com/bio/report/detail/6qupR0aK80VIgPYc1tH6y43y4XWl13un7F4VmRGfoXQFp0AXm8my92';

const desktop = path.join(os.homedir(), 'Desktop');
const profileDir = path.join(os.tmpdir(), 'bingo-jyeoo-playwright-profile');
const stamp = '2024-2025_beijing_chaoyang_grade7_biology_final';

fs.mkdirSync(desktop, { recursive: true });
fs.mkdirSync(profileDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  acceptDownloads: true,
  downloadsPath: desktop,
  viewport: { width: 1365, height: 900 },
});

const page = context.pages()[0] ?? (await context.newPage());
let savedDownload = false;

page.on('download', async (download) => {
  const suggested = download.suggestedFilename();
  const ext = path.extname(suggested) || '.bin';
  const out = path.join(desktop, `${stamp}${ext}`);
  await download.saveAs(out);
  console.log(`Downloaded: ${out}`);
  savedDownload = true;
});

console.log('Opening Jyeoo report page.');
console.log('If Jyeoo asks you to log in, complete login in the browser window.');
console.log('After the report is visible, the script will try download buttons and also save a PDF print.');

await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

async function looksLikeReport() {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return (
    url.includes('/bio/report/detail/') &&
    !url.includes('ReturnUrl=') &&
    (text.includes('2024') ||
      text.includes('2025') ||
      text.includes('朝阳') ||
      text.includes('生物') ||
      text.includes('下载') ||
      title.includes('生物') ||
      title.includes('试卷'))
  );
}

const deadline = Date.now() + 10 * 60 * 1000;
while (Date.now() < deadline) {
  if (await looksLikeReport()) break;
  await page.waitForTimeout(2000);
}

if (!(await looksLikeReport())) {
  console.log('The report page was not visible within 10 minutes. Leaving browser open for manual use.');
  await page.waitForTimeout(30 * 60 * 1000);
  await context.close();
  process.exit(2);
}

const title = await page.title().catch(() => '');
const url = page.url();
const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
console.log(`Current URL: ${url}`);
console.log(`Current title: ${title}`);
console.log(`Body preview: ${bodyText.replace(/\s+/g, ' ').slice(0, 500)}`);

const screenshotPath = path.join(desktop, `${stamp}_jyeoo_page.png`);
await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
  console.log(`Screenshot failed: ${error.message}`);
});
if (fs.existsSync(screenshotPath)) console.log(`Saved screenshot: ${screenshotPath}`);

const htmlPath = path.join(desktop, `${stamp}_jyeoo_page.html`);
await fs.promises.writeFile(htmlPath, await page.content(), 'utf8').catch((error) => {
  console.log(`HTML save failed: ${error.message}`);
});
if (fs.existsSync(htmlPath)) console.log(`Saved HTML: ${htmlPath}`);

const pdfPath = path.join(desktop, `${stamp}_jyeoo_print.pdf`);
await page.emulateMedia({ media: 'print' }).catch(() => null);
await page
  .pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
  })
  .then(() => console.log(`Saved PDF print: ${pdfPath}`))
  .catch((error) => console.log(`PDF print failed: ${error.message}`));

console.log('Trying public page download controls.');

const downloadText = /下载|导出|保存|Word|PDF|试卷下载|立即下载|免费下载/;
const candidates = page.getByText(downloadText).or(page.locator('a,button').filter({ hasText: downloadText }));

let clicked = false;
for (let i = 0; i < Math.min(await candidates.count().catch(() => 0), 10); i += 1) {
  const item = candidates.nth(i);
  if (!(await item.isVisible().catch(() => false))) continue;
  const downloadPromise = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await item.click({ timeout: 5000 }).catch((error) => {
    console.log(`Download control click failed: ${error.message}`);
  });
  const download = await downloadPromise;
  if (download) {
    const suggested = download.suggestedFilename();
    const ext = path.extname(suggested) || '.bin';
    const out = path.join(desktop, `${stamp}${ext}`);
    await download.saveAs(out);
    console.log(`Downloaded: ${out}`);
    savedDownload = true;
    clicked = true;
    break;
  }
  if (page.isClosed()) break;
}

if (!clicked && !savedDownload) {
  console.log('No direct downloadable file was triggered; saved the visible Jyeoo page as PDF instead.');
}

await context.close();
