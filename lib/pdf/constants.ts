/**
 * PDF Provider Constants
 * Separated from pdf-providers.ts to avoid importing server-only parser modules
 * in client components.
 */

import type { BuiltInPDFProviderId, PDFProviderId, PDFProviderConfig } from './types';

/**
 * PDF Provider Registry
 */
export const PDF_PROVIDERS: Record<BuiltInPDFProviderId, PDFProviderConfig> &
  Record<string, PDFProviderConfig> = {
  'mineru-local': {
    id: 'mineru-local',
    name: 'MinerU Local',
    requiresApiKey: false,
    baseUrl: 'http://localhost:50002',
    icon: '/logos/mineru.png',
    features: ['text', 'images', 'metadata', 'tables', 'formulas', 'layout-analysis', 'ocr'],
  },
};

/**
 * Get all available PDF providers
 */
export function getAllPDFProviders(): PDFProviderConfig[] {
  return Object.values(PDF_PROVIDERS);
}

/**
 * Get PDF provider by ID
 */
export function getPDFProvider(providerId: PDFProviderId): PDFProviderConfig | undefined {
  return PDF_PROVIDERS[providerId];
}
