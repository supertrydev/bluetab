import { useTranslation } from 'react-i18next';
import { AppWindow, Copy, Layers, Pin, Save, Undo2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { useSettingsUpdater, type SettingsSectionProps } from '../hooks/useSettingsUpdater';

export function TabBehaviorSettings(props: SettingsSectionProps) {
    const { settings } = props;
    const { t } = useTranslation();
    const { updateSetting } = useSettingsUpdater(props);

    return (
        <div className="space-y-8">
            {/* Tab Restore Settings */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <AppWindow className="w-5 h-5" />
                    {t('settings.general.tabRestoration.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-text-strong mb-3 block">
                            {t('settings.general.tabRestoration.description')}
                        </label>
                        <RadioGroup
                            value={settings.restoreMode}
                            onValueChange={(value) => updateSetting('restoreMode', value as 'smart' | 'newWindow' | 'currentWindow')}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="smart" id="restore-smart" className="mt-0.5" />
                                <Label htmlFor="restore-smart" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.tabRestoration.options.smart.title')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.tabRestoration.options.smart.description')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="newWindow" id="restore-new" className="mt-0.5" />
                                <Label htmlFor="restore-new" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.tabRestoration.options.newWindow.title')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.tabRestoration.options.newWindow.description')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="currentWindow" id="restore-current" className="mt-0.5" />
                                <Label htmlFor="restore-current" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.tabRestoration.options.currentWindow.title')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.tabRestoration.options.currentWindow.description')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>

            {/* Tab Group Restore Mode */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <Layers className="w-5 h-5" />
                    {t('settings.general.tabGroupRestoreMode.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-text-strong mb-3 block">
                            {t('settings.general.tabGroupRestoreMode.description')}
                        </label>
                        <RadioGroup
                            value={settings.tabGroupRestoreMode || 'normal'}
                            onValueChange={(value) => updateSetting(
                                'tabGroupRestoreMode',
                                value as 'normal' | 'browserGroups',
                                t('settings.general.tabGroupRestoreMode.updated'),
                            )}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="normal" id="tab-group-normal" className="mt-0.5" />
                                <Label htmlFor="tab-group-normal" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.tabGroupRestoreMode.options.normal.title')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.tabGroupRestoreMode.options.normal.description')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="browserGroups" id="tab-group-browser" className="mt-0.5" />
                                <Label htmlFor="tab-group-browser" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.tabGroupRestoreMode.options.browserGroups.title')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.tabGroupRestoreMode.options.browserGroups.description')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>

            {/* Pinned Tabs Settings */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <Pin className="w-5 h-5" />
                    {t('settings.general.pinnedTabs.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-text-strong mb-3 block">
                            {t('settings.general.pinnedTabs.description')}
                        </label>
                        <RadioGroup
                            value={settings.pinnedTabsMode}
                            onValueChange={(value) => updateSetting('pinnedTabsMode', value as 'exclude' | 'include')}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="exclude" id="pinned-exclude" className="mt-0.5" />
                                <Label htmlFor="pinned-exclude" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.pinnedTabs.options.exclude.title')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.pinnedTabs.options.exclude.description')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="include" id="pinned-include" className="mt-0.5" />
                                <Label htmlFor="pinned-include" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.pinnedTabs.options.include.title')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.pinnedTabs.options.include.description')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>

            {/* Tab Restore Behavior Settings */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <Undo2 className="w-5 h-5" />
                    {t('settings.general.restoreBehavior.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-text-strong mb-3 block">
                            {t('settings.general.restoreBehavior.description')}
                        </label>
                        <RadioGroup
                            value={settings.restoreBehavior}
                            onValueChange={(value) => updateSetting('restoreBehavior', value as 'removeFromList' | 'keepInList')}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="removeFromList" id="behavior-remove" className="mt-0.5" />
                                <Label htmlFor="behavior-remove" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.restoreBehavior.options.removeFromList.title')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.restoreBehavior.options.removeFromList.description')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="keepInList" id="behavior-keep" className="mt-0.5" />
                                <Label htmlFor="behavior-keep" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.restoreBehavior.options.keepInList.title')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.restoreBehavior.options.keepInList.description')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>

            {/* Save Behavior Settings */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <Save className="w-5 h-5" />
                    {t('settings.general.saveBehavior.title')}
                </h3>

                <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 rounded-md border border-border bg-bg-1">
                        <Switch
                            id="open-manager-after-save"
                            checked={settings.openManagerAfterSave ?? true}
                            onCheckedChange={(checked) => updateSetting('openManagerAfterSave', checked)}
                        />
                        <Label htmlFor="open-manager-after-save" className="flex-1 cursor-pointer space-y-1">
                            <div className="text-sm font-medium text-text-strong">
                                {t('settings.general.saveBehavior.openAfterSaveLabel')}
                            </div>
                            <div className="text-xs text-text-muted">
                                {t('settings.general.saveBehavior.openAfterSaveDescription')}
                            </div>
                        </Label>
                    </div>
                </div>
            </div>

            {/* Duplicate Handling Settings */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <Copy className="w-5 h-5" />
                    {t('settings.general.duplicates.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-text-strong mb-3 block">
                            {t('settings.general.duplicates.handlingLabel')}
                        </label>
                        <RadioGroup
                            value={settings.duplicateHandling}
                            onValueChange={(value) => updateSetting('duplicateHandling', value as 'allow' | 'reject')}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="allow" id="duplicate-allow" className="mt-0.5" />
                                <Label htmlFor="duplicate-allow" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.duplicates.allow')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-4 rounded-md bg-muted transition-colors has-[[data-state=checked]]:bg-primary-muted">
                                <RadioGroupItem value="reject" id="duplicate-reject" className="mt-0.5" />
                                <Label htmlFor="duplicate-reject" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.duplicates.reject')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.duplicates.rejectDescription')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>
        </div>
    );
}
