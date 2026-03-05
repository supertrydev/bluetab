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
import { cn } from '@/lib/utils'
import { Cloud, Lock, Shield, Smartphone, Eye, EyeOff, Loader2 } from 'lucide-react'

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
  const { setupSync, restoreSync, isLoading, error } = useSync()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isSetup = mode === 'setup'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    // Validate password
    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters')
      return
    }

    // For setup, confirm password match
    if (isSetup && password !== confirmPassword) {
      setLocalError('Passwords do not match')
      return
    }

    setIsSubmitting(true)

    try {
      let success: boolean

      if (isSetup) {
        success = await setupSync(password, deviceName || undefined)
      } else {
        success = await restoreSync(password)
      }

      if (success) {
        onOpenChange(false)
        // Reset form
        setPassword('')
        setConfirmPassword('')
        setDeviceName('')
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
            {isSetup ? 'Set Up Sync' : 'Restore Sync'}
          </DialogTitle>
          <DialogDescription>
            {isSetup
              ? 'Sync your tabs across devices with end-to-end encryption.'
              : 'Enter your sync password to restore sync on this device.'}
          </DialogDescription>
        </DialogHeader>

        {/* Feature highlights for setup */}
        {isSetup && (
          <div className="grid grid-cols-1 gap-3 py-4">
            <FeatureItem
              icon={Shield}
              title="End-to-End Encrypted"
              description="Your data is encrypted on your device. We can never see your tabs."
            />
            <FeatureItem
              icon={Smartphone}
              title="Real-Time Sync"
              description="Changes sync instantly across all your devices."
            />
            <FeatureItem
              icon={Lock}
              title="Your Password, Your Key"
              description="Only you can decrypt your data. Don't forget your password!"
            />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Password */}
          <div className="space-y-2">
            <Label htmlFor="sync-password">
              {isSetup ? 'Create Sync Password' : 'Sync Password'}
            </Label>
            <div className="relative">
              <Input
                id="sync-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSetup ? 'Create a strong password' : 'Enter your sync password'}
                className="pr-10"
                autoComplete={isSetup ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-strong"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {isSetup && (
              <p className="text-xs text-text-muted">
                This password encrypts your data. It's different from your account password.
              </p>
            )}
          </div>

          {/* Confirm Password (setup only) */}
          {isSetup && (
            <div className="space-y-2">
              <Label htmlFor="sync-confirm-password">Confirm Password</Label>
              <Input
                id="sync-confirm-password"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                autoComplete="new-password"
              />
            </div>
          )}

          {/* Device Name (setup only) */}
          {isSetup && (
            <div className="space-y-2">
              <Label htmlFor="sync-device-name">Device Name (optional)</Label>
              <Input
                id="sync-device-name"
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="e.g., Work Laptop, Home Desktop"
              />
            </div>
          )}

          {/* Error message */}
          {displayError && (
            <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-500">{displayError}</p>
            </div>
          )}

          {/* Warning for restore */}
          {!isSetup && (
            <div className="p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20">
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                Make sure to use the same password you used when setting up sync.
                Using a different password will result in unreadable data.
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
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !password}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {isSetup ? 'Setting up...' : 'Restoring...'}
                </>
              ) : isSetup ? (
                'Set Up Sync'
              ) : (
                'Restore Sync'
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
