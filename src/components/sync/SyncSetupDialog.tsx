/**
 * @module components/sync/SyncSetupDialog
 *
 * WHY: Guide users through sync setup process.
 *      Explain E2E encryption and collect sync password.
 *
 * WHAT: Modal dialog with:
 *       - Explanation of sync feature
 *       - Password input for encryption
 *       - Device name input
 *       - Setup/restore flow
 */

import { useState } from 'react'
import { useSync } from '@/hooks/useSync'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Cloud, Lock, Shield, Smartphone, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getDefaultDeviceName } from '@/utils/device-name'

interface SyncSetupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Whether this is a new setup or restoring existing */
  mode?: 'setup' | 'restore'
}

export function SyncSetupDialog({
  open,
  onOpenChange,
  mode = 'setup',
}: SyncSetupDialogProps) {
  const { t } = useTranslation()
  const { autoSetupSync, error } = useSync()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [deviceName, setDeviceName] = useState(getDefaultDeviceName)
  const [showPassword, setShowPassword] = useState(false)
  const [startFresh, setStartFresh] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isSetup = mode === 'setup'
  const shouldCreatePassword = isSetup || startFresh

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    // Validate password
    if (password.length < 8) {
      setLocalError(t('components.sync.setup.passwordLength'))
      return
    }

    // For setup or fresh reset, confirm password match
    if (shouldCreatePassword && password !== confirmPassword) {
      setLocalError(t('components.sync.setup.passwordMismatch'))
      return
    }

    setIsSubmitting(true)

    try {
      const success = await autoSetupSync(
        password,
        deviceName.trim() || undefined,
        startFresh
      )

      if (success) {
        onOpenChange(false)
        // Reset form
        setPassword('')
        setConfirmPassword('')
        setDeviceName(getDefaultDeviceName())
        setStartFresh(false)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const displayError = localError || error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-primary" />
            {isSetup ? t('components.sync.setup.title') : t('components.sync.setup.restoreTitle')}
          </DialogTitle>
            <DialogDescription>
              {isSetup
                ? t('components.sync.setup.description')
                : t('components.sync.setup.restoreDescription')}
            </DialogDescription>
          </DialogHeader>

        {/* Feature highlights for setup */}
        {isSetup && (
          <div className="grid grid-cols-1 gap-3 py-4">
            <FeatureItem
              icon={Shield}
              title={t('components.sync.setup.encryptedTitle')}
              description={t('components.sync.setup.encryptedDescription')}
            />
            <FeatureItem
              icon={Smartphone}
              title={t('components.sync.setup.realtimeTitle')}
              description={t('components.sync.setup.realtimeDescription')}
            />
            <FeatureItem
              icon={Lock}
              title={t('components.sync.setup.keyTitle')}
              description={t('components.sync.setup.keyDescription')}
            />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="sync-password">
                {shouldCreatePassword ? t('components.sync.setup.createPassword') : t('components.sync.setup.existingPassword')}
              </Label>
            <div className="relative">
              <Input
                id="sync-password"
                type={showPassword ? 'text' : 'password'}
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={shouldCreatePassword ? t('components.sync.setup.createPasswordPlaceholder') : t('components.sync.setup.existingPasswordPlaceholder')}
                className="pe-10"
                autoComplete={shouldCreatePassword ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-strong"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {shouldCreatePassword && (
              <p className="text-xs text-text-muted">
                {t('components.sync.setup.passwordHelp')}
              </p>
            )}
          </div>

          {/* Confirm Password (setup only) */}
          {shouldCreatePassword && (
            <div className="space-y-2">
              <Label htmlFor="sync-confirm-password">{t('popup.archiveModal.confirmPasswordLabel')}</Label>
              <Input
                id="sync-confirm-password"
                type={showPassword ? 'text' : 'password'}
                dir="ltr"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('popup.archiveModal.confirmPasswordPlaceholder')}
                autoComplete="new-password"
              />
            </div>
          )}

          {/* Device Name: asked on every new device so devices stay easy to tell apart */}
          <div className="space-y-2">
            <Label htmlFor="sync-device-name">{t('components.sync.setup.deviceName')}</Label>
            <Input
              id="sync-device-name"
              type="text"
              dir="auto"
              maxLength={60}
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder={t('components.sync.setup.devicePlaceholder')}
            />
          </div>

          {!isSetup && (
            <label className="flex cursor-pointer gap-3 rounded-md border border-border bg-bg-1/70 p-3">
              <input
                type="checkbox"
                checked={startFresh}
                onChange={(event) => setStartFresh(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-border bg-bg-0 text-primary"
              />
              <span>
                <span className="block text-sm font-medium text-text-strong">
                  {t('components.sync.setup.freshTitle')}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-text-muted">
                  {t('components.sync.setup.freshDescription')}
                </span>
              </span>
            </label>
          )}

          {/* Error message */}
          {displayError && (
            <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20">
              <p dir="auto" className="text-sm text-red-500">{displayError}</p>
            </div>
          )}

          {/* Warning for restore */}
            {!isSetup && (
              <div className="p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                <p className="text-sm text-yellow-600 dark:text-yellow-400">
                  {startFresh
                    ? t('components.sync.setup.freshWarning')
                    : t('components.sync.setup.restoreWarning')}
                </p>
              </div>
            )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || !password}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  {isSetup ? t('components.sync.setup.settingUp') : startFresh ? t('components.sync.setup.startingFresh') : t('components.sync.setup.restoring')}
                </>
              ) : isSetup ? (
                t('components.sync.setup.title')
              ) : startFresh ? (
                t('components.sync.setup.startFresh')
              ) : (
                t('components.sync.setup.restoreTitle')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function FeatureItem({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Shield
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div>
        <p className="text-sm font-medium text-text-strong">{title}</p>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
    </div>
  )
}

export default SyncSetupDialog
