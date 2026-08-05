'use client';

import type { ParsedPdfContent } from '@/lib/types/pdf';

function canvasToDataUrl(canvas: HTMLCanvasElement, quality = 0.86): string {
  return canvas.toDataURL('image/jpeg', quality);
}

async function loadPdf(file: File) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}

async function renderPage(
  pdf: Awaited<ReturnType<typeof loadPdf>>,
  pageNumber: number,
  scale: number,
) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前设备无法创建 PDF 画布');
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas;
}

export async function renderPdfCoverLocally(file: File): Promise<string> {
  const pdf = await loadPdf(file);
  try {
    return canvasToDataUrl(await renderPage(pdf, 1, 1.35), 0.82);
  } finally {
    await pdf.cleanup();
  }
}

export async function parsePdfLocally(
  file: File,
  options: { maxPages?: number; includePageImages?: boolean } = {},
): Promise<ParsedPdfContent> {
  const startedAt = Date.now();
  const pdf = await loadPdf(file);
  const maxPages = Math.min(pdf.numPages, Math.max(1, options.maxPages ?? pdf.numPages));
  const pages: string[] = [];
  const images: string[] = [];
  const pdfImages: NonNullable<ParsedPdfContent['metadata']>['pdfImages'] = [];
  let coverImage: string | undefined;

  try {
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      pages.push(pageText ? `## 第 ${pageNumber} 页\n\n${pageText}` : `## 第 ${pageNumber} 页`);

      if (pageNumber === 1 || options.includePageImages) {
        const canvas = await renderPage(pdf, pageNumber, pageNumber === 1 ? 1.35 : 1.05);
        const src = canvasToDataUrl(canvas, 0.82);
        if (pageNumber === 1) coverImage = src;
        if (options.includePageImages) {
          const id = `pdf-page-${pageNumber}`;
          images.push(src);
          pdfImages.push({
            id,
            src,
            pageNumber,
            description: `PDF 第 ${pageNumber} 页`,
            width: canvas.width,
            height: canvas.height,
          });
        }
      }
    }

    return {
      text: pages.join('\n\n'),
      images,
      coverImage,
      metadata: {
        fileName: file.name,
        fileSize: file.size,
        pageCount: pdf.numPages,
        parser: 'ipad-pdfjs',
        processingTime: Date.now() - startedAt,
        pdfImages,
      },
    };
  } finally {
    await pdf.cleanup();
  }
}

export async function recognizeImageTextLocally(image: string | Blob): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['chi_sim', 'eng'], 1, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract',
    langPath: '/tessdata',
    gzip: false,
  });
  try {
    const result = await worker.recognize(image);
    const text = result.data.text.replace(/\r\n/g, '\n').trim();
    if (!text) throw new Error('没有从图片中识别到文字');
    return text;
  } finally {
    await worker.terminate();
  }
}
