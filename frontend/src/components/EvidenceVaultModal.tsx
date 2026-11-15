import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Engagement,
  EvidenceItem,
  EvidenceType,
  EvidenceSeverity,
  FindingItem,
  FindingStatus,
  TableEvidenceContent,
  ReportFormat,
  ReportExportRequest,
  ReportExportResult,
} from '../types/pentest';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CyberIcon } from './CyberIcon';

export const COMMON_MITRE_TECHNIQUES = [
  'T1059.001 - Command and Scripting Interpreter: PowerShell',
  'T1059.004 - Command and Scripting Interpreter: Unix Shell',
  'T1003.001 - OS Credential Dumping: LSASS Memory',
  'T1003.002 - OS Credential Dumping: Security Account Manager (SAM)',
  'T1078.002 - Valid Accounts: Domain Accounts',
  'T1078.003 - Valid Accounts: Local Accounts',
  'T1021.002 - Remote Services: SMB/Windows Admin Shares',
  'T1021.004 - Remote Services: SSH',
  'T1021.006 - Remote Services: Windows Remote Management (WinRM)',
  'T1558.003 - Steal or Forge Kerberos Tickets: Kerberoasting',
  'T1558.004 - Steal or Forge Kerberos Tickets: AS-REP Roasting',
  'T1574.009 - Hijack Execution Flow: Path Interception by Unquoted Path',
  'T1548.003 - Abuse Elevation Control Mechanism: Sudo and Sudo Caching',
  'T1190 - Exploit Public-Facing Application',
  'T1552.005 - Unsecured Credentials: Cloud Instance Metadata API',
  'T1046 - Network Service Discovery',
  'T1110.003 - Brute Force: Password Spraying',
  'T1068 - Exploitation for Privilege Escalation',
];

export interface CvssV31Input {
  av: 'N' | 'A' | 'L' | 'P';
  ac: 'L' | 'H';
  pr: 'N' | 'L' | 'H';
  ui: 'N' | 'R';
  s: 'U' | 'C';
  c: 'H' | 'L' | 'N';
  i: 'H' | 'L' | 'N';
  a: 'H' | 'L' | 'N';
}

