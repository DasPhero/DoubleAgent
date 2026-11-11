import React, { useMemo, useState } from 'react';
import { AppGlobalSettings } from './TerminalView';
import brandLogoText from '../assets/DoubleAgent_Logo_complete_with_text.png';
import {
  SYSTEM_SHORTCUTS,
  ShortcutCategory,
  CustomShortcutItem,
  normalizeKeyboardShortcut,
  findShortcutConflict,
} from '../types/shortcuts';
import type { VaultSyncInfo, VaultConflictReport } from '../types/vaultSync';
import { CyberIcon } from './CyberIcon';

interface WailsSyncApi {
  GetVaultSyncInfo?: () => Promise<VaultSyncInfo>;
  CheckVaultSyncStatus?: () => Promise<VaultSyncInfo>;
  RelocateVaultFile?: (newPath: string, moveExisting: boolean) => Promise<void>;
  ScanSyncConflictFiles?: () => Promise<string[]>;
  MergeExternalVaultFile?: (filePath: string, password: string) => Promise<VaultConflictReport>;
}

function getWailsSyncApi(): WailsSyncApi | undefined {
  const w = window as unknown as { go?: { main?: { App?: WailsSyncApi } } };
  return w.go?.main?.App;
}

export type SettingsTabId = 'appearance' | 'security' | 'sync' | 'shortcuts' | 'migration' | 'about';

export interface SettingsViewProps {
  activeTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  globalSettings: AppGlobalSettings;
  onUpdateSettings: (partial: Partial<AppGlobalSettings>) => void;
  onResetSettings: () => void;
  vaultLocked: boolean;
  passwordless: boolean;
  helloPending: boolean;
  quickUnlockReady: boolean;
  modalError: string;
  onEnableQuickUnlock: () => Promise<void>;
  onChangePassword: (currentPw: string, newPw: string) => Promise<void>;
  onResetVault: () => Promise<void>;
  availableSnippets?: Array<{ id: string; name: string }>;
  syncInfo?: VaultSyncInfo | null;
  onOpenConflictResolver?: (report: VaultConflictReport, conflictFile?: string) => void;
  onRefreshSync?: () => Promise<void>;
  onOpenSSHConfigImport?: () => void;
  onOpenPuttyTermiusImport?: () => void;
  onClose?: () => void;
  onOpenAsTab?: () => void;
  isModal?: boolean;
}

export type CustomShortcut = CustomShortcutItem;

