/**
 * LinearMirrorControl - Shows "Mirror to Linear" / "Stop mirroring" controls
 * like Notion integration, for each group in Bluetab Manager.
 */

import { useState, useEffect, useCallback } from 'react';
import { toast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Link, Link2Off, AlertTriangle, CheckCircle } from 'lucide-react';
import { dispatchVerb } from '@/services/integration-service';
import { LinearSyncStorage, type LinearSyncGroup } from '@/services/linear-sync-storage';
import { listConnectedAccounts } from '@/services/integration-token-storage';
import type { TabGroup } from '@/types/models';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';

interface LinearMirrorControlProps {
  group: TabGroup;
  onSyncStatusChange?: () => void;
}

export function LinearMirrorControl({ group, onSyncStatusChange }: LinearMirrorControlProps) {
  const { t } = useTranslation();
  const [syncGroup, setSyncGroup] = useState<LinearSyncGroup | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [linearAccounts, setLinearAccounts] = useState<any[]>([]);

  const loadSyncStatus = useCallback(async () => {
    try {
      const syncGroups = await LinearSyncStorage.getAllSyncGroups();
      const groupSync = syncGroups.find(s => s.groupId === group.id);
      setSyncGroup(groupSync || null);
    } catch (error) {
      console.error('Failed to load sync status:', error);
    }
  }, [group.id]);

  const loadLinearAccounts = useCallback(async () => {
    try {
      const accounts = await listConnectedAccounts();
      const linearAccs = accounts.filter(acc => acc.integrationId === 'linear');
      setLinearAccounts(linearAccs);
    } catch (error) {
      console.error('Failed to load Linear accounts:', error);
    }
  }, []);

  useEffect(() => {
    void loadSyncStatus();
    void loadLinearAccounts();
  }, [loadSyncStatus, loadLinearAccounts]);

  const handleStartMirroring = async () => {
    if (linearAccounts.length === 0) {
      toast.error(t('components.linearMirror.connectFirst'));
      return;
    }

    setIsLoading(true);
    try {
      const account = linearAccounts[0]; // Use first account

      const result = await dispatchVerb(
        'linear',
        'start_group_mirroring',
        { groupId: group.id },
        account.accountId
      );

      if (result.success) {
        toast.success(t('options.groupMenu.startMirroringSuccess', {
          name: isolateBidi(group.name),
          integration: isolateBidi('Linear', 'ltr'),
        }));
        await loadSyncStatus();
        onSyncStatusChange?.();
      } else {
        throw new Error(result.error || t('components.linearMirror.startFailedBare'));
      }
    } catch (error) {
      console.error('Failed to start mirroring:', error);
      toast.error(t('options.groupMenu.startMirroringFailed', {
        message: isolateBidi(error instanceof Error ? error.message : t('components.linearMirror.unknownError')),
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleStopMirroring = async () => {
    if (!syncGroup) return;

    setIsLoading(true);
    try {
      const result = await dispatchVerb(
        'linear',
        'stop_group_mirroring',
        { groupId: group.id },
        syncGroup.accountId
      );

      if (result.success) {
        toast.success(t('components.linearMirror.stopSuccess', { name: isolateBidi(group.name) }));
        setSyncGroup(null);
        onSyncStatusChange?.();
      } else {
        throw new Error(result.error || t('components.linearMirror.stopFailedBare'));
      }
    } catch (error) {
      console.error('Failed to stop mirroring:', error);
      toast.error(t('options.groupMenu.stopMirroringFailed', {
        integration: isolateBidi('Linear', 'ltr'),
        message: isolateBidi(error instanceof Error ? error.message : t('components.linearMirror.unknownError')),
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const getSyncStatusIcon = () => {
    if (!syncGroup) return null;

    switch (syncGroup.syncStatus) {
      case 'active':
        return <CheckCircle className="h-3 w-3 text-green-500" />;
      case 'error':
        return <AlertTriangle className="h-3 w-3 text-red-500" />;
      case 'paused':
        return <Link2Off className="h-3 w-3 text-gray-500" />;
      default:
        return null;
    }
  };

  const getSyncStatusText = () => {
    if (!syncGroup) return null;

    switch (syncGroup.syncStatus) {
      case 'active':
        return t('components.linearMirror.synced', { count: syncGroup.issueCount });
      case 'error':
        return t('components.linearMirror.error');
      case 'paused':
        return t('components.linearMirror.paused');
      default:
        return t('components.linearMirror.unknown');
    }
  };

  const getSyncStatusVariant = (): "default" | "secondary" | "destructive" | "outline" => {
    if (!syncGroup) return 'outline';

    switch (syncGroup.syncStatus) {
      case 'active':
        return 'default';
      case 'error':
        return 'destructive';
      case 'paused':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  if (linearAccounts.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        {t('components.linearMirror.connect')}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {syncGroup ? (
        <>
          <Badge variant={getSyncStatusVariant()} className="text-xs">
            <div className="flex items-center gap-1">
              {getSyncStatusIcon()}
              {getSyncStatusText()}
            </div>
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={handleStopMirroring}
            disabled={isLoading}
            className="text-xs"
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin me-1" />
            ) : (
              <Link2Off className="h-3 w-3 me-1" />
            )}
            {t('components.linearMirror.stop')}
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={handleStartMirroring}
          disabled={isLoading}
          className="text-xs"
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin me-1" />
          ) : (
            <Link className="h-3 w-3 me-1" />
          )}
          {t('components.linearMirror.start')}
        </Button>
      )}
    </div>
  );
}
