import React, { useState, useEffect } from 'react';
import { ModalWrapper } from './ModalWrapper';
import { TabGroup } from '../../../types/models';

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

const SUGGESTED_REASONS = ['End of project', 'Seasonal cleanup'];

export function ArchiveModal({
    isOpen,
    onClose,
    onArchive,
    groups = [],
    selectedGroupIds = []
}: ArchiveModalProps) {
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

    const getPasswordStrength = (password: string): { score: number; label: string; color: string } => {
        if (!password) return { score: 0, label: 'No password', color: 'gray' };

        let score = 0;
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;

        if (score <= 2) return { score, label: 'Weak', color: 'red' };
        if (score <= 4) return { score, label: 'Medium', color: 'yellow' };
        return { score, label: 'Strong', color: 'green' };
    };

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (selectedGroups.length === 0) {
            newErrors.groups = 'Please select at least one group to archive';
        }

        if (passwordProtected) {
            if (!password) {
                newErrors.password = 'Password is required';
            } else if (password.length < 8) {
                newErrors.password = 'Password must be at least 8 characters';
            }

            if (password !== confirmPassword) {
                newErrors.confirmPassword = 'Passwords do not match';
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
            setErrors({ submit: error instanceof Error ? error.message : 'Failed to create archive' });
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

    const handleSuggestedReason = (suggestedReason: string) => {
        setReason(suggestedReason);
    };

    const passwordStrength = getPasswordStrength(password);
    const selectedGroupsData = groups.filter(g => selectedGroups.includes(g.id));
    const totalTabCount = selectedGroupsData.reduce((sum, group) => sum + group.tabs.length, 0);

    // Filter groups based on search query
    const filteredGroups = groups.filter(group =>
        group.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <ModalWrapper
            isOpen={isOpen}
            onClose={onClose}
            title="Create Archive"
            subtitle="Organize and save your tab groups"
            size="lg"
        >
            <form onSubmit={handleSubmit} className="space-y-6">

                {/* Group Selection Header with Search */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <label className="text-sm font-medium text-text-strong">
                            Select Groups ({selectedGroups.length} selected, {totalTabCount} tabs)
                        </label>
                        <div className="relative">
                            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-xs"></i>
                            <input
                                type="text"
                                placeholder="Search groups..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-8 pr-3 py-1.5 text-sm border border-border rounded-lg bg-bg-1 text-text focus:ring-2 focus:ring-primary focus:border-primary w-40"
                            />
                        </div>
                    </div>

                    {/* Group List */}
                    <div className="max-h-48 overflow-y-auto border border-border rounded-xl bg-bg-1 scrollbar-transparent">
                        {filteredGroups.length === 0 ? (
                            <div className="p-4 text-center text-text-muted text-sm">
                                {groups.length === 0 ? 'No groups available to archive' : 'No groups match your search'}
                            </div>
                        ) : (
                            filteredGroups.map(group => {
                                const isSelected = selectedGroups.includes(group.id);
                                return (
                                    <label
                                        key={group.id}
                                        className={`flex items-center gap-3 p-3 cursor-pointer border-l-3 transition-all ${isSelected
                                            ? 'border-l-primary bg-primary-muted/30'
                                            : 'border-l-transparent hover:bg-bg-2'
                                            } border-b border-border last:border-b-0`}
                                    >
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isSelected
                                            ? 'bg-primary border-primary'
                                            : 'border-border bg-bg-1'
                                            }`}>
                                            {isSelected && (
                                                <i className="fas fa-check text-white text-xs"></i>
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
                                                    {group.name}
                                                </span>
                                                {isSelected && (
                                                    <span className="px-2 py-0.5 text-xs font-medium bg-primary text-white rounded-full">
                                                        Selected
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-text-muted mt-0.5">
                                                {group.tabs.length} tab{group.tabs.length !== 1 ? 's' : ''} • Created {new Date(group.created).toLocaleDateString()}
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
                        Archive Reason
                        <span className="text-text-muted font-normal">(Optional)</span>
                    </label>
                    <textarea
                        id="archive-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why are you archiving these groups? (e.g., 'End of project', 'Seasonal cleanup')"
                        rows={3}
                        className="w-full px-4 py-3 text-sm border border-border rounded-xl bg-bg-1 text-text placeholder:text-text-muted focus:ring-2 focus:ring-primary focus:border-primary resize-none"
                        maxLength={200}
                    />
                    <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-2">
                            {SUGGESTED_REASONS.map((suggestion) => (
                                <button
                                    key={suggestion}
                                    type="button"
                                    onClick={() => handleSuggestedReason(suggestion)}
                                    className={`px-3 py-1 text-xs font-medium rounded-full border transition-all ${reason === suggestion
                                        ? 'bg-primary text-white border-primary'
                                        : 'bg-bg-2 text-text-muted border-border hover:border-primary hover:text-primary'
                                        }`}
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                        <span className="text-xs text-text-muted">
                            {reason.length}/200 characters
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
                                <i className="fas fa-check text-white text-xs"></i>
                            )}
                        </div>
                        <input
                            type="checkbox"
                            checked={passwordProtected}
                            onChange={(e) => setPasswordProtected(e.target.checked)}
                            className="sr-only"
                        />
                        <span className="text-sm font-medium text-text-strong">
                            Password Protection
                        </span>
                        <i
                            className="fas fa-info-circle text-info text-sm cursor-help"
                            title="Encrypts archive data with your password"
                        ></i>
                    </label>

                    {passwordProtected && (
                        <div className="mt-4 space-y-4 pt-4 border-t border-border">
                            {/* Warning */}
                            <div className="flex items-start gap-2 p-3 bg-warning-muted rounded-lg">
                                <i className="fas fa-exclamation-triangle text-warning mt-0.5"></i>
                                <p className="text-sm text-warning">
                                    <strong>Important:</strong> If you forget your password, the archived data cannot be recovered.
                                </p>
                            </div>

                            {/* Password Input */}
                            <div>
                                <label htmlFor="archive-password" className="block text-sm font-medium text-text-strong mb-1.5">
                                    Password
                                </label>
                                <input
                                    type="password"
                                    id="archive-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full px-4 py-2.5 text-sm border border-border rounded-lg bg-bg-2 text-text focus:ring-2 focus:ring-primary focus:border-primary"
                                    placeholder="Enter a strong password"
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
                                                {passwordStrength.label}
                                            </span>
                                        </div>
                                        <p className="text-xs text-text-muted">
                                            Use 8+ characters with uppercase, lowercase, numbers, and symbols
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Confirm Password */}
                            <div>
                                <label htmlFor="confirm-password" className="block text-sm font-medium text-text-strong mb-1.5">
                                    Confirm Password
                                </label>
                                <input
                                    type="password"
                                    id="confirm-password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full px-4 py-2.5 text-sm border border-border rounded-lg bg-bg-2 text-text focus:ring-2 focus:ring-primary focus:border-primary"
                                    placeholder="Confirm your password"
                                />
                                {errors.confirmPassword && (
                                    <p className="mt-1 text-sm text-danger">{errors.confirmPassword}</p>
                                )}
                            </div>

                            {/* Password Hint */}
                            <div>
                                <label htmlFor="password-hint" className="flex items-center gap-2 text-sm font-medium text-text-strong mb-1.5">
                                    Password Hint
                                    <span className="text-text-muted font-normal">(Optional)</span>
                                </label>
                                <input
                                    type="text"
                                    id="password-hint"
                                    value={passwordHint}
                                    onChange={(e) => setPasswordHint(e.target.value)}
                                    className="w-full px-4 py-2.5 text-sm border border-border rounded-lg bg-bg-2 text-text focus:ring-2 focus:ring-primary focus:border-primary"
                                    placeholder="A hint to help you remember the password"
                                    maxLength={100}
                                />
                                <p className="mt-1 text-xs text-text-muted">
                                    The hint will be stored unencrypted to help you remember
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Submit Error */}
                {errors.submit && (
                    <div className="flex items-center gap-2 p-3 bg-danger-muted rounded-lg text-danger">
                        <i className="fas fa-exclamation-circle"></i>
                        <span className="text-sm">{errors.submit}</span>
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
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={isArchiving || selectedGroups.length === 0}
                        className="px-5 py-2.5 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isArchiving && <i className="fas fa-spinner fa-spin"></i>}
                        <i className="fas fa-archive"></i>
                        {isArchiving ? 'Creating Archive...' : 'Create Archive'}
                    </button>
                </div>
            </form>
        </ModalWrapper>
    );
}