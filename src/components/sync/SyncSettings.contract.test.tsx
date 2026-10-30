import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_FILE = path.resolve(__dirname, './SyncSettings.tsx');
const HOOK_FILE = path.resolve(__dirname, '../../hooks/useSync.ts');
const ENGINE_FILE = path.resolve(__dirname, '../../services/sync-engine.ts');
const SERVICE_WORKER_FILE = path.resolve(__dirname, '../../background/service-worker.ts');
const SETUP_DIALOG_FILE = path.resolve(__dirname, './SyncSetupDialog.tsx');
const ENGLISH_RESOURCE_FILE = path.resolve(__dirname, '../../i18n/locales/en.json');

const componentSource = fs.readFileSync(COMPONENT_FILE, 'utf-8');
const hookSource = fs.readFileSync(HOOK_FILE, 'utf-8');
const engineSource = fs.readFileSync(ENGINE_FILE, 'utf-8');
const serviceWorkerSource = fs.readFileSync(SERVICE_WORKER_FILE, 'utf-8');
const setupDialogSource = fs.readFileSync(SETUP_DIALOG_FILE, 'utf-8');
const english = JSON.parse(fs.readFileSync(ENGLISH_RESOURCE_FILE, 'utf-8'));

describe('SyncSettings device management contract', () => {
  it('shows a visible absolute last-active timestamp beside the relative value', () => {
    expect(componentSource).toContain('formatAbsoluteTime');
    expect(componentSource).toContain("t('components.sync.lastActive'");
    expect(english.components.sync.lastActive).toBe('Last active: {{time}}');
    expect(componentSource).not.toContain('Last seen:');
  });

  it('exposes stale-device removal from the settings list without allowing current-device removal', () => {
    expect(componentSource).toContain('Trash2');
    expect(componentSource).toContain('handleDeleteDevice');
    expect(componentSource).toContain('if (isCurrent) return');
    expect(componentSource).toContain("title={t('components.sync.removeDevice')}");
    expect(english.components.sync.removeDevice).toBe('Remove device');
  });

  it('routes device removal through the hook, service worker, and sync engine', () => {
    expect(hookSource).toContain('deleteDevice: (deviceId: string) => Promise<boolean>');
    expect(hookSource).toContain("type: 'SYNC_DELETE_DEVICE'");
    expect(engineSource).toContain('export async function deleteDevice');
    expect(engineSource).toContain('/api/sync/devices/');
    expect(serviceWorkerSource).toContain("message.type === 'SYNC_DELETE_DEVICE'");
    expect(serviceWorkerSource).toContain('SyncEngine.deleteDevice');
  });

  it('offers a separate explicit disconnect flow for the current device', () => {
    expect(componentSource).toContain('handleDisconnectCurrentDevice');
    expect(componentSource).toContain("t('components.sync.disconnectConfirm')");
    expect(componentSource).toContain("title={t('components.sync.disconnectDevice')}");
    expect(english.components.sync.disconnectConfirm).toBe('Disconnect this device from sync? Your local Bluetab data will stay here, but this browser will stop syncing until you connect it again.');
    expect(english.components.sync.disconnectDevice).toBe('Disconnect this device');
    expect(hookSource).toContain('disconnectCurrentDevice: () => Promise<boolean>');
    expect(hookSource).toContain("type: 'SYNC_DISCONNECT_CURRENT_DEVICE'");
    expect(engineSource).toContain('export async function disconnectCurrentDevice');
    expect(engineSource).toContain('clearLocalSyncRegistration');
    expect(serviceWorkerSource).toContain("message.type === 'SYNC_DISCONNECT_CURRENT_DEVICE'");
    expect(serviceWorkerSource).toContain('SyncEngine.disconnectCurrentDevice');
  });

  it('wires setup UI to the password-backed auto-setup flow', () => {
    expect(componentSource).toContain('SyncSetupDialog');
    expect(componentSource).toContain("t('components.sync.connectDevice')");
    expect(english.components.sync.connectDevice).toBe('Connect this device');
    expect(componentSource).toContain('setupDialogOpen');
    expect(hookSource).toContain('autoSetupSync: (password: string, deviceName?: string, resetCloudData?: boolean) => Promise<boolean>');
    expect(hookSource).toContain("type: 'SYNC_AUTO_SETUP'");
  });

  it('supports explicit fresh-start reset for orphaned encrypted cloud sync data', () => {
    expect(componentSource).toContain('hasCloudSyncData');
    expect(componentSource).toContain("const setupMode = requiresPasswordRestore || devices.length > 0 || hasCloudSyncData ? 'restore' : 'setup'");
    expect(setupDialogSource).toContain('startFresh');
    expect(setupDialogSource).toContain("t('components.sync.setup.freshTitle')");
    expect(setupDialogSource).toContain("t('components.sync.setup.startFresh')");
    expect(english.components.sync.setup.freshTitle).toBe('Start fresh sync instead');
    expect(english.components.sync.setup.startFresh).toBe('Start Fresh Sync');
    expect(hookSource).toContain('resetCloudData');
    expect(serviceWorkerSource).toContain('message.resetCloudData === true');
    expect(engineSource).toContain('resetCloudData = false');
    expect(engineSource).toContain('resetCloudData,');
  });

  it('does not hide device setup just because the service worker reports connected', () => {
    expect(componentSource).toContain('const hasLocalDeviceInfo = deviceInfo !== null');
    expect(componentSource).toContain("const requiresPasswordRestore = state?.status === 'restore-required'");
    expect(componentSource).toContain('const needsDeviceConnection');
    expect(componentSource).toContain('const isSetUp = !needsDeviceConnection');
    expect(componentSource).not.toContain('const isSetUp = deviceInfo !== null || isConnected || isSyncingStatus');
  });

  it('keeps restore-required devices out of the healthy synced state until the password is re-entered', () => {
    expect(componentSource).toContain("t('components.sync.restoreAccess')");
    expect(componentSource).toContain("t('components.sync.restorePrompt')");
    expect(english.components.sync.restoreAccess).toBe('Restore Sync Access');
    expect(english.components.sync.restorePrompt).toBe('Enter your sync password again on this device to resume sync');
    expect(engineSource).toContain("status: 'restore-required'");
    expect(engineSource).toContain('Sync password restore required for this device');
    expect(engineSource).toContain('Enter your sync password on this device to resume sync.');
  });

  it('makes restore password expectations explicit and distinguishes it from account login', () => {
    expect(setupDialogSource).toContain("t('components.sync.setup.existingPassword')");
    expect(setupDialogSource).toContain("t('components.sync.setup.restoreDescription')");
    expect(setupDialogSource).toContain("t('components.sync.setup.restoreWarning')");
    expect(english.components.sync.setup.existingPassword).toBe('Existing Sync Password');
    expect(english.components.sync.setup.restoreDescription).toContain('This is not your Supertry account password.');
    expect(english.components.sync.setup.restoreWarning).toContain('If you never created a sync password or cannot remember it');
    expect(english.components.sync.setup.restoreWarning).toContain('we cannot recover it');
  });

  it('shows server-provided device limit metadata and blocks setup when full', () => {
    expect(componentSource).toContain('deviceLimit');
    expect(componentSource).toContain('canAddDevice');
    expect(componentSource).toContain("t('components.sync.deviceLimit')");
    expect(componentSource).toContain("t('components.sync.devices'");
    expect(english.components.sync.deviceLimit).toContain('Device limit reached');
    expect(english.components.sync.devices).toBe('Your Devices ({{label}})');
    expect(hookSource).toContain('deviceLimit: number | null');
    expect(hookSource).toContain('canAddDevice: boolean');
  });

  it('shows an explicit excluded-from-sync modal from the sync settings header', () => {
    expect(componentSource).toContain('ModalTemplate');
    expect(componentSource).toContain("t('components.sync.notSyncedTitle')");
    expect(componentSource).toContain("t('components.sync.exclusions')");
    expect(english.components.sync.notSyncedTitle).toBe('Not synced by Cloud Sync');
    expect(english.components.sync.exclusions).toBe('Sync exclusions');
    expect(english.components.sync.exclusionsItems.integrationsTitle).toBe('Integration tokens and account sessions');
    expect(english.components.sync.exclusionsItems.rssTitle).toBe('RSS feed subscriptions and article cache');
    expect(english.components.sync.exclusionsItems.archiveTitle).toBe('Archive storage and offline readings');
  });

  it('shows a visible pro upsell card instead of hiding the sync section for free users', () => {
    expect(componentSource).toContain("t('components.sync.proTitle')");
    expect(componentSource).toContain('<UpgradeToProButton');
    expect(english.components.sync.proTitle).toBe('Cloud Sync is a Bluetab Pro feature');
    expect(english.auth.account.upgradeToBadge).toBe('Upgrade to <badge/>');
    expect(componentSource).toContain('ProBadge');
    expect(componentSource).not.toContain('if (!isPro) return null');
  });

  it('preserves device-limit errors from the sync engine for settings UI recovery', () => {
    expect(engineSource).toContain("code?: 'sync_device_limit_reached'");
    expect(engineSource).toContain('deviceLimit?: number');
    expect(engineSource).toContain('canAddDevice?: boolean');
    expect(engineSource).toContain('devices: data.devices');
  });

  it('does not mark a newly restored device healthy when snapshot decryption fails', () => {
    expect(engineSource).toContain('const downloadResult = await downloadSnapshots(undefined, deviceId)');
    expect(engineSource).toContain('releaseServerDeviceRegistration(deviceId, token)');
    expect(engineSource).toContain('Unable to decrypt sync data. Check your sync password.');
    expect(engineSource).toContain('const restoredSnapshots: Array<{ key: SyncableKey; data: unknown }> = []');
  });

  it('seeds cloud sync from local state when starting fresh or re-registering an existing local device', () => {
    expect(engineSource).toContain('const hadExistingLocalDeviceInfo = Boolean(existingDeviceInfo)');
    expect(engineSource).toContain('const shouldRestoreRemoteSnapshots');
    expect(engineSource).toContain('const shouldSeedBaseline');
    expect(engineSource).toContain('queueBaselineStateDeltas');
    expect(engineSource).toContain('generateBaselineDeltasForKey');
    expect(engineSource).toContain('downloadSnapshots(undefined, deviceId)');
  });

  it('clears local sync registration when the server rejects a removed device', () => {
    expect(engineSource).toContain('handleDeviceRegistrationError');
    expect(engineSource).toContain('This device is no longer registered for sync.');
    expect(engineSource).toContain('status === 403');
    expect(engineSource).toContain('clearLocalSyncRegistration()');
  });

  it('does not replay large initial sync backlogs one visible page at a time', () => {
    expect(engineSource).toContain('restoreSnapshotForBacklog');
    expect(engineSource).toContain('data.hasMore');
    expect(engineSource).toContain('const snapshotResult = await downloadSnapshots(undefined, deviceId)');
    expect(engineSource).toContain('Snapshot backlog restore complete');
  });

  it('does not treat an empty snapshot restore as a fully synced new device', () => {
    expect(engineSource).toContain('let restoredRemoteSnapshotCount = 0');
    expect(engineSource).toContain('restoredRemoteSnapshotCount = downloadResult.restored');
    expect(engineSource).toContain('restoredRemoteSnapshotCount === 0');
    expect(engineSource).toContain('const initialLastSeq =');
    expect(engineSource).toContain('const postSetupPullResult = await pull()');
  });

  it('restores snapshots through the sync-aware applier instead of echoing them back as local changes', () => {
    expect(engineSource).toContain('await applySnapshot(snapshot.key, snapshot.data)');
    expect(engineSource).not.toContain('await Storage.set(snapshot.key, snapshot.data)');
  });

  it('auto-pushes local deltas while online even when no sync UI is open', () => {
    expect(engineSource).toContain("console.log('[SyncEngine] Auto-pushing deltas...')");
    expect(engineSource).toContain('if (isOnlineState) {');
    expect(engineSource).not.toContain("if (SyncRealtime.getConnectionState() === 'connected' || SyncRealtime.isUIOpen())");
  });

  it('keeps exact local deltas when the sync key is temporarily unavailable and replays them after restore', () => {
    expect(engineSource).toContain("DEFERRED_PLAINTEXT_DELTAS: 'syncDeferredPlaintextDeltas'");
    expect(engineSource).toContain('stashGeneratedDeltasForLater(deltas)');
    expect(engineSource).toContain('processDeferredGeneratedDeltas()');
    expect(engineSource).toContain('deferring plaintext deltas until key restore');
    expect(engineSource).toContain('Re-queued');
  });

  it('pushes local baseline data in server-sized batches before uploading one snapshot', () => {
    expect(engineSource).toContain('const SYNC_PUSH_BATCH_SIZE = 100');
    expect(engineSource).toContain('entries.slice(0, SYNC_PUSH_BATCH_SIZE)');
    expect(engineSource).toContain('let totalPushed = 0');
    expect(engineSource).toContain('remainingEntries.length > 0');
    expect(engineSource).toContain('Post-push snapshot upload failed');
  });
});
