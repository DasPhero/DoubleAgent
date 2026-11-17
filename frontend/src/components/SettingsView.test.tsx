import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SettingsView } from './SettingsView';
import { DEFAULT_SETTINGS } from './TerminalView';

describe('SettingsView — Files & Templates Manager', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as { go?: unknown }).go;
  });

  it('lists managed external files, initializes/resets defaults, browses paths, reveals in explorer, and opens tools', async () => {
    const listMock = vi.fn(async () => [
      {
        id: 'vault',
        name: 'Encrypted Vault Store',
        kind: 'vault',
        description: 'Encrypted vault container.',
        featureLabel: 'Core Vault & Security',
        filePath: 'C:/Users/Test/doubleagent.vault',
        defaultName: 'doubleagent.vault',
        exists: true,
        itemCount: 3,
        sizeBytes: 4096,
      },
      {
        id: 'report_templates',
        name: 'Report Narrative Templates',
        kind: 'json',
        description: 'Report scaffolds for .docx / .html / .md exports.',
        featureLabel: 'Evidence Vault -> Assessment Report',
        filePath: 'C:/Users/Test/report_templates.json',
        defaultName: 'report_templates.json',
        exists: false,
        itemCount: 0,
        sizeBytes: 0,
      },
    ]);
    const resetMock = vi.fn(async () => ({
      id: 'report_templates',
      name: 'Report Narrative Templates',
      kind: 'json',
      description: 'Report scaffolds.',
      featureLabel: 'Evidence Vault -> Assessment Report',
      filePath: 'C:/Users/Test/report_templates.json',
      defaultName: 'report_templates.json',
      exists: true,
      itemCount: 4,
      sizeBytes: 2048,
    }));
    const selectFileMock = vi.fn(async () => 'D:/Sync/report_templates.json');
    const setPathMock = vi.fn(async (_id: string, p: string) => ({
      id: 'report_templates',
      name: 'Report Narrative Templates',
      kind: 'json',
      description: 'Report scaffolds.',
      featureLabel: 'Evidence Vault -> Assessment Report',
      filePath: p,
      defaultName: 'report_templates.json',
      exists: true,
      itemCount: 4,
      sizeBytes: 2048,
    }));
    const revealMock = vi.fn(async () => {});
    const resetPathMock = vi.fn(async () => ({
      id: 'report_templates',
      name: 'Report Narrative Templates',
      kind: 'json',
      description: 'Report scaffolds.',
      featureLabel: 'Evidence Vault -> Assessment Report',
      filePath: 'C:/Users/Test/templates/report_templates.json',
      defaultName: 'report_templates.json',
      exists: true,
      itemCount: 4,
      sizeBytes: 2048,
    }));
    const openToolMock = vi.fn();

    (window as unknown as { go: unknown }).go = {
      main: {
        App: {
          ListManagedFiles: listMock,
          ResetManagedFileDefaults: resetMock,
          ResetManagedFilePath: resetPathMock,
          SelectFileDialog: selectFileMock,
          SetManagedFilePath: setPathMock,
          RevealPathInExplorer: revealMock,
        },
      },
    };

    render(
      <SettingsView
        activeTab="files"
        onTabChange={vi.fn()}
        globalSettings={DEFAULT_SETTINGS}
        onUpdateSettings={vi.fn()}
        onResetSettings={vi.fn()}
        vaultLocked={false}
        passwordless={true}
        helloPending={false}
        quickUnlockReady={false}
        modalError=""
        onEnableQuickUnlock={vi.fn(async () => {})}
        onChangePassword={vi.fn(async () => {})}
        onResetVault={vi.fn(async () => {})}
        onOpenToolForManagedFile={openToolMock}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Encrypted Vault Store')).toBeInTheDocument();
      expect(screen.getByText('Report Narrative Templates')).toBeInTheDocument();
      expect(screen.getByText('C:/Users/Test/report_templates.json')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Initialize Defaults/i }));
    await waitFor(() => {
      expect(resetMock).toHaveBeenCalledWith('report_templates');
    });

    fireEvent.click(screen.getByRole('button', { name: /Browse File/i }));
    await waitFor(() => {
      expect(selectFileMock).toHaveBeenCalled();
      expect(setPathMock).toHaveBeenCalledWith('report_templates', 'D:/Sync/report_templates.json');
    });

    fireEvent.click(screen.getAllByRole('button', { name: /Reveal in Explorer/i })[1]);
    await waitFor(() => {
      expect(revealMock).toHaveBeenCalledWith('C:/Users/Test/report_templates.json');
    });

    fireEvent.click(screen.getByRole('button', { name: /Reset Path/i }));
    await waitFor(() => {
      expect(resetPathMock).toHaveBeenCalledWith('report_templates');
    });

    fireEvent.click(screen.getByRole('button', { name: /Open Tool/i }));
    expect(openToolMock).toHaveBeenCalledWith('report_templates');
  });

  it('resets all keyboard shortcuts and leader key settings via two-step inline confirmation', () => {
    const updateMock = vi.fn();
    render(
      <SettingsView
        activeTab="shortcuts"
        onTabChange={vi.fn()}
        globalSettings={{
          ...DEFAULT_SETTINGS,
          keybindings: { command_palette: 'Ctrl+Shift+P' },
          leaderKeyEnabled: true,
          leaderKey: 'Ctrl+A',
        }}
        onUpdateSettings={updateMock}
        onResetSettings={vi.fn()}
        vaultLocked={false}
        passwordless={true}
        helloPending={false}
        quickUnlockReady={false}
        modalError=""
        onEnableQuickUnlock={vi.fn(async () => {})}
        onChangePassword={vi.fn(async () => {})}
        onResetVault={vi.fn(async () => {})}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Reset All to Defaults/i }));
    expect(updateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Confirm Reset All\?/i }));
    expect(updateMock).toHaveBeenCalledWith({
      keybindings: {},
      customShortcuts: [],
      leaderKeyEnabled: false,
      leaderKey: 'Ctrl+B',
      leaderTimeoutMs: 2000,
    });
    expect(screen.getByText(/All keyboard shortcuts and leader key settings restored to defaults/i)).toBeInTheDocument();
  });
});
