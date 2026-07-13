'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/lib/hooks/use-i18n';
import { Plus } from 'lucide-react';

export interface ServiceProviderOption {
  id: string;
  name: string;
  icon?: string;
}

export interface NewServiceProviderData {
  name: string;
  baseUrl: string;
  icon: string;
  requiresApiKey: boolean;
  compatibleProviderId: string;
}

interface AddServiceProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compatibleProviders: ServiceProviderOption[];
  onAddCustom: (provider: NewServiceProviderData) => void;
}

export function AddServiceProviderDialog({
  open,
  onOpenChange,
  compatibleProviders,
  onAddCustom,
}: AddServiceProviderDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [icon, setIcon] = useState('');
  const [requiresApiKey, setRequiresApiKey] = useState(true);
  const selectedCompatibleProviderId = compatibleProviders[0]?.id || '';

  const resetForm = () => {
    setName('');
    setBaseUrl('');
    setIcon('');
    setRequiresApiKey(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const handleAddCustom = () => {
    onAddCustom({
      name,
      baseUrl,
      icon,
      requiresApiKey,
      compatibleProviderId: selectedCompatibleProviderId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogTitle>{t('settings.addServiceProviderDialog')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('settings.addServiceProviderDescription')}
        </DialogDescription>

        <div className="space-y-5 pt-1">
          <div className="space-y-4">
            <Label className="text-sm">{t('settings.addCustomProvider')}</Label>

            <div className="space-y-2">
              <Label>{t('settings.providerName')}</Label>
              <Input
                placeholder={t('settings.providerNamePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('settings.defaultBaseUrl')}</Label>
              <Input
                type="url"
                placeholder="https://api.example.com"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('settings.providerIcon')}</Label>
              <Input
                type="url"
                placeholder="https://example.com/icon.svg"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="service-provider-requires-api-key"
                checked={requiresApiKey}
                onCheckedChange={(checked) => setRequiresApiKey(checked as boolean)}
              />
              <label htmlFor="service-provider-requires-api-key" className="text-sm cursor-pointer">
                {t('settings.requiresApiKey')}
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
              {t('settings.cancelEdit')}
            </Button>
            <Button
              size="sm"
              onClick={handleAddCustom}
              disabled={!name.trim() || !selectedCompatibleProviderId}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('settings.addProviderButton')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
