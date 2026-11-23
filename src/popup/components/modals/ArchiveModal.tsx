import { matchesSearch } from '@/utils/search-text';
import React, { useState, useEffect } from 'react';
import { Search, Check, Info, AlertTriangle, AlertCircle, Loader2, Archive } from 'lucide-react';
import { ModalWrapper } from './ModalWrapper';
import { TabGroup } from '../../../types/models';
import { getLocaleTag } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import { useTranslation } from 'react-i18next';

interface ArchiveModalProps {
    isOpen: boolean;
    onClose: () => void;
    onArchive: (options: ArchiveOptions) => Promise<void>;
    groups?: TabGroup[];
    selectedGroupIds?: string[];
}

export interface ArchiveOptions {
    groupIds: string[];
    reason?: string;
    passwordProtected: boolean;
    password?: string;
    passwordHint?: string;
}

export function ArchiveModal({
    isOpen,
    onClose,
    onArchive,
    groups = [],
    selectedGroupIds = []
}: ArchiveModalProps) {
    const { t } = useTranslation();
    const [reason, setReason] = useState('');
    const [passwordProtected, setPasswordProtected] = useState(false);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordHint, setPasswordHint] = useState('');
    const [selectedGroups, setSelectedGroups] = useState<string[]>(selectedGroupIds);
    const [isArchiving, setIsArchiving] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [searchQuery, setSearchQuery] = useState('');

    // Reset form when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            setReason('');
            setPasswordProtected(false);
            setPassword('');
            setConfirmPassword('');
            setPasswordHint('');
            setSelectedGroups(selectedGroupIds);
            setErrors({});
            setSearchQuery('');
        }
    }, [isOpen, selectedGroupIds]);

    const getPasswordStrength = (nextPassword: string): { score: number; labelKey: string; color: string } => {
        if (!nextPassword) return { score: 0, labelKey: 'none', color: 'gray' };

        let score = 0;
        if (nextPassword.length >= 8) score++;
        if (nextPassword.length >= 12) score++;
        if (/[a-z]/.test(nextPassword)) score++;
        if (/[A-Z]/.test(nextPassword)) score++;
        if (/[0-9]/.test(nextPassword)) score++;
        if (/[^A-Za-z0-9]/.test(nextPassword)) score++;

        if (score <= 2) return { score, labelKey: 'weak', color: 'red' };
        if (score <= 4) return { score, labelKey: 'medium', color: 'yellow' };
        return { score, labelKey: 'strong', color: 'green' };
    };

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (selectedGroups.length === 0) {
            newErrors.groups = t('popup.archiveModal.errors.selectGroup');
        }

        if (passwordProtected) {
            if (!password) {
                newErrors.password = t('popup.archiveModal.errors.passwordRequired');
            } else if (password.length < 8) {
                newErrors.password = t('popup.archiveModal.errors.passwordMin');
            }

            if (password !== confirmPassword) {
                newErrors.confirmPassword = t('popup.archiveModal.errors.passwordMismatch');
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!validateForm()) return;

        setIsArchiving(true);
        try {
            await onArchive({
                groupIds: selectedGroups,
                reason: reason.trim() || undefined,
                passwordProtected,
                password: passwordProtected ? password : undefined,
                passwordHint: passwordProtected && passwordHint.trim() ? passwordHint.trim() : undefined
            });
            onClose();
        } catch (error) {
            setErrors({ submit: error instanceof Error ? error.message : t('popup.archiveModal.errors.submit') });
        } finally {
            setIsArchiving(false);
        }
    };

    const handleGroupToggle = (groupId: string) => {
        setSelectedGroups(prev =>
            prev.includes(groupId)
                ? prev.filter(id => id !== groupId)
                : [...prev, groupId]
        );
        // Clear group selection error when user makes a selection
        if (errors.groups) {
            setErrors(prev => ({ ...prev, groups: '' }));
        }
    };

    const passwordStrength = getPasswordStrength(password);
    const selectedGroupsData = groups.filter(g => selectedGroups.includes(g.id));
    const totalTabCount = selectedGroupsData.reduce((sum, group) => sum + group.tabs.length, 0);

    // Filter groups based on search query
    const filteredGroups = groups.filter(group =>
        matchesSearch(group.name, searchQuery)
    );

    return (
        <ModalWrapper
            isOpen={isOpen}
            onClose={onClose}
            title={t('popup.archiveModal.title')}
            subtitle={t('popup.archiveModal.subtitle')}
            size="lg"
        >
            <form onSubmit={handleSubmit} className="space-y-6">

                {/* Group Selection Header with Search */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <label className="text-sm font-medium text-text-strong">
                            {t('popup.archiveModal.selectionLabel', { selectedCount: selectedGroups.length, tabCount: totalTabCount })}
                        </label>
                        <div className="relative">
                            <Search className="w-3 h-3 absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
                            <input
                                type="text"
                                placeholder={t('popup.archiveModal.searchPlaceholder')}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="ps-8 pe-3 py-1.5 text-sm border border-border rounded-lg bg-bg-1 text-text focus:ring-2 focus:ring-primary focus:border-primary w-40"
                            />
                        </div>
                    </div>

                    {/* Group List */}
                    <div className="max-h-48 overflow-y-auto border border-border rounded-xl bg-bg-1 scrollbar-transparent">
                        {filteredGroups.length === 0 ? (
                            <div className="p-4 text-center text-text-muted text-sm">
                                {groups.length === 0 ? t('popup.archiveModal.noGroups') : t('popup.archiveModal.noMatches')}
                            </div>
                        ) : (
                            filteredGroups.map(group => {
                                const isSelected = selectedGroups.includes(group.id);
                                return (
                                    <label
                                        key={group.id}
                                        className={`flex items-center gap-3 p-3 cursor-pointer border-s-3 transition-all ${isSelected
                                            ? 'border-s-primary bg-primary-muted/30'
                                            : 'border-s-transparent hover:bg-bg-2'
                                            } border-b border-border last:border-b-0`}
                                    >
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isSelected
                                            ? 'bg-primary border-primary'
                                            : 'border-border bg-bg-1'
                                            }`}>
                                            {isSelected && (
                                                <Check className="w-3 h-3 text-white" />
                                            )}
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => handleGroupToggle(group.id)}
                                            className="sr-only"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-medium text-text-strong truncate">
                                                    <bdi dir="auto">{group.name}</bdi>
                                                </span>
                                                {isSelected && (
                                                    <span className="px-2 py-0.5 text-xs font-medium bg-primary text-white rounded-full">
                                                        {t('common.selected')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-text-muted mt-0.5">
                                                {t('popup.archiveModal.tabCount', { count: group.tabs.length })} • {t('popup.archiveModal.createdOn', {
                                                    date: isolateBidi(new Date(group.created).toLocaleDateString(getLocaleTag()), 'ltr'),
                                                })}
                                            </div>
                                        </div>
                                    </label>
                                );
                            })
                        )}
                    </div>
                    {errors.groups && (
                        <p className="mt-2 text-sm text-danger">{errors.groups}</p>
                    )}
                </div>

                {/* Archive Reason */}
                <div>
                    <label htmlFor="archive-reason" className="flex items-center gap-2 text-sm font-medium text-text-strong mb-2">
                        {t('popup.archiveModal.reasonLabel')}
                        <span className="text-text-muted font-normal">({t('popup.archiveModal.optional')})</span>
                    </label>
                    <textarea
                        id="archive-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={t('popup.archiveModal.reasonPlaceholder')}
                        rows={3}
                        className="w-full px-4 py-3 text-sm border border-border rounded-xl bg-bg-1 text-text placeholder:text-text-muted focus:ring-2 focus:ring-primary focus:border-primary resize-none"
                        maxLength={200}
                        dir="auto"
                    />
                    <div className="flex items-center justify-end mt-2">
                        <span className="text-xs text-text-muted">
                            {t('popup.archiveModal.characterCount', { count: reason.length })}
                        </span>
                    </div>
                </div>

                {/* Password Protection */}
                <div className="border border-border rounded-xl p-4 bg-bg-1">
                    <label className="flex items-center gap-3 cursor-pointer">
                        <div
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${passwordProtected
                                ? 'bg-primary border-primary'
                                : 'border-border bg-bg-1'
                                }`}
                            onClick={() => setPasswordProtected(!passwordProtected)}
                        >
                            {passwordProtected && (
                                <Check className="w-3 h-3 text-white" />
                            )}
                        </div>
                        <input
                            type="checkbox"
                            checked={passwordProtected}
                            onChange={(e) => setPasswordProtected(e.target.checked)}
                            className="sr-only"
                        />
                        <span className="text-sm font-medium text-text-strong">
                            {t('popup.archiveModal.passwordProtection')}
                        </span>
                        <Info
                            className="w-4 h-4 text-info cursor-help"
                            aria-label={t('popup.archiveModal.passwordProtectionAria')}
                        />
                    </label>

                    {passwordProtected && (
                        <div className="mt-4 space-y-4 pt-4 border-t border-border">
                            {/* Warning */}
                            <div className="flex items-start gap-2 p-3 bg-warning-muted rounded-lg">
                                <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                                <p className="text-sm text-warning">
                                    <strong>{t('popup.archiveModal.important')}</strong> {t('popup.archiveModal.passwordWarning')}
                                </p>
                            </div>

                            {/* Password Input */}
                            <div>
                                <label htmlFor="archive-password" className="block text-sm font-medium text-text-strong mb-1.5">
                                    {t('popup.archiveModal.passwordLabel')}
                                </label>
                                <input
                                    type="password"
                                    id="archive-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full px-4 py-2.5 text-sm border border-border rounded-lg bg-bg-0 text-text-strong placeholder:text-text-muted focus:ring-2 focus:ring-primary focus:border-primary"
                                    placeholder={t('popup.archiveModal.passwordPlaceholder')}
                                    dir="ltr"
                                />
                                {errors.password && (
                                    <p className="mt-1 text-sm text-danger">{errors.password}</p>
                                )}

                                {/* Password Strength Indicator */}
                                {password && (
                                    <div className="mt-2">
                                        <div className="flex items-center gap-2 mb-1">
                                            <div className="flex-1 bg-bg-2 rounded-full h-1.5">
                                                <div
                                                    className={`h-1.5 rounded-full transition-all duration-300 ${passwordStrength.color === 'red' ? 'bg-danger' :
                                                        passwordStrength.color === 'yellow' ? 'bg-warning' : 'bg-success'
                                                        }`}
                                                    style={{ width: `${(passwordStrength.score / 6) * 100}%` }}
                                                />
                                            </div>
                                            <span className={`text-xs font-medium ${passwordStrength.color === 'red' ? 'text-danger' :
                                                passwordStrength.color === 'yellow' ? 'text-warning' : 'text-success'
                                                }`}>
                                                {passwordStrength.labelKey === 'none'
                                                    ? t('popup.archiveModal.passwordStrength.none')
                                                    : passwordStrength.labelKey === 'weak'
                                                        ? t('popup.archiveModal.passwordStrength.weak')
                                                        : passwordStrength.labelKey === 'medium'
                                                            ? t('popup.archiveModal.passwordStrength.medium')
                                                            : t('popup.archiveModal.passwordStrength.strong')}
                                            </span>
                                        </div>
                                        <p className="text-xs text-text-muted">
                                            {t('popup.archiveModal.passwordHelp')}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Confirm Password */}
                            <div>
                                <label htmlFor="confirm-password" className="block text-sm font-medium text-text-strong mb-1.5">
                                    {t('popup.archiveModal.confirmPasswordLabel')}
                                </label>
                                <input
                                    type="password"
                                    id="confirm-password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full px-4 py-2.5 text-sm border border-border rounded-lg bg-bg-0 text-text-strong placeholder:text-text-muted focus:ring-2 focus:ring-primary focus:border-primary"
                                    placeholder={t('popup.archiveModal.confirmPasswordPlaceholder')}
                                    dir="ltr"
                                />
                                {errors.confirmPassword && (
                                    <p className="mt-1 text-sm text-danger">{errors.confirmPassword}</p>
                                )}
                            </div>

                            {/* Password Hint */}
                            <div>
                                <label htmlFor="password-hint" className="flex items-center gap-2 text-sm font-medium text-text-strong mb-1.5">
                                    {t('popup.archiveModal.passwordHintLabel')}
                                    <span className="text-text-muted font-normal">({t('popup.archiveModal.optional')})</span>
                                </label>
                                <input
                                    type="text"
                                    id="password-hint"
                                    value={passwordHint}
                                    onChange={(e) => setPasswordHint(e.target.value)}
                                    className="w-full px-4 py-2.5 text-sm border border-border rounded-lg bg-bg-0 text-text-strong placeholder:text-text-muted focus:ring-2 focus:ring-primary focus:border-primary"
                                    placeholder={t('popup.archiveModal.passwordHintPlaceholder')}
                                    maxLength={100}
                                    dir="auto"
                                />
                                <p className="mt-1 text-xs text-text-muted">
                                    {t('popup.archiveModal.passwordHintDescription')}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Submit Error */}
                {errors.submit && (
                    <div className="flex items-center gap-2 p-3 bg-danger-muted rounded-lg text-danger">
                        <AlertCircle className="w-4 h-4" />
                        <span dir="auto" className="text-sm">{errors.submit}</span>
                    </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isArchiving}
                        className="px-5 py-2.5 text-sm font-medium text-text bg-bg-2 hover:bg-highlight border border-border rounded-lg transition-colors disabled:opacity-50"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        disabled={isArchiving || selectedGroups.length === 0}
                        className="px-5 py-2.5 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isArchiving && <Loader2 className="w-4 h-4 animate-spin" />}
                        <Archive className="w-4 h-4" />
                        {isArchiving ? t('popup.archiveModal.creating') : t('popup.archiveModal.submit')}
                    </button>
                </div>
            </form>
        </ModalWrapper>
    );
}
