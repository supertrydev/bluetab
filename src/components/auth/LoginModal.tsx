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

interface LoginModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess?: () => void
}

export function LoginModal({ isOpen, onClose, onSuccess }: LoginModalProps) {
    const { login, isLoading } = useAuth()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')

        if (!email.trim() || !password.trim()) {
            setError('Please enter email and password')
            return
        }

        const result = await login(email, password)

        if (result.success) {
            setEmail('')
            setPassword('')
            onSuccess?.()
            onClose()
        } else {
            setError(result.error || 'Login failed')
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
                        <DialogTitle className="text-xl text-text-strong">Sign in to BlueTab</DialogTitle>
                    </div>
                    <DialogDescription className="text-text-muted">
                        Sign in with your Supertry account to unlock premium features
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
                            Email
                        </Label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                className="pl-10 bg-bg-0 border-border text-text-strong placeholder:text-text-muted"
                                disabled={isLoading}
                                autoComplete="email"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="password" className="text-text-strong">
                            Password
                        </Label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
                            <Input
                                id="password"
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="pl-10 pr-10 bg-bg-0 border-border text-text-strong placeholder:text-text-muted"
                                disabled={isLoading}
                                autoComplete="current-password"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-strong transition-colors"
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
                            Forgot password?
                        </button>
                    </div>

                    <Button
                        type="submit"
                        className="w-full bg-primary hover:bg-primary-hover text-white"
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Signing in...
                            </>
                        ) : (
                            'Sign In'
                        )}
                    </Button>

                    <div className="relative my-4">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-border" />
                        </div>
                        <div className="relative flex justify-center text-xs">
                            <span className="bg-bg-1 px-2 text-text-muted">or</span>
                        </div>
                    </div>

                    <Button
                        type="button"
                        variant="outline"
                        className="w-full border-border text-text hover:bg-bg-2 hover:text-text-strong"
                        onClick={handleOpenSupertry}
                    >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Create Account on Supertry
                    </Button>
                </form>

                <p className="text-xs text-text-muted text-center mt-4">
                    By signing in, you agree to our Terms of Service and Privacy Policy
                </p>
            </DialogContent>
        </Dialog>
    )
}
