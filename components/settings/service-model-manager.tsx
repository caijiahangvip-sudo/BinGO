'use client';

import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle, Loader2, Plus, Settings2, Trash2, XCircle } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import {
  getAbortErrorMessage,
  LOCAL_SERVICE_TEST_STARTUP_TIMEOUT_MS,
  SETTINGS_CONNECTION_TEST_TIMEOUT_MS,
  isAbortError,
  type SettingsTestOptions,
} from './utils';

export interface ServiceModelInfo {
  id: string;
  name: string;
}

interface ServiceModelManagerProps {
  models: ServiceModelInfo[];
  onModelsChange: (models: ServiceModelInfo[]) => void;
  onSelectedModelChange?: (modelId: string) => void;
  onTestModel?: (
    model: ServiceModelInfo,
    options?: SettingsTestOptions,
  ) => Promise<{ success: boolean; message: string }>;
  testDisabled?: boolean;
  isTestDisabled?: (model: ServiceModelInfo) => boolean;
}

export function ServiceModelManager({
  models,
  onModelsChange,
  onSelectedModelChange,
  onTestModel,
  testDisabled,
  isTestDisabled,
}: ServiceModelManagerProps) {
  const { t } = useI18n();
  const [showModelDialog, setShowModelDialog] = useState(false);
  const [editingModelIndex, setEditingModelIndex] = useState<number | null>(null);
  const [modelForm, setModelForm] = useState<ServiceModelInfo>({ id: '', name: '' });
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const handleOpenAddModel = () => {
    setEditingModelIndex(null);
    setModelForm({ id: '', name: '' });
    setTestStatus('idle');
    setTestMessage('');
    setShowModelDialog(true);
  };

  const handleOpenEditModel = (index: number) => {
    setEditingModelIndex(index);
    setModelForm({ ...models[index] });
    setTestStatus('idle');
    setTestMessage('');
    setShowModelDialog(true);
  };

  const handleModelIdChange = (newId: string) => {
    setTestStatus('idle');
    setTestMessage('');
    setModelForm((prev) => {
      const shouldSyncName = !prev.name || prev.name === prev.id;
      return {
        id: newId,
        name: shouldSyncName ? newId : prev.name,
      };
    });
  };

  const handleSaveModel = useCallback(() => {
    const modelId = modelForm.id.trim();
    if (!modelId) return;

    const savedModel = {
      id: modelId,
      name: modelForm.name.trim() || modelId,
    };
    const newModels = [...models];

    if (editingModelIndex !== null) {
      newModels[editingModelIndex] = savedModel;
    } else {
      newModels.push(savedModel);
    }

    onModelsChange(newModels);
    onSelectedModelChange?.(savedModel.id);
    setShowModelDialog(false);
  }, [editingModelIndex, modelForm, models, onModelsChange, onSelectedModelChange]);

  const handleDeleteModel = (index: number) => {
    const removedModel = models[index];
    const newModels = models.filter((_, modelIndex) => modelIndex !== index);
    onModelsChange(newModels);

    if (removedModel) {
      onSelectedModelChange?.(newModels[0]?.id || '');
    }
  };

  const handleTestModel = useCallback(async () => {
    const modelId = modelForm.id.trim();
    if (!modelId || !onTestModel) return;
    const model = {
      id: modelId,
      name: modelForm.name.trim() || modelId,
    };
    if (testDisabled || isTestDisabled?.(model)) return;

    setTestStatus('testing');
    setTestMessage('');
    const controller = new AbortController();
    let timeoutId: number | undefined;

    try {
      const result = await Promise.race([
        onTestModel(model, {
          signal: controller.signal,
          localServiceStartupTimeoutMs: LOCAL_SERVICE_TEST_STARTUP_TIMEOUT_MS,
        }),
        new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            controller.abort();
            reject(new DOMException('Connection test timed out', 'AbortError'));
          }, SETTINGS_CONNECTION_TEST_TIMEOUT_MS);
        }),
      ]);
      setTestStatus(result.success ? 'success' : 'error');
      setTestMessage(result.message || t(result.success ? 'settings.connectionSuccess' : 'settings.connectionFailed'));
    } catch (error) {
      setTestStatus('error');
      setTestMessage(
        isAbortError(error)
          ? getAbortErrorMessage(t)
          : error instanceof Error
            ? error.message
            : String(error),
      );
    } finally {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    }
  }, [isTestDisabled, modelForm, onTestModel, t, testDisabled]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Label className="text-base">{t('settings.models')}</Label>
        <Button variant="outline" size="sm" onClick={handleOpenAddModel} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          {t('settings.addNewModel')}
        </Button>
      </div>

      <div className="space-y-1.5">
        {models.map((model, index) => (
          <div
            key={`${model.id}-${index}`}
            className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card"
          >
            <div className="flex-1 min-w-0">
              <div className="font-mono text-sm font-medium">{model.name}</div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5">{model.id}</div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={() => handleOpenEditModel(index)}
                title={t('settings.editModel')}
              >
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => handleDeleteModel(index)}
                title={t('settings.deleteModel')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={showModelDialog} onOpenChange={setShowModelDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogTitle className="sr-only">
            {editingModelIndex === null ? t('settings.addNewModel') : t('settings.editModel')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editingModelIndex === null
              ? t('settings.addNewModelDescription')
              : t('settings.editModelDescription')}
          </DialogDescription>
          <div className="space-y-4">
            <div className="pb-3 border-b">
              <h2 className="text-lg font-semibold">
                {editingModelIndex === null ? t('settings.addNewModel') : t('settings.editModel')}
              </h2>
            </div>

            <div className="space-y-2">
              <Label>{t('settings.modelId')}</Label>
              <Input
                placeholder={t('settings.modelIdPlaceholder')}
                value={modelForm.id}
                onChange={(event) => handleModelIdChange(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('settings.modelName')}</Label>
              <Input
                placeholder={t('settings.modelNamePlaceholder')}
                value={modelForm.name}
                onChange={(event) =>
                  setModelForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>

            {onTestModel && (
              <div className="space-y-3 pt-3 border-t">
                <div className="flex items-center justify-between">
                  <Label className="text-base">{t('settings.testModel')}</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestModel}
                    disabled={
                      !modelForm.id.trim() ||
                      testDisabled ||
                      isTestDisabled?.({
                        id: modelForm.id.trim(),
                        name: modelForm.name.trim() || modelForm.id.trim(),
                      }) ||
                      testStatus === 'testing'
                    }
                    className={cn(
                      testStatus === 'success' &&
                        'border-green-600 text-green-600 hover:bg-green-50',
                      testStatus === 'error' && 'border-red-600 text-red-600 hover:bg-red-50',
                    )}
                  >
                    {testStatus === 'testing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {testStatus === 'success' && <CheckCircle className="mr-2 h-4 w-4" />}
                    {testStatus === 'error' && <XCircle className="mr-2 h-4 w-4" />}
                    {testStatus === 'testing'
                      ? t('settings.testing')
                      : t('settings.testConnection')}
                  </Button>
                </div>
                {testMessage && (
                  <div
                    className={cn(
                      'rounded-lg p-3 text-sm',
                      testStatus === 'success' &&
                        'bg-green-50 text-green-700 border border-green-200',
                      testStatus === 'error' && 'bg-red-50 text-red-700 border border-red-200',
                    )}
                  >
                    <div className="flex items-start gap-2 flex-wrap">
                      {testStatus === 'success' && (
                        <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      )}
                      {testStatus === 'error' && <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                      <p className="flex-1 break-words">{testMessage}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t">
              <Button variant="outline" size="sm" onClick={() => setShowModelDialog(false)}>
                {t('settings.cancelEdit')}
              </Button>
              <Button size="sm" onClick={handleSaveModel} disabled={!modelForm.id.trim()}>
                {t('settings.saveModel')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
