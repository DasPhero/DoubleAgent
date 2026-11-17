import React, { useState, useMemo, useEffect } from 'react';
import { SnippetChain, SnippetChainStep, SnippetChainsFileConfig } from '../types/snippet';
import { CyberIcon } from './CyberIcon';

export interface SnippetChainsModalProps {
  chains: SnippetChain[];
  hosts?: Array<{ id: string; label: string; address: string }>;
  activeSessionId?: string | null;
  activeHostId?: string | null;
  onSaveChain: (chain: SnippetChain) => Promise<void>;
  onDeleteChain: (chainId: string) => Promise<void>;
  onRunChain: (chain: SnippetChain) => void;
  onClose: () => void;
  // External File decoupling (F-16/F-33)
  getFileConfig?: () => Promise<SnippetChainsFileConfig>;
  setFilePath?: (path: string) => Promise<SnippetChainsFileConfig>;
  onReloadFromFile?: () => Promise<SnippetChain[]>;
  onSelectFile?: (title: string, filterName: string, filterPattern: string) => Promise<string>;
  onSelectDirectory?: (title: string) => Promise<string>;
}

export const SnippetChainsModal: React.FC<SnippetChainsModalProps> = ({
  chains,
  hosts = [],
  activeSessionId,
  activeHostId,
  onSaveChain,
  onDeleteChain,
  onRunChain,
  onClose,
  getFileConfig,
  setFilePath,
  onReloadFromFile,
  onSelectFile,
  onSelectDirectory,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [osFilter, setOsFilter] = useState<'all' | 'linux' | 'windows'>('all');
  const [hostFilter, setHostFilter] = useState<string>(activeHostId || 'all');
  const [expandedChainId, setExpandedChainId] = useState<string | null>(null);

  const [editingChain, setEditingChain] = useState<SnippetChain | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [chainsList, setChainsList] = useState<SnippetChain[]>(chains);

  // File decoupling state
  const [fileConfig, setFileConfig] = useState<SnippetChainsFileConfig | null>(null);
  const [showPathInput, setShowPathInput] = useState<boolean>(false);
  const [customPathValue, setCustomPathValue] = useState<string>('');

  useEffect(() => {
    setChainsList(chains);
  }, [chains]);

  useEffect(() => {
    if (getFileConfig) {
      getFileConfig()
        .then(setFileConfig)
        .catch(() => {});
    }
  }, [getFileConfig]);

  const handleReload = async () => {
    try {
      if (onReloadFromFile) {
        const loaded = await onReloadFromFile();
        setChainsList(loaded);
      }
      if (getFileConfig) {
        const cfg = await getFileConfig();
        setFileConfig(cfg);
      }
      setInfoMessage('Reloaded snippet chains from disk.');
      setTimeout(() => setInfoMessage(''), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleBrowseFile = async () => {
    try {
      const file = onSelectFile
        ? await onSelectFile('Select Snippet Chains JSON File', 'JSON Files', '*.json')
        : await (window as unknown as { go?: { main?: { App?: { SelectFileDialog: (t: string, fn: string, fp: string) => Promise<string> } } } }).go?.main?.App?.SelectFileDialog?.(
            'Select Snippet Chains JSON File',
            'JSON Files',
            '*.json'
          );
      if (file && file.trim() && setFilePath) {
        const updated = await setFilePath(file.trim());
        setFileConfig(updated);
        await handleReload();
        setInfoMessage(`Loaded snippet chains from file: ${file.trim()}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const folder = onSelectDirectory
        ? await onSelectDirectory('Select Snippet Chains Folder')
        : await (window as unknown as { go?: { main?: { App?: { SelectDirectoryDialog: (t: string) => Promise<string> } } } }).go?.main?.App?.SelectDirectoryDialog?.(
            'Select Snippet Chains Folder'
          );
      if (folder && folder.trim() && setFilePath) {
        const updated = await setFilePath(folder.trim());
        setFileConfig(updated);
        await handleReload();
        setInfoMessage(`Configured snippet chains folder: ${folder.trim()} (using default snippet_chains.json)`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleApplyCustomPath = async () => {
    if (!customPathValue.trim() || !setFilePath) return;
    try {
      const updated = await setFilePath(customPathValue.trim());
      setFileConfig(updated);
      setShowPathInput(false);
      await handleReload();
      setInfoMessage(`Configured snippet chains path: ${updated.filePath}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Start new chain
  const startNewChain = () => {
    setEditingChain({
      id: '',
      name: '',
      description: '',
      category: 'PrivEsc',
      targetOs: 'any',
      hostId: activeHostId || '',
      stopOnError: true,
      autoRunWithoutPrompt: false,
      tags: [],
      steps: [
        {
          id: `step-${Date.now()}-1`,
          title: 'Step 1',
          description: '',
          command: '',
          confirmBeforeRun: true,
          delayMs: 300,
          stopOnError: true,
        },
      ],
    });
    setError('');
  };

  const startEditChain = (chain: SnippetChain) => {
    // Deep clone to allow safe editing
    setEditingChain(JSON.parse(JSON.stringify(chain)));
    setError('');
  };

  // Step manipulation in edit form
  const handleAddStep = () => {
    if (!editingChain) return;
    const nextIdx = editingChain.steps.length + 1;
    const newStep: SnippetChainStep = {
      id: `step-${Date.now()}-${nextIdx}`,
      title: `Step ${nextIdx}`,
      description: '',
      command: '',
      confirmBeforeRun: !editingChain.autoRunWithoutPrompt,
      delayMs: 300,
      stopOnError: true,
    };
    setEditingChain({
      ...editingChain,
      steps: [...editingChain.steps, newStep],
    });
  };

  const handleRemoveStep = (idx: number) => {
    if (!editingChain) return;
    if (editingChain.steps.length <= 1) {
      setError('A snippet chain must contain at least one step.');
      return;
    }
    const updated = editingChain.steps.filter((_, i) => i !== idx);
    setEditingChain({ ...editingChain, steps: updated });
  };

  const handleMoveStep = (idx: number, direction: 'up' | 'down') => {
    if (!editingChain) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= editingChain.steps.length) return;

    const updated = [...editingChain.steps];
    const temp = updated[idx];
    updated[idx] = updated[targetIdx];
    updated[targetIdx] = temp;
    setEditingChain({ ...editingChain, steps: updated });
  };

  const handleStepChange = (idx: number, field: keyof SnippetChainStep, value: unknown) => {
    if (!editingChain) return;
    const updated = [...editingChain.steps];
    updated[idx] = { ...updated[idx], [field]: value };
    setEditingChain({ ...editingChain, steps: updated });
  };

  const insertVariableIntoStep = (stepIdx: number, placeholder: string) => {
    if (!editingChain) return;
    const el = document.getElementById(`chain-step-cmd-${stepIdx}`) as HTMLTextAreaElement | null;
    const currentCmd = editingChain.steps[stepIdx].command || '';
    if (el) {
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : currentCmd.length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : currentCmd.length;
      const nextCmd = currentCmd.slice(0, start) + placeholder + currentCmd.slice(end);
      const nextCursor = start + placeholder.length;
      handleStepChange(stepIdx, 'command', nextCmd);
      el.focus();
      setTimeout(() => {
        const refEl = document.getElementById(`chain-step-cmd-${stepIdx}`) as HTMLTextAreaElement | null;
        if (refEl) {
          refEl.focus();
          refEl.setSelectionRange(nextCursor, nextCursor);
        }
      }, 0);
    } else {
      handleStepChange(stepIdx, 'command', currentCmd + placeholder);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChain) return;

    if (!editingChain.name.trim()) {
      setError('Snippet chain name is required.');
      return;
    }
    if (editingChain.steps.length === 0) {
      setError('At least one step is required.');
      return;
    }
    for (let i = 0; i < editingChain.steps.length; i++) {
      const s = editingChain.steps[i];
      if (!s.command.trim() && !s.snippetId) {
        setError(`Step ${i + 1} (${s.title || 'Untitled'}) must specify a shell command.`);
        return;
      }
    }

    setSaving(true);
    setError('');
    try {
      await onSaveChain(editingChain);
      setEditingChain(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save snippet chain');
    } finally {
      setSaving(false);
    }
  };

  // Filtered chains
  const filteredChains = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return chainsList.filter((c) => {
      // OS filter
      if (osFilter !== 'all') {
        const cOS = (c.targetOs || 'any').toLowerCase();
        if (cOS !== 'any' && cOS !== osFilter) return false;
      }
      // Host filter
      if (hostFilter !== 'all') {
        if (c.hostId && c.hostId !== hostFilter) return false;
      }
      // Text search
      if (q) {
        const matchName = c.name.toLowerCase().includes(q);
        const matchDesc = (c.description || '').toLowerCase().includes(q);
        const matchCat = (c.category || '').toLowerCase().includes(q);
        const matchStep = c.steps.some((s) => s.title.toLowerCase().includes(q) || s.command.toLowerCase().includes(q));
        if (!matchName && !matchDesc && !matchCat && !matchStep) return false;
      }
      return true;
    });
  }, [chainsList, osFilter, hostFilter, searchQuery]);

  return (
    <div className="cyber-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Snippet Chains Manager">
      <div
        className="cyber-modal-card cyber-hud-card"
        style={{ width: '920px', maxWidth: '96vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Modal Header */}
        <div className="cyber-modal-header" style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ color: 'var(--color-primary-cyan, var(--accent-bright))' }}>
              <CyberIcon name="chain" size={18} />
            </span>
            <div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-primary-cyan, var(--accent-bright))' }}>
                SNIPPET CHAINS // MULTI-STAGE SEQUENCES
              </div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                Multi-step exploit, privesc & pivot chains with step-by-step confirmation and host scoping
              </div>
            </div>
          </div>
          <button type="button" className="cyber-btn-close" onClick={onClose} aria-label="Close Modal">
            <CyberIcon name="close" size={14} />
          </button>
        </div>

        {/* External File Decoupling Status Banner */}
        <div
          style={{
            padding: '0.55rem 1.25rem',
            backgroundColor: 'rgba(5, 12, 22, 0.95)',
            borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.65rem',
            fontSize: '0.74rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', overflow: 'hidden' }}>
            <span style={{ color: 'var(--accent-bright)', fontWeight: 600 }}>CHAINS STORE:</span>
            <span
              style={{
                color: '#cbd5e1',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.72rem',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                maxWidth: '420px',
              }}
              title={fileConfig?.filePath || 'data/snippet_chains.json'}
            >
              {fileConfig?.filePath || 'data/snippet_chains.json'}
            </span>
            <span
              style={{
                fontSize: '0.68rem',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                padding: '0.1rem 0.4rem',
                borderRadius: '3px',
                fontWeight: 600,
              }}
            >
              {chainsList.length} CHAINS
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              onClick={() => void handleReload()}
              title="Reload chains from disk"
              style={{ padding: '0.2rem 0.55rem', fontSize: '0.72rem' }}
            >
              <CyberIcon name="radar" size={11} />
              <span style={{ marginLeft: '0.35rem' }}>Reload File</span>
            </button>
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              onClick={() => void handleBrowseFile()}
              title="Select a specific snippet chains JSON file"
              style={{ padding: '0.2rem 0.55rem', fontSize: '0.72rem' }}
            >
              <CyberIcon name="folder" size={11} />
              <span style={{ marginLeft: '0.35rem' }}>Browse File</span>
            </button>
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              onClick={() => void handleBrowseFolder()}
              title="Select a folder (uses default snippet_chains.json inside)"
              style={{ padding: '0.2rem 0.55rem', fontSize: '0.72rem' }}
            >
              <CyberIcon name="folder" size={11} />
              <span style={{ marginLeft: '0.35rem' }}>Browse Folder</span>
            </button>
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              onClick={() => {
                setCustomPathValue(fileConfig?.filePath || '');
                setShowPathInput(!showPathInput);
              }}
              title="Change snippet chains file path"
              style={{ padding: '0.2rem 0.55rem', fontSize: '0.72rem' }}
            >
              <CyberIcon name="edit" size={11} />
              <span style={{ marginLeft: '0.35rem' }}>Config Path</span>
            </button>
          </div>
        </div>

        {/* Custom Path Edit Expandable */}
        {showPathInput && (
          <div
            style={{
              padding: '0.75rem 1.25rem',
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '0.75rem', color: '#cbd5e1', whiteSpace: 'nowrap' }}>
              File or Folder Path:
            </span>
            <input
              type="text"
              className="cyber-hud-input"
              value={customPathValue}
              onChange={(e) => setCustomPathValue(e.target.value)}
              placeholder="e.g. data/snippet_chains.json or folder path"
              style={{ flex: 1, minWidth: '220px', fontSize: '0.78rem' }}
            />
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              onClick={() => void handleBrowseFile()}
              title="Pick file from disk"
            >
              Pick File
            </button>
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              onClick={() => void handleBrowseFolder()}
              title="Pick folder from disk"
            >
              Pick Folder
            </button>
            <button
              type="button"
              className="cyber-hud-btn btn-sm btn-primary"
              onClick={() => void handleApplyCustomPath()}
            >
              Apply Path
            </button>
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              onClick={() => setShowPathInput(false)}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Notifications & Error messages */}
        {infoMessage && (
          <div
            style={{
              margin: '0.65rem 1.25rem 0 1.25rem',
              padding: '0.55rem 0.85rem',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid #10b981',
              color: '#6ee7b7',
              borderRadius: '4px',
              fontSize: '0.78rem',
            }}
          >
            {infoMessage}
          </div>
        )}

        {/* Body Container */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>
          {error && (
            <div style={{ padding: '0.65rem 0.85rem', marginBottom: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#fca5a5', borderRadius: '4px', fontSize: '0.82rem' }}>
              {error}
            </div>
          )}

          {!editingChain ? (
            /* Chain List View */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Controls bar */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', flex: 1, minWidth: '300px' }}>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    placeholder="Search chains by name, category, or command..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ flex: 1, minWidth: '180px' }}
                  />
                  <select
                    className="cyber-hud-select"
                    value={osFilter}
                    onChange={(e) => setOsFilter(e.target.value as 'all' | 'linux' | 'windows')}
                    style={{ width: '130px' }}
                  >
                    <option value="all">OS: All Platforms</option>
                    <option value="linux">OS: Linux</option>
                    <option value="windows">OS: Windows</option>
                  </select>
                  {hosts.length > 0 && (
                    <select
                      className="cyber-hud-select"
                      value={hostFilter}
                      onChange={(e) => setHostFilter(e.target.value)}
                      style={{ width: '150px' }}
                    >
                      <option value="all">Host: All Hosts</option>
                      {hosts.map((h) => (
                        <option key={h.id} value={h.id}>
                          Host: {h.label || h.address}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <button
                  type="button"
                  className="cyber-hud-btn btn-primary"
                  onClick={startNewChain}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.85rem' }}
                >
                  <CyberIcon name="plus" size={13} />
                  <span>New Chain</span>
                </button>
              </div>

              {/* List Grid */}
              {filteredChains.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#64748b', border: '1px dashed color-mix(in srgb, var(--accent-bright) 20%, transparent)', borderRadius: '6px' }}>
                  <CyberIcon name="chain" size={32} />
                  <p style={{ marginTop: '0.5rem', fontSize: '0.88rem' }}>No snippet chains found matching filters.</p>
                  <button type="button" className="cyber-hud-btn btn-sm" onClick={startNewChain} style={{ marginTop: '0.75rem' }}>
                    Create First Snippet Chain
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {filteredChains.map((chain) => {
                    const isExpanded = expandedChainId === chain.id;
                    const hostObj = hosts.find((h) => h.id === chain.hostId);
                    const isBuiltin = chain.id.startsWith('builtin-chain-');

                    return (
                      <div
                        key={chain.id}
                        className="cyber-card"
                        style={{
                          backgroundColor: 'rgba(10, 20, 35, 0.75)',
                          border: isExpanded ? '1px solid color-mix(in srgb, var(--accent-bright) 60%, transparent)' : '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)',
                          borderRadius: '4px',
                          padding: '0.85rem 1rem',
                          transition: 'border-color 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc' }}>
                                {chain.name}
                              </span>
                              {chain.category && (
                                <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: '3px', backgroundColor: 'color-mix(in srgb, var(--accent-bright) 12%, transparent)', color: 'var(--color-primary-cyan, var(--accent-bright))', border: '1px solid color-mix(in srgb, var(--accent-bright) 30%, transparent)' }}>
                                  {chain.category}
                                </span>
                              )}
                              <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: '3px', backgroundColor: 'rgba(148, 163, 184, 0.12)', color: '#cbd5e1', border: '1px solid rgba(148, 163, 184, 0.3)' }}>
                                {chain.targetOs ? chain.targetOs.toUpperCase() : 'ANY OS'}
                              </span>
                              {chain.hostId ? (
                                <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: '3px', backgroundColor: 'color-mix(in srgb, var(--accent-bright) 15%, transparent)', color: 'var(--accent-bright)', border: '1px solid color-mix(in srgb, var(--accent-bright) 40%, transparent)' }}>
                                  HOST: {hostObj ? hostObj.label : chain.hostId}
                                </span>
                              ) : (
                                <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: '3px', backgroundColor: 'rgba(100, 116, 139, 0.15)', color: '#94a3b8' }}>
                                  GLOBAL
                                </span>
                              )}
                              <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: '3px', backgroundColor: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                                {chain.steps.length} {chain.steps.length === 1 ? 'STEP' : 'STEPS'}
                              </span>
                              {chain.autoRunWithoutPrompt && (
                                <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: '3px', backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid #ef4444', fontWeight: 600 }}>
                                  NO-PROMPT AUTO
                                </span>
                              )}
                            </div>
                            {chain.description && (
                              <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '0.35rem' }}>
                                {chain.description}
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                            <button
                              type="button"
                              className="cyber-hud-btn btn-sm btn-primary"
                              onClick={() => onRunChain(chain)}
                              title={activeSessionId ? 'Run this chain in active terminal' : 'Open chain runner'}
                              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                            >
                              <CyberIcon name="play" size={12} />
                              <span>Run</span>
                            </button>
                            <button
                              type="button"
                              className="cyber-hud-btn btn-sm"
                              onClick={() => setExpandedChainId(isExpanded ? null : chain.id)}
                              title="Toggle step preview"
                            >
                              <CyberIcon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={12} />
                            </button>
                            <button
                              type="button"
                              className="cyber-hud-btn btn-sm"
                              onClick={() => startEditChain(chain)}
                              title="Edit chain"
                            >
                              <CyberIcon name="edit" size={12} />
                            </button>
                            {!isBuiltin && (
                              <button
                                type="button"
                                className="cyber-hud-btn btn-sm btn-danger"
                                onClick={() => {
                                  if (window.confirm(`Delete chain "${chain.name}"?`)) {
                                    void onDeleteChain(chain.id);
                                  }
                                }}
                                title="Delete chain"
                              >
                                <CyberIcon name="trash" size={12} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Collapsible Steps Preview */}
                        {isExpanded && (
                          <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px dashed color-mix(in srgb, var(--accent-bright) 20%, transparent)' }}>
                            <div style={{ fontSize: '0.72rem', letterSpacing: '0.05em', color: 'var(--color-primary-cyan, var(--accent-bright))', marginBottom: '0.5rem', fontWeight: 600 }}>
                              CHAIN STEP BREAKDOWN:
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              {chain.steps.map((st, sidx) => (
                                <div
                                  key={st.id || sidx}
                                  style={{
                                    backgroundColor: 'rgba(4, 9, 18, 0.85)',
                                    border: '1px solid color-mix(in srgb, var(--accent-bright) 15%, transparent)',
                                    borderRadius: '3px',
                                    padding: '0.5rem 0.75rem',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#e2e8f0' }}>
                                      {sidx + 1}. {st.title}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.68rem', color: '#64748b' }}>
                                      <span>Delay: {st.delayMs || 0}ms</span>
                                      <span>Confirm: {chain.autoRunWithoutPrompt ? 'NO (Global Auto)' : st.confirmBeforeRun ? 'YES' : 'NO'}</span>
                                      <span>StopOnError: {st.stopOnError ? 'YES' : 'NO'}</span>
                                    </div>
                                  </div>
                                  {st.description && (
                                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.35rem' }}>
                                      {st.description}
                                    </div>
                                  )}
                                  <pre
                                    style={{
                                      margin: 0,
                                      padding: '0.35rem 0.5rem',
                                      backgroundColor: 'rgba(0, 0, 0, 0.65)',
                                      border: '1px solid color-mix(in srgb, var(--accent-bright) 10%, transparent)',
                                      borderRadius: '2px',
                                      color: '#a7f3d0',
                                      fontSize: '0.74rem',
                                      fontFamily: 'var(--font-mono, monospace)',
                                      overflowX: 'auto',
                                      whiteSpace: 'pre-wrap',
                                    }}
                                  >
                                    {st.command || `[References Snippet ID: ${st.snippetId}]`}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* Chain Edit / Create Form */
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)' }}>
                <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--color-primary-cyan, var(--accent-bright))' }}>
                  {editingChain.id ? `EDIT CHAIN: ${editingChain.name}` : 'CREATE NEW SNIPPET CHAIN'}
                </span>
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm btn-cancel"
                  onClick={() => setEditingChain(null)}
                >
                  Cancel
                </button>
              </div>

              {/* Basic Metadata Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
                <div>
                  <label className="cyber-hud-label" style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                    Chain Name *
                  </label>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    value={editingChain.name}
                    onChange={(e) => setEditingChain({ ...editingChain, name: e.target.value })}
                    placeholder="e.g. Linux Reverse Shell Stabilization"
                    style={{ width: '100%' }}
                    required
                  />
                </div>

                <div>
                  <label className="cyber-hud-label" style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                    Category
                  </label>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    value={editingChain.category || ''}
                    onChange={(e) => setEditingChain({ ...editingChain, category: e.target.value })}
                    placeholder="e.g. PrivEsc, Pivot, Stabilization"
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label className="cyber-hud-label" style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                    Target Operating System
                  </label>
                  <select
                    className="cyber-hud-select"
                    value={editingChain.targetOs || 'any'}
                    onChange={(e) => setEditingChain({ ...editingChain, targetOs: e.target.value })}
                    style={{ width: '100%' }}
                  >
                    <option value="any">Multi-Platform (Any OS)</option>
                    <option value="linux">Linux</option>
                    <option value="windows">Windows</option>
                  </select>
                </div>

                <div>
                  <label className="cyber-hud-label" style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                    Host Scope
                  </label>
                  <select
                    className="cyber-hud-select"
                    value={editingChain.hostId || ''}
                    onChange={(e) => setEditingChain({ ...editingChain, hostId: e.target.value })}
                    style={{ width: '100%' }}
                  >
                    <option value="">Global (All Hosts)</option>
                    {hosts.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.label} ({h.address})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="cyber-hud-label" style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                  Description / Documentation
                </label>
                <input
                  type="text"
                  className="cyber-hud-input"
                  value={editingChain.description || ''}
                  onChange={(e) => setEditingChain({ ...editingChain, description: e.target.value })}
                  placeholder="Explain the killchain stage or execution sequence..."
                  style={{ width: '100%' }}
                />
              </div>

              {/* Safety & Execution Policy Flags */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'rgba(0, 0, 0, 0.4)', border: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)', borderRadius: '4px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', color: '#e2e8f0' }}>
                  <input
                    type="checkbox"
                    checked={editingChain.stopOnError}
                    onChange={(e) => setEditingChain({ ...editingChain, stopOnError: e.target.checked })}
                  />
                  <span><strong>Global Stop on Error:</strong> Abort remaining chain steps if any step fails or exits non-zero</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', color: editingChain.autoRunWithoutPrompt ? '#fca5a5' : '#cbd5e1' }}>
                  <input
                    type="checkbox"
                    checked={editingChain.autoRunWithoutPrompt}
                    onChange={(e) => {
                      const nextAutoRun = e.target.checked;
                      setEditingChain({
                        ...editingChain,
                        autoRunWithoutPrompt: nextAutoRun,
                        steps: editingChain.steps.map((s) => ({
                          ...s,
                          confirmBeforeRun: !nextAutoRun,
                        })),
                      });
                    }}
                  />
                  <span><strong>Automatic Execution Without Prompts ("ohne Nachfrage"):</strong> Run entire sequence sequentially without manual confirmation per step</span>
                </label>

                {editingChain.autoRunWithoutPrompt && (
                  <div style={{ fontSize: '0.74rem', color: '#f87171', padding: '0.4rem 0.6rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '3px' }}>
                    WARNING: Unprompted automated chains may execute destructive actions or trigger EDR detections if run against the wrong host. Step confirmation is recommended.
                  </div>
                )}
              </div>

              {/* Steps Editor */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--color-primary-cyan, var(--accent-bright))' }}>
                    ORDERED CHAIN STEPS ({editingChain.steps.length})
                  </span>
                  <button
                    type="button"
                    className="cyber-hud-btn btn-sm"
                    onClick={handleAddStep}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <CyberIcon name="plus" size={12} />
                    <span>Add Step</span>
                  </button>
                </div>

                {editingChain.steps.map((step, idx) => (
                  <div
                    key={step.id || idx}
                    style={{
                      backgroundColor: 'rgba(6, 14, 26, 0.9)',
                      border: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)',
                      borderRadius: '4px',
                      padding: '0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.65rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-primary-cyan, var(--accent-bright))', width: '22px' }}>
                          #{idx + 1}
                        </span>
                        <input
                          type="text"
                          className="cyber-hud-input"
                          value={step.title}
                          onChange={(e) => handleStepChange(idx, 'title', e.target.value)}
                          placeholder={`Step ${idx + 1} Title`}
                          style={{ flex: 1 }}
                        />
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <button
                          type="button"
                          className="cyber-hud-btn btn-sm"
                          disabled={idx === 0}
                          onClick={() => handleMoveStep(idx, 'up')}
                          title="Move step up"
                        >
                          <CyberIcon name="chevron-up" size={14} />
                        </button>
                        <button
                          type="button"
                          className="cyber-hud-btn btn-sm"
                          disabled={idx === editingChain.steps.length - 1}
                          onClick={() => handleMoveStep(idx, 'down')}
                          title="Move step down"
                        >
                          <CyberIcon name="chevron-down" size={14} />
                        </button>
                        <button
                          type="button"
                          className="cyber-hud-btn btn-sm btn-danger"
                          onClick={() => handleRemoveStep(idx)}
                          title="Remove step"
                        >
                          <CyberIcon name="trash" size={12} />
                        </button>
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                        <label style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Shell Command Template *</label>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          {['{{HOST}}', '{{PORT}}', '{{USER}}', '{{CWD}}', '{{SECRET:id}}'].map((v) => (
                            <button
                              key={v}
                              type="button"
                              className="cyber-hud-btn btn-sm"
                              style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem' }}
                              onClick={() => insertVariableIntoStep(idx, v)}
                              title={`Insert ${v} into command`}
                            >
                              + {v}
                            </button>
                          ))}
                        </div>
                      </div>
                      <textarea
                        id={`chain-step-cmd-${idx}`}
                        className="cyber-hud-input"
                        value={step.command}
                        onChange={(e) => handleStepChange(idx, 'command', e.target.value)}
                        placeholder={"e.g. sudo -l || python3 -c 'import pty; pty.spawn(\"/bin/bash\")'"}
                        rows={3}
                        style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.8rem' }}
                        required
                      />
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem', fontSize: '0.75rem', color: '#cbd5e1' }}>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          cursor: editingChain.autoRunWithoutPrompt ? 'not-allowed' : 'pointer',
                          opacity: editingChain.autoRunWithoutPrompt ? 0.6 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!editingChain.autoRunWithoutPrompt && step.confirmBeforeRun}
                          disabled={editingChain.autoRunWithoutPrompt}
                          onChange={(e) => handleStepChange(idx, 'confirmBeforeRun', e.target.checked)}
                        />
                        <span>
                          Confirm Before Run{' '}
                          {editingChain.autoRunWithoutPrompt ? '(Overruled by Global No-Prompt)' : '(Spec Default)'}
                        </span>
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={step.stopOnError}
                          onChange={(e) => handleStepChange(idx, 'stopOnError', e.target.checked)}
                        />
                        <span>Stop on Error</span>
                      </label>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span>Delay:</span>
                        <input
                          type="number"
                          className="cyber-hud-input"
                          value={step.delayMs || 0}
                          onChange={(e) => handleStepChange(idx, 'delayMs', parseInt(e.target.value, 10) || 0)}
                          style={{ width: '70px', padding: '0.2rem 0.4rem', height: '26px' }}
                          min={0}
                          step={100}
                        />
                        <span>ms</span>
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  className="cyber-hud-btn"
                  onClick={handleAddStep}
                  style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <CyberIcon name="plus" size={13} />
                  <span>Add Step</span>
                </button>
              </div>

              {/* Form Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)' }}>
                <button
                  type="button"
                  className="cyber-hud-btn btn-cancel"
                  onClick={() => setEditingChain(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="cyber-hud-btn btn-primary"
                  disabled={saving}
                  style={{ minWidth: '120px' }}
                >
                  {saving ? 'Saving...' : 'Save Chain'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
