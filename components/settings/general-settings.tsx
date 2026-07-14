'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { AlertTriangle, Database, Download, Loader2, Trash2, Upload } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { clearDatabase } from '@/lib/utils/database';
import { exportLocalBackup, importLocalBackup } from '@/lib/utils/local-backup';
import { exportUserLearningProfileJson } from '@/lib/utils/user-profile-export';
import { useSettingsStore } from '@/lib/store/settings';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import { LocalRuntimeDiagnostics } from './local-runtime-diagnostics';
import { DesktopUpdateSettings } from './desktop-update-settings';

const log = createLogger('GeneralSettings');
const BACKUP_FILENAME = 'bingo-user-backup.zip';
const USER_PROFILE_FILENAME = 'bingo-user-profile.json';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function GeneralSettings() {
  const { t, locale } = useI18n();
  const slideLayoutReviewEnabled = useSettingsStore((state) => state.slideLayoutReviewEnabled);
  const setSlideLayoutReviewEnabled = useSettingsStore(
    (state) => state.setSlideLayoutReviewEnabled,
  );

  const [showClearDialog, setShowClearDialog] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingProfile, setExportingProfile] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const confirmPhrase = t('settings.clearCacheConfirmPhrase');
  const isConfirmValid = confirmInput === confirmPhrase;

  const copy = useMemo(
    () =>
      locale === 'zh-CN'
        ? {
            backupTitle: '本地数据备份',
            backupDescription: '导出当前浏览器里的学习记录、课件历史和本地设置，或从备份包恢复。',
            profileTitle: '用户画像',
            profileDescription: '导出学生资料、学习画像、知识点掌握情况、作业记录和学习证据。',
            exportProfile: '导出用户画像',
            exportProfileSuccess: '用户画像已导出',
            exportProfileFailed: '导出用户画像失败',
            export: '导出备份',
            import: '导入备份',
            exportSuccess: '本地备份已导出',
            exportFailed: '导出本地备份失败',
            importTitle: '导入本地备份',
            importDescription: '导入会覆盖当前浏览器中的课程数据和本地设置，完成后会自动刷新页面。',
            importConfirm: '确认导入',
            importSuccess: '本地备份已导入',
            importFailed: '导入本地备份失败',
            chooseFileFirst: '请先选择备份文件',
            generationTitle: '课件生成',
            layoutReviewLabel: '高质量布局审核',
            layoutReviewDescription:
              '默认关闭。关闭时直接采用实验性的 AI 原始排版，不保证稳定；开启后执行规则与模型双重审核、一次定向修正，并在仍不合格时使用安全模板。',
          }
        : {
            backupTitle: 'Local backup',
            backupDescription:
              'Export the current browser learning history, generated lessons, and local settings, or restore them from a backup file.',
            profileTitle: 'User profile',
            profileDescription:
              'Export student profile, learning profile, knowledge mastery, homework sessions, and evidence records.',
            exportProfile: 'Export profile',
            exportProfileSuccess: 'User profile exported',
            exportProfileFailed: 'Failed to export user profile',
            export: 'Export backup',
            import: 'Import backup',
            exportSuccess: 'Local backup exported',
            exportFailed: 'Failed to export local backup',
            importTitle: 'Import local backup',
            importDescription:
              'Importing will replace the current browser lesson data and local settings. The page will reload after completion.',
            importConfirm: 'Import backup',
            importSuccess: 'Local backup imported',
            importFailed: 'Failed to import local backup',
            chooseFileFirst: 'Choose a backup file first',
            generationTitle: 'Slide generation',
            layoutReviewLabel: 'High-quality layout review',
            layoutReviewDescription:
              'Off by default. Disabled mode uses experimental raw AI layout without quality guarantees. When enabled, rule and model reviews run, one targeted correction is allowed, and unsafe pages fall back to a stable template.',
          },
    [locale],
  );

  const handleClearCache = useCallback(async () => {
    if (!isConfirmValid) return;
    setClearing(true);
    try {
      await clearDatabase();
      localStorage.clear();
      sessionStorage.clear();
      toast.success(t('settings.clearCacheSuccess'));
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      log.error('Failed to clear cache:', error);
      toast.error(t('settings.clearCacheFailed'));
      setClearing(false);
    }
  }, [isConfirmValid, t]);

  const handleExportBackup = useCallback(async () => {
    setExporting(true);
    try {
      const { blob } = await exportLocalBackup();
      downloadBlob(blob, BACKUP_FILENAME);
      toast.success(copy.exportSuccess);
    } catch (error) {
      log.error('Failed to export local backup:', error);
      toast.error(copy.exportFailed);
    } finally {
      setExporting(false);
    }
  }, [copy.exportFailed, copy.exportSuccess]);

  const handleExportProfile = useCallback(async () => {
    setExportingProfile(true);
    try {
      const blob = await exportUserLearningProfileJson();
      downloadBlob(blob, USER_PROFILE_FILENAME);
      toast.success(copy.exportProfileSuccess);
    } catch (error) {
      log.error('Failed to export user profile:', error);
      toast.error(copy.exportProfileFailed);
    } finally {
      setExportingProfile(false);
    }
  }, [copy.exportProfileFailed, copy.exportProfileSuccess]);

  const handleImportFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setPendingImportFile(file);
    setShowImportDialog(Boolean(file));
    event.target.value = '';
  }, []);

  const handleImportBackup = useCallback(async () => {
    if (!pendingImportFile) {
      toast.error(copy.chooseFileFirst);
      return;
    }

    setImporting(true);
    try {
      await importLocalBackup(pendingImportFile);
      toast.success(copy.importSuccess);
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (error) {
      log.error('Failed to import local backup:', error);
      toast.error(copy.importFailed);
      setImporting(false);
      return;
    }

    setShowImportDialog(false);
    setPendingImportFile(null);
  }, [copy.chooseFileFirst, copy.importFailed, copy.importSuccess, pendingImportFile]);

  const clearCacheItems = t('settings.clearCacheConfirmItems')
    .split(/[,.，。]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-8">
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={handleImportFileChange}
      />

      <LocalRuntimeDiagnostics chinese={locale === 'zh-CN'} />
      <DesktopUpdateSettings />

      <div className="rounded-xl border border-border bg-card">
        <div className="p-4 space-y-4">
          <h3 className="text-sm font-semibold">{copy.generationTitle}</h3>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <Label htmlFor="slide-layout-review" className="text-sm font-medium">
                {copy.layoutReviewLabel}
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                {copy.layoutReviewDescription}
              </p>
            </div>
            <Switch
              id="slide-layout-review"
              checked={slideLayoutReviewEnabled}
              onCheckedChange={setSlideLayoutReviewEnabled}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary">
              <Database className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold">{copy.backupTitle}</h3>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{copy.backupTitle}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                {copy.backupDescription}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" disabled={exporting} onClick={handleExportBackup}>
                {exporting ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                )}
                {copy.export}
              </Button>
              <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                {importing ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                )}
                {copy.import}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary">
              <Download className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold">{copy.profileTitle}</h3>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{copy.profileTitle}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                {copy.profileDescription}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={exportingProfile}
              onClick={handleExportProfile}
            >
              {exportingProfile ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5 mr-1.5" />
              )}
              {copy.exportProfile}
            </Button>
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-destructive/30 bg-destructive/[0.03] dark:bg-destructive/[0.06]">
        <div
          className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: `repeating-linear-gradient(
              -45deg,
              transparent,
              transparent 10px,
              currentColor 10px,
              currentColor 11px
            )`,
          }}
        />

        <div className="relative p-4 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-destructive/10 text-destructive">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-destructive">{t('settings.dangerZone')}</h3>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{t('settings.clearCache')}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                {t('settings.clearCacheDescription')}
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setConfirmInput('');
                setShowClearDialog(true);
              }}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              {t('settings.clearCache')}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog
        open={showImportDialog}
        onOpenChange={(open) => {
          if (!importing) {
            setShowImportDialog(open);
            if (!open) {
              setPendingImportFile(null);
            }
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.importTitle}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">{copy.importDescription}</span>
              {pendingImportFile ? (
                <span className="block text-foreground">{pendingImportFile.name}</span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing}>{t('common.cancel')}</AlertDialogCancel>
            <Button disabled={importing} onClick={handleImportBackup}>
              {importing ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-1.5" />
              )}
              {copy.importConfirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showClearDialog}
        onOpenChange={(open) => {
          if (!clearing) {
            setShowClearDialog(open);
            if (!open) setConfirmInput('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              {t('settings.clearCacheConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{t('settings.clearCacheConfirmDescription')}</p>
                <ul className="ml-1 space-y-1.5">
                  {clearCacheItems.map((item, index) => (
                    <li key={index} className="flex items-center gap-2 text-sm">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive/60" />
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="pt-1">
                  <Label className="text-xs font-medium text-foreground">
                    {t('settings.clearCacheConfirmInput')}
                  </Label>
                  <Input
                    className="mt-1.5 h-9 text-sm"
                    placeholder={confirmPhrase}
                    value={confirmInput}
                    onChange={(event) => setConfirmInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && isConfirmValid) {
                        handleClearCache();
                      }
                    }}
                    autoFocus
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>{t('common.cancel')}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={!isConfirmValid || clearing}
              onClick={handleClearCache}
            >
              {clearing ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-1.5" />
              )}
              {t('settings.clearCacheButton')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
