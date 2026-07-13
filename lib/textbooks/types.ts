export interface TextbookCatalogNode {
  id: string;
  name: string;
  children?: TextbookCatalogNode[];
  textbook?: TextbookListItem;
}

export interface TextbookListItem {
  id: string;
  title: string;
  contentType: string;
  pathIds: string[];
  pathNames: string[];
  stage?: string;
  subject?: string;
  edition?: string;
  grade?: string;
  volume?: string;
}

export interface TextbookCatalogResponse {
  success?: boolean;
  catalog?: TextbookCatalogNode[];
  updatedAt?: number;
  error?: string;
  details?: string;
}

export interface TextbookSearchResponse {
  success?: boolean;
  results?: TextbookListItem[];
  total?: number;
  error?: string;
  details?: string;
}

export interface TextbookDownloadRequest {
  contentId: string;
  contentType?: string;
}
