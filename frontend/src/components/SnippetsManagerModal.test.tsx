import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SnippetsManagerModal } from './SnippetsManagerModal';

describe('SnippetsManagerModal — External command_snippets.json Store', () => {
  afterEach(() => {
    cleanup();
  });

  it('displays external command_snippets.json store controls, reloads, browses file, and saves custom snippet', async () => {
    const getCfgMock = vi.fn(async () => ({
      filePath: 'C:/Sync/command_snippets.json',
      snippetCount: 1,
      exists: true,
    }));
    const setPathMock = vi.fn(async (p: string) => ({
      filePath: p,
      snippetCount: 1,
      exists: true,
    }));
    const reloadMock = vi.fn(async () => []);
    const selectFileMock = vi.fn(async () => 'D:/Shared/command_snippets.json');
    const saveMock = vi.fn(async () => {});

    render(
      <SnippetsManagerModal
        snippets={[
          {
            id: 'snip-1',
            name: 'Check Sockets',
            body: 'ss -tulpn',
            tags: ['linux'],
            confirmBeforeRun: true,
          },
        ]}
        onSaveSnippet={saveMock}
        onDeleteSnippet={vi.fn(async () => {})}
        onRunSnippet={vi.fn()}
        onClose={vi.fn()}
        getFileConfig={getCfgMock}
        setFilePath={setPathMock}
        onReloadFromFile={reloadMock}
        onSelectFile={selectFileMock}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('C:/Sync/command_snippets.json')).toBeInTheDocument();
      expect(screen.getByText('Check Sockets')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Reload File/i }));
    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: /Browse File/i }));
    await waitFor(() => {
      expect(selectFileMock).toHaveBeenCalled();
      expect(setPathMock).toHaveBeenCalledWith('D:/Shared/command_snippets.json');
    });

    fireEvent.click(screen.getByRole('button', { name: /^New Snippet$/i }));
    fireEvent.change(screen.getByLabelText(/Snippet Name/i), { target: { value: 'List Users' } });
    fireEvent.change(screen.getByLabelText(/Command Body/i), { target: { value: 'cat /etc/passwd' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Snippet/i }));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'List Users', body: 'cat /etc/passwd' }));
    });
  });
});
