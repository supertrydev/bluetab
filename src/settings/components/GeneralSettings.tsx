import { AlertTriangle, Archive, Globe, Link, MousePointer, Rocket, StickyNote } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ToastManager } from '@/components/Toast';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AUTO_ARCHIVE_DAY_OPTIONS, resolveAutoArchiveDays } from '@/config/auto-archive';
import { applyLanguagePreference, getLocaleTag, setTimeFormatPreference, type LanguagePreference } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import { formatTime } from '@/i18n/format';
import { Storage } from '@/utils/storage';
import type { Settings } from '@/types/models';
import { useSettingsUpdater, type SettingsSectionProps } from '../hooks/useSettingsUpdater';

/** 13:30 sample used to preview each time format option. */
const TIME_FORMAT_SAMPLE = new Date(2000, 0, 1, 13, 30);

export function GeneralSettings({ settings, onSettingsChange }: SettingsSectionProps) {
    const { t } = useTranslation();
    const { saveSettings, updateSetting } = useSettingsUpdater({ settings, onSettingsChange });

    const updateAutoArchive = async (
        change: Pick<Settings, 'autoArchiveInactiveGroups'> | Pick<Settings, 'autoArchiveInactiveDays'>,
    ) => {
        const next: Settings = { ...settings, ...change };
        const enabled = next.autoArchiveInactiveGroups === true;
        // Turning it on or changing the days restarts the countdown, so a
        // shorter window never archives a batch of groups at once.
        const restartCountdown = enabled && (
            settings.autoArchiveInactiveGroups !== true
            || resolveAutoArchiveDays(next.autoArchiveInactiveDays) !== resolveAutoArchiveDays(settings.autoArchiveInactiveDays)
        );
        await saveSettings({
            ...next,
            autoArchiveEnabledAt: restartCountdown ? Date.now() : settings.autoArchiveEnabledAt,
        });
    };

    const handleLanguageChange = async (value: LanguagePreference) => {
        const updatedSettings = { ...settings, language: value };
        try {
            await Storage.set('settings', updatedSettings);
            onSettingsChange(updatedSettings);
            await applyLanguagePreference(value);
            ToastManager.getInstance().success({ key: 'language.updated' });
        } catch (error) {
            ToastManager.getInstance().error({
                key: 'feedback.settingSaveFailed',
                values: { message: isolateBidi((error as Error).message) },
            });
        }
    };

    return (
        <div className="space-y-8">
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <Globe className="w-5 h-5" />
                    {t('language.title')}
                </h3>

                <div className="rounded-md bg-muted p-4 space-y-3">
                    <div>
                        <p className="text-sm font-medium text-text-strong">
                            {t('settings.general.languageTitle')}
                        </p>
                        <p className="text-xs text-text-muted mt-1">
                            {t('settings.general.languageDescription')}
                        </p>
                    </div>

                    <Select
                        value={settings.language || 'system'}
                        onValueChange={(value) => handleLanguageChange(value as LanguagePreference)}
                    >
                        <SelectTrigger className="w-full sm:w-64">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="system">{t('common.browserDefault')}</SelectItem>
                            <SelectItem value="en">{t('common.english')}</SelectItem>
                            <SelectItem value="tr">{t('common.turkish')}</SelectItem>
                            <SelectItem value="es">{t('common.spanish')}</SelectItem>
                            <SelectItem value="pt-BR">{t('common.brazilianPortuguese')}</SelectItem>
                            <SelectItem value="id">{t('common.indonesian')}</SelectItem>
                            <SelectItem value="ar">{t('common.arabic')}</SelectItem>
                        </SelectContent>
                    </Select>

                    <div className="pt-2">
                        <p className="text-sm font-medium text-text-strong">
                            {t('settings.general.timeFormat.title')}
                        </p>
                        <p className="text-xs text-text-muted mt-1">
                            {t('settings.general.timeFormat.description')}
                        </p>
                    </div>

                    <Select
                        value={settings.timeFormat ?? 'system'}
                        onValueChange={(value) => {
                            // Applied right away in this page; other pages follow via the storage listener.
                            setTimeFormatPreference(value);
                            void updateSetting('timeFormat', value as Settings['timeFormat']);
                        }}
                    >
                        <SelectTrigger className="w-full sm:w-64" aria-label={t('settings.general.timeFormat.title')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="system">
                                {t('settings.general.timeFormat.system', { example: new Intl.DateTimeFormat(getLocaleTag(), { hour: 'numeric', minute: '2-digit' }).format(TIME_FORMAT_SAMPLE) })}
                            </SelectItem>
                            <SelectItem value="12h">
                                {t('settings.general.timeFormat.twelve', { example: formatTime(TIME_FORMAT_SAMPLE, { hour: 'numeric', minute: '2-digit', hour12: true }) })}
                            </SelectItem>
                            <SelectItem value="24h">
                                {t('settings.general.timeFormat.twentyFour', { example: formatTime(TIME_FORMAT_SAMPLE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) })}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Startup Behavior Settings */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <Rocket className="w-5 h-5" />
                    {t('settings.general.startupBehavior.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-text-strong mb-3 block">
                            {t('settings.general.startupBehavior.description')}
                        </label>
                        <RadioGroup
                            value={settings.startupBehavior}
                            onValueChange={(value) => updateSetting('startupBehavior', value as 'show' | 'manual')}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="show" id="startup-show" className="mt-0.5" />
                                <Label htmlFor="startup-show" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.startupBehavior.options.show.title')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="manual" id="startup-manual" className="mt-0.5" />
                                <Label htmlFor="startup-manual" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.startupBehavior.options.manual.title')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.startupBehavior.options.manual.description')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>

            {/* Custom New Tab Page Settings */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <Globe className="w-5 h-5" />
                    {t('settings.general.customNewTab.title')}
                </h3>

                <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-md border border-border bg-bg-1">
                        <div className="flex-1">
                            <label className="text-sm font-medium text-text-strong block">
                                {t('settings.general.customNewTab.enableLabel')}
                            </label>
                            <p className="text-xs text-text-muted mt-1">
                                {t('settings.general.customNewTab.enableDescription')}
                            </p>
                        </div>
                        <Switch
                            checked={settings.customNewTabEnabled || false}
                            onCheckedChange={(checked) => updateSetting(
                                'customNewTabEnabled',
                                checked,
                                checked
                                    ? t('settings.general.customNewTab.enabled')
                                    : t('settings.general.customNewTab.disabled'),
                            )}
                        />
                    </div>
                </div>
            </div>

            {/* Context Menu Settings */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <MousePointer className="w-5 h-5" />
                    {t('settings.general.contextMenu.title')}
                </h3>

                <div className="space-y-4">
                    <div className="p-4 rounded-md bg-muted">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex-1">
                                <label className="text-sm font-medium text-text-strong block">
                                    {t('settings.general.contextMenu.groupLimitLabel')}
                                </label>
                                <p className="text-xs text-text-muted mt-1">
                                    {t('settings.general.contextMenu.groupLimitDescription')}
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                                <span dir="ltr" className="text-lg font-semibold text-primary min-w-[40px] text-end">
                                    {settings.contextMenuGroupLimit || 25}
                                </span>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <input
                                type="range"
                                dir="ltr"
                                min="5"
                                max="50"
                                step="5"
                                value={settings.contextMenuGroupLimit || 25}
                                onChange={(e) => {
                                    const count = parseInt(e.target.value, 10);
                                    void updateSetting(
                                        'contextMenuGroupLimit',
                                        count,
                                        t('settings.general.contextMenu.groupLimitUpdated', { count }),
                                    );
                                }}
                                className="settings-range w-full"
                            />
                            <div dir="ltr" className="flex justify-between text-xs text-text-muted">
                                <span>5</span>
                                <span>25</span>
                                <span>50</span>
                            </div>
                        </div>
                        {(settings.contextMenuGroupLimit || 25) > 30 && (
                            <div className="mt-3 p-3 bg-warning-muted border-warning/30 rounded-lg flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-warning">
                                    {t('settings.general.contextMenu.performanceWarning')}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Tab URL Display */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <Link className="w-5 h-5" />
                    {t('settings.general.tabUrlDisplay.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-text-strong mb-3 block">
                            {t('settings.general.tabUrlDisplay.description')}
                        </label>
                        <RadioGroup
                            value={settings.tabUrlDisplay ?? 'full'}
                            onValueChange={(value) => updateSetting('tabUrlDisplay', value as 'full' | 'hostname')}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="hostname" id="tab-url-hostname" className="mt-0.5" />
                                <Label htmlFor="tab-url-hostname" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.tabUrlDisplay.options.hostname.title')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.tabUrlDisplay.options.hostname.description')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="full" id="tab-url-full" className="mt-0.5" />
                                <Label htmlFor="tab-url-full" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.tabUrlDisplay.options.full.title')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.tabUrlDisplay.options.full.description')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>

            {/* Group Notes Display */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <StickyNote className="w-5 h-5" />
                    {t('settings.general.groupNotesDisplay.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-text-strong mb-3 block">
                            {t('settings.general.groupNotesDisplay.description')}
                        </label>
                        <RadioGroup
                            value={settings.groupNotesDisplay ?? 'preview'}
                            onValueChange={(value) => updateSetting('groupNotesDisplay', value as 'full' | 'preview')}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="preview" id="notes-preview" className="mt-0.5" />
                                <Label htmlFor="notes-preview" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.groupNotesDisplay.options.preview.title')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.groupNotesDisplay.options.preview.description')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="full" id="notes-full" className="mt-0.5" />
                                <Label htmlFor="notes-full" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.groupNotesDisplay.options.full.title')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.groupNotesDisplay.options.full.description')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>

            {/* Auto-archive Settings */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <Archive className="w-5 h-5" />
                    {t('settings.general.autoArchive.title')}
                </h3>

                <div className="space-y-3 p-3 rounded-md border border-border bg-bg-1">
                    <div className="flex items-start gap-3">
                        <Switch
                            id="auto-archive-inactive"
                            checked={settings.autoArchiveInactiveGroups ?? false}
                            onCheckedChange={(checked) => { void updateAutoArchive({ autoArchiveInactiveGroups: checked }); }}
                        />
                        <Label htmlFor="auto-archive-inactive" className="flex-1 cursor-pointer space-y-1">
                            <div className="text-sm font-medium text-text-strong">
                                {t('settings.general.autoArchive.label')}
                            </div>
                            <div className="text-xs text-text-muted">
                                {t('settings.general.autoArchive.description')}
                            </div>
                        </Label>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 ps-12">
                        <Label htmlFor="auto-archive-days" className="text-sm text-text-strong">
                            {t('settings.general.autoArchive.daysLabel')}
                        </Label>
                        <Select
                            value={String(resolveAutoArchiveDays(settings.autoArchiveInactiveDays))}
                            onValueChange={(value) => { void updateAutoArchive({ autoArchiveInactiveDays: Number(value) }); }}
                            disabled={!settings.autoArchiveInactiveGroups}
                        >
                            <SelectTrigger id="auto-archive-days" className="w-36">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {AUTO_ARCHIVE_DAY_OPTIONS.map((days) => (
                                    <SelectItem key={days} value={String(days)}>
                                        {t('settings.general.autoArchive.days', { count: days })}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>
        </div>
    );
}
