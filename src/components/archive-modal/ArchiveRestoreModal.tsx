import React, { useState, useEffect } from 'react';
import { ArchivedGroup } from '../../types/archive';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RotateCcw, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';

interface ArchiveRestoreModalProps {
    isOpen: boolean;
    onClose: () => void;
    archive: ArchivedGroup | null;
    onRestore: (password?: string) => Promise<void>;
}

export function ArchiveRestoreModal({ isOpen, onClose, archive, onRestore }: ArchiveRestoreModalProps) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isRestoring, setIsRestoring] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

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

    useEffect(() => {
        if (!isOpen) {
            setPassword('');
            setError('');
            setShowPassword(false);
        }
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!archive) return;

        if (archive.protection.passwordProtected && !password.trim()) {
            setError('Please enter a password');
            return;
        }

        setIsRestoring(true);
        setError('');

        try {
            await onRestore(archive.protection.passwordProtected ? password : undefined);
            onClose();
        } catch (err) {
            setError((err as Error).message || 'Failed to restore archive');
        } finally {
            setIsRestoring(false);
        }
    };

    if (!archive) return null;

    const isPasswordProtected = archive.protection.passwordProtected;
    const groupName = typeof archive.originalGroup === 'string'
        ? 'Protected Archive'
        : archive.originalGroup.name;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-auto min-w-[450px] max-w-[90vw]">
                <DialogHeader>
                    <DialogTitle className="text-xl text-gray-900 dark:text-gray-100">
                        Restore Archive
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Archive Info */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                        <div className="flex items-center gap-2 text-blue-800 dark:text-blue-200 mb-2">
                            <RotateCcw className="w-4 h-4" />
                            <span className="font-medium">Restore: {groupName}</span>
                        </div>
                        <p className="text-sm text-blue-700 dark:text-blue-300">
                            This will restore the archived group to your active groups.
                        </p>
                    </div>

                    {isPasswordProtected && (
                        <>
                            {/* Password Protection Notice */}
                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200 mb-2">
                                    <Lock className="w-4 h-4" />
                                    <span className="font-medium">Password Protected</span>
                                </div>
                                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                                    This archive is encrypted. Enter the password to restore it.
                                </p>
                                {getPasswordHint(archive.protection.passwordHint) && (
                                    <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-2">
                                        <strong>Hint:</strong> {getPasswordHint(archive.protection.passwordHint)}
                                    </p>
                                )}
                            </div>

                            {/* Password Input */}
                            <div className="space-y-2">
                                <Label htmlFor="restore-password" className="text-gray-900 dark:text-gray-100">Password</Label>
                                <div className="relative">
                                    <Input
                                        id="restore-password"
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
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                                {error && (
                                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                                )}
                            </div>
                        </>
                    )}

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={isRestoring || (isPasswordProtected && !password.trim())}
                            className="bg-green-600 hover:bg-green-700 text-white"
                        >
                            {isRestoring ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Restoring...
                                </>
                            ) : (
                                <>
                                    <RotateCcw className="w-4 h-4 mr-2" />
                                    Restore
                                </>
                            )}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
