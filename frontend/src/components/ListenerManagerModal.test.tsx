import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ListenerManagerModal } from './ListenerManagerModal';
import { ListenerProfile, ManagedListenerInfo } from '../types/listener';

describe('ListenerManagerModal (F-32)', () => {
  const mockProfiles: ListenerProfile[] = [
    {
      id: 'prof-https-443',
      name: 'Default Stealth HTTPS Catcher',
      kind: 'reverse',
      tool: 'builtin',
      bindAddress: '0.0.0.0',
      bindPort: 443,
      autoSpawnTab: true,
      notes: 'Bypasses strict egress filtering',
    },
    {
      id: 'prof-nc-4444',
      name: 'Netcat CTF Listener',
      kind: 'reverse',
      tool: 'nc',
      bindAddress: '0.0.0.0',
      bindPort: 4444,
      autoSpawnTab: false,
    },
  ];

  const mockActiveListeners: ManagedListenerInfo[] = [
    {
      id: 'listener-builtin-443-1',
      profileId: 'prof-https-443',
      name: 'Default Stealth HTTPS Catcher',
      kind: 'reverse',
      tool: 'builtin',
      bindAddress: '0.0.0.0',
      bindPort: 443,
      status: 'listening',
      catchCount: 0,
      activeSessions: [],
      commandPreview: 'DoubleAgent Native Go Listener [0.0.0.0:443]',
    },
  ];

  let listProfilesMock: ReturnType<typeof vi.fn>;
  let saveProfileMock: ReturnType<typeof vi.fn>;
  let deleteProfileMock: ReturnType<typeof vi.fn>;
  let startListenerMock: ReturnType<typeof vi.fn>;
  let stopListenerMock: ReturnType<typeof vi.fn>;
  let listActiveListenersMock: ReturnType<typeof vi.fn>;
  let generateCommandMock: ReturnType<typeof vi.fn>;
  let onCloseMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listProfilesMock = vi.fn().mockResolvedValue(mockProfiles);
    saveProfileMock = vi.fn().mockResolvedValue(undefined);
    deleteProfileMock = vi.fn().mockResolvedValue(undefined);
    startListenerMock = vi.fn().mockImplementation(async (prof: ListenerProfile): Promise<ManagedListenerInfo> => {
      return {
        id: `listener-${prof.tool}-${prof.bindPort}`,
        profileId: prof.id,
        name: prof.name,
        kind: prof.kind,
        tool: prof.tool,
        bindAddress: prof.bindAddress,
        bindPort: prof.bindPort,
        status: 'listening',
        catchCount: 0,
        activeSessions: [],
      };
    });
    stopListenerMock = vi.fn().mockResolvedValue(undefined);
    listActiveListenersMock = vi.fn().mockResolvedValue(mockActiveListeners);
    generateCommandMock = vi.fn().mockResolvedValue('nc -lvnp 4444');
    onCloseMock = vi.fn();
  });

  it('renders modal header, active listeners count, and active listeners list', async () => {
    render(
      <ListenerManagerModal
        isOpen={true}
        onClose={onCloseMock}
        listProfiles={listProfilesMock}
        saveProfile={saveProfileMock}
        deleteProfile={deleteProfileMock}
        startListener={startListenerMock}
        stopListener={stopListenerMock}
        listActiveListeners={listActiveListenersMock}
        generateCommand={generateCommandMock}
      />
    );

    expect(screen.getByText(/LISTENER MANAGER \/\/ REVERSE & BIND CATCHERS/i)).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText('Default Stealth HTTPS Catcher')).toBeDefined();
      expect(screen.getByText(/PORT: 443/i)).toBeDefined();
      expect(screen.getByText('Stop Listener')).toBeDefined();
    });
  });

  it('allows stopping an active listener', async () => {
    render(
      <ListenerManagerModal
        isOpen={true}
        onClose={onCloseMock}
        listProfiles={listProfilesMock}
        saveProfile={saveProfileMock}
        deleteProfile={deleteProfileMock}
        startListener={startListenerMock}
        stopListener={stopListenerMock}
        listActiveListeners={listActiveListenersMock}
        generateCommand={generateCommandMock}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Stop Listener')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Stop Listener'));

    await waitFor(() => {
      expect(stopListenerMock).toHaveBeenCalledWith('listener-builtin-443-1');
      expect(screen.getByText(/Stopped listener/i)).toBeDefined();
    });
  });

  it('switches to saved profiles tab and displays profiles', async () => {
    render(
      <ListenerManagerModal
        isOpen={true}
        onClose={onCloseMock}
        listProfiles={listProfilesMock}
        saveProfile={saveProfileMock}
        deleteProfile={deleteProfileMock}
        startListener={startListenerMock}
        stopListener={stopListenerMock}
        listActiveListeners={listActiveListenersMock}
        generateCommand={generateCommandMock}
      />
    );

    const profilesTab = screen.getByText('SAVED PROFILES');
    fireEvent.click(profilesTab);

    await waitFor(() => {
      expect(screen.getByText('Netcat CTF Listener')).toBeDefined();
      expect(screen.getByText('PORT 4444')).toBeDefined();
    });
  });

  it('switches to launch tab and displays OPSEC warning when port 4444 is selected', async () => {
    render(
      <ListenerManagerModal
        isOpen={true}
        onClose={onCloseMock}
        listProfiles={listProfilesMock}
        saveProfile={saveProfileMock}
        deleteProfile={deleteProfileMock}
        startListener={startListenerMock}
        stopListener={stopListenerMock}
        listActiveListeners={listActiveListenersMock}
        generateCommand={generateCommandMock}
      />
    );

    const launchTab = screen.getByText(/LAUNCH \/ NEW LISTENER/i);
    fireEvent.click(launchTab);

    await waitFor(() => {
      expect(screen.getByText('LAUNCH LISTENER // OPERATIONAL CONFIGURATION')).toBeDefined();
    });

    // Click 4444 preset button
    const port4444Btn = screen.getByTitle(/Metasploit default/i);
    fireEvent.click(port4444Btn);

    await waitFor(() => {
      expect(screen.getByText('OPSEC ADVISORY')).toBeDefined();
      expect(screen.getByText(/heavily monitored Metasploit\/CTF default/i)).toBeDefined();
    });
  });

  it('starts a new listener from form', async () => {
    render(
      <ListenerManagerModal
        isOpen={true}
        onClose={onCloseMock}
        listProfiles={listProfilesMock}
        saveProfile={saveProfileMock}
        deleteProfile={deleteProfileMock}
        startListener={startListenerMock}
        stopListener={stopListenerMock}
        listActiveListeners={listActiveListenersMock}
        generateCommand={generateCommandMock}
      />
    );

    const launchTab = screen.getByText(/LAUNCH \/ NEW LISTENER/i);
    fireEvent.click(launchTab);

    await waitFor(() => {
      expect(screen.getByText('Start Listener Now')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Start Listener Now'));

    await waitFor(() => {
      expect(startListenerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          bindPort: 443,
          tool: 'builtin',
          kind: 'reverse',
        })
      );
    });
  });
});

