import { useState, useEffect, useCallback } from 'react';
import { Archive, Lock, Lightbulb, Loader2, AlertCircle, AlertTriangle } from 'lucide-react';
import { ModalWrapper } from './ModalWrapper';
import { PasswordInput } from '../common/PasswordInput';
import { ArchivedGroup, RestoreOptions } from '../../../types/archive';
import { TabGroup } from '../../../types/models';
import { getLocaleTag } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import { useTranslation } from 'react-i18next';

interface RestoreModalProps {
    isOpen: boolean;
    onClose: () => void;
    onRestore: (options: RestoreOptions) => Promise<void>;
    archive: ArchivedGroup | null;
}

interface PreviewData {
    groupName: string;
    tabCount: number;
    tabs: Array<{
        title: string;
        url: string;
        favicon?: string;
    }>;
    duplicateWarnings: Array<{
        title: string;
        url: string;
        reason: string;
    }>;
}

export function RestoreModal({
    isOpen,
    onClose,
    onRestore,
    archive
}: RestoreModalProps) {
    const { t } = useTranslation();
    const [password, setPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [conflictStrategy, setConflictStrategy] = useState<RestoreOptions['handleConflicts']>('skip');
    const [restoreToActive, setRestoreToActive] = useState(true);
    const [isRestoring, setIsRestoring] = useState(false);
    const [previewData, setPreviewData] = useState<PreviewData | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [previewError, setPreviewError] = useState('');

    const loadPreview = useCallback(async () => {
        if (!archive) return;

        setIsLoadingPreview(true);
        setPreviewError('');

        try {
            // Handle password-protected archives
            if (archive.protection.passwordProtected && typeof archive.originalGroup === 'string') {
                // For password-protected archives, we can't show preview without password
                setPreviewData({
                    groupName: t('popup.restoreModal.protectedArchiveName'),
                    tabCount: 0,
                    tabs: [],
                    duplicateWarnings: []
                });
                return;
            }

            // For unprotected archives, extract preview data
            if (typeof archive.originalGroup === 'object') {
                const group = archive.originalGroup as TabGroup;

                // TODO: Replace with actual duplicate detection service
                // const restorationService = new RestorationService();
                // const duplicates = await restorationService.checkForDuplicates(group.tabs);

                setPreviewData({
                    groupName: group.name,
                    tabCount: group.tabs.length,
                    tabs: group.tabs.slice(0, 20), // Show first 20 tabs
                    duplicateWarnings: [] // Mock: no duplicates for now
                });
            }
        } catch (error) {
            setPreviewError(error instanceof Error ? error.message : t('popup.restoreModal.errors.loadPreview'));
        } finally {
            setIsLoadingPreview(false);
        }
    }, [archive, t]);

    // Reset form when modal opens/closes or archive changes
    useEffect(() => {
        if (isOpen && archive) {
            setPassword('');
            setPasswordError('');
            setConflictStrategy('skip');
            setRestoreToActive(true);
            setIsRestoring(false);
            setPreviewData(null);
            setPreviewError('');
            void loadPreview();
        }
    }, [isOpen, archive, loadPreview]);

    const loadPreviewWithPassword = async () => {
        if (!archive || !password) return;

        setIsLoadingPreview(true);
        setPasswordError('');
        setPreviewError('');

        try {
            // TODO: Replace with actual decryption service
            // const restorationService = new RestorationService();
            // const decryptedGroup = await restorationService.decryptArchive(archive, password);

            // Mock successful decryption
            setPreviewData({
                groupName: t('popup.restoreModal.decryptedArchiveName'),
                tabCount: 5, // Mock count
                tabs: [
                    { title: t('components.restoreModal.exampleTab1'), url: 'https://example.com/1', favicon: '/icons/default-favicon.png' },
                    { title: t('components.restoreModal.exampleTab2'), url: 'https://example.com/2', favicon: '/icons/default-favicon.png' }
                ],
                duplicateWarnings: []
            });
        } catch (error) {
            if (error instanceof Error && error.message.includes('password')) {
                setPasswordError(t('popup.restoreModal.errors.incorrectPassword'));
            } else {
                setPreviewError(error instanceof Error ? error.message : t('popup.restoreModal.errors.decrypt'));
            }
        } finally {
            setIsLoadingPreview(false);
        }
    };

    const handleRestore = async () => {
        if (!archive) return;

        setIsRestoring(true);
        try {
            await onRestore({
                password: archive.protection.passwordProtected ? password : undefined,
                handleConflicts: conflictStrategy,
                restoreToActive
            });
            onClose();
        } catch (error) {
            if (error instanceof Error && error.message.includes('password')) {
                setPasswordError(t('popup.restoreModal.errors.incorrectPassword'));
            } else {
                setPreviewError(error instanceof Error ? error.message : t('popup.restoreModal.errors.restore'));
            }
        } finally {
            setIsRestoring(false);
        }
    };

    if (!archive) return null;

    const isPasswordRequired = archive.protection.passwordProtected && !previewData;
    const canRestore = !isPasswordRequired || (password && previewData);

    return (
        <ModalWrapper
            isOpen={isOpen}
            onClose={onClose}
            title={t('popup.restoreModal.title')}
            size="lg"
        >
            <div className="space-y-4">
                {/* Archive Info */}
                <div className="bg-muted rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-2">
                        <Archive className="w-5 h-5 text-primary" />
                        <div>
                            <h3 className="font-medium text-text-strong">
                                {t('popup.restoreModal.archiveId', { id: isolateBidi(archive.id.slice(0, 8), 'ltr') })}
                            </h3>
                            <p className="text-xs text-text-muted">
                                {t('popup.restoreModal.createdAt', {
                                    date: isolateBidi(new Date(archive.metadata.archivedDate).toLocaleString(getLocaleTag()), 'ltr'),
                                })}
                            </p>
                        </div>
                        {archive.protection.passwordProtected && (
                            <Lock className="w-4 h-4 text-warning" aria-label={t('popup.restoreModal.passwordProtectedAria')} />
                        )}
                    </div>
                    {archive.metadata.archiveReason && (
                        <p className="text-sm text-text-muted italic">
                            <bdi dir="auto">"{archive.metadata.archiveReason}"</bdi>
                        </p>
                    )}
                </div>

                {/* Password Input for Protected Archives */}
                {archive.protection.passwordProtected && !previewData && (
                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-text-strong mb-2">
                                {t('popup.restoreModal.enterPassword')}
                            </label>
                            <PasswordInput
                                value={password}
                                onChange={setPassword}
                                placeholder={t('popup.restoreModal.passwordPlaceholder')}
                                showStrengthMeter={false}
                                autoFocus
                            />
                            {passwordError && (
                                <p className="mt-1 text-sm text-danger">{passwordError}</p>
                            )}
                        </div>

                        {archive.protection.passwordHint && (
                            <div className="bg-primary-muted border border-primary/30 rounded-lg p-3">
                                <div className="flex items-start gap-2">
                                    <Lightbulb className="w-4 h-4 text-primary" />
                                    <div>
                                        <div className="text-sm font-medium text-primary">{t('popup.restoreModal.passwordHint')}</div>
                                        <div dir="auto" className="text-sm text-primary">{archive.protection.passwordHint}</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <button
                            onClick={loadPreviewWithPassword}
                            disabled={!password || isLoadingPreview}
                            className="w-full px-4 py-2 bg-primary text-white rounded-full hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isLoadingPreview && <Loader2 className="w-4 h-4 animate-spin" />}
                            {isLoadingPreview ? t('popup.restoreModal.decrypting') : t('popup.restoreModal.decryptAndPreview')}
                        </button>
                    </div>
                )}

                {/* Loading State */}
                {isLoadingPreview && !archive.protection.passwordProtected && (
                    <div className="flex items-center justify-center py-8">
                        <div className="flex items-center gap-2 text-text-muted">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>{t('popup.restoreModal.loadingPreview')}</span>
                        </div>
                    </div>
                )}

                {/* Preview Error */}
                {previewError && (
                    <div className="bg-danger-muted border border-danger/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-danger">
                            <AlertCircle className="w-4 h-4" />
                            <span dir="auto" className="text-sm">{previewError}</span>
                        </div>
                    </div>
                )}

                {/* Preview Content */}
                {previewData && (
                    <div className="space-y-4">
                        {/* Group Info */}
                        <div className="border border-border rounded-lg p-4">
                            <h4 className="font-medium text-text-strong mb-2">
                                {t('popup.restoreModal.previewTitle', { name: isolateBidi(previewData.groupName) })}
                            </h4>
                            <p className="text-sm text-text-muted mb-3">
                                {t('popup.restoreModal.tabsWillBeRestored', { count: previewData.tabCount })}
                            </p>

                            {/* Duplicate Warnings */}
                            {previewData.duplicateWarnings.length > 0 && (
                                <div className="bg-warning-muted border border-warning/30 rounded-lg p-3 mb-3">
                                    <div className="flex items-start gap-2">
                                        <AlertTriangle className="w-4 h-4 text-warning" />
                                        <div>
                                            <div className="text-sm font-medium text-warning">
                                                {t('popup.restoreModal.potentialDuplicates')}
                                            </div>
                                            <div className="text-sm text-warning mt-1">
                                                {t('popup.restoreModal.duplicatesMayBeOpen', { count: previewData.duplicateWarnings.length })}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Tab Preview */}
                            {previewData.tabs.length > 0 && (
                                <div className="space-y-2 max-h-40 overflow-y-auto">
                                    {previewData.tabs.map((tab, index) => (
                                        <div key={index} className="flex items-center gap-3 p-2 bg-muted rounded">
                                            <img
                                                src={tab.favicon || '/icons/default-favicon.png'}
                                                alt=""
                                                className="w-4 h-4 flex-shrink-0"
                                                onError={(e) => {
                                                    e.currentTarget.src = '/icons/default-favicon.png';
                                                }}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium text-text-strong truncate">
                                                    <bdi dir="auto">{tab.title}</bdi>
                                                </div>
                                                <div className="text-xs text-text-muted truncate">
                                                    <bdi dir="ltr">{tab.url}</bdi>
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {previewData.tabCount > previewData.tabs.length && (
                                        <div className="text-center text-sm text-text-muted py-2">
                                            {t('popup.restoreModal.moreTabs', {
                                                count: previewData.tabCount - previewData.tabs.length
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Restore Options */}
                        <div className="space-y-3">
                            <h4 className="font-medium text-text-strong">{t('popup.restoreModal.optionsTitle')}</h4>

                            {/* Conflict Handling */}
                            <div>
                                <label className="block text-sm font-medium text-text-strong mb-2">
                                    {t('popup.restoreModal.handleDuplicates')}
                                </label>
                                <select
                                    value={conflictStrategy}
                                    onChange={(e) => setConflictStrategy(e.target.value as RestoreOptions['handleConflicts'])}
                                    className="w-full px-3.5 py-2 text-sm border border-field rounded-input bg-bg-1 text-foreground"
                                >
                                    <option value="skip">{t('popup.restoreModal.conflictStrategies.skip')}</option>
                                    <option value="replace">{t('popup.restoreModal.conflictStrategies.replace')}</option>
                                    <option value="rename">{t('popup.restoreModal.conflictStrategies.rename')}</option>
                                </select>
                            </div>

                            {/* Restore Location */}
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="restore-active"
                                    checked={restoreToActive}
                                    onChange={(e) => setRestoreToActive(e.target.checked)}
                                    className="rounded border-border text-primary"
                                />
                                <label htmlFor="restore-active" className="text-sm text-text-strong">
                                    {t('popup.restoreModal.restoreToActive')}
                                </label>
                            </div>
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                    <button
                        onClick={onClose}
                        disabled={isRestoring}
                        className="px-4 py-2 text-sm font-medium text-text-strong bg-muted hover:bg-accent rounded-full transition-colors disabled:opacity-50"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={handleRestore}
                        disabled={!canRestore || isRestoring}
                        className="px-4 py-2 text-sm font-medium text-white bg-success hover:bg-success rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isRestoring && <Loader2 className="w-4 h-4 animate-spin" />}
                        {isRestoring ? t('popup.restoreModal.restoring') : t('popup.restoreModal.restoreArchive')}
                    </button>
                </div>
            </div>
        </ModalWrapper>
    );
}
