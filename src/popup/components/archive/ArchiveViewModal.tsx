import React, { useState, useEffect } from 'react';
import { ArchivedGroup } from '../../../types/archive';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArchiveService } from '../../../services/archive-service';

interface ArchiveViewModalProps {
    isOpen: boolean;
    onClose: () => void;
    archive: ArchivedGroup | null;
}

export function ArchiveViewModal({ isOpen, onClose, archive }: ArchiveViewModalProps) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [decryptedArchive, setDecryptedArchive] = useState<ArchivedGroup | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            setPassword('');
            setError('');
            setDecryptedArchive(null);
            setShowPassword(false);
        } else if (archive) {
            // If not password protected, show directly
            if (!archive.protection.passwordProtected) {
                setDecryptedArchive(archive);
            }
        }
    }, [isOpen, archive]);

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!archive || !password.trim()) {
            setError('Please enter a password');
            return;
        }

        setIsVerifying(true);
        setError('');

        try {
            const result = await ArchiveService.verifyArchivePassword(archive.id, password);
            if (result.success && result.decryptedArchive) {
                setDecryptedArchive(result.decryptedArchive);
                setPassword('');
            } else {
                setError(result.error || 'Incorrect password');
            }
        } catch (err) {
            setError('Failed to verify password');
        } finally {
            setIsVerifying(false);
        }
    };

    const formatDate = (timestamp: number) => {
        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date(timestamp));
    };

    const isPasswordProtected = archive?.protection.passwordProtected;
    const shouldShowPassword = isPasswordProtected && !decryptedArchive;

    // Helper to safely display hint (handle both encrypted and plain text hints)
    const getPasswordHint = (hint: string | undefined): string | null => {
        if (!hint) return null;

        // Check if hint is encrypted JSON
        try {
            const parsed = JSON.parse(hint);
            if (parsed.data && parsed.iv && parsed.salt) {
                // This is an encrypted hint from old archives, don't show it
                return null;
            }
        } catch {
            // Not JSON, plain text hint
        }

        return hint;
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-auto min-w-[320px] sm:min-w-[500px] max-w-[90vw] max-h-[85vh] overflow-y-auto scrollbar-transparent">
                <DialogHeader className="mb-2">
                    <DialogTitle className="text-xl text-gray-900 dark:text-gray-100">
                        {decryptedArchive
                            ? (typeof decryptedArchive.originalGroup === 'string' ? 'Archive' : decryptedArchive.originalGroup.name)
                            : 'View Archive'}
                    </DialogTitle>
                </DialogHeader>

                {shouldShowPassword ? (
                    // Password Form
                    <form onSubmit={handlePasswordSubmit} className="space-y-4">
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                            <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200 mb-2">
                                <i className="fas fa-lock"></i>
                                <span className="font-medium">Password Protected Archive</span>
                            </div>
                            <p className="text-sm text-yellow-700 dark:text-yellow-300">
                                This archive is encrypted. Enter the password to view its contents.
                            </p>
                            {getPasswordHint(archive.protection.passwordHint) && (
                                <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-2">
                                    <strong>Hint:</strong> {getPasswordHint(archive.protection.passwordHint)}
                                </p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="password" className="text-gray-900 dark:text-gray-100">Password</Label>
                            <div className="relative">
                                <Input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Enter password"
                                    className="pr-10"
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                >
                                    <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                </button>
                            </div>
                            {error && (
                                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                            )}
                        </div>

                        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3">
                            <Button type="button" variant="secondary" onClick={onClose} className="w-full sm:w-auto">
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isVerifying || !password.trim()} className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white">
                                {isVerifying ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin mr-2"></i>
                                        Verifying...
                                    </>
                                ) : (
                                    'Unlock'
                                )}
                            </Button>
                        </div>
                    </form>
                ) : decryptedArchive && typeof decryptedArchive.originalGroup !== 'string' ? (
                    // Archive Content
                    <div className="space-y-4">
                        {/* Archive Info */}
                        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                <div>
                                    <span className="text-gray-500 dark:text-gray-400">Archived:</span>
                                    <span className="ml-2 text-gray-900 dark:text-gray-100">
                                        {formatDate(decryptedArchive.metadata.archivedDate)}
                                    </span>
                                </div>
                                {decryptedArchive.metadata.archiveReason && (
                                    <div className="col-span-2">
                                        <span className="text-gray-500 dark:text-gray-400">Reason:</span>
                                        <span className="ml-2 text-gray-900 dark:text-gray-100 italic">
                                            "{decryptedArchive.metadata.archiveReason}"
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Notes */}
                        {decryptedArchive.originalGroup.notes && (
                            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
                                    <i className="fas fa-sticky-note"></i>
                                    <span>Note</span>
                                </div>
                                <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
                                    {decryptedArchive.originalGroup.notes}
                                </p>
                            </div>
                        )}

                        {/* Tabs List */}
                        <div>
                            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                                Tabs ({decryptedArchive.originalGroup.tabs.length})
                            </h3>
                            <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-transparent">
                                {decryptedArchive.originalGroup.tabs.map((tab, index) => (
                                    <div
                                        key={index}
                                        className="flex items-start gap-2 sm:gap-3 p-3 sm:p-4 bg-bg-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                    >
                                        <img
                                            src={tab.favicon || '/icons/default-favicon.png'}
                                            alt=""
                                            className="w-4 h-4 flex-shrink-0 mt-0.5"
                                            onError={(e) => {
                                                e.currentTarget.src = '/icons/default-favicon.png';
                                            }}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                                {tab.title}
                                            </div>
                                            <a
                                                href={tab.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline truncate block"
                                            >
                                                {tab.url}
                                            </a>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <Button variant="secondary" onClick={onClose} className="w-full sm:w-auto">
                                Close
                            </Button>
                        </div>
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