export function computeCvssV31(m: CvssV31Input): { score: number; vector: string; severity: EvidenceSeverity } {
  const avWeights = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
  const acWeights = { L: 0.77, H: 0.44 };
  const prWeightsU = { N: 0.85, L: 0.62, H: 0.27 };
  const prWeightsC = { N: 0.85, L: 0.68, H: 0.50 };
  const uiWeights = { N: 0.85, R: 0.62 };
  const impactWeights = { H: 0.56, L: 0.22, N: 0.0 };

  const prWeight = m.s === 'U' ? prWeightsU[m.pr] : prWeightsC[m.pr];
  const exploitability = 8.22 * avWeights[m.av] * acWeights[m.ac] * prWeight * uiWeights[m.ui];

  const iss = 1.0 - (1.0 - impactWeights[m.c]) * (1.0 - impactWeights[m.i]) * (1.0 - impactWeights[m.a]);
  let impact = 0;
  if (m.s === 'U') {
    impact = 6.42 * iss;
  } else {
    impact = 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  }

  let rawScore = 0;
  if (impact <= 0) {
    rawScore = 0;
  } else if (m.s === 'U') {
    rawScore = Math.min(impact + exploitability, 10);
  } else {
    rawScore = Math.min(1.08 * (impact + exploitability), 10);
  }

  const score = Math.round((Math.ceil(rawScore * 10) / 10) * 10) / 10;
  const vector = `CVSS:3.1/AV:${m.av}/AC:${m.ac}/PR:${m.pr}/UI:${m.ui}/S:${m.s}/C:${m.c}/I:${m.i}/A:${m.a}`;

  let severity: EvidenceSeverity = 'info';
  if (score >= 9.0) severity = 'critical';
  else if (score >= 7.0) severity = 'high';
  else if (score >= 4.0) severity = 'medium';
  else if (score > 0) severity = 'low';

  return { score, vector, severity };
}

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
  ListFindings?: (engagementId: string, hostId: string) => Promise<FindingItem[]>;
  GetFinding?: (id: string) => Promise<FindingItem>;
  SaveFinding?: (item: FindingItem) => Promise<void>;
  DeleteFinding?: (id: string) => Promise<void>;
  GetFindingTemplates?: () => Promise<FindingItem[]>;
  GenerateEvidenceReport?: (req: ReportExportRequest) => Promise<ReportExportResult>;
  ExportEvidenceReportToFile?: (req: ReportExportRequest, filePath: string) => Promise<ReportExportResult>;
  SaveReportFileDialog?: (defaultFilename: string, format: string) => Promise<string>;
  SelectDirectoryDialog?: (title: string) => Promise<string>;
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
  // Navigation Tabs: Findings (Vulnerabilities), Evidence Vault (Proof Artifacts), Assessment Report
  const [activeTab, setActiveTab] = useState<'findings' | 'evidence' | 'report'>('findings');

  const [findingsList, setFindingsList] = useState<FindingItem[]>([]);
  const [findingTemplates, setFindingTemplates] = useState<FindingItem[]>([]);
  const [evidenceList, setEvidenceList] = useState<EvidenceItem[]>([]);
  const [evidenceTemplates, setEvidenceTemplates] = useState<EvidenceItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [activeEngagement, setActiveEngagementState] = useState<Engagement | null>(null);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedHostId, setSelectedHostId] = useState<string>(activeHostId || 'all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [evidenceReportFilter, setEvidenceReportFilter] = useState<'all' | 'reportable' | 'internal' | 'unlinked'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Category creation
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  // Finding Editor State
  const [isEditingFinding, setIsEditingFinding] = useState(false);
  const [findEditId, setFindEditId] = useState<string | null>(null);
  const [findEditTitle, setFindEditTitle] = useState('');
  const [findEditCategory, setFindEditCategory] = useState('Vulnerabilities');
  const [findEditSeverity, setFindEditSeverity] = useState<EvidenceSeverity>('high');
  const [findEditStatus, setFindEditStatus] = useState<FindingStatus>('draft');
  const [findEditHostId, setFindEditHostId] = useState<string>(activeHostId || '');
  const [findEditCve, setFindEditCve] = useState('');
  const [findEditCvss, setFindEditCvss] = useState('');
  const [findEditCvssVector, setFindEditCvssVector] = useState('');
  const [findEditMitreAttack, setFindEditMitreAttack] = useState('');
  const [showCvssCalculator, setShowCvssCalculator] = useState(false);
  const [cvssParams, setCvssParams] = useState<CvssV31Input>({
    av: 'N',
    ac: 'L',
    pr: 'N',
    ui: 'N',
    s: 'U',
    c: 'H',
    i: 'H',
    a: 'H',
  });
  const [findEditDescription, setFindEditDescription] = useState('');
  const [findEditImpact, setFindEditImpact] = useState('');
  const [findEditRemediation, setFindEditRemediation] = useState('');
  const [findEditEvidenceIds, setFindEditEvidenceIds] = useState<string[]>([]);
  const [findEditTags, setFindEditTags] = useState('');
  const [selectedEvidenceToAttach, setSelectedEvidenceToAttach] = useState<string>('');

  // Assessment Report Exporter State (Pentest F-30)
  const [reportFormat, setReportFormat] = useState<ReportFormat>('markdown');
  const [reportHostScope, setReportHostScope] = useState<string>(activeHostId || 'all');
  const [reportIncludePorts, setReportIncludePorts] = useState<boolean>(true);
  const [reportIncludeUnlinked, setReportIncludeUnlinked] = useState<boolean>(true);
  const [reportIncludeNotes, setReportIncludeNotes] = useState<boolean>(true);
  const [reportIncludeInternal, setReportIncludeInternal] = useState<boolean>(false);
  const [compiledReport, setCompiledReport] = useState<ReportExportResult | null>(null);
  const [reportLoading, setReportLoading] = useState<boolean>(false);
  const [reportPreviewView, setReportPreviewView] = useState<'rendered' | 'source'>('rendered');

  // Evidence Editor State
  const [isEditingEvidence, setIsEditingEvidence] = useState(false);
  const [eviEditId, setEviEditId] = useState<string | null>(null);
  const [eviEditTitle, setEviEditTitle] = useState('');
  const [eviEditCategory, setEviEditCategory] = useState('Credentials');
  const [eviEditSeverity, setEviEditSeverity] = useState<EvidenceSeverity>('info');
  const [eviEditType, setEviEditType] = useState<EvidenceType>('text');
  const [eviEditHostId, setEviEditHostId] = useState<string>(activeHostId || '');
  const [eviEditSource, setEviEditSource] = useState('manual');
  const [eviEditTags, setEviEditTags] = useState('');
  const [eviEditTextContent, setEviEditTextContent] = useState('');
  const [eviEditInReport, setEviEditInReport] = useState<boolean>(true);
  const [eviEditFindingId, setEviEditFindingId] = useState<string>('');

  // Table Editor State (for evidence)
  const [tableHeaders, setTableHeaders] = useState<string[]>(['Port', 'Protocol', 'Service', 'State']);
  const [tableRows, setTableRows] = useState<string[][]>([
    ['22', 'tcp', 'ssh', 'open'],
    ['80', 'tcp', 'http', 'open'],
  ]);

  const refreshAll = useCallback(async () => {
    const api = getEvidenceApi();
    if (!api) return;
    try {
      if (api.ListEngagements) {
        const engs = await api.ListEngagements();
        setEngagements(engs || []);
      }
      let activeId = '';
      if (api.GetActiveEngagement) {
        const act = await api.GetActiveEngagement();
        setActiveEngagementState(act || null);
        activeId = act?.id || '';
      }
      if (api.ListFindings) {
        const findings = await api.ListFindings('', '');
        setFindingsList(findings || []);
      }
      if (api.GetFindingTemplates) {
        const fTpls = await api.GetFindingTemplates();
        setFindingTemplates(fTpls || []);
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
        setEvidenceTemplates(tpls || []);
      }
    } catch (err: unknown) {
      console.error('Failed to load pentest hub data:', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void refreshAll();
      setFeedbackMsg(null);
      setIsEditingFinding(false);
      setIsEditingEvidence(false);
    }
  }, [isOpen, refreshAll]);

  const hostMap = useMemo(() => {
    const m = new Map<string, HostOption>();
    for (const h of hosts) {
      m.set(h.id, h);
    }
    return m;
  }, [hosts]);

  const findingMap = useMemo(() => {
    const m = new Map<string, FindingItem>();
    for (const f of findingsList) {
      m.set(f.id, f);
    }
    return m;
  }, [findingsList]);

  // Filtered Findings — strict customer encapsulation
  const filteredFindings = useMemo(() => {
    return findingsList.filter((item) => {
      if (!activeEngagement) {
        if (item.engagementId) return false;
      } else {
        if (item.engagementId !== activeEngagement.id) return false;
      }
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }
      if (selectedHostId !== 'all') {
        if (selectedHostId === 'unassigned') {
          if (item.hostId) return false;
        } else if (item.hostId !== selectedHostId && !item.affectedHosts?.includes(selectedHostId)) {
          return false;
        }
      }
      if (selectedSeverity !== 'all' && item.severity !== selectedSeverity) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inTitle = item.title.toLowerCase().includes(q);
        const inCat = item.category.toLowerCase().includes(q);
        const inDesc = item.description.toLowerCase().includes(q);
        const inRem = item.remediation ? item.remediation.toLowerCase().includes(q) : false;
        const inTags = item.tags ? item.tags.some((t) => t.toLowerCase().includes(q)) : false;
        if (!inTitle && !inCat && !inDesc && !inRem && !inTags) {
          return false;
        }
      }
      return true;
    });
  }, [findingsList, activeEngagement, selectedCategory, selectedHostId, selectedSeverity, searchQuery]);

  // Filtered Evidence Items — strict customer encapsulation & reportability
  const filteredEvidence = useMemo(() => {
    return evidenceList.filter((item) => {
      if (!activeEngagement) {
        if (item.engagementId) return false;
      } else {
        if (item.engagementId !== activeEngagement.id) return false;
      }
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }
      if (selectedHostId !== 'all') {
        if (selectedHostId === 'unassigned') {
          if (item.hostId) return false;
        } else if (item.hostId !== selectedHostId) {
          return false;
        }
      }
      if (selectedSeverity !== 'all' && item.severity !== selectedSeverity) {
        return false;
      }
      if (evidenceReportFilter === 'reportable' && item.inReport === false) {
        return false;
      }
      if (evidenceReportFilter === 'internal' && item.inReport !== false) {
        return false;
      }
      if (evidenceReportFilter === 'unlinked' && (item.findingId || findingsList.some((f) => f.evidenceIds?.includes(item.id)))) {
        return false;
      }
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
  }, [evidenceList, activeEngagement, selectedCategory, selectedHostId, selectedSeverity, evidenceReportFilter, searchQuery, findingsList]);

  // Findings handlers
  const openNewFinding = (presetTemplate?: FindingItem) => {
    if (presetTemplate) {
      setFindEditId(null);
      setFindEditTitle(presetTemplate.title);
      setFindEditCategory(presetTemplate.category);
      setFindEditSeverity(presetTemplate.severity || 'high');
      setFindEditStatus('draft');
      setFindEditHostId(activeHostId || '');
      setFindEditCve(presetTemplate.cve || '');
      setFindEditCvss(presetTemplate.cvss || '');
      setFindEditCvssVector(presetTemplate.cvssVector || '');
      setFindEditMitreAttack(presetTemplate.mitreAttack || '');
      setShowCvssCalculator(false);
      setFindEditDescription(presetTemplate.description);
      setFindEditImpact(presetTemplate.impact || '');
      setFindEditRemediation(presetTemplate.remediation || '');
      setFindEditEvidenceIds([]);
      setFindEditTags(presetTemplate.tags ? presetTemplate.tags.join(', ') : '');
    } else {
      setFindEditId(null);
      setFindEditTitle('');
      setFindEditCategory(categories[0] || 'Vulnerabilities');
      setFindEditSeverity('high');
      setFindEditStatus('draft');
      setFindEditHostId(activeHostId || '');
      setFindEditCve('');
      setFindEditCvss('');
      setFindEditCvssVector('');
      setFindEditMitreAttack('');
      setShowCvssCalculator(false);
      setFindEditDescription('');
      setFindEditImpact('');
      setFindEditRemediation('');
      setFindEditEvidenceIds([]);
      setFindEditTags('');
    }
    setIsEditingFinding(true);
    setIsEditingEvidence(false);
  };

  const openEditFinding = (f: FindingItem) => {
    setFindEditId(f.id);
    setFindEditTitle(f.title);
    setFindEditCategory(f.category);
    setFindEditSeverity(f.severity);
    setFindEditStatus(f.status || 'draft');
    setFindEditHostId(f.hostId || '');
    setFindEditCve(f.cve || '');
    setFindEditCvss(f.cvss || '');
    setFindEditCvssVector(f.cvssVector || '');
    setFindEditMitreAttack(f.mitreAttack || '');
    setShowCvssCalculator(false);
    setFindEditDescription(f.description);
    setFindEditImpact(f.impact || '');
    setFindEditRemediation(f.remediation || '');
    // Gather all evidences that reference this finding or are in its evidenceIds
    const linkedIds = new Set<string>(f.evidenceIds || []);
    evidenceList.forEach((e) => {
      if (e.findingId === f.id) linkedIds.add(e.id);
    });
    setFindEditEvidenceIds(Array.from(linkedIds));
    setFindEditTags(f.tags ? f.tags.join(', ') : '');
    setIsEditingFinding(true);
    setIsEditingEvidence(false);
  };

  const handleSaveFinding = async (e: React.FormEvent) => {
    e.preventDefault();
    const api = getEvidenceApi();
    if (!api?.SaveFinding) return;

    if (!findEditTitle.trim() || !findEditDescription.trim()) {
      setFeedbackMsg({ type: 'error', text: 'Finding title and description are required.' });
      return;
    }

    const now = new Date().toISOString();
    const findingId = findEditId || `find-${Date.now()}`;
    const item: FindingItem = {
      id: findingId,
      engagementId: activeEngagement?.id || '',
      title: findEditTitle.trim(),
      category: findEditCategory,
      severity: findEditSeverity,
      status: findEditStatus,
      hostId: findEditHostId || undefined,
      affectedHosts: findEditHostId ? [findEditHostId] : undefined,
      description: findEditDescription.trim(),
      impact: findEditImpact.trim() || undefined,
      remediation: findEditRemediation.trim() || undefined,
      cve: findEditCve.trim() || undefined,
      cvss: findEditCvss.trim() || undefined,
      cvssVector: findEditCvssVector.trim() || undefined,
      mitreAttack: findEditMitreAttack.trim() || undefined,
      evidenceIds: findEditEvidenceIds,
      createdAt: now,
      updatedAt: now,
      tags: findEditTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };

    try {
      await api.SaveFinding(item);
      setFeedbackMsg({ type: 'success', text: `Saved finding: ${item.title}` });
      setIsEditingFinding(false);
      await refreshAll();
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleDeleteFinding = async (id: string, title: string) => {
    if (!window.confirm(`Delete finding "${title}"?`)) return;
    const api = getEvidenceApi();
    if (!api?.DeleteFinding) return;
    try {
      await api.DeleteFinding(id);
      setFeedbackMsg({ type: 'success', text: `Deleted finding "${title}"` });
      await refreshAll();
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  // Evidence handlers
  const openNewEvidence = (presetTemplate?: EvidenceItem) => {
    if (presetTemplate) {
      setEviEditId(null);
      setEviEditTitle(presetTemplate.title);
      setEviEditCategory(presetTemplate.category);
      setEviEditSeverity(presetTemplate.severity || 'info');
      setEviEditType(presetTemplate.type);
      setEviEditHostId(activeHostId || '');
      setEviEditSource(presetTemplate.source || 'manual');
      setEviEditTags(presetTemplate.tags ? presetTemplate.tags.join(', ') : '');
      setEviEditInReport(presetTemplate.inReport !== false);
      setEviEditFindingId(presetTemplate.findingId || '');
      if (presetTemplate.type === 'table') {
        try {
          const parsed = JSON.parse(presetTemplate.content) as TableEvidenceContent;
          setTableHeaders(parsed.headers || ['Column 1', 'Column 2']);
          setTableRows(parsed.rows || [['Value 1', 'Value 2']]);
        } catch {
          setTableHeaders(['Column 1', 'Column 2']);
          setTableRows([['', '']]);
        }
        setEviEditTextContent('');
      } else {
        setEviEditTextContent(presetTemplate.content);
      }
    } else {
      setEviEditId(null);
      setEviEditTitle('');
      setEviEditCategory(categories[0] || 'Credentials');
      setEviEditSeverity('info');
      setEviEditType('text');
      setEviEditHostId(activeHostId || '');
      setEviEditSource('manual');
      setEviEditTags('');
      setEviEditTextContent('');
      setEviEditInReport(true);
      setEviEditFindingId('');
      setTableHeaders(['Port', 'Protocol', 'Service', 'State']);
      setTableRows([['22', 'tcp', 'ssh', 'open']]);
    }
    setIsEditingEvidence(true);
    setIsEditingFinding(false);
  };

  const openEditEvidence = (item: EvidenceItem) => {
    setEviEditId(item.id);
    setEviEditTitle(item.title);
    setEviEditCategory(item.category);
    setEviEditSeverity(item.severity || 'info');
    setEviEditType(item.type);
    setEviEditHostId(item.hostId || '');
    setEviEditSource(item.source || 'manual');
    setEviEditTags(item.tags ? item.tags.join(', ') : '');
    setEviEditInReport(item.inReport !== false);
    setEviEditFindingId(item.findingId || '');
    if (item.type === 'table') {
      try {
        const parsed = JSON.parse(item.content) as TableEvidenceContent;
        setTableHeaders(parsed.headers || ['Column 1', 'Column 2']);
        setTableRows(parsed.rows || [['', '']]);
      } catch {
        setTableHeaders(['Column 1', 'Column 2']);
        setTableRows([['', '']]);
      }
      setEviEditTextContent('');
    } else {
      setEviEditTextContent(item.content);
    }
    setIsEditingEvidence(true);
    setIsEditingFinding(false);
  };

  const handleSaveEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    const api = getEvidenceApi();
    if (!api?.SaveEvidence) return;

    if (!eviEditTitle.trim()) {
      setFeedbackMsg({ type: 'error', text: 'Evidence title is required.' });
      return;
    }

    let finalContent = eviEditTextContent;
    if (eviEditType === 'table') {
      const tableData: TableEvidenceContent = {
        headers: tableHeaders.map((h) => h.trim() || 'Col'),
        rows: tableRows.map((r) => r.map((c) => c.trim())),
      };
      finalContent = JSON.stringify(tableData);
    }

    const tagsArray = eviEditTags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const evidenceId = eviEditId || `evi-${Date.now()}`;
    const item: EvidenceItem = {
      id: evidenceId,
      engagementId: activeEngagement?.id || '',
      findingId: eviEditFindingId || undefined,
      category: eviEditCategory,
      title: eviEditTitle.trim(),
      type: eviEditType,
      content: finalContent,
      hostId: eviEditHostId || undefined,
      severity: eviEditSeverity,
      source: eviEditSource.trim() || 'manual',
      inReport: eviEditInReport,
      tags: tagsArray,
      capturedAt: new Date().toISOString(),
    };

    try {
      await api.SaveEvidence(item);
      // Link into parent finding if specified
      if (eviEditFindingId && api.SaveFinding) {
        const parentFinding = findingsList.find((f) => f.id === eviEditFindingId);
        if (parentFinding && !parentFinding.evidenceIds?.includes(evidenceId)) {
          await api.SaveFinding({
            ...parentFinding,
            evidenceIds: [...(parentFinding.evidenceIds || []), evidenceId],
          });
        }
      }
      setFeedbackMsg({ type: 'success', text: `Saved evidence: ${item.title}` });
      setIsEditingEvidence(false);
      await refreshAll();
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleDeleteEvidence = async (id: string, title: string) => {
    if (!window.confirm(`Delete evidence artifact "${title}"?`)) return;
    const api = getEvidenceApi();
    if (!api?.DeleteEvidence) return;
    try {
      await api.DeleteEvidence(id);
      setFeedbackMsg({ type: 'success', text: `Deleted evidence "${title}"` });
      await refreshAll();
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleToggleEvidenceInReport = async (item: EvidenceItem) => {
    const api = getEvidenceApi();
    if (!api?.SaveEvidence) return;
    const updated: EvidenceItem = {
      ...item,
      inReport: item.inReport === false ? true : false,
    };
    try {
      await api.SaveEvidence(updated);
      await refreshAll();
    } catch (err: unknown) {
      console.error('Failed to toggle inReport status:', err);
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

  const handleCopyText = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch (err: unknown) {
      console.error('Clipboard copy failed:', err);
    }
  };

  // Table helpers
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

  const buildReportRequest = useCallback(
    (splitByHost = false, outputDir = ''): ReportExportRequest => ({
      engagementId: activeEngagement?.id || '',
      hostId: splitByHost || reportHostScope === 'all' ? '' : reportHostScope,
      format: reportFormat,
      splitByHost,
      includeInternalEvidence: reportIncludeInternal,
      includePortFindings: reportIncludePorts,
      includeUnlinkedEvidence: reportIncludeUnlinked,
      includeLinkedNotes: reportIncludeNotes,
      outputDir,
    }),
    [
      activeEngagement?.id,
      reportHostScope,
      reportFormat,
      reportIncludeInternal,
      reportIncludePorts,
      reportIncludeUnlinked,
      reportIncludeNotes,
    ]
  );

  // Client-side fallback compiler used only when running outside the Wails Go runtime (e.g. Vitest/browser).
  const compileClientFallbackReport = useCallback((): ReportExportResult => {
    const scopeFindings = findingsList
      .filter((f) => reportHostScope === 'all' || f.hostId === reportHostScope || f.affectedHosts?.includes(reportHostScope))
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title));

    const groups = new Map<string, { label: string; findings: FindingItem[]; standalone: EvidenceItem[] }>();
    const ensureGroup = (hId: string) => {
      const key = hId || '__engagement_wide__';
      let grp = groups.get(key);
      if (!grp) {
        const h = hId ? hostMap.get(hId) : undefined;
        grp = {
          label: h ? `${h.label} (${h.address})` : hId || 'Engagement-Wide',
          findings: [],
          standalone: [],
        };
        groups.set(key, grp);
      }
      return grp;
    };

    scopeFindings.forEach((f) => ensureGroup(f.hostId || '').findings.push(f));
    if (reportIncludeUnlinked) {
      evidenceList.forEach((ev) => {
        if (!ev.findingId && (reportIncludeInternal || ev.inReport !== false)) {
          if (reportHostScope === 'all' || ev.hostId === reportHostScope) {
            ensureGroup(ev.hostId || '').standalone.push(ev);
          }
        }
      });
    }

    const lines: string[] = [];
    lines.push('# DoubleAgent — Assessment & Evidence Report');
    lines.push('');
    lines.push(`- **Engagement:** ${activeEngagement?.name || 'Default Engagement'}`);
    if (activeEngagement?.scope) lines.push(`- **Scope:** ${activeEngagement.scope}`);
    if (activeEngagement?.timeframe) lines.push(`- **Timeframe:** ${activeEngagement.timeframe}`);
    lines.push('');

    const sevLabel = ['critical', 'high', 'medium', 'low', 'info'];
    lines.push('## 1. Executive Summary');
    lines.push('');
    lines.push('| Severity | Findings |');
    lines.push('| :--- | ---: |');
    sevLabel.forEach((sev) => {
      const count = scopeFindings.filter((f) => (f.severity || 'info').toLowerCase() === sev).length;
      lines.push(`| ${sev.toUpperCase()} | ${count} |`);
    });
    lines.push(`| **Total** | **${scopeFindings.length}** |`);
    lines.push('');

    const internalExcluded = reportIncludeInternal
      ? 0
      : evidenceList.filter((e) => e.inReport === false).length;

    let attachedCount = 0;
    Array.from(groups.entries()).forEach(([, grp], hIdx) => {
      lines.push(`## ${hIdx + 2}. Target Host: ${grp.label}`);
      lines.push('');
      grp.findings.forEach((f, fIdx) => {
        lines.push(`### [${f.severity.toUpperCase()}] ${hIdx + 2}.${fIdx + 1} ${f.title}`);
        lines.push(`- **Category:** ${f.category} | **Status:** ${f.status.toUpperCase()}`);
        if (f.cvss) lines.push(`- **CVSS:** ${f.cvss}${f.cvssVector ? ` (${f.cvssVector})` : ''}`);
        if (f.mitreAttack) lines.push(`- **MITRE ATT&CK:** ${f.mitreAttack}`);
        lines.push('');
        lines.push(f.description);
        lines.push('');
        const attached = evidenceList.filter(
          (ev) =>
            (f.evidenceIds?.includes(ev.id) || ev.findingId === f.id) &&
            (reportIncludeInternal || ev.inReport !== false)
        );
        attachedCount += attached.length;
        attached.forEach((ev, eIdx) => {
          lines.push(`##### Evidence ${eIdx + 1}: ${ev.title}`);
          if (ev.source) lines.push(`- **Source:** ${ev.source}`);
          if (ev.capturedAt) lines.push(`- **Captured At (UTC):** ${ev.capturedAt}`);
          lines.push('');
          if (ev.type === 'table') {
            try {
              const parsed = JSON.parse(ev.content) as TableEvidenceContent;
              if (parsed.headers && parsed.rows) {
                lines.push(`| ${parsed.headers.join(' | ')} |`);
                lines.push(`| ${parsed.headers.map(() => '---').join(' | ')} |`);
                parsed.rows.forEach((r) => lines.push(`| ${r.join(' | ')} |`));
                lines.push('');
                return;
              }
            } catch {
              // Fall through to code block
            }
          }
          lines.push('```text');
          lines.push(ev.content);
          lines.push('```');
          lines.push('');
        });
      });
      grp.standalone.forEach((ev, sIdx) => {
        attachedCount += 1;
        lines.push(`#### Standalone Evidence ${sIdx + 1}: ${ev.title}`);
        if (ev.source) lines.push(`- **Source:** ${ev.source}`);
        if (ev.capturedAt) lines.push(`- **Captured At (UTC):** ${ev.capturedAt}`);
        lines.push('');
        lines.push('```text');
        lines.push(ev.content);
        lines.push('```');
        lines.push('');
      });
    });

    const slug = (activeEngagement?.name || 'engagement').replace(/[^a-zA-Z0-9_-]/g, '_');
    return {
      format: reportFormat,
      fileName: `${slug}.${reportFormat === 'html' ? 'html' : 'md'}`,
      content: lines.join('\n'),
      contentSha256: '',
      findingsCount: scopeFindings.length,
      evidenceCount: attachedCount,
      hostCount: groups.size,
      internalExcluded,
    };
  }, [
    activeEngagement,
    evidenceList,
    findingsList,
    hostMap,
    reportFormat,
    reportHostScope,
    reportIncludeInternal,
    reportIncludeUnlinked,
  ]);

  const compileReportPreview = useCallback(async () => {
    const api = getEvidenceApi();
    if (!api?.GenerateEvidenceReport) {
      setCompiledReport(compileClientFallbackReport());
      return;
    }
    setReportLoading(true);
    try {
      const res = await api.GenerateEvidenceReport(buildReportRequest(false, ''));
      setCompiledReport(res);
    } catch (err: unknown) {
      setFeedbackMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to compile assessment report',
      });
    } finally {
      setReportLoading(false);
    }
  }, [buildReportRequest, compileClientFallbackReport]);

  useEffect(() => {
    if (isOpen && activeTab === 'report') {
      void compileReportPreview();
    }
  }, [isOpen, activeTab, compileReportPreview]);

  const handleExportSingleReport = async () => {
    const api = getEvidenceApi();
    const req = buildReportRequest(false, '');
    const engSlug = (activeEngagement?.name || 'engagement').replace(/[^a-zA-Z0-9_-]/g, '_');
    const hostLabel =
      reportHostScope !== 'all'
        ? (hostMap.get(reportHostScope)?.label || reportHostScope).replace(/[^a-zA-Z0-9_-]/g, '_')
        : 'all-hosts';
    const ext = reportFormat === 'html' ? 'html' : 'md';
    const suggestedName = compiledReport?.fileName || `${engSlug}-${hostLabel}.${ext}`;

    if (api?.SaveReportFileDialog && api?.ExportEvidenceReportToFile) {
      try {
        const targetPath = await api.SaveReportFileDialog(suggestedName, reportFormat);
        if (!targetPath) return;
        setReportLoading(true);
        const saved = await api.ExportEvidenceReportToFile(req, targetPath);
        setCompiledReport(saved);
        setFeedbackMsg({
          type: 'success',
          text: `Report exported (${saved.format.toUpperCase()}, SHA-256 ${saved.contentSha256.slice(0, 12)}...) to ${targetPath}`,
        });
      } catch (err: unknown) {
        setFeedbackMsg({
          type: 'error',
          text: err instanceof Error ? err.message : 'Failed to export report file',
        });
      } finally {
        setReportLoading(false);
      }
      return;
    }

    const result = compiledReport || compileClientFallbackReport();
    const mime = reportFormat === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8';
    const blob = new Blob([result.content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBatchExportPerHost = async () => {
    const api = getEvidenceApi();
    if (!api?.SelectDirectoryDialog || !api?.GenerateEvidenceReport) {
      setFeedbackMsg({
        type: 'error',
        text: 'Per-host directory export requires the native desktop runtime.',
      });
      return;
    }
    try {
      const dirPath = await api.SelectDirectoryDialog('Select Folder for Per-Host Report Export');
      if (!dirPath) return;
      setReportLoading(true);
      const batchRes = await api.GenerateEvidenceReport(buildReportRequest(true, dirPath));
      setCompiledReport(batchRes);
      const fileCount = batchRes.writtenFiles?.length || 0;
      setFeedbackMsg({
        type: 'success',
        text: `Exported ${fileCount} per-host files + SHA-256 manifest to ${dirPath}`,
      });
    } catch (err: unknown) {
      setFeedbackMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Per-host batch export failed',
      });
    } finally {
      setReportLoading(false);
    }
  };

  const getSeverityBadgeColor = (sev?: EvidenceSeverity) => {
    switch (sev) {
      case 'critical':
        return { bg: 'rgba(239, 68, 68, 0.2)', border: '#ef4444', text: '#fca5a5' };
      case 'high':
        return { bg: 'rgba(249, 115, 22, 0.2)', border: '#f97316', text: '#fdba74' };
      case 'medium':
        return { bg: 'rgba(234, 179, 8, 0.2)', border: '#eab308', text: '#fde047' };
      case 'low':
        return { bg: 'rgba(59, 130, 246, 0.2)', border: '#3b82f6', text: '#93c5fd' };
      default:
        return { bg: 'rgba(100, 116, 139, 0.2)', border: '#64748b', text: '#cbd5e1' };
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="cyber-dialog-backdrop modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-dialog-title"
    >
      <div
        className="cyber-dialog-card evidence-dialog-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '1020px', width: '96%', maxHeight: '92vh', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}
      >
        {/* Reticles */}
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Modal Header */}
        <div className="dialog-header" style={{ flexShrink: 0 }}>
          <div className="dialog-title" style={{ flex: 1, marginRight: '1rem' }}>
            <span className="cyber-hazard-stripes">///</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                <h3 id="evidence-dialog-title" style={{ margin: 0, fontSize: '1.05rem', color: '#00f0ff', letterSpacing: '0.06em' }}>
                  🛡️ Evidence Vault &amp; Findings (F-18)
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.74rem', color: '#00f0ff', fontWeight: 700 }}>ENGAGEMENT:</span>
                  <select
                    className="cyber-hud-select"
                    value={activeEngagement?.id || ''}
                    onChange={async (e) => {
                      const newId = e.target.value;
                      const appApi = (window as unknown as { go?: { main?: { App?: { SetActiveEngagement: (id: string) => Promise<void> } } } }).go?.main?.App;
                      if (appApi?.SetActiveEngagement) {
                        try {
                          await appApi.SetActiveEngagement(newId || 'none');
                          await refreshAll();
                        } catch (err) {
                          console.error('Failed to change engagement:', err);
                        }
                      }
                    }}
                    style={{ fontSize: '0.78rem', height: '32px', minWidth: '320px', borderColor: 'rgba(0, 240, 255, 0.45)', padding: '2px 8px' }}
                  >
                    <option value="">🌐 No Engagement (Casual / Global)</option>
                    {engagements.map((eng) => (
                      <option key={eng.id} value={eng.id}>
                        🎯 {eng.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ fontSize: '0.7rem', color: '#38bdf8', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                SEPARATED WORKFLOW // 1 FINDING &rarr; MULTIPLE EVIDENCES &amp; REPORTABLE ARTIFACT TOGGLE
                {activeEngagement && (
                  <span style={{ marginLeft: '8px', color: '#10b981', fontWeight: 700 }}>
                    [ENCAPSULATED: {activeEngagement.name.toUpperCase()}]
                  </span>
                )}
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

        {/* Top-Level Tab Navigation */}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            padding: '0.55rem 1.25rem',
            background: 'rgba(5, 12, 22, 0.9)',
            borderBottom: '1px solid rgba(0, 240, 255, 0.25)',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            className={`cyber-btn ${activeTab === 'findings' ? 'cyber-btn-primary' : 'cyber-btn-secondary'}`}
            style={{ fontSize: '0.78rem', padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            onClick={() => {
              setActiveTab('findings');
              setIsEditingFinding(false);
              setIsEditingEvidence(false);
            }}
          >
            <CyberIcon name="target" size={14} />
            Findings ({filteredFindings.length})
          </button>
          <button
            type="button"
            className={`cyber-btn ${activeTab === 'evidence' ? 'cyber-btn-primary' : 'cyber-btn-secondary'}`}
            style={{ fontSize: '0.78rem', padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            onClick={() => {
              setActiveTab('evidence');
              setIsEditingFinding(false);
              setIsEditingEvidence(false);
            }}
          >
            <CyberIcon name="shield" size={14} />
            Evidence Vault ({filteredEvidence.length})
          </button>
          <button
            type="button"
            className={`cyber-btn ${activeTab === 'report' ? 'cyber-btn-primary' : 'cyber-btn-secondary'}`}
            style={{ fontSize: '0.78rem', padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            onClick={() => {
              setActiveTab('report');
              setIsEditingFinding(false);
              setIsEditingEvidence(false);
            }}
          >
            <CyberIcon name="file" size={14} />
            Assessment Report
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div
          className="dialog-body"
          style={{
            flex: 1,
            minHeight: 0,
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

          {/* ========================================================= */}
          {/* TAB 1: FINDINGS (Vulnerabilities)                          */}
          {/* ========================================================= */}
          {activeTab === 'findings' && !isEditingFinding && (
            <>
              {/* Toolbar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.5rem', flex: 1, minWidth: '280px' }}>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    placeholder="Search findings by title, description, tags, category..."
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
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    style={{ width: '135px', height: '32px' }}
                  >
                    <option value="all">All Categories</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
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
                  {findingTemplates.length > 0 && (
                    <select
                      className="cyber-hud-select"
                      style={{ width: '200px', height: '32px', border: '1px solid rgba(0, 240, 255, 0.4)' }}
                      defaultValue=""
                      onChange={(e) => {
                        const tpl = findingTemplates.find((t) => t.id === e.target.value);
                        if (tpl) {
                          openNewFinding(tpl);
                        }
                        e.target.value = '';
                      }}
                    >
                      <option value="" disabled>
                        ✨ Use Finding Template...
                      </option>
                      {findingTemplates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          [{tpl.severity.toUpperCase()}] {tpl.title}
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
                </div>
              </div>

              {/* Findings Cards */}
              {filteredFindings.length === 0 ? (
                <div
                  style={{
                    padding: '2.5rem',
                    textAlign: 'center',
                    background: 'rgba(0, 240, 255, 0.02)',
                    border: '1px dashed rgba(0, 240, 255, 0.25)',
                    color: '#94a3b8',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '0.85rem',
                  }}
                >
                  No findings recorded yet. Click <strong>+ New Finding</strong> or select terminal text to create one.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {filteredFindings.map((finding) => {
                    const badge = getSeverityBadgeColor(finding.severity);
                    const hostObj = finding.hostId ? hostMap.get(finding.hostId) : undefined;
                    // Count linked evidences
                    const linkedEvCount = evidenceList.filter(
                      (e) => finding.evidenceIds?.includes(e.id) || e.findingId === finding.id
                    ).length;

                    return (
                      <div
                        key={finding.id}
                        style={{
                          background: 'rgba(5, 11, 20, 0.85)',
                          border: `1px solid ${badge.border}40`,
                          borderLeft: `4px solid ${badge.border}`,
                          padding: '0.85rem 1rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.55rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                            <span
                              style={{
                                background: badge.bg,
                                border: `1px solid ${badge.border}`,
                                color: badge.text,
                                padding: '2px 8px',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                fontFamily: 'JetBrains Mono, monospace',
                              }}
                            >
                              {finding.severity}
                            </span>
                            <span style={{ fontSize: '0.94rem', fontWeight: 700, color: '#f1f5f9' }}>
                              {finding.title}
                            </span>
                            <span style={{ fontSize: '0.72rem', color: '#94a3b8', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: '2px' }}>
                              {finding.category}
                            </span>
                            {finding.cve && (
                              <span style={{ fontSize: '0.68rem', color: '#a5f3fc', background: 'rgba(0, 240, 255, 0.1)', border: '1px solid rgba(0, 240, 255, 0.3)', padding: '1px 6px', fontFamily: 'JetBrains Mono, monospace' }}>
                                {finding.cve}
                              </span>
                            )}
                            {finding.cvss && (
                              <span style={{ fontSize: '0.68rem', color: '#fbbf24', background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)', padding: '1px 6px', fontFamily: 'JetBrains Mono, monospace' }}>
                                CVSS {finding.cvss}
                              </span>
                            )}
                            {finding.mitreAttack && (
                              <span style={{ fontSize: '0.68rem', color: '#e879f9', background: 'rgba(232, 121, 249, 0.1)', border: '1px solid rgba(232, 121, 249, 0.3)', padding: '1px 6px', fontFamily: 'JetBrains Mono, monospace' }}>
                                ATT&amp;CK {finding.mitreAttack.split(' - ')[0]}
                              </span>
                            )}
                            {hostObj && (
                              <span style={{ fontSize: '0.72rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '1px 6px', borderRadius: '2px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                <CyberIcon name="terminal" size={10} /> {hostObj.label}
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: '0.68rem',
                                color: linkedEvCount > 0 ? '#00f0ff' : '#64748b',
                                border: linkedEvCount > 0 ? '1px solid rgba(0, 240, 255, 0.3)' : '1px solid rgba(100, 116, 139, 0.25)',
                                padding: '1px 6px',
                                background: linkedEvCount > 0 ? 'rgba(0, 240, 255, 0.08)' : 'transparent',
                                fontFamily: 'JetBrains Mono, monospace',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px',
                              }}
                            >
                              <CyberIcon name="shield" size={10} /> {linkedEvCount} {linkedEvCount === 1 ? 'Evidence' : 'Evidences'}
                            </span>
                          </div>

                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                            <button
                              type="button"
                              className="cyber-btn"
                              style={{ padding: '2px 8px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '3px' }}
                              onClick={() => openEditFinding(finding)}
                            >
                              <CyberIcon name="edit" size={11} /> Edit Finding
                            </button>
                            <button
                              type="button"
                              className="cyber-btn"
                              style={{ padding: '2px 8px', fontSize: '0.72rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: '3px' }}
                              onClick={() => handleDeleteFinding(finding.id, finding.title)}
                            >
                              <CyberIcon name="trash" size={11} /> Delete
                            </button>
                          </div>
                        </div>

                        <div style={{ fontSize: '0.82rem', color: '#cbd5e1', lineHeight: '1.45' }}>
                          <MarkdownRenderer content={finding.description} />
                        </div>

                        {finding.remediation && (
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8', background: 'rgba(0, 240, 255, 0.03)', padding: '0.4rem 0.6rem', borderLeft: '2px solid #00f0ff' }}>
                            <strong style={{ color: '#00f0ff' }}>Remediation: </strong>
                            {finding.remediation}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* FINDING EDITOR */}
          {activeTab === 'findings' && isEditingFinding && (
            <div
              style={{
                background: 'rgba(7, 14, 26, 0.95)',
                border: '1px solid #00f0ff',
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#00f0ff', letterSpacing: '0.04em' }}>
                  {findEditId ? '✏️ EDIT SECURITY FINDING' : '⚡ CREATE NEW SECURITY FINDING'}
                </span>
                <button
                  type="button"
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem' }}
                  onClick={() => setIsEditingFinding(false)}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveFinding} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="cyber-label">Finding Title</label>
                    <input
                      type="text"
                      className="cyber-hud-input"
                      placeholder="e.g. Kerberoasting on Domain Controller"
                      value={findEditTitle}
                      onChange={(e) => setFindEditTitle(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="cyber-label">Category</label>
                    <select
                      className="cyber-hud-select"
                      value={findEditCategory}
                      onChange={(e) => setFindEditCategory(e.target.value)}
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
                      value={findEditSeverity}
                      onChange={(e) => setFindEditSeverity(e.target.value as EvidenceSeverity)}
                    >
                      <option value="critical">🔴 Critical</option>
                      <option value="high">🟠 High</option>
                      <option value="medium">🟡 Medium</option>
                      <option value="low">🔵 Low</option>
                      <option value="info">ℹ️ Info</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="cyber-label">Target Host</label>
                    <select
                      className="cyber-hud-select"
                      value={findEditHostId}
                      onChange={(e) => setFindEditHostId(e.target.value)}
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
                    <label className="cyber-label">Lifecycle Status</label>
                    <select
                      className="cyber-hud-select"
                      value={findEditStatus}
                      onChange={(e) => setFindEditStatus(e.target.value as FindingStatus)}
                    >
                      <option value="draft">Draft (In Progress)</option>
                      <option value="confirmed">Confirmed (Verified)</option>
                      <option value="reported">Reported to Client</option>
                      <option value="remediated">Remediated / Verified Fixed</option>
                    </select>
                  </div>
                </div>

                {/* CVE, MITRE ATT&CK & CVSS Calculator Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.6fr 1.3fr', gap: '0.75rem' }}>
                  <div>
                    <label className="cyber-label" htmlFor="find-edit-cve">CVE Identifier</label>
                    <input
                      id="find-edit-cve"
                      type="text"
                      className="cyber-hud-input font-mono"
                      placeholder="e.g. CVE-2023-38606"
                      value={findEditCve}
                      onChange={(e) => setFindEditCve(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="cyber-label" htmlFor="find-edit-mitre">MITRE ATT&amp;CK Technique</label>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <input
                        id="find-edit-mitre"
                        type="text"
                        className="cyber-hud-input font-mono"
                        placeholder="e.g. T1003.001 - LSASS Memory"
                        value={findEditMitreAttack}
                        onChange={(e) => setFindEditMitreAttack(e.target.value)}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <select
                        className="cyber-hud-select font-mono"
                        style={{ width: '135px', fontSize: '0.72rem' }}
                        value=""
                        onChange={(e) => {
                          if (e.target.value) setFindEditMitreAttack(e.target.value);
                        }}
                        title="Quick-pick standard MITRE ATT&CK technique"
                      >
                        <option value="">Presets...</option>
                        {COMMON_MITRE_TECHNIQUES.map((tech) => (
                          <option key={tech} value={tech}>
                            {tech}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                      <label className="cyber-label" htmlFor="find-edit-cvss" style={{ margin: 0 }}>CVSS v3.1</label>
                      <button
                        type="button"
                        className="cyber-btn cyber-btn-sm cyber-btn-secondary"
                        style={{ fontSize: '0.68rem', padding: '1px 6px', display: 'flex', alignItems: 'center', gap: '3px' }}
                        onClick={() => setShowCvssCalculator((prev) => !prev)}
                        title="Toggle CVSS v3.1 Base Score Calculator"
                      >
                        <CyberIcon name="calculator" size={10} /> {showCvssCalculator ? 'Close Calc' : 'Calculator'}
                      </button>
                    </div>
                    <input
                      id="find-edit-cvss"
                      type="text"
                      className="cyber-hud-input font-mono"
                      placeholder="e.g. 7.8 (or use calc)"
                      value={findEditCvss}
                      onChange={(e) => setFindEditCvss(e.target.value)}
                    />
                  </div>
                </div>

                {/* Collapsible CVSS v3.1 Interactive Calculator */}
                {showCvssCalculator && (
                  <div
                    style={{
                      background: 'rgba(2, 6, 12, 0.95)',
                      border: '1px solid #00f0ff',
                      padding: '0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.65rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(0, 240, 255, 0.25)', paddingBottom: '0.4rem' }}>
                      <span style={{ fontSize: '0.78rem', color: '#00f0ff', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <CyberIcon name="calculator" size={12} /> FIRST.org CVSS v3.1 BASE SCORE CALCULATOR
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace' }}>
                          VECTOR: <code style={{ color: '#38bdf8' }}>{findEditCvssVector || computeCvssV31(cvssParams).vector}</code>
                        </span>
                        <span
                          style={{
                            background: getSeverityBadgeColor(computeCvssV31(cvssParams).severity).bg,
                            border: `1px solid ${getSeverityBadgeColor(computeCvssV31(cvssParams).severity).border}`,
                            color: getSeverityBadgeColor(computeCvssV31(cvssParams).severity).text,
                            padding: '1px 8px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            fontFamily: 'JetBrains Mono, monospace',
                          }}
                        >
                          {computeCvssV31(cvssParams).score} ({computeCvssV31(cvssParams).severity.toUpperCase()})
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
                      {/* Attack Vector */}
                      <div>
                        <label className="cyber-label-sm" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.72rem', color: '#94a3b8' }}>Attack Vector (AV)</label>
                        <select
                          className="cyber-hud-select font-mono"
                          style={{ fontSize: '0.78rem', height: '36px', minHeight: '36px', padding: '0.35rem 0.65rem', lineHeight: '1.4', width: '100%' }}
                          value={cvssParams.av}
                          onChange={(e) => {
                            const next = { ...cvssParams, av: e.target.value as CvssV31Input['av'] };
                            setCvssParams(next);
                            const res = computeCvssV31(next);
                            setFindEditCvss(res.score.toString());
                            setFindEditCvssVector(res.vector);
                            setFindEditSeverity(res.severity);
                          }}
                        >
                          <option value="N">Network (N: 0.85)</option>
                          <option value="A">Adjacent (A: 0.62)</option>
                          <option value="L">Local (L: 0.55)</option>
                          <option value="P">Physical (P: 0.20)</option>
                        </select>
                      </div>

                      {/* Attack Complexity */}
                      <div>
                        <label className="cyber-label-sm" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.72rem', color: '#94a3b8' }}>Attack Complexity (AC)</label>
                        <select
                          className="cyber-hud-select font-mono"
                          style={{ fontSize: '0.78rem', height: '36px', minHeight: '36px', padding: '0.35rem 0.65rem', lineHeight: '1.4', width: '100%' }}
                          value={cvssParams.ac}
                          onChange={(e) => {
                            const next = { ...cvssParams, ac: e.target.value as CvssV31Input['ac'] };
                            setCvssParams(next);
                            const res = computeCvssV31(next);
                            setFindEditCvss(res.score.toString());
                            setFindEditCvssVector(res.vector);
                            setFindEditSeverity(res.severity);
                          }}
                        >
                          <option value="L">Low (L: 0.77)</option>
                          <option value="H">High (H: 0.44)</option>
                        </select>
                      </div>

                      {/* Privileges Required */}
                      <div>
                        <label className="cyber-label-sm" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.72rem', color: '#94a3b8' }}>Privileges Required (PR)</label>
                        <select
                          className="cyber-hud-select font-mono"
                          style={{ fontSize: '0.78rem', height: '36px', minHeight: '36px', padding: '0.35rem 0.65rem', lineHeight: '1.4', width: '100%' }}
                          value={cvssParams.pr}
                          onChange={(e) => {
                            const next = { ...cvssParams, pr: e.target.value as CvssV31Input['pr'] };
                            setCvssParams(next);
                            const res = computeCvssV31(next);
                            setFindEditCvss(res.score.toString());
                            setFindEditCvssVector(res.vector);
                            setFindEditSeverity(res.severity);
                          }}
                        >
                          <option value="N">None (N)</option>
                          <option value="L">Low (L)</option>
                          <option value="H">High (H)</option>
                        </select>
                      </div>

                      {/* User Interaction */}
                      <div>
                        <label className="cyber-label-sm" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.72rem', color: '#94a3b8' }}>User Interaction (UI)</label>
                        <select
                          className="cyber-hud-select font-mono"
                          style={{ fontSize: '0.78rem', height: '36px', minHeight: '36px', padding: '0.35rem 0.65rem', lineHeight: '1.4', width: '100%' }}
                          value={cvssParams.ui}
                          onChange={(e) => {
                            const next = { ...cvssParams, ui: e.target.value as CvssV31Input['ui'] };
                            setCvssParams(next);
                            const res = computeCvssV31(next);
                            setFindEditCvss(res.score.toString());
                            setFindEditCvssVector(res.vector);
                            setFindEditSeverity(res.severity);
                          }}
                        >
                          <option value="N">None (N: 0.85)</option>
                          <option value="R">Required (R: 0.62)</option>
                        </select>
                      </div>

                      {/* Scope */}
                      <div>
                        <label className="cyber-label-sm" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.72rem', color: '#94a3b8' }}>Scope (S)</label>
                        <select
                          className="cyber-hud-select font-mono"
                          style={{ fontSize: '0.78rem', height: '36px', minHeight: '36px', padding: '0.35rem 0.65rem', lineHeight: '1.4', width: '100%' }}
                          value={cvssParams.s}
                          onChange={(e) => {
                            const next = { ...cvssParams, s: e.target.value as CvssV31Input['s'] };
                            setCvssParams(next);
                            const res = computeCvssV31(next);
                            setFindEditCvss(res.score.toString());
                            setFindEditCvssVector(res.vector);
                            setFindEditSeverity(res.severity);
                          }}
                        >
                          <option value="U">Unchanged (U)</option>
                          <option value="C">Changed (C)</option>
                        </select>
                      </div>

                      {/* Confidentiality */}
                      <div>
                        <label className="cyber-label-sm" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.72rem', color: '#94a3b8' }}>Confidentiality (C)</label>
                        <select
                          className="cyber-hud-select font-mono"
                          style={{ fontSize: '0.78rem', height: '36px', minHeight: '36px', padding: '0.35rem 0.65rem', lineHeight: '1.4', width: '100%' }}
                          value={cvssParams.c}
                          onChange={(e) => {
                            const next = { ...cvssParams, c: e.target.value as CvssV31Input['c'] };
                            setCvssParams(next);
                            const res = computeCvssV31(next);
                            setFindEditCvss(res.score.toString());
                            setFindEditCvssVector(res.vector);
                            setFindEditSeverity(res.severity);
                          }}
                        >
                          <option value="H">High (H: 0.56)</option>
                          <option value="L">Low (L: 0.22)</option>
                          <option value="N">None (N: 0)</option>
                        </select>
                      </div>

                      {/* Integrity */}
                      <div>
                        <label className="cyber-label-sm" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.72rem', color: '#94a3b8' }}>Integrity (I)</label>
                        <select
                          className="cyber-hud-select font-mono"
                          style={{ fontSize: '0.78rem', height: '36px', minHeight: '36px', padding: '0.35rem 0.65rem', lineHeight: '1.4', width: '100%' }}
                          value={cvssParams.i}
                          onChange={(e) => {
                            const next = { ...cvssParams, i: e.target.value as CvssV31Input['i'] };
                            setCvssParams(next);
                            const res = computeCvssV31(next);
                            setFindEditCvss(res.score.toString());
                            setFindEditCvssVector(res.vector);
                            setFindEditSeverity(res.severity);
                          }}
                        >
                          <option value="H">High (H: 0.56)</option>
                          <option value="L">Low (L: 0.22)</option>
                          <option value="N">None (N: 0)</option>
                        </select>
                      </div>

                      {/* Availability */}
                      <div>
                        <label className="cyber-label-sm" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.72rem', color: '#94a3b8' }}>Availability (A)</label>
                        <select
                          className="cyber-hud-select font-mono"
                          style={{ fontSize: '0.78rem', height: '36px', minHeight: '36px', padding: '0.35rem 0.65rem', lineHeight: '1.4', width: '100%' }}
                          value={cvssParams.a}
                          onChange={(e) => {
                            const next = { ...cvssParams, a: e.target.value as CvssV31Input['a'] };
                            setCvssParams(next);
                            const res = computeCvssV31(next);
                            setFindEditCvss(res.score.toString());
                            setFindEditCvssVector(res.vector);
                            setFindEditSeverity(res.severity);
                          }}
                        >
                          <option value="H">High (H: 0.56)</option>
                          <option value="L">Low (L: 0.22)</option>
                          <option value="N">None (N: 0)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="cyber-label">Description / Narrative (Markdown)</label>
                  <textarea
                    className="cyber-hud-input font-mono"
                    style={{ minHeight: '110px', resize: 'vertical' }}
                    placeholder="Explain the vulnerability, cause, and conditions..."
                    value={findEditDescription}
                    onChange={(e) => setFindEditDescription(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="cyber-label">Impact Assessment</label>
                    <textarea
                      className="cyber-hud-input"
                      style={{ minHeight: '75px', resize: 'vertical' }}
                      placeholder="Technical and business impact..."
                      value={findEditImpact}
                      onChange={(e) => setFindEditImpact(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="cyber-label">Remediation Guidance</label>
                    <textarea
                      className="cyber-hud-input"
                      style={{ minHeight: '75px', resize: 'vertical' }}
                      placeholder="Hardening recommendations, configuration changes, or patches..."
                      value={findEditRemediation}
                      onChange={(e) => setFindEditRemediation(e.target.value)}
                    />
                  </div>
                </div>

                {/* ATTACHED EVIDENCES SECTION */}
                <div
                  style={{
                    background: 'rgba(0, 240, 255, 0.04)',
                    border: '1px solid rgba(0, 240, 255, 0.25)',
                    padding: '0.75rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.55rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem', color: '#00f0ff', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                      🛡️ SUPPORTING EVIDENCES ({findEditEvidenceIds.length})
                    </span>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                      1 Finding can have multiple evidences (mimikatz dump, hashes, network trace)
                    </span>
                  </div>

                  {findEditEvidenceIds.length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic', padding: '0.4rem 0' }}>
                      No evidences attached yet. Attach from the vault below or right-click terminal text.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {findEditEvidenceIds.map((evId) => {
                        const ev = evidenceList.find((e) => e.id === evId);
                        if (!ev) return null;
                        return (
                          <div
                            key={ev.id}
                            style={{
                              background: 'rgba(2, 6, 12, 0.85)',
                              border: '1px solid rgba(0, 240, 255, 0.2)',
                              padding: '0.4rem 0.65rem',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: '0.76rem',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                              <span style={{ color: '#00f0ff' }}>🛡️ {ev.title}</span>
                              <span style={{ color: '#64748b' }}>[{ev.type}]</span>
                              <button
                                type="button"
                                style={{
                                  background: ev.inReport !== false ? 'rgba(0, 240, 255, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                                  border: ev.inReport !== false ? '1px solid #00f0ff' : '1px solid #64748b',
                                  color: ev.inReport !== false ? '#00f0ff' : '#94a3b8',
                                  fontSize: '0.68rem',
                                  padding: '1px 6px',
                                  cursor: 'pointer',
                                }}
                                onClick={() => handleToggleEvidenceInReport(ev)}
                                title="Toggle whether this evidence is exported in client report"
                              >
                                {ev.inReport !== false ? '📄 In Report' : '🔒 Internal Only'}
                              </button>
                            </div>
                            <button
                              type="button"
                              className="cyber-btn"
                              style={{ padding: '1px 6px', fontSize: '0.7rem', color: '#ef4444' }}
                              onClick={() => setFindEditEvidenceIds(findEditEvidenceIds.filter((id) => id !== ev.id))}
                              title="Detach evidence from this finding"
                            >
                              ✕ Detach
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Attach Existing Evidence Dropdown */}
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.2rem' }}>
                    <select
                      className="cyber-hud-select"
                      value={selectedEvidenceToAttach}
                      onChange={(e) => setSelectedEvidenceToAttach(e.target.value)}
                      style={{ flex: 1, height: '28px', fontSize: '0.74rem' }}
                    >
                      <option value="">-- Attach Existing Evidence from Vault --</option>
                      {evidenceList
                        .filter((e) => !findEditEvidenceIds.includes(e.id))
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            [{e.type.toUpperCase()}] {e.title} ({e.category})
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-secondary"
                      style={{ padding: '3px 10px', fontSize: '0.74rem' }}
                      disabled={!selectedEvidenceToAttach}
                      onClick={() => {
                        if (selectedEvidenceToAttach && !findEditEvidenceIds.includes(selectedEvidenceToAttach)) {
                          setFindEditEvidenceIds([...findEditEvidenceIds, selectedEvidenceToAttach]);
                          setSelectedEvidenceToAttach('');
                        }
                      }}
                    >
                      + Attach
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-secondary"
                    onClick={() => setIsEditingFinding(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="cyber-btn cyber-btn-primary">
                    💾 Save Finding
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ========================================================= */}
          {/* TAB 2: EVIDENCE VAULT (Raw Proof Artifacts)               */}
          {/* ========================================================= */}
          {activeTab === 'evidence' && !isEditingEvidence && (
            <>
              {/* Evidence Filters & Toolbar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.5rem', flex: 1, minWidth: '280px' }}>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    placeholder="Search raw evidence by title, content, host, source..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <select
                    className="cyber-hud-select"
                    value={evidenceReportFilter}
                    onChange={(e) => setEvidenceReportFilter(e.target.value as 'all' | 'reportable' | 'internal' | 'unlinked')}
                    style={{ width: '160px', height: '32px' }}
                  >
                    <option value="all">All Evidence</option>
                    <option value="reportable">📄 Reportable Only</option>
                    <option value="internal">🔒 Internal Only</option>
                    <option value="unlinked">⚠️ Unassigned</option>
                  </select>
                  <select
                    className="cyber-hud-select"
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    style={{ width: '135px', height: '32px' }}
                  >
                    <option value="all">All Categories</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
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
                  {evidenceTemplates.length > 0 && (
                    <select
                      className="cyber-hud-select"
                      style={{ width: '185px', height: '32px', border: '1px solid rgba(0, 240, 255, 0.4)' }}
                      defaultValue=""
                      onChange={(e) => {
                        const tpl = evidenceTemplates.find((t) => t.id === e.target.value);
                        if (tpl) {
                          openNewEvidence(tpl);
                        }
                        e.target.value = '';
                      }}
                    >
                      <option value="" disabled>
                        ✨ Use Evidence Preset...
                      </option>
                      {evidenceTemplates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          [{tpl.type.toUpperCase()}] {tpl.title}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-primary"
                    onClick={() => openNewEvidence()}
                  >
                    + New Evidence Artifact
                  </button>
                </div>
              </div>

              {/* Evidence Cards */}
              {filteredEvidence.length === 0 ? (
                <div
                  style={{
                    padding: '2.5rem',
                    textAlign: 'center',
                    background: 'rgba(0, 240, 255, 0.02)',
                    border: '1px dashed rgba(0, 240, 255, 0.25)',
                    color: '#94a3b8',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '0.85rem',
                  }}
                >
                  No evidence artifacts found matching filters.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {filteredEvidence.map((item) => {
                    const hostObj = item.hostId ? hostMap.get(item.hostId) : undefined;
                    const linkedFinding = item.findingId
                      ? findingMap.get(item.findingId)
                      : findingsList.find((f) => f.evidenceIds?.includes(item.id));

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
                          border: item.inReport !== false ? '1px solid rgba(0, 240, 255, 0.25)' : '1px solid rgba(100, 116, 139, 0.3)',
                          borderLeft: item.inReport !== false ? '4px solid #00f0ff' : '4px solid #64748b',
                          padding: '0.85rem 1rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.55rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f1f5f9' }}>
                              {item.title}
                            </span>
                            {item.severity && (
                              <span
                                style={{
                                  fontSize: '0.68rem',
                                  padding: '1px 5px',
                                  borderRadius: '2px',
                                  fontWeight: 700,
                                  background: getSeverityBadgeColor(item.severity).bg,
                                  border: `1px solid ${getSeverityBadgeColor(item.severity).border}`,
                                  color: getSeverityBadgeColor(item.severity).text,
                                }}
                              >
                                {item.severity.toUpperCase()}
                              </span>
                            )}
                            <span style={{ fontSize: '0.72rem', color: '#94a3b8', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: '2px' }}>
                              {item.category}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: '#38bdf8', fontFamily: 'JetBrains Mono, monospace' }}>
                              [{item.type.toUpperCase()}]
                            </span>
                            {hostObj && (
                              <span style={{ fontSize: '0.72rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '1px 6px', borderRadius: '2px' }}>
                                🖥️ {hostObj.label}
                              </span>
                            )}
                            {item.tags?.map((t) => (
                              <span key={t} style={{ fontSize: '0.68rem', color: '#94a3b8', background: 'rgba(255,255,255,0.04)', padding: '1px 5px', borderRadius: '2px' }}>
                                #{t}
                              </span>
                            ))}
                            {/* In-Report Toggle Button */}
                            <button
                              type="button"
                              onClick={() => handleToggleEvidenceInReport(item)}
                              style={{
                                background: item.inReport !== false ? 'rgba(0, 240, 255, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                                border: item.inReport !== false ? '1px solid #00f0ff' : '1px solid #64748b',
                                color: item.inReport !== false ? '#00f0ff' : '#94a3b8',
                                fontSize: '0.68rem',
                                padding: '1px 6px',
                                cursor: 'pointer',
                                fontFamily: 'JetBrains Mono, monospace',
                              }}
                              title="Click to toggle whether this evidence is exported in client report"
                            >
                              {item.inReport !== false ? '📄 In Report' : '🔒 Internal Only'}
                            </button>
                            {/* Linked Finding Pill */}
                            {linkedFinding ? (
                              <span style={{ fontSize: '0.7rem', color: '#a78bfa', background: 'rgba(167, 139, 250, 0.12)', border: '1px solid rgba(167, 139, 250, 0.3)', padding: '1px 6px', borderRadius: '2px', fontFamily: 'JetBrains Mono, monospace' }}>
                                🎯 Linked: {linkedFinding.title}
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.68rem', color: '#eab308', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)', padding: '1px 6px', borderRadius: '2px', fontFamily: 'JetBrains Mono, monospace' }}>
                                ⚠️ Standalone / Unassigned
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                            <button
                              type="button"
                              className="cyber-btn"
                              style={{ padding: '2px 7px', fontSize: '0.72rem' }}
                              onClick={() => handleCopyText(item.content, item.id)}
                            >
                              {copiedId === item.id ? '✓ Copied' : '📋 Copy'}
                            </button>
                            <button
                              type="button"
                              className="cyber-btn"
                              style={{ padding: '2px 7px', fontSize: '0.72rem' }}
                              onClick={() => openEditEvidence(item)}
                            >
                              ✏️ Edit
                            </button>
                            <button
                              type="button"
                              className="cyber-btn"
                              style={{ padding: '2px 7px', fontSize: '0.72rem', color: '#ef4444' }}
                              onClick={() => handleDeleteEvidence(item.id, item.title)}
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {/* Preview of Evidence Content */}
                        <div
                          style={{
                            background: 'rgba(2, 6, 12, 0.85)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            padding: '0.65rem 0.85rem',
                            fontSize: '0.8rem',
                            maxHeight: '220px',
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
                            <pre className="font-mono" style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#e2e8f0', fontSize: '0.78rem' }}>
                              {item.content}
                            </pre>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* EVIDENCE ARTIFACT EDITOR */}
          {activeTab === 'evidence' && isEditingEvidence && (
            <div
              style={{
                background: 'rgba(7, 14, 26, 0.95)',
                border: '1px solid #00f0ff',
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#00f0ff', letterSpacing: '0.04em' }}>
                  {eviEditId ? '✏️ EDIT EVIDENCE ARTIFACT' : '🛡️ CAPTURE NEW EVIDENCE ARTIFACT'}
                </span>
                <button
                  type="button"
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem' }}
                  onClick={() => setIsEditingEvidence(false)}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveEvidence} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="cyber-label">Evidence Title</label>
                    <input
                      type="text"
                      className="cyber-hud-input"
                      placeholder="e.g. Mimikatz sekurlsa dump on DC01"
                      value={eviEditTitle}
                      onChange={(e) => setEviEditTitle(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                      <label className="cyber-label">Category</label>
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', color: '#00f0ff', cursor: 'pointer', fontSize: '0.68rem', fontFamily: 'JetBrains Mono, monospace' }}
                        onClick={() => setShowAddCategory(!showAddCategory)}
                      >
                        {showAddCategory ? '✕ Cancel' : '+ New'}
                      </button>
                    </div>
                    {showAddCategory ? (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <input
                          type="text"
                          className="cyber-hud-input"
                          style={{ padding: '2px 4px', fontSize: '0.74rem' }}
                          placeholder="New category..."
                          value={newCatName}
                          onChange={(e) => setNewCatName(e.target.value)}
                        />
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-primary"
                          style={{ padding: '1px 6px', fontSize: '0.68rem' }}
                          onClick={handleAddCategory}
                        >
                          Add
                        </button>
                      </div>
                    ) : (
                      <select
                        className="cyber-hud-select"
                        value={eviEditCategory}
                        onChange={(e) => setEviEditCategory(e.target.value)}
                      >
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="cyber-label">Type</label>
                    <select
                      className="cyber-hud-select"
                      value={eviEditType}
                      onChange={(e) => setEviEditType(e.target.value as EvidenceType)}
                    >
                      <option value="text">Text (Markdown / Log)</option>
                      <option value="table">Structured Table</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="cyber-label">Target Host</label>
                    <select
                      className="cyber-hud-select"
                      value={eviEditHostId}
                      onChange={(e) => setEviEditHostId(e.target.value)}
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
                    <label className="cyber-label">Attach to Finding (Optional)</label>
                    <select
                      className="cyber-hud-select"
                      value={eviEditFindingId}
                      onChange={(e) => setEviEditFindingId(e.target.value)}
                    >
                      <option value="">-- No Linked Finding (Standalone Proof) --</option>
                      {findingsList.map((f) => (
                        <option key={f.id} value={f.id}>
                          🎯 [{f.severity.toUpperCase()}] {f.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {eviEditType === 'text' ? (
                  <div>
                    <label className="cyber-label">Evidence Excerpt / Terminal Output</label>
                    <textarea
                      className="cyber-hud-input font-mono"
                      style={{ minHeight: '140px', resize: 'vertical' }}
                      placeholder="Paste terminal output, hashdump, or exploit proof..."
                      value={eviEditTextContent}
                      onChange={(e) => setEviEditTextContent(e.target.value)}
                      required
                    />
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <label className="cyber-label">Structured Table Data</label>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button type="button" className="cyber-btn" style={{ padding: '1px 6px', fontSize: '0.68rem' }} onClick={handleAddTableRow}>
                          + Add Row
                        </button>
                        <button type="button" className="cyber-btn" style={{ padding: '1px 6px', fontSize: '0.68rem' }} onClick={handleAddTableCol}>
                          + Add Col
                        </button>
                      </div>
                    </div>
                    <div style={{ overflowX: 'auto', maxHeight: '180px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', fontFamily: 'JetBrains Mono, monospace' }}>
                        <thead>
                          <tr style={{ background: 'rgba(0, 240, 255, 0.08)' }}>
                            {tableHeaders.map((h, i) => (
                              <th key={i} style={{ padding: '4px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                  <input
                                    className="cyber-hud-input"
                                    style={{ padding: '2px 4px', fontSize: '0.74rem' }}
                                    value={h}
                                    onChange={(e) => handleHeaderChange(i, e.target.value)}
                                  />
                                  {tableHeaders.length > 1 && (
                                    <button
                                      type="button"
                                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0 2px' }}
                                      title="Delete column"
                                      onClick={() => handleDeleteTableCol(i)}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              </th>
                            ))}
                            <th style={{ width: '30px' }} />
                          </tr>
                        </thead>
                        <tbody>
                          {tableRows.map((row, ri) => (
                            <tr key={ri}>
                              {row.map((cell, ci) => (
                                <td key={ci} style={{ padding: '2px' }}>
                                  <input
                                    className="cyber-hud-input"
                                    style={{ padding: '2px 4px', fontSize: '0.74rem' }}
                                    value={cell}
                                    onChange={(e) => handleCellChange(ri, ci, e.target.value)}
                                  />
                                </td>
                              ))}
                              <td>
                                <button type="button" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }} onClick={() => handleDeleteTableRow(ri)}>
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* In-Report Toggle Checkbox */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                    padding: '0.5rem 0.75rem',
                    background: eviEditInReport ? 'rgba(0, 240, 255, 0.05)' : 'rgba(100, 116, 139, 0.1)',
                    border: eviEditInReport ? '1px solid rgba(0, 240, 255, 0.3)' : '1px solid rgba(100, 116, 139, 0.3)',
                  }}
                >
                  <input
                    type="checkbox"
                    id="evi-edit-in-report"
                    checked={eviEditInReport}
                    onChange={(e) => setEviEditInReport(e.target.checked)}
                    style={{ accentColor: '#00f0ff', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <label
                    htmlFor="evi-edit-in-report"
                    style={{
                      fontSize: '0.8rem',
                      color: eviEditInReport ? '#00f0ff' : '#94a3b8',
                      cursor: 'pointer',
                      fontFamily: 'JetBrains Mono, Consolas, monospace',
                      userSelect: 'none',
                    }}
                  >
                    {eviEditInReport
                      ? '📄 Include in Assessment Report (Reportable Finding Proof)'
                      : '🔒 Internal Vault Evidence Only (Excluded from Client Report)'}
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-secondary"
                    onClick={() => setIsEditingEvidence(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="cyber-btn cyber-btn-primary">
                    💾 Save Evidence Artifact
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ========================================================= */}
          {/* TAB 3: ASSESSMENT REPORT LIVE PREVIEW & EXPORT (F-30)     */}
          {/* ========================================================= */}
          {activeTab === 'report' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div>
                  <h4 style={{ margin: 0, color: '#00f0ff', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <CyberIcon name="file" size={16} />
                    Assessment Report Compiler &amp; Per-Host Exporter
                  </h4>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace', marginTop: '3px' }}>
                    {compiledReport
                      ? `${compiledReport.hostCount} host section(s) · ${compiledReport.findingsCount} finding(s) · ${compiledReport.evidenceCount} artifact(s)`
                      : `Compiles ${filteredFindings.length} finding(s) grouped deterministically per host.`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-ghost"
                    onClick={() => void compileReportPreview()}
                    disabled={reportLoading}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <CyberIcon name="bolt" size={13} />
                    {reportLoading ? 'Compiling...' : 'Recompile'}
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-primary"
                    onClick={() => void handleExportSingleReport()}
                    disabled={reportLoading}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <CyberIcon name="download" size={14} />
                    Export Report ({reportFormat === 'html' ? '.html' : '.md'})
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-ghost"
                    onClick={() => void handleBatchExportPerHost()}
                    disabled={reportLoading}
                    title="Writes one report file per target host plus manifest.sha256"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', borderColor: 'rgba(0, 240, 255, 0.4)', color: '#00f0ff' }}
                  >
                    <CyberIcon name="folder" size={14} />
                    Export 1 File Per Host
                  </button>
                </div>
              </div>

              {/* Compiler Options Strip */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                  padding: '0.6rem 0.8rem',
                  background: 'rgba(10, 18, 30, 0.75)',
                  border: '1px solid rgba(0, 240, 255, 0.22)',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '0.75rem',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#cbd5e1' }}>
                  <span>Host Scope:</span>
                  <select
                    aria-label="Report Host Scope"
                    value={reportHostScope}
                    onChange={(e) => setReportHostScope(e.target.value)}
                    style={{
                      background: 'rgba(2, 6, 12, 0.9)',
                      border: '1px solid rgba(0, 240, 255, 0.35)',
                      color: '#e2e8f0',
                      padding: '3px 8px',
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '0.75rem',
                    }}
                  >
                    <option value="all">All Hosts (Grouped Per Host)</option>
                    {hosts.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.label} ({h.address})
                      </option>
                    ))}
                  </select>
                </label>

                <div style={{ display: 'inline-flex', border: '1px solid rgba(0, 240, 255, 0.3)' }}>
                  <button
                    type="button"
                    onClick={() => setReportFormat('markdown')}
                    style={{
                      background: reportFormat === 'markdown' ? 'rgba(0, 240, 255, 0.18)' : 'transparent',
                      color: reportFormat === 'markdown' ? '#00f0ff' : '#94a3b8',
                      border: 'none',
                      padding: '4px 10px',
                      cursor: 'pointer',
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '0.73rem',
                      fontWeight: reportFormat === 'markdown' ? 700 : 400,
                    }}
                  >
                    Markdown (.md)
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportFormat('html')}
                    style={{
                      background: reportFormat === 'html' ? 'rgba(0, 240, 255, 0.18)' : 'transparent',
                      color: reportFormat === 'html' ? '#00f0ff' : '#94a3b8',
                      border: 'none',
                      borderLeft: '1px solid rgba(0, 240, 255, 0.3)',
                      padding: '4px 10px',
                      cursor: 'pointer',
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '0.73rem',
                      fontWeight: reportFormat === 'html' ? 700 : 400,
                    }}
                  >
                    HTML5 (.html)
                  </button>
                </div>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#cbd5e1', cursor: 'pointer' }}>
                  <input type="checkbox" checked={reportIncludePorts} onChange={(e) => setReportIncludePorts(e.target.checked)} />
                  <span>Open Ports</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#cbd5e1', cursor: 'pointer' }}>
                  <input type="checkbox" checked={reportIncludeUnlinked} onChange={(e) => setReportIncludeUnlinked(e.target.checked)} />
                  <span>Standalone Evidence</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#cbd5e1', cursor: 'pointer' }}>
                  <input type="checkbox" checked={reportIncludeNotes} onChange={(e) => setReportIncludeNotes(e.target.checked)} />
                  <span>Linked Notes</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#fbbf24', cursor: 'pointer' }}>
                  <input type="checkbox" checked={reportIncludeInternal} onChange={(e) => setReportIncludeInternal(e.target.checked)} />
                  <span>Include Internal-Only</span>
                </label>

                <div style={{ marginLeft: 'auto', display: 'inline-flex', border: '1px solid rgba(148, 163, 184, 0.3)' }}>
                  <button
                    type="button"
                    onClick={() => setReportPreviewView('rendered')}
                    style={{
                      background: reportPreviewView === 'rendered' ? 'rgba(56, 189, 248, 0.16)' : 'transparent',
                      color: reportPreviewView === 'rendered' ? '#38bdf8' : '#94a3b8',
                      border: 'none',
                      padding: '3px 8px',
                      cursor: 'pointer',
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '0.72rem',
                    }}
                  >
                    Rendered
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportPreviewView('source')}
                    style={{
                      background: reportPreviewView === 'source' ? 'rgba(56, 189, 248, 0.16)' : 'transparent',
                      color: reportPreviewView === 'source' ? '#38bdf8' : '#94a3b8',
                      border: 'none',
                      borderLeft: '1px solid rgba(148, 163, 184, 0.3)',
                      padding: '3px 8px',
                      cursor: 'pointer',
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '0.72rem',
                    }}
                  >
                    Source
                  </button>
                </div>
              </div>

              {/* Integrity Digest & Exclusion Banner */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                {(() => {
                  const excludedCount = compiledReport
                    ? compiledReport.internalExcluded
                    : (reportIncludeInternal ? 0 : evidenceList.filter((e) => e.inReport === false).length);
                  return (
                    <div
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        background: excludedCount > 0 ? 'rgba(56, 189, 248, 0.08)' : 'rgba(15, 23, 42, 0.5)',
                        border: '1px solid rgba(56, 189, 248, 0.3)',
                        padding: '0.45rem 0.75rem',
                        fontSize: '0.74rem',
                        color: '#38bdf8',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      <CyberIcon name="shield" size={14} />
                      <span>
                        {reportIncludeInternal
                          ? 'Internal-only evidence artifacts are included and explicitly tagged as [INTERNAL VAULT ONLY].'
                          : `${excludedCount} internal vault artifact(s) marked non-reportable are automatically excluded.`}
                      </span>
                    </div>
                  );
                })()}

                {compiledReport?.contentSha256 && (
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      background: 'rgba(16, 185, 129, 0.09)',
                      border: '1px solid rgba(16, 185, 129, 0.35)',
                      padding: '0.45rem 0.75rem',
                      fontSize: '0.72rem',
                      color: '#6ee7b7',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                    title={compiledReport.contentSha256}
                  >
                    <CyberIcon name="check" size={13} />
                    <span>SHA-256: {compiledReport.contentSha256.slice(0, 16)}...</span>
                    <button
                      type="button"
                      onClick={() => void handleCopyText(compiledReport.contentSha256, 'report-sha256')}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: copiedId === 'report-sha256' ? '#00f0ff' : '#a7f3d0',
                        cursor: 'pointer',
                        padding: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                      title="Copy full SHA-256 digest"
                    >
                      <CyberIcon name={copiedId === 'report-sha256' ? 'check' : 'copy'} size={12} />
                    </button>
                  </div>
                )}
              </div>

              {/* Per-Host Batch Export Manifest Summary */}
              {compiledReport?.writtenFiles && compiledReport.writtenFiles.length > 0 && (
                <div
                  style={{
                    background: 'rgba(16, 185, 129, 0.07)',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    padding: '0.6rem 0.85rem',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '0.73rem',
                    color: '#a7f3d0',
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <CyberIcon name="folder" size={13} />
                    <span>Written Per-Host Artifacts ({compiledReport.writtenFiles.length})</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '110px', overflowY: 'auto' }}>
                    {compiledReport.writtenFiles.map((wf) => (
                      <div key={wf.filePath} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                        <span>{wf.fileName}</span>
                        <span style={{ color: '#64748b' }}>{wf.sha256.slice(0, 16)}... ({wf.bytes} B)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Live Preview Canvas */}
              {compiledReport && reportFormat === 'html' && reportPreviewView === 'rendered' ? (
                <iframe
                  title="Assessment Report HTML Preview"
                  sandbox=""
                  srcDoc={compiledReport.content}
                  style={{
                    width: '100%',
                    height: '50vh',
                    border: '1px solid rgba(0, 240, 255, 0.3)',
                    background: '#0b0f17',
                  }}
                />
              ) : (
                <div
                  style={{
                    background: 'rgba(2, 6, 12, 0.95)',
                    border: '1px solid rgba(0, 240, 255, 0.3)',
                    padding: '1.1rem',
                    fontSize: '0.84rem',
                    color: '#cbd5e1',
                    maxHeight: '50vh',
                    overflowY: 'auto',
                  }}
                >
                  {compiledReport && reportPreviewView === 'source' ? (
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '0.76rem',
                        color: '#cbd5e1',
                      }}
                    >
                      {compiledReport.content}
                    </pre>
                  ) : compiledReport && reportFormat === 'markdown' ? (
                    <MarkdownRenderer content={compiledReport.content} />
                  ) : (
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem', color: '#94a3b8' }}>
                      {reportLoading ? 'Compiling deterministic report...' : 'Click Recompile to render preview.'}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
