import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Engagement,
  EvidenceItem,
  EvidenceType,
  EvidenceSeverity,
  TableEvidenceContent,
} from '../types/pentest';
import { MarkdownRenderer } from './MarkdownRenderer';

export interface HostOption {
  id: string;
  label: string;
  address?: string;
}

interface EvidenceVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  hosts: HostOption[];
  activeHostId?: string;
}

interface WailsPentestEvidenceApi {
  ListEngagements?: () => Promise<Engagement[]>;
  GetActiveEngagement?: () => Promise<Engagement | null>;
  ListEvidence?: (engagementId: string, hostId: string) => Promise<EvidenceItem[]>;
  SaveEvidence?: (item: EvidenceItem) => Promise<void>;
  DeleteEvidence?: (id: string) => Promise<void>;
  GetEvidenceCategories?: (engagementId: string) => Promise<string[]>;
  AddEvidenceCategory?: (engagementId: string, category: string) => Promise<void>;
  GetEvidenceTemplates?: () => Promise<EvidenceItem[]>;
}

function getEvidenceApi(): WailsPentestEvidenceApi | undefined {
  const w = window as unknown as { go?: { main?: { App?: WailsPentestEvidenceApi } } };
  return w.go?.main?.App;
}

export const EvidenceVaultModal: React.FC<EvidenceVaultModalProps> = ({
  isOpen,
  onClose,
  hosts,
  activeHostId,
}) => {
  const [evidenceList, setEvidenceList] = useState<EvidenceItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [templates, setTemplates] = useState<EvidenceItem[]>([]);
  const [activeEngagement, setActiveEngagementState] = useState<Engagement | null>(null);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedHostId, setSelectedHostId] = useState<string>(activeHostId || 'all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Category creation
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  // Finding Editor State
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('Vulnerabilities');
  const [editSeverity, setEditSeverity] = useState<EvidenceSeverity>('medium');
  const [editType, setEditType] = useState<EvidenceType>('text');
  const [editHostId, setEditHostId] = useState<string>(activeHostId || '');
  const [editSource, setEditSource] = useState('manual');
  const [editTags, setEditTags] = useState('');
  const [editTextContent, setEditTextContent] = useState('');

  // Table Editor State
  const [tableHeaders, setTableHeaders] = useState<string[]>(['Port', 'Protocol', 'Service', 'State']);
  const [tableRows, setTableRows] = useState<string[][]>([
    ['22', 'tcp', 'ssh', 'open'],
    ['80', 'tcp', 'http', 'open'],
  ]);

  const refreshAll = useCallback(async () => {
    const api = getEvidenceApi();
    if (!api) return;
    try {
      let activeId = '';
      if (api.GetActiveEngagement) {
        const act = await api.GetActiveEngagement();
        setActiveEngagementState(act || null);
        activeId = act?.id || '';
      }
      if (api.ListEvidence) {
        const items = await api.ListEvidence('', '');
        setEvidenceList(items || []);
      }
      if (api.GetEvidenceCategories) {
        const cats = await api.GetEvidenceCategories(activeId);
        setCategories(cats || []);
      }
      if (api.GetEvidenceTemplates) {
        const tpls = await api.GetEvidenceTemplates();
        setTemplates(tpls || []);
      }
    } catch (err: unknown) {
      console.error('Failed to load evidence vault data:', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void refreshAll();
      setFeedbackMsg(null);
      setIsEditing(false);
    }
  }, [isOpen, refreshAll]);

  const hostMap = useMemo(() => {
    const m = new Map<string, HostOption>();
    for (const h of hosts) {
      m.set(h.id, h);
    }
    return m;
  }, [hosts]);

  // Filtered evidence items
  const filteredEvidence = useMemo(() => {
    return evidenceList.filter((item) => {
      // Engagement filter: only show items belonging to active engagement if defined
      if (activeEngagement && item.engagementId && item.engagementId !== activeEngagement.id) {
        return false;
      }
      // Category filter
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }
      // Host filter
      if (selectedHostId !== 'all') {
        if (selectedHostId === 'unassigned') {
          if (item.hostId) return false;
        } else if (item.hostId !== selectedHostId) {
          return false;
        }
      }
      // Severity filter
      if (selectedSeverity !== 'all' && item.severity !== selectedSeverity) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inTitle = item.title.toLowerCase().includes(q);
        const inCat = item.category.toLowerCase().includes(q);
        const inContent = item.content.toLowerCase().includes(q);
        const inTags = item.tags ? item.tags.some((t) => t.toLowerCase().includes(q)) : false;
        const inSource = item.source ? item.source.toLowerCase().includes(q) : false;
        if (!inTitle && !inCat && !inContent && !inTags && !inSource) {
          return false;
        }
      }
      return true;
    });
  }, [evidenceList, activeEngagement, selectedCategory, selectedHostId, selectedSeverity, searchQuery]);

  // Counts per category
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of evidenceList) {
      if (activeEngagement && item.engagementId && item.engagementId !== activeEngagement.id) {
        continue;
      }
      counts.set(item.category, (counts.get(item.category) || 0) + 1);
    }
    return counts;
  }, [evidenceList, activeEngagement]);

  // Reset editor
  const openNewFinding = (presetTemplate?: EvidenceItem) => {
    if (presetTemplate) {
      setEditId(null);
      setEditTitle(presetTemplate.title);
      setEditCategory(presetTemplate.category);
      setEditSeverity(presetTemplate.severity || 'medium');
      setEditType(presetTemplate.type);
      setEditHostId(activeHostId || '');
      setEditSource(presetTemplate.source || 'manual');
      setEditTags(presetTemplate.tags ? presetTemplate.tags.join(', ') : '');
      if (presetTemplate.type === 'table') {
        try {
          const parsed = JSON.parse(presetTemplate.content) as TableEvidenceContent;
          setTableHeaders(parsed.headers || ['Column 1', 'Column 2']);
          setTableRows(parsed.rows || [['Value 1', 'Value 2']]);
        } catch {
          setTableHeaders(['Column 1', 'Column 2']);
          setTableRows([['', '']]);
        }
        setEditTextContent('');
      } else {
        setEditTextContent(presetTemplate.content);
      }
    } else {
      setEditId(null);
      setEditTitle('');
      setEditCategory(categories[0] || 'Vulnerabilities');
      setEditSeverity('medium');
      setEditType('text');
      setEditHostId(activeHostId || '');
      setEditSource('manual');
      setEditTags('');
      setEditTextContent('');
      setTableHeaders(['Port', 'Protocol', 'Service', 'State']);
      setTableRows([['22', 'tcp', 'ssh', 'open']]);
    }
    setIsEditing(true);
  };

  const openEditFinding = (item: EvidenceItem) => {
    setEditId(item.id);
    setEditTitle(item.title);
    setEditCategory(item.category);
    setEditSeverity(item.severity || 'info');
    setEditType(item.type);
    setEditHostId(item.hostId || '');
    setEditSource(item.source || 'manual');
    setEditTags(item.tags ? item.tags.join(', ') : '');
    if (item.type === 'table') {
      try {
        const parsed = JSON.parse(item.content) as TableEvidenceContent;
        setTableHeaders(parsed.headers || ['Column 1', 'Column 2']);
        setTableRows(parsed.rows || [['', '']]);
      } catch {
        setTableHeaders(['Column 1', 'Column 2']);
        setTableRows([['', '']]);
      }
      setEditTextContent('');
    } else {
      setEditTextContent(item.content);
    }
    setIsEditing(true);
  };

  const handleSaveFinding = async (e: React.FormEvent) => {
    e.preventDefault();
    const api = getEvidenceApi();
    if (!api?.SaveEvidence) return;

    if (!editTitle.trim()) {
      setFeedbackMsg({ type: 'error', text: 'Finding title is required.' });
      return;
    }

    let finalContent = editTextContent;
    if (editType === 'table') {
      const tableData: TableEvidenceContent = {
        headers: tableHeaders.map((h) => h.trim() || 'Col'),
        rows: tableRows.map((r) => r.map((c) => c.trim())),
      };
      finalContent = JSON.stringify(tableData);
    }

    const tagsArray = editTags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const item: EvidenceItem = {
      id: editId || `evi-${Date.now()}`,
      engagementId: activeEngagement?.id || 'eng-default',
      category: editCategory,
      title: editTitle.trim(),
      type: editType,
      content: finalContent,
      hostId: editHostId || undefined,
      severity: editSeverity,
      source: editSource.trim() || 'manual',
      tags: tagsArray,
      capturedAt: new Date().toISOString(),
    };

    try {
      await api.SaveEvidence(item);
      setFeedbackMsg({ type: 'success', text: `Saved finding: ${item.title}` });
      setIsEditing(false);
      await refreshAll();
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleDeleteFinding = async (id: string, title: string) => {
    if (!window.confirm(`Delete evidence item "${title}"?`)) return;
    const api = getEvidenceApi();
    if (!api?.DeleteEvidence) return;
    try {
      await api.DeleteEvidence(id);
      setFeedbackMsg({ type: 'success', text: `Deleted evidence item "${title}"` });
      await refreshAll();
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const api = getEvidenceApi();
    if (!api?.AddEvidenceCategory) return;
    const trimmed = newCatName.trim();
    if (!trimmed) return;

    try {
      await api.AddEvidenceCategory(activeEngagement?.id || '', trimmed);
      setNewCatName('');
      setShowAddCategory(false);
      setFeedbackMsg({ type: 'success', text: `Added category "${trimmed}"!` });
      await refreshAll();
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleCopyFindingContent = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch (err: unknown) {
      console.error('Clipboard copy failed:', err);
    }
  };

  // Table Row & Column manipulators
  const handleAddTableRow = () => {
    const newRow = new Array(tableHeaders.length).fill('');
    setTableRows([...tableRows, newRow]);
  };

  const handleDeleteTableRow = (idx: number) => {
    if (tableRows.length <= 1) return;
    setTableRows(tableRows.filter((_, i) => i !== idx));
  };

  const handleCellChange = (rowIdx: number, colIdx: number, val: string) => {
    const updated = tableRows.map((r, ri) => {
      if (ri !== rowIdx) return r;
      const newR = [...r];
      newR[colIdx] = val;
      return newR;
    });
    setTableRows(updated);
  };

  const handleAddTableCol = () => {
    const colName = `Column ${tableHeaders.length + 1}`;
    setTableHeaders([...tableHeaders, colName]);
    setTableRows(tableRows.map((r) => [...r, '']));
  };

  const handleDeleteTableCol = (colIdx: number) => {
    if (tableHeaders.length <= 1) return;
    setTableHeaders(tableHeaders.filter((_, ci) => ci !== colIdx));
    setTableRows(tableRows.map((r) => r.filter((_, ci) => ci !== colIdx)));
  };

  const handleHeaderChange = (colIdx: number, val: string) => {
    const updated = [...tableHeaders];
    updated[colIdx] = val;
    setTableHeaders(updated);
  };

  // Export report as Markdown
  const handleExportMarkdownReport = () => {
    const lines: string[] = [];
    lines.push(`# DoubleAgent — Pentest Evidence & Findings Report`);
    lines.push(`**Generated:** ${new Date().toLocaleString()}`);
    lines.push(`**Engagement:** ${activeEngagement?.name || 'Default Engagement'}`);
    if (activeEngagement?.scope) {
      lines.push(`**Scope:** ${activeEngagement.scope}`);
    }
    if (activeEngagement?.timeframe) {
      lines.push(`**Timeframe:** ${activeEngagement.timeframe}`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    lines.push(`## 1. Executive Summary & Findings Overview`);
    lines.push(``);

    // Count by severity
    const sevCount: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    filteredEvidence.forEach((e) => {
      const s = (e.severity || 'info').toLowerCase();
      sevCount[s] = (sevCount[s] || 0) + 1;
    });

    lines.push(`| Severity | Count |`);
    lines.push(`| :--- | :--- |`);
    lines.push(`| 🔴 Critical | ${sevCount.critical} |`);
    lines.push(`| 🟠 High | ${sevCount.high} |`);
    lines.push(`| 🟡 Medium | ${sevCount.medium} |`);
    lines.push(`| 🔵 Low | ${sevCount.low} |`);
    lines.push(`| ℹ️ Informational | ${sevCount.info} |`);
    lines.push(`| **Total Findings** | **${filteredEvidence.length}** |`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    lines.push(`## 2. Detailed Findings & Evidence`);
    lines.push(``);

    filteredEvidence.forEach((item, index) => {
      const hostLabel = item.hostId ? hostMap.get(item.hostId)?.label || item.hostId : 'Engagement-Wide';
      lines.push(`### 2.${index + 1} [${(item.severity || 'INFO').toUpperCase()}] ${item.title}`);
      lines.push(``);
      lines.push(`- **Category:** ${item.category}`);
      lines.push(`- **Target Host:** ${hostLabel}`);
      lines.push(`- **Captured At:** ${item.capturedAt}`);
      if (item.source) lines.push(`- **Source:** ${item.source}`);
      if (item.tags && item.tags.length > 0) lines.push(`- **Tags:** \`${item.tags.join('`, `')}\``);
      lines.push(``);

      if (item.type === 'table') {
        try {
          const parsed = JSON.parse(item.content) as TableEvidenceContent;
          if (parsed.headers && parsed.rows) {
            lines.push(`| ${parsed.headers.join(' | ')} |`);
            lines.push(`| ${parsed.headers.map(() => '---').join(' | ')} |`);
            parsed.rows.forEach((row) => {
              lines.push(`| ${row.join(' | ')} |`);
            });
            lines.push(``);
          }
        } catch {
          lines.push(`\`\`\`\n${item.content}\n\`\`\`\n`);
        }
      } else {
        lines.push(item.content);
        lines.push(``);
      }
      lines.push(`---`);
      lines.push(``);
    });

    const reportContent = lines.join('\n');
    const blob = new Blob([reportContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pentest-evidence-report-${activeEngagement?.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'engagement'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getSeverityBadgeColor = (sev?: EvidenceSeverity) => {
    switch (sev) {
      case 'critical':
        return { bg: 'rgba(239, 68, 68, 0.2)', border: '#ef4444', text: '#fca5a5' };
      case 'high':
        return { bg: 'rgba(249, 115, 22, 0.2)', border: '#f97316', text: '#fdba74' };
      case 'medium':
        return { bg: 'rgba(245, 158, 11, 0.2)', border: '#f59e0b', text: '#fde68a' };
      case 'low':
        return { bg: 'rgba(59, 130, 246, 0.2)', border: '#3b82f6', text: '#93c5fd' };
      default:
        return { bg: 'rgba(6, 182, 212, 0.2)', border: '#06b6d4', text: '#67e8f9' };
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="cyber-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-dialog-title"
    >
      <div
        className="cyber-dialog-card evidence-dialog-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '960px', width: '95%', maxHeight: '90vh' }}
      >
        {/* Reticles */}
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Modal Header */}
        <div className="dialog-header">
          <div className="dialog-title">
            <span className="cyber-hazard-stripes">///</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <h3 id="evidence-dialog-title" style={{ margin: 0, fontSize: '0.98rem', color: '#00f0ff', letterSpacing: '0.06em' }}>
                  🛡️ Evidence Vault &amp; Findings (F-18)
                </h3>
                {activeEngagement && (
                  <span
                    style={{
                      background: 'rgba(0, 240, 255, 0.12)',
                      border: '1px solid rgba(0, 240, 255, 0.4)',
                      color: '#38bdf8',
                      padding: '2px 8px',
                      fontSize: '0.72rem',
                      fontFamily: 'JetBrains Mono, monospace',
                      borderRadius: '2px',
                    }}
                  >
                    🎯 {activeEngagement.name}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#38bdf8', fontFamily: 'JetBrains Mono, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                SEC-PENTEST // ENGAGEMENT-SCOPED FINDINGS, POCS &amp; STRUCTURED EVIDENCE
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Category Pills Bar */}
        <div
          style={{
            padding: '0.65rem 1.25rem',
            background: 'rgba(5, 10, 18, 0.65)',
            borderBottom: '1px solid rgba(0, 240, 255, 0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            overflowX: 'auto',
            whiteSpace: 'nowrap',
          }}
        >
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            style={{
              padding: '4px 10px',
              fontSize: '0.74rem',
              fontFamily: 'JetBrains Mono, monospace',
              border: selectedCategory === 'all' ? '1px solid #00f0ff' : '1px solid rgba(255, 255, 255, 0.12)',
              background: selectedCategory === 'all' ? 'rgba(0, 240, 255, 0.18)' : 'rgba(255, 255, 255, 0.04)',
              color: selectedCategory === 'all' ? '#00f0ff' : '#94a3b8',
              cursor: 'pointer',
              borderRadius: '2px',
            }}
          >
            All Categories ({evidenceList.length})
          </button>

          {categories.map((cat) => {
            const count = categoryCounts.get(cat) || 0;
            const isSel = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                style={{
                  padding: '4px 10px',
                  fontSize: '0.74rem',
                  fontFamily: 'JetBrains Mono, monospace',
                  border: isSel ? '1px solid #00f0ff' : '1px solid rgba(255, 255, 255, 0.12)',
                  background: isSel ? 'rgba(0, 240, 255, 0.18)' : 'rgba(255, 255, 255, 0.04)',
                  color: isSel ? '#00f0ff' : '#94a3b8',
                  cursor: 'pointer',
                  borderRadius: '2px',
                }}
              >
                {cat} {count > 0 && <span style={{ opacity: 0.8 }}>({count})</span>}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setShowAddCategory(!showAddCategory)}
            style={{
              padding: '4px 8px',
              fontSize: '0.72rem',
              border: '1px dashed rgba(0, 240, 255, 0.4)',
              background: 'transparent',
              color: '#38bdf8',
              cursor: 'pointer',
              borderRadius: '2px',
            }}
          >
            + Add Category
          </button>
        </div>

        {/* Add Category Drawer */}
        {showAddCategory && (
          <form
            onSubmit={handleAddCategory}
            style={{
              padding: '0.65rem 1.25rem',
              background: 'rgba(0, 240, 255, 0.08)',
              borderBottom: '1px solid rgba(0, 240, 255, 0.25)',
              display: 'flex',
              gap: '0.65rem',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: '0.78rem', color: '#00f0ff', fontFamily: 'JetBrains Mono, monospace' }}>
              Create New Finding Category:
            </span>
            <input
              type="text"
              className="cyber-hud-input"
              style={{ maxWidth: '260px', height: '28px', fontSize: '0.78rem' }}
              placeholder="e.g. Cloud Infrastructure, Wireless"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              autoFocus
            />
            <button type="submit" className="cyber-btn cyber-btn-primary" style={{ padding: '3px 10px', fontSize: '0.74rem' }}>
              Save Category
            </button>
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              style={{ padding: '3px 10px', fontSize: '0.74rem' }}
              onClick={() => setShowAddCategory(false)}
            >
              Cancel
            </button>
          </form>
        )}

        {/* Modal Body */}
        <div
          className="dialog-body"
          style={{
            maxHeight: '74vh',
            overflowY: 'auto',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
          }}
        >
          {feedbackMsg && (
            <div
              style={{
                background: feedbackMsg.type === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                border: `1px solid ${feedbackMsg.type === 'error' ? 'rgba(239, 68, 68, 0.45)' : 'rgba(16, 185, 129, 0.45)'}`,
                color: feedbackMsg.type === 'error' ? '#fca5a5' : '#6ee7b7',
                padding: '0.55rem 0.85rem',
                fontSize: '0.78rem',
                fontFamily: 'JetBrains Mono, monospace',
                borderRadius: '2px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
              role="alert"
            >
              <span>{feedbackMsg.type === 'error' ? '⚠️' : '✓'}</span>
              <span>{feedbackMsg.text}</span>
            </div>
          )}

          {/* Action Toolbar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flex: 1, minWidth: '280px' }}>
              <input
                type="text"
                className="cyber-hud-input"
                placeholder="Search findings by title, content, tags, host, source..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select
                className="cyber-hud-select"
                value={selectedSeverity}
                onChange={(e) => setSelectedSeverity(e.target.value)}
                style={{ width: '135px', height: '32px' }}
              >
                <option value="all">All Severities</option>
                <option value="critical">🔴 Critical</option>
                <option value="high">🟠 High</option>
                <option value="medium">🟡 Medium</option>
                <option value="low">🔵 Low</option>
                <option value="info">ℹ️ Info</option>
              </select>
              <select
                className="cyber-hud-select"
                value={selectedHostId}
                onChange={(e) => setSelectedHostId(e.target.value)}
                style={{ width: '140px', height: '32px' }}
              >
                <option value="all">All Hosts</option>
                <option value="unassigned">Engagement-wide</option>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label} {h.address ? `(${h.address})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {/* Template quick-picker dropdown */}
              {templates.length > 0 && (
                <select
                  className="cyber-hud-select"
                  style={{ width: '185px', height: '32px', border: '1px solid rgba(0, 240, 255, 0.4)' }}
                  defaultValue=""
                  onChange={(e) => {
                    const tpl = templates.find((t) => t.id === e.target.value);
                    if (tpl) {
                      openNewFinding(tpl);
                    }
                    e.target.value = '';
                  }}
                >
                  <option value="" disabled>
                    ✨ Use Finding Template...
                  </option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      [{tpl.severity?.toUpperCase() || 'INFO'}] {tpl.title}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                className="cyber-btn cyber-btn-primary"
                onClick={() => openNewFinding()}
              >
                + New Finding
              </button>

              <button
                type="button"
                className="cyber-btn cyber-btn-secondary"
                onClick={handleExportMarkdownReport}
                title="Download formatted Markdown findings report"
              >
                💾 Export Report (.md)
              </button>
            </div>
          </div>

          {/* EDIT / CREATE FINDING DRAWER */}
          {isEditing && (
            <div
              style={{
                background: 'rgba(7, 14, 26, 0.95)',
                border: '1px solid #00f0ff',
                padding: '1.1rem',
                borderRadius: '2px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.85rem',
                boxShadow: '0 0 20px rgba(0, 240, 255, 0.15)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#00f0ff', letterSpacing: '0.04em' }}>
                  {editId ? '✏️ EDIT FINDING / EVIDENCE' : '⚡ NEW FINDING / EVIDENCE ENTRY'}
                </span>
                <button
                  type="button"
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem' }}
                  onClick={() => setIsEditing(false)}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveFinding} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {/* Title & Category Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="cyber-label">Finding Title</label>
                    <input
                      type="text"
                      className="cyber-hud-input"
                      placeholder="e.g. Unquoted Service Path in VulnSvc"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="cyber-label">Category</label>
                    <select
                      className="cyber-hud-select"
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                    >
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="cyber-label">Severity</label>
                    <select
                      className="cyber-hud-select"
                      value={editSeverity}
                      onChange={(e) => setEditSeverity(e.target.value as EvidenceSeverity)}
                    >
                      <option value="critical">🔴 Critical</option>
                      <option value="high">🟠 High</option>
                      <option value="medium">🟡 Medium</option>
                      <option value="low">🔵 Low</option>
                      <option value="info">ℹ️ Info</option>
                    </select>
                  </div>
                </div>

                {/* Target Host, Source, Tags Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr', gap: '0.75rem' }}>
                  <div>
                    <label className="cyber-label">Target Host</label>
                    <select
                      className="cyber-hud-select"
                      value={editHostId}
                      onChange={(e) => setEditHostId(e.target.value)}
                    >
                      <option value="">(Engagement-wide / Unassigned)</option>
                      {hosts.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.label} {h.address ? `(${h.address})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="cyber-label">Source (Origin)</label>
                    <input
                      type="text"
                      className="cyber-hud-input"
                      placeholder="manual, nmap, linpeas, mimikatz"
                      value={editSource}
                      onChange={(e) => setEditSource(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="cyber-label">Tags (comma-separated)</label>
                    <input
                      type="text"
                      className="cyber-hud-input"
                      placeholder="privesc, service, cve-2021-44228"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                    />
                  </div>
                </div>

                {/* Content Type Switch: Free Text vs Structured Table */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', borderBottom: '1px solid rgba(0, 240, 255, 0.2)', paddingBottom: '0.45rem' }}>
                  <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Entry Format:</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem', color: editType === 'text' ? '#00f0ff' : '#64748b' }}>
                    <input
                      type="radio"
                      name="editType"
                      value="text"
                      checked={editType === 'text'}
                      onChange={() => setEditType('text')}
                      style={{ accentColor: '#00f0ff' }}
                    />
                    📝 Free Text (Markdown / PoC)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem', color: editType === 'table' ? '#00f0ff' : '#64748b' }}>
                    <input
                      type="radio"
                      name="editType"
                      value="table"
                      checked={editType === 'table'}
                      onChange={() => setEditType('table')}
                      style={{ accentColor: '#00f0ff' }}
                    />
                    📊 Structured Table
                  </label>
                </div>

                {/* FORMAT A: FREE TEXT (MARKDOWN) */}
                {editType === 'text' && (
                  <div>
                    <label className="cyber-label">Evidence Details / Markdown / PoC</label>
                    <textarea
                      className="cyber-hud-input"
                      rows={9}
                      style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.82rem', lineHeight: '1.45' }}
                      placeholder="Describe the vulnerability, paste terminal output, exploitation steps, and remediation..."
                      value={editTextContent}
                      onChange={(e) => setEditTextContent(e.target.value)}
                    />
                  </div>
                )}

                {/* FORMAT B: STRUCTURED TABLE */}
                {editType === 'table' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="cyber-label" style={{ margin: 0 }}>
                        Table Columns ({tableHeaders.length}) &amp; Rows ({tableRows.length})
                      </span>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-secondary"
                          style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                          onClick={handleAddTableCol}
                        >
                          + Add Column
                        </button>
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-secondary"
                          style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                          onClick={handleAddTableRow}
                        >
                          + Add Row
                        </button>
                      </div>
                    </div>

                    <div style={{ overflowX: 'auto', border: '1px solid rgba(0, 240, 255, 0.25)', background: 'rgba(3, 7, 18, 0.8)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', fontFamily: 'JetBrains Mono, monospace' }}>
                        <thead>
                          <tr style={{ background: 'rgba(0, 240, 255, 0.12)' }}>
                            {tableHeaders.map((hdr, ci) => (
                              <th key={ci} style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid rgba(0, 240, 255, 0.25)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <input
                                    type="text"
                                    className="cyber-hud-input"
                                    style={{ height: '24px', fontSize: '0.76rem', fontWeight: 700, color: '#00f0ff' }}
                                    value={hdr}
                                    onChange={(e) => handleHeaderChange(ci, e.target.value)}
                                  />
                                  {tableHeaders.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteTableCol(ci)}
                                      title="Delete column"
                                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem' }}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              </th>
                            ))}
                            <th style={{ width: '36px', padding: '6px' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableRows.map((row, ri) => (
                            <tr key={ri} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                              {row.map((cell, ci) => (
                                <td key={ci} style={{ padding: '4px 6px' }}>
                                  <input
                                    type="text"
                                    className="cyber-hud-input"
                                    style={{ height: '24px', fontSize: '0.76rem' }}
                                    value={cell}
                                    onChange={(e) => handleCellChange(ri, ci, e.target.value)}
                                  />
                                </td>
                              ))}
                              <td style={{ textAlign: 'center', padding: '4px' }}>
                                {tableRows.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteTableRow(ri)}
                                    title="Delete row"
                                    style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.78rem' }}
                                  >
                                    ✕
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Submit Row */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.35rem' }}>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-secondary"
                    onClick={() => setIsEditing(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="cyber-btn cyber-btn-primary">
                    💾 Save Finding to Vault
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* FINDINGS LIST */}
          {filteredEvidence.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '2.5rem 1rem',
                color: '#64748b',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.85rem',
                border: '1px dashed rgba(255, 255, 255, 0.1)',
                borderRadius: '2px',
              }}
            >
              No findings matched the selected filters.
              <div style={{ marginTop: '0.65rem' }}>
                Click <span style={{ color: '#00f0ff' }}>"+ New Finding"</span> or select <span style={{ color: '#00f0ff' }}>"✨ Use Finding Template"</span> to capture evidence.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {filteredEvidence.map((item) => {
                const sevColor = getSeverityBadgeColor(item.severity);
                const hostObj = item.hostId ? hostMap.get(item.hostId) : undefined;

                let parsedTable: TableEvidenceContent | null = null;
                if (item.type === 'table') {
                  try {
                    parsedTable = JSON.parse(item.content) as TableEvidenceContent;
                  } catch {
                    parsedTable = null;
                  }
                }

                return (
                  <div
                    key={item.id}
                    style={{
                      background: 'rgba(5, 11, 20, 0.85)',
                      border: `1px solid ${sevColor.border}55`,
                      borderLeft: `4px solid ${sevColor.border}`,
                      padding: '0.85rem 1rem',
                      borderRadius: '2px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.55rem',
                      position: 'relative',
                    }}
                  >
                    {/* Top Row: Severity, Title, Category, Host, Actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {/* Severity Badge */}
                        <span
                          style={{
                            background: sevColor.bg,
                            border: `1px solid ${sevColor.border}`,
                            color: sevColor.text,
                            padding: '1px 6px',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            fontFamily: 'JetBrains Mono, monospace',
                            borderRadius: '2px',
                            textTransform: 'uppercase',
                          }}
                        >
                          {(item.severity || 'INFO').toUpperCase()}
                        </span>

                        {/* Title */}
                        <span style={{ fontSize: '0.92rem', fontWeight: 600, color: '#f1f5f9' }}>
                          {item.title}
                        </span>

                        {/* Category Pill */}
                        <span
                          style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            color: '#94a3b8',
                            padding: '1px 6px',
                            fontSize: '0.68rem',
                            fontFamily: 'JetBrains Mono, monospace',
                            borderRadius: '2px',
                          }}
                        >
                          {item.category}
                        </span>

                        {/* Host Pill */}
                        {hostObj ? (
                          <span
                            style={{
                              background: 'rgba(56, 189, 248, 0.12)',
                              border: '1px solid rgba(56, 189, 248, 0.35)',
                              color: '#38bdf8',
                              padding: '1px 6px',
                              fontSize: '0.68rem',
                              fontFamily: 'JetBrains Mono, monospace',
                              borderRadius: '2px',
                            }}
                          >
                            🖥️ {hostObj.label}
                          </span>
                        ) : (
                          <span
                            style={{
                              background: 'rgba(148, 163, 184, 0.08)',
                              border: '1px solid rgba(148, 163, 184, 0.2)',
                              color: '#94a3b8',
                              padding: '1px 6px',
                              fontSize: '0.68rem',
                              fontFamily: 'JetBrains Mono, monospace',
                              borderRadius: '2px',
                            }}
                          >
                            🌐 Engagement-wide
                          </span>
                        )}
                      </div>

                      {/* Card Action Buttons */}
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="cyber-btn"
                          style={{ padding: '2px 7px', fontSize: '0.72rem' }}
                          onClick={() => handleCopyFindingContent(item.content, item.id)}
                          title="Copy finding content"
                        >
                          {copiedId === item.id ? '✓ Copied' : '📋 Copy'}
                        </button>
                        <button
                          type="button"
                          className="cyber-btn"
                          style={{ padding: '2px 7px', fontSize: '0.72rem' }}
                          onClick={() => openEditFinding(item)}
                          title="Edit finding"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          className="cyber-btn"
                          style={{ padding: '2px 7px', fontSize: '0.72rem', color: '#ef4444' }}
                          onClick={() => handleDeleteFinding(item.id, item.title)}
                          title="Delete finding"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Metadata Sub-row: Source, Timestamp, Tags */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.72rem', color: '#64748b', fontFamily: 'JetBrains Mono, monospace', flexWrap: 'wrap' }}>
                      {item.source && <span>Source: <span style={{ color: '#94a3b8' }}>{item.source}</span></span>}
                      <span>Captured: <span style={{ color: '#94a3b8' }}>{new Date(item.capturedAt).toLocaleString()}</span></span>
                      {item.tags && item.tags.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          {item.tags.map((tag) => (
                            <span key={tag} style={{ background: 'rgba(0, 240, 255, 0.08)', color: '#38bdf8', padding: '0 4px', borderRadius: '2px', fontSize: '0.68rem' }}>
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Content Display: Text (Markdown) vs Table */}
                    <div
                      style={{
                        background: 'rgba(2, 6, 12, 0.75)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        padding: '0.65rem 0.85rem',
                        borderRadius: '2px',
                        marginTop: '0.2rem',
                        fontSize: '0.8rem',
                        maxHeight: '260px',
                        overflowY: 'auto',
                      }}
                    >
                      {item.type === 'table' && parsedTable ? (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', fontFamily: 'JetBrains Mono, monospace' }}>
                            <thead>
                              <tr style={{ background: 'rgba(0, 240, 255, 0.08)', borderBottom: '1px solid rgba(0, 240, 255, 0.2)' }}>
                                {parsedTable.headers.map((h, i) => (
                                  <th key={i} style={{ padding: '4px 8px', textAlign: 'left', color: '#00f0ff' }}>
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {parsedTable.rows.map((row, ri) => (
                                <tr key={ri} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                  {row.map((cell, ci) => (
                                    <td key={ci} style={{ padding: '4px 8px', color: '#cbd5e1' }}>
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="markdown-body" style={{ color: '#e2e8f0', lineHeight: '1.45' }}>
                          <MarkdownRenderer content={item.content} />
                        </div>
                      )}
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
};
