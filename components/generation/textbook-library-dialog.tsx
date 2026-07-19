'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronRight, Download, Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import type {
  TextbookCatalogNode,
  TextbookCatalogResponse,
  TextbookListItem,
  TextbookSearchResponse,
} from '@/lib/textbooks/types';

const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024;

interface TextbookLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPdfSelected: (file: File) => void;
}

export function TextbookLibraryDialog({
  open,
  onOpenChange,
  onPdfSelected,
}: TextbookLibraryDialogProps) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const copy = zh
    ? {
        title: '教材库',
        description: '从国家中小学智慧教育平台选择教材，下载后直接作为当前 PDF 附件。',
        searchPlaceholder: '搜索教材、学科、年级、版本',
        loadingCatalog: '正在加载教材目录...',
        catalogFailed: '教材目录加载失败',
        empty: '没有匹配的教材',
        all: '全部',
        downloading: '下载中...',
        importPdf: '下载并导入',
        imported: '已导入教材 PDF',
        downloadFailed: '教材下载失败',
        networkFailed: '无法连接教材平台，请检查网络后重试。',
        authRequired: '教材平台会话无效，请先在 BinGO 内完成登录。',
        openPlatform: '打开平台登录',
        openDownloader: '打开教材下载器',
        downloaderOpened: '教材下载器已启动',
        downloaderFailed: '教材下载器启动失败',
        tooLarge: '教材 PDF 超过 50 MB，无法作为当前附件导入。',
      }
    : {
        title: 'Textbook Library',
        description:
          'Choose a textbook from Smart Education of China and import it as the current PDF.',
        searchPlaceholder: 'Search title, subject, grade, edition',
        loadingCatalog: 'Loading textbook catalog...',
        catalogFailed: 'Failed to load textbook catalog',
        empty: 'No matching textbooks',
        all: 'All',
        downloading: 'Downloading...',
        importPdf: 'Download and import',
        imported: 'Textbook PDF imported',
        downloadFailed: 'Failed to download textbook',
        networkFailed: 'Unable to reach the textbook platform. Check your network and retry.',
        authRequired: 'The textbook session is missing or expired. Sign in inside BinGO first.',
        openPlatform: 'Open platform login',
        openDownloader: 'Open textbook downloader',
        downloaderOpened: 'Textbook downloader started',
        downloaderFailed: 'Failed to start textbook downloader',
        tooLarge:
          'The textbook PDF exceeds 50 MB and cannot be imported as the current attachment.',
      };

  const [catalog, setCatalog] = useState<TextbookCatalogNode[]>([]);
  const [results, setResults] = useState<TextbookListItem[]>([]);
  const [query, setQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<TextbookCatalogNode[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingResults, setLoadingResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const getFriendlyError = (err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : '';
    if (/NETWORK_ERROR|fetch failed|network/i.test(message)) return copy.networkFailed;
    if (/AUTH_REQUIRED|401|403|session|token/i.test(message)) return copy.authRequired;
    return message || fallback;
  };

  const launchDownloader = async () => {
    try {
      const response = await fetch('/api/textbook-downloader/launch', { method: 'POST' });
      const data = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
      if (!response.ok) throw new Error(data.details || data.error || copy.downloaderFailed);
      toast.success(copy.downloaderOpened);
    } catch (err) {
      toast.error(getFriendlyError(err, copy.downloaderFailed));
    }
  };

  useEffect(() => {
    if (!open) return;

    if (catalog.length > 0) return;

    let cancelled = false;
    setLoadingCatalog(true);
    setError(null);
    fetch('/api/textbooks/catalog', { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as TextbookCatalogResponse;
        if (!response.ok || !data.success || !data.catalog) {
          throw new Error(data.details || data.error || copy.catalogFailed);
        }
        if (!cancelled) {
          setCatalog(data.catalog);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : copy.catalogFailed);
      })
      .finally(() => {
        if (!cancelled) setLoadingCatalog(false);
      });

    return () => {
      cancelled = true;
    };
  }, [catalog.length, copy.catalogFailed, open]);

  const selectedPathIds = useMemo(() => selectedPath.map((node) => node.id), [selectedPath]);

  useEffect(() => {
    if (!open || catalog.length === 0) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoadingResults(true);
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (selectedPathIds.length > 0) params.set('path', selectedPathIds.join('/'));

      fetch(`/api/textbooks/search?${params.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = (await response.json()) as TextbookSearchResponse;
          if (!response.ok || !data.success || !data.results) {
            throw new Error(data.details || data.error || copy.catalogFailed);
          }
          setResults(data.results);
          setError(null);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(getFriendlyError(err, copy.catalogFailed));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingResults(false);
        });
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [catalog.length, copy.catalogFailed, open, query, selectedPathIds]);

  const currentChildren =
    selectedPath.length === 0
      ? catalog
      : selectedPath[selectedPath.length - 1]?.children?.filter((node) => !node.textbook) || [];

  const downloadTextbook = async (item: TextbookListItem) => {
    if (downloadingId) return;

    setDownloadingId(item.id);
    setError(null);
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };

      const response = await fetch('/api/textbooks/download', {
        method: 'POST',
        headers,
        body: JSON.stringify({ contentId: item.id, contentType: item.contentType }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          details?: string;
        };
        throw new Error(data.details || data.error || copy.downloadFailed);
      }

      const blob = await response.blob();
      if (blob.size > MAX_PDF_SIZE_BYTES) {
        throw new Error(copy.tooLarge);
      }

      const file = new File([blob], `${sanitizeFileName(item.title)}.pdf`, {
        type: 'application/pdf',
      });
      onPdfSelected(file);
      toast.success(copy.imported);
      onOpenChange(false);
    } catch (err) {
      const message = getFriendlyError(err, copy.downloadFailed);
      setError(message);
      toast.error(message);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[82vh] max-w-[980px] flex-col gap-0 p-0" showCloseButton>
        <DialogTitle className="sr-only">{copy.title}</DialogTitle>
        <DialogDescription className="sr-only">{copy.description}</DialogDescription>

        <div className="border-b border-border/60 px-5 py-4">
          <div className="flex items-start justify-between gap-4 pr-10">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <BookOpen className="size-4 text-violet-600" />
                <h2 className="text-base font-semibold">{copy.title}</h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => window.open('https://basic.smartedu.cn/', '_blank', 'noopener,noreferrer')}>
                  {copy.openPlatform}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={launchDownloader}>
                  {copy.openDownloader}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
          <aside className="min-h-0 border-r border-border/60 bg-muted/20">
            <div className="border-b border-border/60 p-3">
              <Button
                type="button"
                variant={selectedPath.length === 0 ? 'secondary' : 'ghost'}
                size="sm"
                className="w-full justify-start"
                onClick={() => setSelectedPath([])}
              >
                {copy.all}
              </Button>
              {selectedPath.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                  {selectedPath.map((node, index) => (
                    <button
                      key={node.id}
                      type="button"
                      className="inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
                      onClick={() => setSelectedPath((path) => path.slice(0, index + 1))}
                    >
                      <span className="truncate">{node.name}</span>
                      {index < selectedPath.length - 1 && <ChevronRight className="size-3" />}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="inline-flex size-5 items-center justify-center rounded hover:bg-muted"
                    onClick={() => setSelectedPath([])}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )}
            </div>

            <ScrollArea className="h-full">
              <div className="space-y-1 p-3 pb-20">
                {loadingCatalog ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    {copy.loadingCatalog}
                  </div>
                ) : (
                  currentChildren.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted"
                      onClick={() => setSelectedPath((path) => [...path, node])}
                    >
                      <span className="min-w-0 truncate">{node.name}</span>
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </aside>

          <main className="min-h-0">
            <div className="border-b border-border/60 p-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={copy.searchPlaceholder}
                  className="h-9 pl-8 text-sm"
                />
              </div>
            </div>

            {error && (
              <div className="mx-3 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {error}
              </div>
            )}

            <ScrollArea className="h-[calc(82vh-142px)]">
              <div className="space-y-2 p-3">
                {loadingResults ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    {copy.loadingCatalog}
                  </div>
                ) : results.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    {copy.empty}
                  </div>
                ) : (
                  results.map((item) => {
                    const isDownloading = downloadingId === item.id;
                    return (
                      <div
                        key={item.id}
                        className="rounded-lg border border-border/70 bg-background p-3 transition-colors hover:bg-muted/20"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                            <BookOpen className="size-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="line-clamp-2 text-sm font-medium leading-snug">
                              {item.title}
                            </h3>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {[item.stage, item.subject, item.edition, item.grade, item.volume]
                                .filter(Boolean)
                                .map((value) => (
                                  <Badge
                                    key={value}
                                    variant="secondary"
                                    className="h-5 text-[10px]"
                                  >
                                    {value}
                                  </Badge>
                                ))}
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            disabled={!!downloadingId}
                            onClick={() => downloadTextbook(item)}
                            className={cn('shrink-0', isDownloading && 'min-w-24')}
                          >
                            {isDownloading ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Download className="size-3.5" />
                            )}
                            {isDownloading ? copy.downloading : copy.importPdf}
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function sanitizeFileName(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'textbook'
  );
}
