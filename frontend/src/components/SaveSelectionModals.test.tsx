import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  parseCredentialSelection,
  SaveSelectionCredModal,
  SaveSelectionEvidenceModal,
  SaveSelectionNoteModal,
  SaveSelectionFindingModal,
} from './SaveSelectionModals';
import { TerminalContextMenu } from './TerminalContextMenu';
import { CredentialEntry, EvidenceItem, FindingItem } from '../types/pentest';
import { NotePage } from '../types/note';

describe('F-19 Terminal Selection & Quick Save to Vault', () => {
  describe('parseCredentialSelection heuristics', () => {
    it('parses user:pass correctly into username, secret, and plaintext category', () => {
      const res = parseCredentialSelection('admin:SuperSecret2026!');
      expect(res.username).toBe('admin');
      expect(res.secret).toBe('SuperSecret2026!');
      expect(res.category).toBe('plaintext');
      expect(res.labelSuggestion).toBe('admin Account');
    });

    it('detects NTLM/MD5 32-hex hashes in user:pass', () => {
      const res = parseCredentialSelection('Administrator:5f4dcc3b5aa765d61d8327deb882cf99');
      expect(res.username).toBe('Administrator');
      expect(res.secret).toBe('5f4dcc3b5aa765d61d8327deb882cf99');
      expect(res.category).toBe('hash');
    });

    it('detects SSH keys', () => {
      const res = parseCredentialSelection('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGu989 user@box');
      expect(res.category).toBe('ssh_key');
      expect(res.secret).toContain('ssh-ed25519');
    });

    it('detects API tokens (GitHub / JWT)', () => {
      const res = parseCredentialSelection('ghp_abcdefghijklmnopqrstuvwxyz123456');
      expect(res.category).toBe('api_key');
      expect(res.secret).toBe('ghp_abcdefghijklmnopqrstuvwxyz123456');
    });

    it('defaults bare strings to plaintext', () => {
      const res = parseCredentialSelection('just_a_password_123');
      expect(res.username).toBe('');
      expect(res.secret).toBe('just_a_password_123');
      expect(res.category).toBe('plaintext');
    });
  });

  describe('TerminalContextMenu', () => {
    it('renders menu options, handles copy, save as credential, save as evidence, and dismiss', () => {
      const onCopy = vi.fn();
      const onSaveAsCred = vi.fn();
      const onSaveAsEv = vi.fn();
      const onClose = vi.fn();

      render(
        <TerminalContextMenu
          x={100}
          y={150}
          sessionId="sess-1"
          selectedText="root:toor"
          hostLabel="Web-Gateway (10.0.0.1)"
          onCopy={onCopy}
          onSaveAsCredential={onSaveAsCred}
          onSaveAsEvidence={onSaveAsEv}
          onClose={onClose}
        />
      );

      // Verify menu elements
      expect(screen.getByRole('menu', { name: /Terminal Selection Context Menu/i })).toBeInTheDocument();
      expect(screen.getByText(/TERMINAL CONTEXT \(F-19\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Web-Gateway/i)).toBeInTheDocument();

      // Test Copy
      fireEvent.click(screen.getByRole('menuitem', { name: /Copy Selection/i }));
      expect(onCopy).toHaveBeenCalledTimes(1);

      // Test Save as Credential
      fireEvent.click(screen.getByRole('menuitem', { name: /Save as Credential/i }));
      expect(onSaveAsCred).toHaveBeenCalledTimes(1);

      // Test Save as Evidence
      fireEvent.click(screen.getByRole('menuitem', { name: /Save as Evidence/i }));
      expect(onSaveAsEv).toHaveBeenCalledTimes(1);

      // Test Dismiss
      fireEvent.click(screen.getByRole('menuitem', { name: /Dismiss/i }));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('SaveSelectionCredModal', () => {
    it('pre-populates selection data and host ID, and saves to vault', async () => {
      let savedResult: CredentialEntry | undefined;
      const onSave = vi.fn().mockImplementation(async (c: CredentialEntry) => {
        savedResult = c;
      });
      const onClose = vi.fn();

      render(
        <SaveSelectionCredModal
          isOpen={true}
          selectedText="admin:SecretPass123!"
          initialHostId="host-target-1"
          hosts={[{ id: 'host-target-1', label: 'Production Server', address: '192.168.1.50' }]}
          initialEngagementId="eng-test-1"
          engagements={[{ id: 'eng-test-1', name: 'Internal Red Team' }]}
          onSave={onSave}
          onClose={onClose}
        />
      );

      // Verify dialog is open with auto-populated fields
      expect(screen.getByRole('dialog', { name: /Save Terminal Selection as Credential/i })).toBeInTheDocument();
      expect(screen.getByDisplayValue('admin')).toBeInTheDocument();
      expect(screen.getByDisplayValue('SecretPass123!')).toBeInTheDocument();

      // Verify associated host & engagement are preselected
      const hostSelect = screen.getByLabelText(/Associated Host \(F-19\)/i) as HTMLSelectElement;
      expect(hostSelect.value).toBe('host-target-1');

      const engSelect = screen.getByLabelText(/Pentest Engagement/i) as HTMLSelectElement;
      expect(engSelect.value).toBe('eng-test-1');

      // Submit form
      fireEvent.click(screen.getByRole('button', { name: /Save to Vault/i }));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalled();
      });

      expect(savedResult).toBeDefined();
      const r = savedResult as unknown as CredentialEntry;
      expect(r.username).toBe('admin');
      expect(r.secret).toBe('SecretPass123!');
      expect(r.hostId).toBe('host-target-1');
      expect(r.engagementId).toBe('eng-test-1');
      expect(r.source).toBe('terminal_selection');
    });
  });

  describe('SaveSelectionEvidenceModal', () => {
    it('pre-populates terminal output proof, host, and saves evidence with inReport toggle', async () => {
      let savedResult: EvidenceItem | undefined;
      const onSave = vi.fn().mockImplementation(async (e: EvidenceItem) => {
        savedResult = e;
      });
      const onClose = vi.fn();

      render(
        <SaveSelectionEvidenceModal
          isOpen={true}
          selectedText="uid=0(root) gid=0(root) groups=0(root)"
          initialHostId="host-target-1"
          hosts={[{ id: 'host-target-1', label: 'Production Server', address: '192.168.1.50' }]}
          initialEngagementId="eng-test-1"
          engagements={[{ id: 'eng-test-1', name: 'Internal Red Team' }]}
          findings={[
            {
              id: 'find-100',
              engagementId: 'eng-test-1',
              title: 'Root Privilege Escalation',
              category: 'Privilege Escalation',
              severity: 'critical',
              status: 'draft',
              description: 'Vulnerable sudo config allows privilege escalation',
              createdAt: '2026-11-10T12:00:00Z',
              updatedAt: '2026-11-10T12:00:00Z',
            },
          ]}
          onSave={onSave}
          onClose={onClose}
        />
      );

      expect(screen.getByRole('dialog', { name: /Save Terminal Selection as Evidence Finding/i })).toBeInTheDocument();
      expect(screen.getByDisplayValue('uid=0(root) gid=0(root) groups=0(root)')).toBeInTheDocument();

      const hostSelect = screen.getByLabelText(/Associated Target Host \(F-19\)/i) as HTMLSelectElement;
      expect(hostSelect.value).toBe('host-target-1');

      // Check inReport checkbox defaults to checked
      const reportCheckbox = screen.getByLabelText(/Include in Assessment Report/i) as HTMLInputElement;
      expect(reportCheckbox).toBeChecked();

      // Attach to finding
      const findingSelect = screen.getByLabelText(/Attach to Finding \(Optional\)/i) as HTMLSelectElement;
      fireEvent.change(findingSelect, { target: { value: 'find-100' } });

      // Save finding proof
      fireEvent.click(screen.getByRole('button', { name: /Save to Evidence Vault/i }));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalled();
      });

      expect(savedResult).toBeDefined();
      const ev = savedResult as unknown as EvidenceItem;
      expect(ev.content).toBe('uid=0(root) gid=0(root) groups=0(root)');
      expect(ev.hostId).toBe('host-target-1');
      expect(ev.engagementId).toBe('eng-test-1');
      expect(ev.findingId).toBe('find-100');
      expect(ev.inReport).toBe(true);
      expect(ev.source).toBe('terminal_selection');
    });
  });

  describe('SaveSelectionNoteModal', () => {
    it('saves terminal output as recon note linked to host and engagement', async () => {
      let savedNote: NotePage | undefined;
      const onSave = vi.fn().mockImplementation(async (n: NotePage) => {
        savedNote = n;
      });
      const onClose = vi.fn();

      render(
        <SaveSelectionNoteModal
          isOpen={true}
          selectedText="PORT STATE SERVICE\n22/tcp open ssh\n80/tcp open http"
          initialHostId="host-target-1"
          hosts={[{ id: 'host-target-1', label: 'Production Server', address: '192.168.1.50' }]}
          initialEngagementId="eng-test-1"
          engagements={[{ id: 'eng-test-1', name: 'Internal Red Team' }]}
          onSave={onSave}
          onClose={onClose}
        />
      );

      expect(screen.getByRole('dialog', { name: /Save Terminal Selection to Host Notes/i })).toBeInTheDocument();
      expect(screen.getByDisplayValue(/PORT STATE SERVICE/i)).toBeInTheDocument();

      // Submit note
      fireEvent.click(screen.getByRole('button', { name: /Save to Notes/i }));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalled();
      });

      expect(savedNote).toBeDefined();
      expect(savedNote?.hostId).toBe('host-target-1');
      expect(savedNote?.engagementId).toBe('eng-test-1');
      expect(savedNote?.body).toContain('22/tcp open ssh');
      expect(savedNote?.type).toBe('markdown');
    });
  });

  describe('SaveSelectionFindingModal', () => {
    it('creates a finding and links terminal output as initial evidence', async () => {
      let savedFinding: FindingItem | undefined;
      let savedEvidence: EvidenceItem | undefined;
      const onSave = vi.fn().mockImplementation(async (f: FindingItem, e: EvidenceItem) => {
        savedFinding = f;
        savedEvidence = e;
      });
      const onClose = vi.fn();

      render(
        <SaveSelectionFindingModal
          isOpen={true}
          selectedText="Vulnerable sudo configuration: ALL=(ALL) NOPASSWD: /usr/bin/find"
          initialHostId="host-target-1"
          hosts={[{ id: 'host-target-1', label: 'Production Server', address: '192.168.1.50' }]}
          initialEngagementId="eng-test-1"
          engagements={[{ id: 'eng-test-1', name: 'Internal Red Team' }]}
          onSave={onSave}
          onClose={onClose}
        />
      );

      expect(screen.getByRole('dialog', { name: /Create Finding from Terminal Selection/i })).toBeInTheDocument();

      // Check severity select
      const severitySelect = screen.getByLabelText(/Severity Rating/i) as HTMLSelectElement;
      fireEvent.change(severitySelect, { target: { value: 'critical' } });

      // Submit finding
      fireEvent.click(screen.getByRole('button', { name: /Create Finding/i }));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalled();
      });

      expect(savedFinding).toBeDefined();
      expect(savedEvidence).toBeDefined();
      expect(savedFinding?.severity).toBe('critical');
      expect(savedFinding?.hostId).toBe('host-target-1');
      expect(savedFinding?.engagementId).toBe('eng-test-1');
      expect(savedFinding?.evidenceIds).toContain(savedEvidence?.id);
      expect(savedEvidence?.findingId).toBe(savedFinding?.id);
      expect(savedEvidence?.inReport).toBe(true);
      expect(savedEvidence?.content).toContain('NOPASSWD: /usr/bin/find');
    });
  });
});
