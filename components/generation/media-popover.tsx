'use client';

import { useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight, Mic, SlidersHorizontal, Volume2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { ASR_PROVIDERS, getASRSupportedLanguages } from '@/lib/audio/constants';
import type { ASRProviderId } from '@/lib/audio/types';
import type { SettingsSection } from '@/lib/types/settings';

interface MediaPopoverProps {
  onSettingsOpen: (section: SettingsSection) => void;
}

type TabId = 'tts' | 'asr';

interface SelectGroupData {
  groupId: string;
  groupName: string;
  groupIcon?: string;
  items: Array<{ id: string; name: string }>;
}

const TABS: Array<{ id: TabId; icon: LucideIcon; label: string }> = [
  { id: 'tts', icon: Volume2, label: 'TTS' },
  { id: 'asr', icon: Mic, label: 'ASR' },
];

export function MediaPopover({ onSettingsOpen }: MediaPopoverProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('tts');

  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const asrEnabled = useSettingsStore((s) => s.asrEnabled);
  const setTTSEnabled = useSettingsStore((s) => s.setTTSEnabled);
  const setASREnabled = useSettingsStore((s) => s.setASREnabled);

  const asrProviderId = useSettingsStore((s) => s.asrProviderId);
  const asrLanguage = useSettingsStore((s) => s.asrLanguage);
  const asrProvidersConfig = useSettingsStore((s) => s.asrProvidersConfig);
  const setASRProvider = useSettingsStore((s) => s.setASRProvider);
  const setASRLanguage = useSettingsStore((s) => s.setASRLanguage);

  const enabledMap: Record<TabId, boolean> = {
    tts: ttsEnabled,
    asr: asrEnabled,
  };
  const enabledCount = [ttsEnabled, asrEnabled].filter(Boolean).length;

  const cfgOk = (
    configs: Record<string, { apiKey?: string; isServerConfigured?: boolean }>,
    id: string,
    needsKey: boolean,
  ) => !needsKey || !!configs[id]?.apiKey || !!configs[id]?.isServerConfigured;

  const asrGroups = useMemo(
    () =>
      Object.entries(asrProvidersConfig)
        .map(([id, config]): SelectGroupData | null => {
          const compatibleProviderId = config.compatibleProviderId || id;
          const provider = ASR_PROVIDERS[compatibleProviderId] || ASR_PROVIDERS[id];
          if (!provider) return null;
          const requiresApiKey = config.requiresApiKey ?? provider.requiresApiKey;
          if (!cfgOk(asrProvidersConfig, id, requiresApiKey)) return null;
          return {
            groupId: id,
            groupName: config.name || provider.name,
            groupIcon: config.icon || provider.icon,
            items: getASRSupportedLanguages(compatibleProviderId).map((language) => ({
              id: language,
              name: language,
            })),
          };
        })
        .filter((group): group is SelectGroupData => !!group && group.items.length > 0),
    [asrProvidersConfig],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setActiveTab(ttsEnabled ? 'tts' : asrEnabled ? 'asr' : 'tts');
    }
    setOpen(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-all cursor-pointer select-none whitespace-nowrap',
            enabledCount > 0
              ? 'bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-500/15 dark:text-violet-200 dark:hover:bg-violet-500/20'
              : 'text-slate-500/80 hover:text-slate-700 hover:bg-slate-100/80 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-white/10',
          )}
        >
          <SlidersHorizontal className="size-3.5" />
          {ttsEnabled && <Volume2 className="size-3.5" />}
          {asrEnabled && <Mic className="size-3.5" />}
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" side="bottom" avoidCollisions={false} className="w-80 p-0">
        <div className="p-2 pb-0">
          <div className="flex gap-0.5 p-0.5 bg-muted/60 rounded-lg">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const isEnabled = enabledMap[tab.id];
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-all relative',
                    isActive
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground/80',
                  )}
                >
                  <Icon className="size-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {isEnabled && !isActive && (
                    <span className="absolute top-1 right-1 size-1.5 rounded-full bg-violet-500" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-3 pt-2.5">
          {activeTab === 'tts' && (
            <TabPanel
              icon={Volume2}
              label={t('media.ttsCapability')}
              enabled={ttsEnabled}
              onToggle={setTTSEnabled}
            >
              <p className="text-[11px] text-muted-foreground/60">
                {t('settings.ttsVoiceConfigHint')}
              </p>
            </TabPanel>
          )}

          {activeTab === 'asr' && (
            <TabPanel
              icon={Mic}
              label={t('media.asrCapability')}
              enabled={asrEnabled}
              onToggle={setASREnabled}
            >
              <GroupedSelect
                groups={asrGroups}
                selectedGroupId={asrProviderId}
                selectedItemId={asrLanguage}
                onSelect={(groupId, itemId) => {
                  setASRProvider(groupId as ASRProviderId);
                  setASRLanguage(itemId);
                }}
              />
            </TabPanel>
          )}
        </div>

        <div className="border-t border-border/40">
          <button
            onClick={() => {
              setOpen(false);
              onSettingsOpen(activeTab);
            }}
            className="w-full flex items-center justify-between px-3.5 py-2.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            <span>{t('toolbar.advancedSettings')}</span>
            <ChevronRight className="size-3" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TabPanel({
  icon: Icon,
  label,
  enabled,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  label: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2.5">
        <Icon
          className={cn(
            'size-4 shrink-0 transition-colors',
            enabled ? 'text-violet-600 dark:text-violet-400' : 'text-muted-foreground/50',
          )}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{label}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </div>
      {enabled && children && <div className="pt-1">{children}</div>}
    </div>
  );
}

function GroupedSelect({
  groups,
  selectedGroupId,
  selectedItemId,
  onSelect,
}: {
  groups: SelectGroupData[];
  selectedGroupId: string;
  selectedItemId: string;
  onSelect: (groupId: string, itemId: string) => void;
}) {
  const selectedValue = `${selectedGroupId}::${selectedItemId}`;

  return (
    <Select
      value={selectedValue}
      onValueChange={(value) => {
        const [groupId, itemId] = value.split('::');
        if (groupId && itemId) onSelect(groupId, itemId);
      }}
    >
      <SelectTrigger className="h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups.length === 0 ? (
          <SelectItem value="__none" disabled>
            No available providers
          </SelectItem>
        ) : (
          groups.map((group, groupIndex) => (
            <div key={group.groupId}>
              {groupIndex > 0 && <SelectSeparator />}
              <SelectGroup>
                <SelectLabel className="flex items-center gap-1.5 text-[11px]">
                  {group.groupIcon && (
                    <img src={group.groupIcon} alt="" className="h-3.5 w-3.5 rounded-sm" />
                  )}
                  {group.groupName}
                </SelectLabel>
                {group.items.map((item) => (
                  <SelectItem
                    key={`${group.groupId}-${item.id}`}
                    value={`${group.groupId}::${item.id}`}
                  >
                    {item.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </div>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
