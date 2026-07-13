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

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  acceptDownloads: true,
  downloadsPath: desktop,
  viewport: { width: 1440, height: 960 },
});

const page = context.pages()[0] ?? (await context.newPage());

async function saveDownload(download, suffix = '') {
  const suggested = download.suggestedFilename();
  const ext = path.extname(suggested) || '.bin';
  const out = path.join(desktop, `${stamp}${suffix}${ext}`);
  await download.saveAs(out);
  console.log(`Downloaded: ${out}`);
}

page.on('download', (download) => {
  saveDownload(download).catch((error) => console.log(`Download save failed: ${error.message}`));
});

console.log('Opening Jyeoo report page with the existing logged-in browser profile...');
await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => null);

console.log(`Title: ${await page.title().catch(() => '')}`);
console.log(`URL: ${page.url()}`);

await page.screenshot({
  path: path.join(desktop, `${stamp}_before_download_click.png`),
  fullPage: true,
});

const downloadLink = page.locator('a,button').filter({ hasText: '下载试卷' }).first();
if (!(await downloadLink.isVisible({ timeout: 15000 }).catch(() => false))) {
  console.log('The "下载试卷" button is not visible. Browser will stay open for 5 minutes.');
  await page.waitForTimeout(5 * 60 * 1000);
  await context.close();
  process.exit(2);
}

console.log('Clicking "下载试卷"...');
let popup = null;
const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
await downloadLink.click({ timeout: 10000 });
popup = await popupPromise;
const firstDownload = await downloadPromise;
if (firstDownload) {
  await saveDownload(firstDownload, '_direct');
  await context.close();
  process.exit(0);
}

if (popup) {
  await popup.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => null);
  console.log(`Popup opened: ${popup.url()}`);
}

await page.waitForTimeout(3000);

const modalInfo = await page.evaluate(() => {
  const visible = (el) => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  return Array.from(document.querySelectorAll('button,a,input,select,label'))
    .filter(visible)
    .map((el) => ({
      tag: el.tagName,
      text: (el.innerText || el.value || el.getAttribute('title') || '').trim(),
      type: el.getAttribute('type') || '',
      name: el.getAttribute('name') || '',
      onclick: el.getAttribute('onclick') || '',
      href: el.getAttribute('href') || '',
      className: el.className || '',
    }))
    .filter((x) =>
      /下载|确定|确认|Word|PDF|试卷|答案|解析|导出|保存|取消/.test(
        `${x.text} ${x.onclick} ${x.href} ${x.name} ${x.className}`,
      ),
    )
    .slice(-80);
});

const infoPath = path.join(desktop, `${stamp}_download_dialog_controls.json`);
await fs.promises.writeFile(infoPath, JSON.stringify(modalInfo, null, 2), 'utf8');
console.log(`Saved dialog controls: ${infoPath}`);
console.log(JSON.stringify(modalInfo.slice(-20), null, 2));

await page.screenshot({
  path: path.join(desktop, `${stamp}_download_dialog.png`),
  fullPage: true,
});

const confirmCandidates = [
  page.locator('.footer-bar button, .footer-bar a').filter({ hasText: /下载|确定|确认|立即下载/ }).last(),
  page.locator('button,a,input').filter({ hasText: /下载|确定|确认|立即下载/ }).last(),
  page.locator('input[type=button][value*=下载],input[type=submit][value*=下载]').last(),
];

for (const candidate of confirmCandidates) {
  if (!(await candidate.isVisible({ timeout: 3000 }).catch(() => false))) continue;
  console.log('Clicking final confirm/download control...');
  const finalDownloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  const finalPopupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
  await candidate.click({ timeout: 10000 }).catch((error) => {
    console.log(`Final control click failed: ${error.message}`);
  });
  const finalDownload = await finalDownloadPromise;
  if (finalDownload) {
    await saveDownload(finalDownload, '_confirmed');
    await context.close();
    process.exit(0);
  }
  const finalPopup = await finalPopupPromise;
  if (finalPopup) {
    await finalPopup.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => null);
    const popupPdf = path.join(desktop, `${stamp}_download_popup_print.pdf`);
    await finalPopup.pdf({ path: popupPdf, format: 'A4', printBackground: true }).catch(() => null);
    console.log(`Saved popup print, if supported: ${popupPdf}`);
  }
}

console.log('No browser download event was captured. Saved the visible dialog for inspection.');
await context.close();
