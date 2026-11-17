import React, { useState } from 'react';
import { ProxyProfile, ProxyProfileSummary, ProxyProfileType } from '../types/proxy';
import { CyberIcon } from './CyberIcon';

export interface HostOption {
  id: string;
  label: string;
  address: string;
  port?: number;
}

export interface EngagementOption {
  id: string;
  name: string;
}

export interface ProxyProfilesViewProps {
  profiles: ProxyProfileSummary[];
  hosts: HostOption[];
  engagements?: EngagementOption[];
  activeEngagementId?: string;
  onSaveProfile: (profile: ProxyProfile) => Promise<void>;
  onDeleteProfile: (profileId: string) => Promise<void>;
  onOpenProxychainsExport: () => void;
  onClose: () => void;
}

export function ProxyProfilesView({
  profiles,
  hosts,
  engagements = [],
  activeEngagementId = '',
  onSaveProfile,
  onDeleteProfile,
  onOpenProxychainsExport,
  onClose,
}: ProxyProfilesViewProps): React.JSX.Element {
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<'context' | 'engagement' | 'global' | 'all'>('context');

  // Form states
  const [name, setName] = useState<string>('');
  const [profileEngagementId, setProfileEngagementId] = useState<string>(activeEngagementId || '');
  const [type, setType] = useState<ProxyProfileType>('jump');
  const [jumpHostIds, setJumpHostIds] = useState<string[]>([]);
  const [customJumpSpec, setCustomJumpSpec] = useState<string>('');
  const [command, setCommand] = useState<string>('');
  const [socksAddress, setSocksAddress] = useState<string>('127.0.0.1:1080');
  const [socksUsername, setSocksUsername] = useState<string>('');
  const [socksPassword, setSocksPassword] = useState<string>('');
  const [hasExistingPassword, setHasExistingPassword] = useState<boolean>(false);

  const [formError, setFormError] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  const resetForm = () => {
    setShowAddForm(false);
    setEditingProfileId(null);
    setName('');
    setProfileEngagementId(activeEngagementId || '');
    setType('jump');
    setJumpHostIds([]);
    setCustomJumpSpec('');
    setCommand('');
    setSocksAddress('127.0.0.1:1080');
    setSocksUsername('');
    setSocksPassword('');
    setHasExistingPassword(false);
    setFormError('');
  };

  const handleStartEdit = (p: ProxyProfileSummary) => {
    setEditingProfileId(p.id);
    setName(p.name);
    setProfileEngagementId(p.engagementId || '');
    setType(p.type);
    setJumpHostIds(p.jumpHostIds || []);
    setCommand(p.command || '');
    setSocksAddress(p.socksAddress || '127.0.0.1:1080');
    setSocksUsername(p.socksUsername || '');
    setSocksPassword('');
    setHasExistingPassword(!!p.hasPassword);
    setShowAddForm(true);
    setFormError('');
  };

  const filteredProfiles = profiles.filter((p) => {
    const pEng = p.engagementId || '';
    if (scopeFilter === 'all') return true;
    if (scopeFilter === 'global') return pEng === '';
    if (scopeFilter === 'engagement') {
      return activeEngagementId ? pEng === activeEngagementId : pEng !== '';
    }
    if (!activeEngagementId) return pEng === '';
    return pEng === '' || pEng === activeEngagementId;
  });

  const handleAddJumpHop = (hostId: string) => {
    if (!hostId || jumpHostIds.includes(hostId)) return;
    setJumpHostIds([...jumpHostIds, hostId]);
  };

  const handleAddCustomJumpHop = () => {
    const trimmed = customJumpSpec.trim();
    if (!trimmed || jumpHostIds.includes(trimmed)) return;
    setJumpHostIds([...jumpHostIds, trimmed]);
    setCustomJumpSpec('');
  };

  const handleRemoveJumpHop = (index: number) => {
    setJumpHostIds(jumpHostIds.filter((_, i) => i !== index));
  };

  const handleMoveJumpHop = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= jumpHostIds.length) return;
    const copy = [...jumpHostIds];
    const temp = copy[index];
    copy[index] = copy[newIndex];
    copy[newIndex] = temp;
    setJumpHostIds(copy);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Profile name is required');
      return;
    }

    if (type === 'jump' && jumpHostIds.length === 0) {
      setFormError('Please add at least one bastion host hop to the jump chain');
      return;
    }

    if (type === 'command' && !command.trim()) {
      setFormError('ProxyCommand string is required (e.g. ssh -W %h:%p bastion)');
      return;
    }

    if (type === 'socks5' && !socksAddress.trim()) {
      setFormError('SOCKS5 address is required (e.g. 127.0.0.1:1080)');
      return;
    }

    setSaving(true);
    setFormError('');

    try {
      const profileToSave: ProxyProfile = {
        id: editingProfileId || `prof-${Date.now()}`,
        name: name.trim(),
        engagementId: profileEngagementId || undefined,
        type,
        jumpHostIds: type === 'jump' ? jumpHostIds : undefined,
        command: type === 'command' ? command.trim() : undefined,
        socksAddress: type === 'socks5' ? socksAddress.trim() : undefined,
        socksUsername: type === 'socks5' && socksUsername.trim() ? socksUsername.trim() : undefined,
        socksPassword: type === 'socks5' && socksPassword ? socksPassword : undefined,
      };

      await onSaveProfile(profileToSave);
      resetForm();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (profileId: string) => {
    if (!window.confirm('Are you sure you want to delete this proxy profile? Hosts using it will revert to direct connection.')) {
      return;
    }
    try {
      await onDeleteProfile(profileId);
      if (editingProfileId === profileId) {
        resetForm();
      }
    } catch (err: unknown) {
      alert(`Failed to delete profile: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const getHostLabel = (id: string) => {
    const found = hosts.find((h) => h.id === id);
    if (found) return `${found.label} (${found.address})`;
    return id;
  };

  return (
    <div
      className="modal-backdrop cyber-modal-overlay"
      style={{ zIndex: 100010 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cyber-dialog-card proxy-profiles-view"
        style={{
          width: '940px',
          maxWidth: '96vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {/* Reticles */}
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Header */}
        <div className="dialog-header">
          <div className="dialog-title">
            <span className="cyber-hazard-stripes">///</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.98rem', color: 'var(--accent-bright)', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CyberIcon name="shield" size={16} />
                <span>Proxy Profiles &amp; Bastion Chains</span>
              </h3>
              <div style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                VAULT-PROXIES // JUMP CHAINS · SOCKS5 (WITH AUTH) · COMMAND
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary cyber-btn-sm"
              onClick={onOpenProxychainsExport}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <CyberIcon name="chain" size={12} />
              <span>Export proxychains.conf</span>
            </button>
            <button
              type="button"
              className="cyber-btn-close"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {/* Top Actions & Scope Filter */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {filteredProfiles.length} of {profiles.length} profile{profiles.length === 1 ? '' : 's'}
              </span>
              {engagements.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {(
                    [
                      { id: 'context', label: activeEngagementId ? 'Active Engagement + Global' : 'Global (Casual Mode)' },
                      { id: 'engagement', label: 'Engagement Only' },
                      { id: 'global', label: 'Global Only' },
                      { id: 'all', label: `All (${profiles.length})` },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={`cyber-btn cyber-btn-sm ${scopeFilter === tab.id ? 'cyber-btn-primary' : 'cyber-btn-secondary'}`}
                      style={{ fontSize: '0.7rem', padding: '3px 8px' }}
                      onClick={() => setScopeFilter(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!showAddForm && (
              <button
                type="button"
                className="cyber-btn cyber-btn-primary"
                aria-label="+ New Proxy Profile"
                onClick={() => {
                  resetForm();
                  setShowAddForm(true);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <CyberIcon name="plus" size={12} />
                <span>New Proxy Profile</span>
              </button>
            )}
          </div>

          {/* Add / Edit Form Card */}
          {showAddForm && (
            <form
              onSubmit={handleSubmit}
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--accent)',
                borderRadius: '8px',
                padding: '20px',
                marginBottom: '24px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-bright)' }}>
                  {editingProfileId ? 'Edit Proxy Profile' : 'Create New Proxy Profile'}
                </h3>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  onClick={resetForm}
                  style={{ padding: '2px 8px', fontSize: '0.8rem' }}
                >
                  Cancel
                </button>
              </div>

              {formError && (
                <div
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid #ef4444',
                    color: '#f87171',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    marginBottom: '14px',
                    fontSize: '0.85rem',
                  }}
                >
                  {formError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px' }}>
                    Profile Name *
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. AWS Production Bastion, Tor SOCKS5"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px' }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px' }}>
                    Configuration Scope
                  </label>
                  <select
                    aria-label="Profile Scope"
                    className="cyber-hud-select"
                    value={profileEngagementId}
                    onChange={(e) => setProfileEngagementId(e.target.value)}
                    style={{ width: '100%', height: '36px' }}
                  >
                    <option value="">Global (All Engagements)</option>
                    {engagements.map((eng) => (
                      <option key={eng.id} value={eng.id}>
                        Engagement: {eng.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px' }}>
                    Proxy Mechanism *
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                    {(
                      [
                        { id: 'jump', label: 'ProxyJump', desc: 'Bastion SSH' },
                        { id: 'command', label: 'Command', desc: 'ProxyCommand' },
                        { id: 'socks5', label: 'SOCKS5', desc: 'SOCKS Proxy' },
                      ] as const
                    ).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={`btn ${type === t.id ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setType(t.id)}
                        style={{ padding: '6px 8px', textAlign: 'center', fontSize: '0.8rem' }}
                      >
                        <div>{t.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Type-specific Fields */}
              {type === 'jump' && (
                <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: '6px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-bright)', marginBottom: '8px' }}>
                    Intermediate Jump Hops (ProxyChain)
                  </div>
                  <p style={{ margin: '0 0 12px 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Traffic will be routed sequentially through each bastion hop before connecting to the target.
                  </p>

                  {/* Existing Hops List */}
                  {jumpHostIds.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                      {jumpHostIds.map((hop, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: 'var(--bg-primary)',
                            padding: '8px 12px',
                            borderRadius: '4px',
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span
                              style={{
                                background: 'var(--accent)',
                                color: '#000',
                                padding: '2px 6px',
                                borderRadius: '10px',
                                fontSize: '0.75rem',
                                fontWeight: 'bold',
                              }}
                            >
                              Hop {idx + 1}
                            </span>
                            <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{getHostLabel(hop)}</span>
                          </div>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              type="button"
                              className="cyber-btn cyber-btn-secondary"
                              onClick={() => handleMoveJumpHop(idx, 'up')}
                              disabled={idx === 0}
                              style={{ padding: '2px 6px', fontSize: '0.75rem' }}
                            >
                              <CyberIcon name="chevron-up" size={14} />
                            </button>
                            <button
                              type="button"
                              className="cyber-btn cyber-btn-secondary"
                              onClick={() => handleMoveJumpHop(idx, 'down')}
                              disabled={idx === jumpHostIds.length - 1}
                              style={{ padding: '2px 6px', fontSize: '0.75rem' }}
                            >
                              <CyberIcon name="chevron-down" size={14} />
                            </button>
                            <button
                              type="button"
                              className="cyber-btn cyber-btn-secondary"
                              onClick={() => handleRemoveJumpHop(idx)}
                              style={{ padding: '2px 6px', fontSize: '0.75rem', color: '#f87171' }}
                            >
                              <CyberIcon name="close" size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: '10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      No jump hops added yet. Add a bastion host below.
                    </div>
                  )}

                  {/* Add Hop Controls */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                        Add from Saved Hosts
                      </label>
                      <select
                        className="input"
                        onChange={(e) => {
                          if (e.target.value) {
                            handleAddJumpHop(e.target.value);
                            e.target.value = '';
                          }
                        }}
                        defaultValue=""
                        style={{ width: '100%', padding: '6px 10px', fontSize: '0.85rem' }}
                      >
                        <option value="" disabled>
                          -- Select saved host --
                        </option>
                        {hosts.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.label} ({h.address})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                        Or Enter Custom Hop (user@host:port)
                      </label>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <input
                          type="text"
                          placeholder="e.g. ops@bastion.corp.net:2222"
                          className="input"
                          value={customJumpSpec}
                          onChange={(e) => setCustomJumpSpec(e.target.value)}
                          style={{ flex: 1, padding: '6px 10px', fontSize: '0.85rem' }}
                        />
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-secondary"
                          onClick={handleAddCustomJumpHop}
                          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {type === 'command' && (
                <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: '6px', marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-bright)' }}>
                    ProxyCommand Expression *
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder="ssh -W %h:%p bastion.internal"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', fontFamily: 'monospace', fontSize: '0.85rem' }}
                    required
                  />
                  <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Substitutions: <code>%h</code> = target host, <code>%p</code> = target port, <code>%%</code> = literal %.
                    <br />
                    Examples: <code>ssh -W %h:%p bastion.corp.net</code>, <code>ncat --proxy-type socks5 --proxy 127.0.0.1:1080 %h %p</code>
                  </div>
                </div>
              )}

              {type === 'socks5' && (
                <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: '6px', marginBottom: '16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px' }}>
                        SOCKS5 Address (host:port) *
                      </label>
                      <input
                        type="text"
                        className="input"
                        placeholder="127.0.0.1:1080"
                        value={socksAddress}
                        onChange={(e) => setSocksAddress(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', fontFamily: 'monospace', fontSize: '0.85rem' }}
                        required
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px' }}>
                        Username (optional)
                      </label>
                      <input
                        type="text"
                        className="input"
                        placeholder="Username"
                        value={socksUsername}
                        onChange={(e) => setSocksUsername(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', fontSize: '0.85rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px' }}>
                        Password (optional)
                      </label>
                      <input
                        type="password"
                        className="input"
                        placeholder={hasExistingPassword ? '•••••••• (unchanged)' : 'Password'}
                        value={socksPassword}
                        onChange={(e) => setSocksPassword(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', fontSize: '0.85rem' }}
                      />
                    </div>
                  </div>
                  {hasExistingPassword && (
                    <div style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--accent-bright)' }}>
                      Password is saved in encrypted vault. Leave blank to keep existing password.
                    </div>
                  )}
                </div>
              )}

              {/* Submit Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  onClick={resetForm}
                  style={{ padding: '8px 16px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="cyber-btn cyber-btn-primary"
                  disabled={saving}
                  style={{ padding: '8px 20px' }}
                >
                  {saving ? 'Saving...' : editingProfileId ? 'Update Profile' : 'Save Profile'}
                </button>
              </div>
            </form>
          )}

          {/* Profiles List */}
          {filteredProfiles.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '48px 20px',
                background: 'var(--bg-secondary)',
                borderRadius: '8px',
                border: '1px dashed var(--border-color)',
              }}
            >
              <div style={{ marginBottom: '12px', color: 'var(--accent-bright)', display: 'flex', justifyContent: 'center' }}>
                <CyberIcon name="shield" size={32} />
              </div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem', color: 'var(--text-bright)' }}>
                No Proxy Profiles Configured
              </h3>
              <p style={{ margin: '0 0 20px 0', fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '420px', marginInline: 'auto' }}>
                Create a global or engagement-scoped proxy profile to route SSH connections through jump bastions, local streaming commands, or SOCKS5 proxies.
              </p>
              <button
                type="button"
                className="cyber-btn cyber-btn-primary"
                onClick={() => {
                  resetForm();
                  setShowAddForm(true);
                }}
              >
                + Create First Profile
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '16px' }}>
              {filteredProfiles.map((p) => {
                const badgeColor =
                  p.type === 'jump' ? 'var(--accent-bright)' : p.type === 'command' ? '#c084fc' : '#fbbf24';
                const badgeLabel =
                  p.type === 'jump' ? 'ProxyJump' : p.type === 'command' ? 'ProxyCommand' : 'SOCKS5';
                const profEngagement = engagements.find((e) => e.id === p.engagementId);

                return (
                  <div
                    key={p.id}
                    style={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      transition: 'border-color 0.2s',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '8px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-bright)' }}>
                            {p.name}
                          </span>
                          <span
                            style={{
                              fontSize: '0.68rem',
                              color: profEngagement ? 'var(--accent-bright)' : '#94a3b8',
                              background: profEngagement ? 'color-mix(in srgb, var(--accent-bright) 12%, transparent)' : 'rgba(148, 163, 184, 0.1)',
                              border: `1px solid ${profEngagement ? 'color-mix(in srgb, var(--accent-bright) 40%, transparent)' : 'rgba(148, 163, 184, 0.25)'}`,
                              padding: '1px 6px',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}
                          >
                            {profEngagement ? `ENGAGEMENT: ${profEngagement.name}` : 'GLOBAL'}
                          </span>
                        </div>
                        <span
                          style={{
                            background: `${badgeColor}22`,
                            color: badgeColor,
                            border: `1px solid ${badgeColor}66`,
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                          }}
                        >
                          {badgeLabel}
                        </span>
                      </div>

                      {/* Details based on type */}
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                        {p.type === 'jump' && (
                          <div>
                            <span style={{ fontWeight: 600 }}>Chain ({p.jumpHostIds?.length || 0} hop{(p.jumpHostIds?.length || 0) === 1 ? '' : 's'}):</span>{' '}
                            <span style={{ fontFamily: 'monospace' }}>
                              {(p.jumpHostIds || []).map((h) => getHostLabel(h)).join(' -> ') || 'Empty'}
                            </span>
                          </div>
                        )}

                        {p.type === 'command' && (
                          <div>
                            <span style={{ fontWeight: 600 }}>Command:</span>{' '}
                            <code style={{ background: '#0d1117', padding: '2px 6px', borderRadius: '4px' }}>
                              {p.command}
                            </code>
                          </div>
                        )}

                        {p.type === 'socks5' && (
                          <div>
                            <span style={{ fontWeight: 600 }}>Address:</span>{' '}
                            <code style={{ background: '#0d1117', padding: '2px 6px', borderRadius: '4px' }}>
                              {p.socksAddress}
                            </code>
                            {p.socksUsername && (
                              <span style={{ marginLeft: '8px', opacity: 0.8 }}>
                                (User: {p.socksUsername}{p.hasPassword ? ', Encrypted Pass' : ''})
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '10px' }}>
                      <button
                        type="button"
                        className="cyber-btn cyber-btn-secondary"
                        onClick={() => handleStartEdit(p)}
                        style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="cyber-btn cyber-btn-secondary"
                        onClick={() => handleDelete(p.id)}
                        style={{ padding: '4px 10px', fontSize: '0.8rem', color: '#f87171' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