export function SettingsView({
  activeTab,
  onTabChange,
  globalSettings,
  onUpdateSettings,
  onResetSettings,
  vaultLocked,
  passwordless,
  helloPending,
  quickUnlockReady,
  modalError,
  onEnableQuickUnlock,
  onChangePassword,
  onResetVault,
  availableSnippets = [],
  syncInfo,
  onOpenConflictResolver,
  onRefreshSync,
  onOpenSSHConfigImport,
  onOpenPuttyTermiusImport,
  onClose,
  onOpenAsTab,
  isModal = false,
}: SettingsViewProps): React.JSX.Element {
  const [currentPw, setCurrentPw] = useState<string>('');
  const [newPw, setNewPw] = useState<string>('');
  const [confirmPw, setConfirmPw] = useState<string>('');
  const [pwError, setPwError] = useState<string>('');
  const [pwSuccess, setPwSuccess] = useState<string>('');

  // Storage & Sync State (F-29)
  const [relocatePath, setRelocatePath] = useState<string>('');
  const [moveExisting, setMoveExisting] = useState<boolean>(true);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string>('');
  const [syncErrorMsg, setSyncErrorMsg] = useState<string>('');
  const [isRelocating, setIsRelocating] = useState<boolean>(false);
  const [manualMergePath, setManualMergePath] = useState<string>('');
  const [manualMergePw, setManualMergePw] = useState<string>('');
  const [isMerging, setIsMerging] = useState<boolean>(false);

  React.useEffect(() => {
    if (activeTab === 'sync' && onRefreshSync) {
      void onRefreshSync();
    }
  }, [activeTab, onRefreshSync]);

  // Shortcuts & Leader Key State
  const currentKeybindings = useMemo(() => globalSettings.keybindings || {}, [globalSettings.keybindings]);
  const currentCustomShortcuts = useMemo(
    () => globalSettings.customShortcuts || [],
    [globalSettings.customShortcuts]
  );
  const leaderEnabled = globalSettings.leaderKeyEnabled ?? false;
  const leaderKey = globalSettings.leaderKey || 'Ctrl+B';
  const leaderTimeout = globalSettings.leaderTimeoutMs || 2000;

  const [shortcutCategory, setShortcutCategory] = useState<ShortcutCategory | 'all'>('all');
  const [shortcutSearch, setShortcutSearch] = useState<string>('');
  const [recordingActionId, setRecordingActionId] = useState<string | null>(null);
  const [recordedCombo, setRecordedCombo] = useState<string>('');
  const [conflictWarning, setConflictWarning] = useState<string>('');

  // Add Custom Shortcut Modal / Form State
  const [showAddShortcut, setShowAddShortcut] = useState<boolean>(false);
  const [customType, setCustomType] = useState<'action' | 'snippet'>('action');
  const [newShortcutAction, setNewShortcutAction] = useState<string>('Quick Connect');
  const [selectedSnippetId, setSelectedSnippetId] = useState<string>('');
  const [newShortcutKey, setNewShortcutKey] = useState<string>('');
  const [isRecordingCustom, setIsRecordingCustom] = useState<boolean>(false);
  const [customConflictWarning, setCustomConflictWarning] = useState<string>('');

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');

    if (newPw && confirmPw && newPw !== confirmPw) {
      setPwError('New passwords do not match.');
      return;
    }

    try {
      await onChangePassword(currentPw, newPw);
      setPwSuccess('Master Password updated successfully.');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPwError(msg);
    }
  };

  const handleRelocateVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relocatePath.trim()) return;
    setIsRelocating(true);
    setSyncErrorMsg('');
    setSyncStatusMsg('');
    const api = getWailsSyncApi();
    if (!api?.RelocateVaultFile) {
      setSyncStatusMsg('Vault relocated successfully (mock mode).');
      setIsRelocating(false);
      return;
    }
    try {
      await api.RelocateVaultFile(relocatePath.trim(), moveExisting);
      setSyncStatusMsg('Encrypted vault file successfully relocated!');
      setRelocatePath('');
      if (onRefreshSync) await onRefreshSync();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSyncErrorMsg(`Relocation failed: ${msg}`);
    } finally {
      setIsRelocating(false);
    }
  };

  const handleCheckSync = async () => {
    setSyncErrorMsg('');
    setSyncStatusMsg('');
    const api = getWailsSyncApi();
    if (!api?.CheckVaultSyncStatus) {
      setSyncStatusMsg('Checked vault synchronization status.');
      return;
    }
    try {
      const updated = await api.CheckVaultSyncStatus();
      if (updated.status === 'conflict') {
        setSyncStatusMsg(`External conflict detected (${updated.conflictCount} items)!`);
      } else if (updated.status === 'external_change') {
        setSyncStatusMsg('External file modification detected.');
      } else {
        setSyncStatusMsg('In sync: Local file matches active vault.');
      }
      if (onRefreshSync) await onRefreshSync();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSyncErrorMsg(`Sync check failed: ${msg}`);
    }
  };

  const handleMergeFile = async (filePath: string, password = '') => {
    if (!filePath.trim()) return;
    setIsMerging(true);
    setSyncErrorMsg('');
    setSyncStatusMsg('');
    const api = getWailsSyncApi();
    if (!api?.MergeExternalVaultFile) {
      setSyncStatusMsg('External vault merged successfully (mock mode).');
      setIsMerging(false);
      return;
    }
    try {
      const report = await api.MergeExternalVaultFile(filePath.trim(), password);
      if (report.hasConflicts) {
        if (onOpenConflictResolver) {
          onOpenConflictResolver(report, filePath);
        } else {
          setSyncStatusMsg(`Conflicts detected (${report.conflicts.length} items). Please open conflict resolver.`);
        }
      } else {
        setSyncStatusMsg(`Successfully merged external vault (${report.autoMerged} items auto-merged)!`);
        setManualMergePath('');
        setManualMergePw('');
        if (onRefreshSync) await onRefreshSync();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSyncErrorMsg(`Merge failed: ${msg}`);
    } finally {
      setIsMerging(false);
    }
  };

  const handleSaveRecordedKey = (actionId: string) => {
    if (!recordedCombo) return;
    const updated = { ...currentKeybindings, [actionId]: recordedCombo };
    onUpdateSettings({ keybindings: updated });
    setRecordingActionId(null);
    setRecordedCombo('');
    setConflictWarning('');
  };

  const handleResetSingleBinding = (actionId: string) => {
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(currentKeybindings)) {
      if (k !== actionId) {
        updated[k] = v;
      }
    }
    onUpdateSettings({ keybindings: updated });
    if (recordingActionId === actionId) {
      setRecordingActionId(null);
      setRecordedCombo('');
      setConflictWarning('');
    }
  };

  const handleResetAllBindings = () => {
    if (confirm('Reset all keyboard shortcuts and leader keys to factory defaults?')) {
      onUpdateSettings({
        keybindings: {},
        customShortcuts: [],
        leaderKeyEnabled: false,
        leaderKey: 'Ctrl+B',
        leaderTimeoutMs: 2000,
      });
      setRecordingActionId(null);
      setRecordedCombo('');
      setConflictWarning('');
    }
  };

  const handleAddCustomShortcut = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShortcutKey.trim()) return;

    let actionLabel = newShortcutAction;
    let snippetName: string | undefined;

    if (customType === 'snippet') {
      const snip = availableSnippets.find((s) => s.id === selectedSnippetId);
      if (snip) {
        actionLabel = `Run: ${snip.name}`;
        snippetName = snip.name;
      }
    }

    const newItem: CustomShortcutItem = {
      id: `custom-sc-${Date.now()}`,
      action: actionLabel,
      keyCombo: newShortcutKey.trim(),
      snippetId: customType === 'snippet' ? selectedSnippetId : undefined,
      snippetName,
    };

    onUpdateSettings({
      customShortcuts: [...currentCustomShortcuts, newItem],
    });

    setNewShortcutKey('');
    setShowAddShortcut(false);
    setIsRecordingCustom(false);
    setCustomConflictWarning('');
  };

  const handleRemoveCustomShortcut = (id: string) => {
    onUpdateSettings({
      customShortcuts: currentCustomShortcuts.filter((s) => s.id !== id),
    });
  };

  return (
    <div
      className={isModal ? 'modal-card settings-card' : 'settings-workspace-view'}
      style={
        !isModal
          ? {
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              maxWidth: '860px',
              margin: '0 auto',
              width: '100%',
              padding: '1.5rem',
              boxSizing: 'border-box',
            }
          : undefined
      }
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
        <div>
          <h2 style={{ margin: '0 0 0.25rem 0' }}>Global Settings &amp; Preferences</h2>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Customize terminal appearance, default fonts, vault security, and custom keyboard shortcuts.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {isModal && onOpenAsTab && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={onOpenAsTab}
              title="Open Settings in a dedicated workspace tab"
            >
              🗗 Open as Tab
            </button>
          )}
          {isModal && onClose && (
            <button
              type="button"
              className="tab-close-btn"
              onClick={onClose}
              aria-label="Close Settings"
              style={{ fontSize: '1.2rem', padding: '0 0.4rem' }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Tabs navigation */}
      <div className="settings-tab-nav" role="tablist" aria-label="Settings Subsections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'appearance'}
          className={`settings-tab-btn ${activeTab === 'appearance' ? 'active' : ''}`}
          onClick={() => onTabChange('appearance')}
        >
          🎨 Appearance &amp; Terminal
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'security'}
          className={`settings-tab-btn ${activeTab === 'security' ? 'active' : ''}`}
          onClick={() => onTabChange('security')}
        >
          🔒 Vault &amp; Security
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'sync'}
          className={`settings-tab-btn ${activeTab === 'sync' ? 'active' : ''}`}
          onClick={() => onTabChange('sync')}
        >
          ☁️ Storage &amp; Sync
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'shortcuts'}
          className={`settings-tab-btn ${activeTab === 'shortcuts' ? 'active' : ''}`}
          onClick={() => onTabChange('shortcuts')}
        >
          ⌨️ Keyboard Shortcuts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'migration'}
          className={`settings-tab-btn ${activeTab === 'migration' ? 'active' : ''}`}
          onClick={() => onTabChange('migration')}
        >
          📥 Config Migration
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'about'}
          className={`settings-tab-btn ${activeTab === 'about' ? 'active' : ''}`}
          onClick={() => onTabChange('about')}
        >
          ℹ About DoubleAgent
        </button>
      </div>

      {/* Tab 1: Appearance & Terminal */}
      {activeTab === 'appearance' && (
        <div className="settings-grid" role="tabpanel" aria-label="Appearance & Terminal Settings">
          <section className="settings-section">
            <h3>Color Theme</h3>
            <div className="theme-options-grid">
              {(
                [
                  { id: 'teal', label: 'Teal (Cyber)', swatch: '#2dd4bf' },
                  { id: 'dracula', label: 'Dracula', swatch: '#bd93f9' },
                  { id: 'one-dark', label: 'One Dark', swatch: '#61afef' },
                  { id: 'nord', label: 'Nord', swatch: '#88c0d0' },
                  { id: 'monokai', label: 'Monokai Pro', swatch: '#ffd866' },
                  { id: 'crimson', label: 'Crimson', swatch: '#f43f5e' },
                ] as const
              ).map((th) => (
                <button
                  key={th.id}
                  type="button"
                  className={`theme-card-btn ${globalSettings.colorTheme === th.id ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ colorTheme: th.id })}
                >
                  <span className="theme-swatch" style={{ backgroundColor: th.swatch }} />
                  <span>{th.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <h3>Terminal Font &amp; Layout</h3>
            <div className="settings-field-row">
              <label htmlFor="setting-font-family">Font Family</label>
              <select
                id="setting-font-family"
                aria-label="Font Family"
                value={globalSettings.fontFamily}
                onChange={(e) => onUpdateSettings({ fontFamily: e.target.value })}
              >
                <option value="'Cascadia Code', 'JetBrains Mono', Consolas, monospace">
                  Cascadia Code (Recommended)
                </option>
                <option value="'JetBrains Mono', Consolas, monospace">JetBrains Mono</option>
                <option value="'Fira Code', Consolas, monospace">Fira Code</option>
                <option value="Consolas, 'Courier New', monospace">Consolas</option>
                <option value="'Source Code Pro', Consolas, monospace">Source Code Pro</option>
                <option value="monospace">System Monospace</option>
              </select>
            </div>

            <div className="settings-field-row">
              <label htmlFor="setting-font-size">Default Font Size</label>
              <input
                id="setting-font-size"
                aria-label="Default Font Size"
                type="number"
                min={9}
                max={32}
                value={globalSettings.fontSize}
                onChange={(e) =>
                  onUpdateSettings({ fontSize: Number(e.target.value) || 14 })
                }
              />
            </div>

            <div className="settings-field-row">
              <label htmlFor="setting-line-height">Line Height</label>
              <select
                id="setting-line-height"
                aria-label="Line Height"
                value={globalSettings.lineHeight}
                onChange={(e) =>
                  onUpdateSettings({ lineHeight: Number(e.target.value) || 1.2 })
                }
              >
                <option value="1.0">1.0 (Compact)</option>
                <option value="1.1">1.1 (Standard)</option>
                <option value="1.2">1.2 (Comfortable - Default)</option>
                <option value="1.3">1.3 (Spacious)</option>
                <option value="1.4">1.4 (Loose)</option>
              </select>
            </div>

            <div className="settings-field-row">
              <label htmlFor="setting-cursor-style">Cursor Style</label>
              <select
                id="setting-cursor-style"
                aria-label="Cursor Style"
                value={globalSettings.cursorStyle}
                onChange={(e) =>
                  onUpdateSettings({
                    cursorStyle: e.target.value as 'block' | 'underline' | 'bar',
                  })
                }
              >
                <option value="block">Block</option>
                <option value="underline">Underline</option>
                <option value="bar">Bar</option>
              </select>
            </div>

            <div className="settings-field-row">
              <label htmlFor="setting-cursor-blink">Cursor Blink</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  id="setting-cursor-blink"
                  aria-label="Cursor Blink"
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={globalSettings.cursorBlink}
                  onChange={(e) => onUpdateSettings({ cursorBlink: e.target.checked })}
                />
                <span>Blink cursor when active</span>
              </label>
            </div>

            <div className="settings-field-row">
              <label htmlFor="setting-scrollback">Scrollback Lines</label>
              <select
                id="setting-scrollback"
                aria-label="Scrollback Lines"
                value={globalSettings.scrollback}
                onChange={(e) =>
                  onUpdateSettings({ scrollback: Number(e.target.value) || 10000 })
                }
              >
                <option value="5000">5,000 lines</option>
                <option value="10000">10,000 lines (Default)</option>
                <option value="20000">20,000 lines</option>
                <option value="50000">50,000 lines</option>
              </select>
            </div>
          </section>

          <section className="settings-section">
            <h3>Connection &amp; Session Restore</h3>
            <div className="settings-field-row">
              <label htmlFor="setting-auto-reconnect">Auto-Reconnect</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  id="setting-auto-reconnect"
                  aria-label="Auto-Reconnect"
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={globalSettings.autoReconnect !== false}
                  onChange={(e) => onUpdateSettings({ autoReconnect: e.target.checked })}
                />
                <span>Automatically reconnect lost SSH sessions with exponential backoff</span>
              </label>
            </div>

            <div className="settings-field-row">
              <label htmlFor="setting-max-reconnect">Max Reconnect Attempts</label>
              <select
                id="setting-max-reconnect"
                aria-label="Max Reconnect Attempts"
                value={globalSettings.maxReconnectAttempts || 5}
                onChange={(e) =>
                  onUpdateSettings({ maxReconnectAttempts: Number(e.target.value) || 5 })
                }
              >
                <option value="3">3 Attempts</option>
                <option value="5">5 Attempts (Default)</option>
                <option value="10">10 Attempts</option>
              </select>
            </div>

            <div className="settings-field-row">
              <label htmlFor="setting-session-restore">Workspace Session Restore</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  id="setting-session-restore"
                  aria-label="Workspace Session Restore"
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={Boolean(globalSettings.sessionRestoreEnabled)}
                  onChange={(e) => onUpdateSettings({ sessionRestoreEnabled: e.target.checked })}
                />
                <span>Restore open tabs, split panes, and layout on launch (workspace.json)</span>
              </label>
            </div>
          </section>

          <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onResetSettings}
              title="Restore default settings"
            >
              Reset to Defaults
            </button>
          </div>
        </div>
      )}

      {/* Tab 2: Vault & Security */}
      {activeTab === 'security' && (
        <div className="settings-grid" role="tabpanel" aria-label="Vault & Security Settings">
          <section className="settings-section">
            <h3>Master Password &amp; Encryption</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
              {passwordless
                ? 'Your vault is currently operating in passwordless mode protected by system DPAPI/keychain.'
                : 'Change your Master Password to re-encrypt your saved hosts and credentials.'}
            </p>

            <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {!passwordless && (
                <div className="settings-field-row">
                  <label htmlFor="setting-curr-pw">Current Password</label>
                  <input
                    id="setting-curr-pw"
                    aria-label="Current Master Password"
                    type="password"
                    placeholder="Current Master Password (optional if unlocked via Hello)"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                  />
                </div>
              )}

              <div className="settings-field-row">
                <label htmlFor="setting-new-pw">New Password</label>
                <input
                  id="setting-new-pw"
                  aria-label="New Master Password"
                  type="password"
                  placeholder="New Master Password (leave empty for passwordless)"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                />
              </div>

              {newPw && (
                <div className="settings-field-row">
                  <label htmlFor="setting-confirm-pw">Confirm Password</label>
                  <input
                    id="setting-confirm-pw"
                    aria-label="Confirm New Master Password"
                    type="password"
                    placeholder="Confirm New Master Password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                  />
                </div>
              )}

              {pwError && <div className="error-banner">{pwError}</div>}
              {pwSuccess && <div className="info-banner" style={{ color: '#3fb950' }}>{pwSuccess}</div>}
              {modalError && <div className="error-banner">{modalError}</div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.4rem' }}>
                <button type="submit" className="btn-primary" disabled={vaultLocked}>
                  Save Master Password
                </button>
              </div>
            </form>
          </section>

          <section className="settings-section">
            <h3>Windows Hello / Fast Biometrics</h3>
            <div className="quick-unlock-box">
              <span>
                Windows Hello / Hardware Key:{' '}
                <strong>{quickUnlockReady ? 'Active & Ready' : 'Not Armed'}</strong>
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={helloPending || vaultLocked}
                onClick={() => void onEnableQuickUnlock()}
              >
                {helloPending ? 'Syncing...' : 'Sync Windows Hello / Key'}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h3>Danger Zone</h3>
            <p style={{ fontSize: '0.8rem', color: '#ff7b72', margin: 0 }}>
              Resetting the vault archives all stored secrets and creates a clean configuration file.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '0.3rem' }}>
              <button
                type="button"
                className="btn-danger"
                onClick={() => void onResetVault()}
                title="Archives current vault and starts fresh"
              >
                Reset Encrypted Vault
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Tab 3: Keyboard Shortcuts & Leader Key (F-18) */}
      {activeTab === 'shortcuts' && (
        <div className="settings-grid" role="tabpanel" aria-label="Keyboard Shortcuts Settings">
          {/* Section A: Leader / Prefix Key Mode (Tmux style) */}
          <section className="settings-section">
            <div className="leader-config-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <div>
                  <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>⌨️ Leader Key / Prefix Mode</span>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        padding: '0.1rem 0.45rem',
                        borderRadius: '9999px',
                        background: leaderEnabled ? 'rgba(45, 212, 191, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                        color: leaderEnabled ? '#2dd4bf' : 'var(--text-muted)',
                      }}
                    >
                      {leaderEnabled ? 'Active' : 'Disabled'}
                    </span>
                  </h3>
                  <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Eliminate keystroke collisions with terminal programs (<code>vim</code>, <code>tmux</code>, <code>nano</code>). When enabled, DoubleAgent only listens for shortcut commands after pressing the prefix key.
                  </p>
                </div>
                <label className="toggle-switch-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    aria-label="Enable Leader Key Mode"
                    checked={leaderEnabled}
                    onChange={(e) => onUpdateSettings({ leaderKeyEnabled: e.target.checked })}
                  />
                  <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Enable Leader Mode</span>
                </label>
              </div>

              {leaderEnabled && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                      Leader Key Combo
                    </label>
                    <select
                      aria-label="Leader Key Combination"
                      value={leaderKey}
                      onChange={(e) => onUpdateSettings({ leaderKey: e.target.value })}
                      style={{ width: '100%' }}
                    >
                      <option value="Ctrl+B">Ctrl + B (Tmux Default)</option>
                      <option value="Ctrl+A">Ctrl + A (Screen Default)</option>
                      <option value="Ctrl+Space">Ctrl + Space</option>
                      <option value="Alt+Space">Alt + Space</option>
                      <option value="Ctrl+Q">Ctrl + Q</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                      Leader Timeout (Auto-disarm)
                    </label>
                    <select
                      aria-label="Leader Timeout"
                      value={leaderTimeout}
                      onChange={(e) => onUpdateSettings({ leaderTimeoutMs: Number(e.target.value) })}
                      style={{ width: '100%' }}
                    >
                      <option value={1000}>1.0 second</option>
                      <option value={1500}>1.5 seconds</option>
                      <option value={2000}>2.0 seconds (Recommended)</option>
                      <option value={3000}>3.0 seconds</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Section B: System Keybindings with Interactive Rebinding & Conflict Detection */}
          <section className="settings-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>System Keybindings &amp; Actions</h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Click Rebind on any action to capture a new key combination. DoubleAgent automatically checks for key conflicts.
                </span>
              </div>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={handleResetAllBindings}
                title="Restore all keyboard shortcuts to factory defaults"
              >
                ↺ Reset All to Defaults
              </button>
            </div>

            {/* Filter Chips & Search Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', gap: '0.5rem', flexWrap: 'wrap' }}>
              <div className="shortcuts-filter-bar" style={{ margin: 0 }}>
                {(
                  [
                    { id: 'all', label: 'All Actions' },
                    { id: 'navigation', label: 'Navigation & Tabs' },
                    { id: 'terminal', label: 'Terminal & Font' },
                    { id: 'sessions', label: 'Sessions & CWD' },
                    { id: 'tools', label: 'Tools & Modals' },
                  ] as const
                ).map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`shortcuts-filter-btn ${shortcutCategory === cat.id ? 'active' : ''}`}
                    onClick={() => setShortcutCategory(cat.id)}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Search shortcuts..."
                value={shortcutSearch}
                onChange={(e) => setShortcutSearch(e.target.value)}
                style={{ width: '180px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}
              />
            </div>

            {/* Keybindings Table */}
            <table className="shortcuts-table">
              <thead>
                <tr>
                  <th style={{ width: '38%' }}>Action</th>
                  <th style={{ width: '22%' }}>Active Shortcut</th>
                  {leaderEnabled && <th style={{ width: '18%' }}>Leader Chord</th>}
                  <th style={{ width: '22%', textAlign: 'right' }}>Customization</th>
                </tr>
              </thead>
              <tbody>
                {SYSTEM_SHORTCUTS.filter((def) => {
                  if (shortcutCategory !== 'all' && def.category !== shortcutCategory) return false;
                  if (shortcutSearch.trim()) {
                    const q = shortcutSearch.toLowerCase();
                    return (
                      def.label.toLowerCase().includes(q) ||
                      def.description.toLowerCase().includes(q) ||
                      def.defaultKey.toLowerCase().includes(q) ||
                      (currentKeybindings[def.actionId] || '').toLowerCase().includes(q)
                    );
                  }
                  return true;
                }).map((def) => {
                  const isRecording = recordingActionId === def.actionId;
                  const customKey = currentKeybindings[def.actionId];
                  const activeKey = customKey || def.defaultKey;
                  const isOverridden = Boolean(customKey && customKey !== def.defaultKey);

                  return (
                    <tr key={def.actionId}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-bright)' }}>{def.label}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{def.description}</div>
                      </td>
                      <td>
                        {isRecording ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <div
                              tabIndex={0}
                              className="key-record-box"
                              onKeyDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (e.key === 'Escape') {
                                  setRecordingActionId(null);
                                  setRecordedCombo('');
                                  setConflictWarning('');
                                  return;
                                }
                                const combo = normalizeKeyboardShortcut(e.nativeEvent);
                                if (combo) {
                                  setRecordedCombo(combo);
                                  const conflict = findShortcutConflict(currentKeybindings, def.actionId, combo);
                                  setConflictWarning(conflict ? conflict.label : '');
                                }
                              }}
                            >
                              <span>🔴</span>
                              <span>{recordedCombo || 'Press key combo...'}</span>
                            </div>
                            {conflictWarning && (
                              <div className="shortcut-conflict-warning">
                                ⚠️ Conflicts with: <strong>{conflictWarning}</strong>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className={`key-badge ${isOverridden ? 'key-badge-custom' : ''}`}>
                            {activeKey}
                          </span>
                        )}
                      </td>
                      {leaderEnabled && (
                        <td>
                          {def.leaderKey ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                              Leader + <strong>{def.leaderKey}</strong>
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                      )}
                      <td style={{ textAlign: 'right' }}>
                        {isRecording ? (
                          <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                            <button
                              type="button"
                              className="btn-primary btn-sm"
                              disabled={!recordedCombo}
                              onClick={() => handleSaveRecordedKey(def.actionId)}
                              style={{ padding: '0.15rem 0.45rem', fontSize: '0.72rem' }}
                            >
                              ✓ Save
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              onClick={() => {
                                setRecordingActionId(null);
                                setRecordedCombo('');
                                setConflictWarning('');
                              }}
                              style={{ padding: '0.15rem 0.45rem', fontSize: '0.72rem' }}
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              onClick={() => {
                                setRecordingActionId(def.actionId);
                                setRecordedCombo('');
                                setConflictWarning('');
                              }}
                              style={{ padding: '0.15rem 0.45rem', fontSize: '0.72rem' }}
                            >
                              ⌨️ Rebind
                            </button>
                            {isOverridden && (
                              <button
                                type="button"
                                className="btn-secondary btn-sm"
                                onClick={() => handleResetSingleBinding(def.actionId)}
                                title="Reset to default key"
                                style={{ padding: '0.15rem 0.45rem', fontSize: '0.72rem' }}
                              >
                                ↺ Reset
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* Section C: Custom Shortcuts & Snippet Launchers */}
          <section className="settings-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0 }}>Custom Hotkeys &amp; Snippet Launchers</h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Bind custom hotkeys to trigger actions or run command snippets directly into active terminals.
                </span>
              </div>
              {!showAddShortcut && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    setShowAddShortcut(true);
                    setNewShortcutKey('');
                    setIsRecordingCustom(false);
                    setCustomConflictWarning('');
                    if (availableSnippets.length > 0 && !selectedSnippetId) {
                      setSelectedSnippetId(availableSnippets[0].id);
                    }
                  }}
                >
                  + Add Custom Shortcut
                </button>
              )}
            </div>

            {showAddShortcut && (
              <form
                onSubmit={handleAddCustomShortcut}
                style={{
                  padding: '0.8rem',
                  backgroundColor: 'rgba(9, 13, 20, 0.7)',
                  borderRadius: '6px',
                  border: '1px solid var(--border-accent)',
                  marginTop: '0.6rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.8rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                      Shortcut Target Type
                    </label>
                    <select
                      value={customType}
                      onChange={(e) => setCustomType(e.target.value as 'action' | 'snippet')}
                      style={{ width: '100%' }}
                    >
                      <option value="action">System Action</option>
                      <option value="snippet">Run Command Snippet</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                      {customType === 'snippet' ? 'Target Snippet' : 'Target Action'}
                    </label>
                    {customType === 'snippet' ? (
                      availableSnippets.length > 0 ? (
                        <select
                          value={selectedSnippetId}
                          onChange={(e) => setSelectedSnippetId(e.target.value)}
                          style={{ width: '100%' }}
                        >
                          {availableSnippets.map((s) => (
                            <option key={s.id} value={s.id}>
                              ⚡ {s.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', paddingTop: '0.4rem' }}>
                          No snippets in vault yet. Create one under Tools ▾ &rarr; Snippets.
                        </div>
                      )
                    ) : (
                      <select
                        value={newShortcutAction}
                        onChange={(e) => setNewShortcutAction(e.target.value)}
                        style={{ width: '100%' }}
                      >
                        <option value="Quick Connect">Quick Connect Bar</option>
                        <option value="Port Forwarding Dialog">Port Forwarding Dialog</option>
                        <option value="SSH Keychain">SSH Keychain</option>
                        <option value="Open Default Dir Terminal">Open Default Dir Terminal</option>
                        <option value="Open Current Dir Terminal">Open Current Dir Terminal</option>
                        <option value="Open Root Shell Terminal">Open Root Shell Terminal</option>
                        <option value="Disconnect Active Session">Disconnect Active Session</option>
                        <option value="Lock Vault">Lock Vault</option>
                      </select>
                    )}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                      Key Combination
                    </label>
                    <div
                      tabIndex={0}
                      className="key-record-box"
                      style={{ width: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
                      onFocus={() => setIsRecordingCustom(true)}
                      onBlur={() => setIsRecordingCustom(false)}
                      onKeyDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.key === 'Escape') {
                          setIsRecordingCustom(false);
                          return;
                        }
                        const combo = normalizeKeyboardShortcut(e.nativeEvent);
                        if (combo) {
                          setNewShortcutKey(combo);
                          const conflict = findShortcutConflict(currentKeybindings, '', combo);
                          setCustomConflictWarning(conflict ? conflict.label : '');
                        }
                      }}
                    >
                      <span>{isRecordingCustom ? '🔴' : '⌨️'}</span>
                      <span>{newShortcutKey || (isRecordingCustom ? 'Press desired keys...' : 'Click to record keys...')}</span>
                    </div>
                    {customConflictWarning && (
                      <div className="shortcut-conflict-warning">
                        ⚠️ Conflicts with: <strong>{customConflictWarning}</strong>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.3rem' }}>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      setShowAddShortcut(false);
                      setNewShortcutKey('');
                      setIsRecordingCustom(false);
                      setCustomConflictWarning('');
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary btn-sm"
                    disabled={!newShortcutKey.trim() || (customType === 'snippet' && !selectedSnippetId)}
                  >
                    Save Custom Shortcut
                  </button>
                </div>
              </form>
            )}

            {currentCustomShortcuts.length > 0 ? (
              <table className="shortcuts-table" style={{ marginTop: '0.6rem' }}>
                <thead>
                  <tr>
                    <th style={{ width: '60%' }}>Custom Action / Target</th>
                    <th style={{ width: '25%' }}>Key Combination</th>
                    <th style={{ width: '15%', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentCustomShortcuts.map((sc) => (
                    <tr key={sc.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-bright)' }}>{sc.action}</div>
                        {sc.snippetName && (
                          <span style={{ fontSize: '0.72rem', color: '#2dd4bf' }}>
                            ⚡ Bound to snippet: {sc.snippetName}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="key-badge key-badge-custom">{sc.keyCombo}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="tab-close-btn"
                          onClick={() => handleRemoveCustomShortcut(sc.id)}
                          title="Remove custom shortcut"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '0.75rem 0' }}>
                No custom shortcuts configured yet. Click &quot;+ Add Custom Shortcut&quot; above to bind custom key combinations.
              </div>
            )}
          </section>
        </div>
      )}

      {/* Tab: Storage & Sync (F-29) */}
      {activeTab === 'sync' && (
        <div className="settings-tab-content" role="tabpanel" aria-label="Storage & Sync Settings">
          {syncStatusMsg && (
            <div className="alert-success" style={{ marginBottom: '1rem' }}>
              {syncStatusMsg}
            </div>
          )}
          {syncErrorMsg && (
            <div className="alert-danger" style={{ marginBottom: '1rem' }}>
              {syncErrorMsg}
            </div>
          )}

          {/* Card 1: Active Vault Location & Live Telemetry */}
          <section className="settings-section storage-sync-card">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CyberIcon name="shield" size={15} />
              <span>Active Vault Location &amp; Sync State (F-29)</span>
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              DoubleAgent stores all hosts, credentials, SSH keys, port forwarding rules, notes, and 2FA tokens
              inside a single tamper-evident encrypted vault file.
            </p>

            <div style={{ margin: '1rem 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>VAULT FILE PATH:</span>
                {syncInfo && (
                  <span className={`sync-status-pill ${syncInfo.status}`}>
                    {syncInfo.status === 'synced' && '🟢 IN SYNC (Disk matches memory)'}
                    {syncInfo.status === 'external_change' && '🟡 EXTERNAL CHANGE DETECTED'}
                    {syncInfo.status === 'conflict' && `🔴 CONFLICT (${syncInfo.conflictCount} items)`}
                  </span>
                )}
              </div>
              <div className="font-mono" style={{ background: 'rgba(5, 9, 16, 0.8)', padding: '0.65rem 0.85rem', border: '1px solid rgba(255, 255, 255, 0.1)', wordBreak: 'break-all', fontSize: '0.8rem', color: '#00f0ff' }}>
                {syncInfo?.filePath || 'Default user config directory'}
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                <span>File Size: <strong>{syncInfo ? `${(syncInfo.fileSize / 1024).toFixed(1)} KB` : 'Unknown'}</strong></span>
                <span>Last Modified: <strong>{syncInfo?.lastModified ? new Date(syncInfo.lastModified * 1000).toLocaleString() : 'Unknown'}</strong></span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => void handleCheckSync()}
              >
                🔄 Check for External Changes
              </button>
            </div>
          </section>

          {/* Card 2: Detected Cloud Sync Conflict Files (Syncthing / Google Drive) */}
          {syncInfo?.syncConflictFiles && syncInfo.syncConflictFiles.length > 0 && (
            <section className="settings-section storage-sync-card" style={{ borderLeft: '3px solid #f59e0b' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f59e0b' }}>
                <CyberIcon name="bolt" size={15} />
                <span>Detected Cloud Sync Conflicts ({syncInfo.syncConflictFiles.length})</span>
              </h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Syncthing or Google Drive generated conflict copy files when changes were synced from another machine.
                You can review the diffs and safely merge them into your primary vault:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                {syncInfo.syncConflictFiles.map((f) => (
                  <div key={f} className="conflict-file-item">
                    <div style={{ overflow: 'hidden' }}>
                      <div className="font-mono" style={{ fontSize: '0.78rem', color: '#f59e0b', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                        {f.split(/[/\\]/).pop()}
                      </div>
                      <div className="font-mono" style={{ fontSize: '0.68rem', color: '#64748b' }}>
                        {f}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => void handleMergeFile(f)}
                      disabled={isMerging}
                    >
                      {isMerging ? 'Merging...' : 'Review & Merge'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Card 3: Relocate Vault File (Google Drive / Syncthing Folder) */}
          <section className="settings-section storage-sync-card">
            <h3>Relocate Vault Storage Path</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Move or point your encrypted vault to a Google Drive, Syncthing, Dropbox, or OneDrive folder to automatically
              sync your servers and configurations across all your devices.
            </p>
            <form onSubmit={handleRelocateVault} style={{ marginTop: '0.85rem' }}>
              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                <label htmlFor="relocate-path" style={{ display: 'block', fontSize: '0.78rem', marginBottom: '0.25rem' }}>
                  Target Vault Path:
                </label>
                <input
                  id="relocate-path"
                  type="text"
                  className="form-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. C:\Users\YourName\Google Drive\DoubleAgent\doubleagent.vault"
                  value={relocatePath}
                  onChange={(e) => setRelocatePath(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={moveExisting}
                    onChange={(e) => setMoveExisting(e.target.checked)}
                  />
                  <span>Move current vault file and biometrics to new location</span>
                </label>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={isRelocating || !relocatePath.trim()}
              >
                {isRelocating ? 'Relocating...' : 'Relocate Vault'}
              </button>
            </form>
          </section>

          {/* Card 4: Manual External Vault Merge */}
          <section className="settings-section storage-sync-card">
            <h3>Merge External Vault Backup</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Manually import and merge another <code>.vault</code> file into your active vault with automatic conflict detection.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px auto', gap: '0.5rem', marginTop: '0.85rem' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Path to external .vault file"
                value={manualMergePath}
                onChange={(e) => setManualMergePath(e.target.value)}
              />
              <input
                type="password"
                className="form-input"
                placeholder="Password (if different)"
                value={manualMergePw}
                onChange={(e) => setManualMergePw(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isMerging || !manualMergePath.trim()}
                onClick={() => void handleMergeFile(manualMergePath, manualMergePw)}
              >
                {isMerging ? 'Merging...' : 'Merge Vault'}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Tab: Config Migration */}
      {activeTab === 'migration' && (
        <div className="settings-grid" role="tabpanel" aria-label="Config Migration Settings">
          <section className="settings-section">
            <h3>Config &amp; Session Migration</h3>
            <p className="setting-description">
              Migrate existing host definitions, keys, jump chains, and session configurations from OpenSSH, PuTTY, or Termius directly into your encrypted vault.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
              {/* Card 1: OpenSSH config */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>⚙️</span>
                    <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-bright)' }}>OpenSSH Configuration</h4>
                  </div>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: '1.5', margin: '0 0 1rem 0' }}>
                    Parse and import host declarations from <code>~/.ssh/config</code>. Supports HostName, User, Port, IdentityFile, and ProxyJump directives.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ alignSelf: 'flex-start', padding: '0.45rem 1rem', fontSize: '0.82rem' }}
                  onClick={() => onOpenSSHConfigImport?.()}
                >
                  Import ssh_config
                </button>
              </div>

              {/* Card 2: PuTTY / Termius */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>📥</span>
                    <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-bright)' }}>PuTTY &amp; Termius Sessions (F-30)</h4>
                  </div>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: '1.5', margin: '0 0 1rem 0' }}>
                    Scan Windows Registry or .reg exports for saved PuTTY sessions, or import JSON session backups exported from Termius.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ alignSelf: 'flex-start', padding: '0.45rem 1rem', fontSize: '0.82rem' }}
                  onClick={() => onOpenPuttyTermiusImport?.()}
                >
                  Import PuTTY / Termius
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Tab 4: About DoubleAgent */}
      {activeTab === 'about' && (
        <div className="settings-tab-content">
          <section className="settings-section" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
            <img src={brandLogoText} alt="DoubleAgent" className="about-hero-img" />
            <h2 style={{ margin: '0.25rem 0', color: 'var(--text-bright)' }}>DoubleAgent SSH Client</h2>
            <div style={{ display: 'inline-block', padding: '0.2rem 0.65rem', borderRadius: '9999px', background: 'var(--accent-glow)', color: 'var(--accent-text)', fontSize: '0.8rem', fontWeight: 600, marginBottom: '1.25rem' }}>
              Version 0.1.0 • Native Desktop Build
            </div>
            <p style={{ maxWidth: '620px', margin: '0 auto 1.5rem auto', color: 'var(--text-muted)', lineHeight: '1.5', fontSize: '0.88rem' }}>
              A high-performance, cross-platform native SSH client engineered in Go and React with system WebView shell. Features tabbed &amp; split-pane xterm.js terminals, encrypted local vault, SFTP file browser, port forwarding (-L, -R, -D), proxy chains, and hardware serial UART diagnostics.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem', textAlign: 'left', maxWidth: '680px', margin: '0 auto' }}>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Core Architecture</div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-bright)', marginTop: '0.2rem' }}>Go 1.26 + Wails v2</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Single native binary, OS WebView2</div>
              </div>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>SSH &amp; SFTP Protocol</div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-bright)', marginTop: '0.2rem' }}>golang.org/x/crypto/ssh</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Strict TOFU host-key verification</div>
              </div>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Vault Cryptography</div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-bright)', marginTop: '0.2rem' }}>Argon2id + XChaCha20-Poly1305</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Windows Hello &amp; FIDO2 quick unlock</div>
              </div>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.85rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Terminal Engine</div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-bright)', marginTop: '0.2rem' }}>xterm.js + ConPTY / PTY</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Truecolor, split panes, in-buffer regex</div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Modal Actions */}
      {isModal && (
        <div className="modal-actions" style={{ marginTop: '1rem' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
