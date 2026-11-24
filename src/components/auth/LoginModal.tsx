/**
 * @module components/auth/LoginModal
 *
 * WHY: Modal for user authentication.
 *
 * WHAT: Provides email/password login form with error handling.
 *
 * HOW: Uses Dialog from shadcn/ui and calls AuthService.
 */

import React, { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { useAuth } from './useAuth'
import { config } from '../../config/config'
import { Eye, EyeOff, Loader2, Mail, Lock, ExternalLink, LogIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface LoginModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess?: () => void
}

export function LoginModal({ isOpen, onClose, onSuccess }: LoginModalProps) {
    const { t } = useTranslation()
    const { login, isLoading } = useAuth()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')

        if (!email.trim() || !password.trim()) {
            setError(t('auth.login.missingCredentials'))
            return
        }

        const result = await login(email, password)

        if (result.success) {
            setEmail('')
            setPassword('')
            onSuccess?.()
            onClose()
        } else {
            setError(result.error || t('auth.login.failed'))
        }
    }

    const handleOpenSupertry = () => {
        chrome.tabs.create({ url: `${config.supertry.baseUrl}/register` })
    }

    const handleForgotPassword = () => {
        chrome.tabs.create({ url: `${config.supertry.baseUrl}/forgot-password` })
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md bg-bg-1 border-border">
                <DialogHeader>
                    <div className="flex items-center gap-3 mb-1">
                        <div className="p-2 rounded-lg bg-primary/10">
                            <LogIn className="h-5 w-5 text-primary" />
                        </div>
                        <DialogTitle className="text-xl text-text-strong">{t('auth.login.title')}</DialogTitle>
                    </div>
                    <DialogDescription className="text-text-muted">
                        {t('auth.login.description')}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 mt-4">
                    {error && (
                        <div className="p-3 rounded-lg bg-danger-muted text-danger text-sm">
                            {error}
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="email" className="text-text-strong">
                            {t('auth.login.email')}
                        </Label>
                        <div className="relative">
                            <Mail className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
                            <Input
                                id="email"
                                type="email"
                                dir="ltr"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder={t('auth.login.emailPlaceholder')}
                                className="ps-10 bg-bg-0 border-border text-text-strong placeholder:text-text-muted"
                                disabled={isLoading}
                                autoComplete="email"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="password" className="text-text-strong">
                            {t('auth.login.password')}
                        </Label>
                        <div className="relative">
                            <Lock className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
                            <Input
                                id="password"
                                type={showPassword ? 'text' : 'password'}
                                dir="ltr"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="ps-10 pe-10 bg-bg-0 border-border text-text-strong placeholder:text-text-muted"
                                disabled={isLoading}
                                autoComplete="current-password"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute end-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-strong transition-colors"
                                title={showPassword ? t('popup.passwordInput.hidePassword') : t('popup.passwordInput.showPassword')}
                            >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={handleForgotPassword}
                            className="text-sm text-primary hover:text-primary-hover transition-colors"
                        >
                            {t('auth.login.forgotPassword')}
                        </button>
                    </div>

                    <Button
                        type="submit"
                        className="w-full bg-primary hover:bg-primary-hover text-white"
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                                {t('auth.login.signingIn')}
                            </>
                        ) : (
                            t('auth.login.signIn')
                        )}
                    </Button>

                    <div className="relative my-4">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-border" />
                        </div>
                        <div className="relative flex justify-center text-xs">
                            <span className="bg-bg-1 px-2 text-text-muted">{t('auth.login.or')}</span>
                        </div>
                    </div>

                    <Button
                        type="button"
                        variant="outline"
                        className="w-full border-border text-text hover:bg-accent hover:text-text-strong"
                        onClick={handleOpenSupertry}
                    >
                        <ExternalLink className="me-2 h-4 w-4" />
                        {t('auth.login.createAccount')}
                    </Button>
                </form>

                <p className="text-xs text-text-muted text-center mt-4">
                    {t('auth.login.agreement')}
                </p>
            </DialogContent>
        </Dialog>
    )
}
