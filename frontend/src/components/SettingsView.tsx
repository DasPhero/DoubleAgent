import React, { useState } from 'react';
import { AppGlobalSettings } from './TerminalView';

export interface SettingsViewProps {
  activeTab: 'appearance' | 'security' | 'shortcuts';
  onTabChange: (tab: 'appearance' | 'security' | 'shortcuts') => void;
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
  onClose?: () => void;
  onOpenAsTab?: () => void;
  isModal?: boolean;
}

export interface CustomShortcut {
  id: string;
  action: string;
  keyCombo: string;
}

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
  onClose,
  onOpenAsTab,
  isModal = false,
}: SettingsViewProps): React.JSX.Element {
  const [currentPw, setCurrentPw] = useState<string>('');
  const [newPw, setNewPw] = useState<string>('');
  const [confirmPw, setConfirmPw] = useState<string>('');
  const [pwError, setPwError] = useState<string>('');
  const [pwSuccess, setPwSuccess] = useState<string>('');

  // Custom shortcuts state (F-24 TODO / Preview)
  const [customShortcuts, setCustomShortcuts] = useState<CustomShortcut[]>([
    { id: 'sc-1', action: 'Toggle Sidebar', keyCombo: 'Ctrl + B' },
    { id: 'sc-2', action: 'Port Forwarding Dialog', keyCombo: 'Ctrl + Shift + P' },
  ]);
  const [showAddShortcut, setShowAddShortcut] = useState<boolean>(false);
  const [newShortcutAction, setNewShortcutAction] = useState<string>('Quick Connect');
  const [newShortcutKey, setNewShortcutKey] = useState<string>('');

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

  const handleAddShortcut = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShortcutKey.trim()) return;
    setCustomShortcuts((prev) => [
      ...prev,
      {
        id: `sc-${Date.now()}`,
        action: newShortcutAction,
        keyCombo: newShortcutKey.trim(),
      },
    ]);
    setNewShortcutKey('');
    setShowAddShortcut(false);
  };

  const handleRemoveShortcut = (id: string) => {
    setCustomShortcuts((prev) => prev.filter((s) => s.id !== id));
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
          aria-selected={activeTab === 'shortcuts'}
          className={`settings-tab-btn ${activeTab === 'shortcuts' ? 'active' : ''}`}
          onClick={() => onTabChange('shortcuts')}
        >
          ⌨️ Keyboard Shortcuts
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

      {/* Tab 3: Keyboard Shortcuts */}
      {activeTab === 'shortcuts' && (
        <div className="settings-grid" role="tabpanel" aria-label="Keyboard Shortcuts Settings">
          <section className="settings-section">
            <h3>Default System Shortcuts</h3>
            <table className="shortcuts-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Shortcut</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Global Settings</td>
                  <td><code>Ctrl + ,</code></td>
                </tr>
                <tr>
                  <td>Command Palette &amp; Quick Connect</td>
                  <td><code>Ctrl + K</code></td>
                </tr>
                <tr>
                  <td>Zoom In / Out Pane Font</td>
                  <td><code>Ctrl + +</code> / <code>Ctrl + -</code> or <code>Ctrl + Wheel</code></td>
                </tr>
                <tr>
                  <td>Reset Pane Font Size</td>
                  <td><code>Ctrl + 0</code></td>
                </tr>
                <tr>
                  <td>Cycle Active Tabs</td>
                  <td><code>Alt + ←</code> / <code>Alt + →</code></td>
                </tr>
                <tr>
                  <td>Cycle Active Split Panes</td>
                  <td><code>Alt + ↑</code> / <code>Alt + ↓</code></td>
                </tr>
                <tr>
                  <td>New Session Tab</td>
                  <td><code>Alt + N</code></td>
                </tr>
                <tr>
                  <td>Close Active Pane / Tab</td>
                  <td><code>Alt + W</code></td>
                </tr>
                <tr>
                  <td>Toggle Sidebar</td>
                  <td><code>Ctrl + B</code></td>
                </tr>
                <tr>
                  <td>Find in Terminal</td>
                  <td><code>Ctrl + F</code></td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* Custom Shortcuts Section */}
          <section className="settings-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0 }}>Custom Shortcuts (Roadmap Feature)</h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Bind custom hotkeys to DoubleAgent operations. Prefix leader keys supported to avoid shell collisions.
                </span>
              </div>
              {!showAddShortcut && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setShowAddShortcut(true)}
                >
                  + Add Custom Shortcut
                </button>
              )}
            </div>

            {showAddShortcut && (
              <form
                onSubmit={handleAddShortcut}
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                      Action
                    </label>
                    <select
                      value={newShortcutAction}
                      onChange={(e) => setNewShortcutAction(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.35rem 0.5rem',
                        backgroundColor: 'var(--bg-main)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '4px',
                        color: 'var(--text-main)',
                      }}
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
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                      Key Combination
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Ctrl + Shift + P"
                      value={newShortcutKey}
                      onChange={(e) => setNewShortcutKey(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.35rem 0.5rem',
                        backgroundColor: 'var(--bg-main)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '4px',
                        color: 'var(--text-main)',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setShowAddShortcut(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary btn-sm">
                    Save Shortcut
                  </button>
                </div>
              </form>
            )}

            {customShortcuts.length > 0 && (
              <table className="shortcuts-table" style={{ marginTop: '0.6rem' }}>
                <thead>
                  <tr>
                    <th>Custom Action</th>
                    <th>Binding</th>
                    <th style={{ width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {customShortcuts.map((sc) => (
                    <tr key={sc.id}>
                      <td>{sc.action}</td>
                      <td><code>{sc.keyCombo}</code></td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="tab-close-btn"
                          onClick={() => handleRemoveShortcut(sc.id)}
                          title="Remove custom shortcut"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
