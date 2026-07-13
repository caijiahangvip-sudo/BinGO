/**
 * PDF Parsing Provider Type Definitions
 */

/**
 * PDF Provider IDs
 */
export type BuiltInPDFProviderId = 'mineru-local';
export type PDFProviderId = BuiltInPDFProviderId | (string & {});
export type PDFParseMode = 'fast' | 'accurate';

/**
 * PDF Provider Configuration
 */
export interface PDFProviderConfig {
  id: PDFProviderId;
  name: string;
  requiresApiKey: boolean;
  baseUrl?: string;
  icon?: string;
  features: string[]; // ['text', 'images', 'tables', 'formulas', 'layout-analysis', etc.]
}

/**
 * PDF Parser Configuration for API calls
 */
export interface PDFParserConfig {
  providerId: PDFProviderId;
  apiKey?: string;
  baseUrl?: string;
  mode?: PDFParseMode;
  needsImages?: boolean;
  needsCover?: boolean;
  needsMiddleJson?: boolean;
  maxPages?: number;
  signal?: AbortSignal;
}

// Note: ParsedPdfContent is imported from @/lib/types/pdf to avoid duplication
