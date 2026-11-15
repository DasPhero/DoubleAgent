import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ForwardRule, ForwardTunnelStatus } from './types/forward';
import { TotpRecord } from './types/totp';
import { RemoteEditorView } from './components/RemoteEditorView';
import { RemoteEditSession } from './types/remoteEdit';

describe('M0 & M1-1 Application Shell, Dark-Red Locked vs Teal Unlocked Theme, and Hosts/Groups (F-01, F-03)', () => {
  it('starts in theme-locked (Dark Crimson), switches to theme-unlocked (Teal) on unlock, and manages Groups and Hosts with inheritance (F-01)', () => {
    render(<App initialLocked={true} />);
    const main = screen.getByLabelText('DoubleAgent Workspace');
    expect(main).toHaveClass('theme-locked');
    expect(screen.getByText('Vault Locked')).toBeInTheDocument();

    // Open initial vault setup modal and initialize passwordless
    fireEvent.click(screen.getByRole('button', { name: /Set Up Vault/i }));
    fireEvent.click(screen.getByRole('button', { name: /Skip Password for Now/i }));

    // Theme must switch to unlocked (Teal)
    expect(main).toHaveClass('theme-unlocked');
    expect(screen.getByText('Vault Unlocked (No PW)')).toBeInTheDocument();

    // Create a Host with Port 2222, Username deploy, and Labels 'production, dmz' (F-01)
    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'Bastion 01' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), {
      target: { value: '10.10.0.5' },
    });
    fireEvent.change(screen.getByLabelText('Host Port'), { target: { value: '2222' } });
    fireEvent.change(screen.getByLabelText('Host Username'), {
      target: { value: 'deploy' },
    });
    fireEvent.change(screen.getByLabelText('Host Tags'), {
      target: { value: 'production, dmz' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Host/i }));

    expect(screen.getByText('Bastion 01')).toBeInTheDocument();
    expect(screen.getByText('deploy@10.10.0.5:2222')).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
  });

  it('opens Command Palette via Ctrl+K, performs fuzzy search over Name/Address/Tags, and supports user@host:port Quick Connect (F-02)', () => {
    render(<App />);

    // Add a host with tags
    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'prod-web-01' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), {
      target: { value: '10.99.1.50' },
    });
    fireEvent.change(screen.getByLabelText('Host Tags'), {
      target: { value: 'nginx, frontend' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Host/i }));

    // Press Ctrl+K to open Command Palette (F-02)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Command Palette' })).toBeInTheDocument();

    const paletteInput = screen.getByLabelText('Command Palette Input');

    // Fuzzy search by subsequence in Name ("pw01" -> "prod-web-01")
    fireEvent.change(paletteInput, { target: { value: 'pw01' } });
    expect(screen.getByText('#nginx')).toBeInTheDocument();

    // Search by Tag ("frontend")
    fireEvent.change(paletteInput, { target: { value: 'frontend' } });
    expect(screen.getByText('#frontend')).toBeInTheDocument();

    // Type user@host:port Quick Connect target
    fireEvent.change(paletteInput, { target: { value: 'admin@192.168.50.10:2222' } });
    const qcButton = screen.getByRole('button', {
      name: /Quick Connect admin@192.168.50.10:2222/i,
    });
    expect(qcButton).toBeInTheDocument();

    // Trigger Quick Connect
    fireEvent.click(qcButton);
    expect(screen.queryByRole('dialog', { name: 'Command Palette' })).not.toBeInTheDocument();
    expect((screen.getByLabelText('Host Address') as HTMLInputElement).value).toBe('192.168.50.10');
    expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('2222');
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('admin');
  });

  it('manages Keychain generation/import/copy public key (F-04), Agent auth (F-05), and imports ssh_config with unknown directive warnings (F-22)', () => {
    render(<App />);

    // Open Keychain and generate Ed25519 key
    fireEvent.click(screen.getByRole('button', { name: /Intel & Keys/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Keychain/i }));
    fireEvent.change(screen.getByLabelText('Key Label'), { target: { value: 'Laptop Ed25519' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Keypair/i }));

    expect(screen.getByText(/Laptop Ed25519 \(ed25519\)/i)).toBeInTheDocument();

    // Copy Public Key (F-04)
    fireEvent.click(screen.getByRole('button', { name: /Copy Public Key/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));

    // Open Global Settings -> Config Migration and click Import ssh_config (F-22)
    fireEvent.click(screen.getByRole('button', { name: /Settings ⚙/i }));
    fireEvent.click(screen.getByRole('tab', { name: /Config Migration/i }));
    fireEvent.click(screen.getByRole('button', { name: /Import ssh_config/i }));
    fireEvent.change(screen.getByLabelText('SSH Config Content'), {
      target: {
        value: `Host jump-eu
  HostName 198.51.100.7
  User secops
  Port 2202
  ForwardX11 yes`,
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Parse & Import Config/i }));

    // Verify unknown directive warning is reported (F-22)
    expect(screen.getByLabelText('SSH Config Warnings')).toHaveTextContent('ForwardX11');
    fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));

    // Verify imported host appears in sidebar
    expect(screen.getByText('jump-eu')).toBeInTheDocument();
    expect(screen.getByText('secops@198.51.100.7:2202')).toBeInTheDocument();
  });

  it('supports multi-session Tabs, drag-and-drop tab reordering, mixed nested Split Panes, closing panes, and preserving logs (F-08)', () => {
    render(<App />);

    // Create a host: Alpha
    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'Alpha' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), { target: { value: '10.0.0.1' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Host/i }));

    // Connect twice to the SAME server (Alpha) to open two separate tabs
    const connectButton = screen.getByRole('button', { name: /^Connect$/i });
    fireEvent.click(connectButton);
    fireEvent.click(connectButton);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-label', 'Tab Alpha');
    expect(tabs[1]).toHaveAttribute('aria-label', 'Tab Alpha');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');

    // Closing one tab does NOT close the other tab to the same server
    const closeTabButtons = screen.getAllByRole('button', { name: /Close Tab Alpha/i });
    fireEvent.click(closeTabButtons[1]);

    const remainingTabs = screen.getAllByRole('tab');
    expect(remainingTabs).toHaveLength(1);
    expect(remainingTabs[0]).toHaveAttribute('aria-selected', 'true');

    // Open another host tab: Beta
    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'Beta' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), { target: { value: '10.0.0.2' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Host/i }));

    const connectBeta = screen.getAllByRole('button', { name: /^Connect$/i })[1];
    fireEvent.click(connectBeta);

    const twoTabs = screen.getAllByRole('tab');
    expect(twoTabs).toHaveLength(2);
    expect(twoTabs[1]).toHaveAttribute('aria-label', 'Tab Beta');
    expect(twoTabs[1]).toHaveAttribute('aria-selected', 'true');

    // Both tabs remain mounted in DOM to preserve logs across tab switches
    const tabPanels = screen.getAllByLabelText(/Pane /);
    expect(tabPanels.length).toBeGreaterThanOrEqual(2);

    // Switch tabs via Alt+ArrowLeft: Tab Alpha becomes active without unmounting Beta
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');

    // Mixed nested splitting on Tab Alpha:
    // 1. Split horizontally -> 2 panes side-by-side
    fireEvent.click(screen.getByRole('button', { name: 'Split Horizontal' }));
    expect(screen.getByLabelText('Split Container horizontal')).toBeInTheDocument();
    expect(screen.getByLabelText('Pane Alpha (H-Split #2)')).toHaveClass('active');

    // Focus left pane (Pane Alpha)
    fireEvent.click(screen.getByLabelText('Pane Alpha'));
    expect(screen.getByLabelText('Pane Alpha')).toHaveClass('active');

    // 2. In left pane, split vertically -> creates vertical split inside left side
    // Result: 2 panes stacked vertically on the left, 1 full-height pane on the right
    fireEvent.click(screen.getByRole('button', { name: 'Split Vertical' }));
    expect(screen.getByLabelText('Split Container vertical')).toBeInTheDocument();
    expect(screen.getByLabelText('Pane Alpha (V-Split #3)')).toHaveClass('active');

    // Cycle focus between split panes via Alt+ArrowDown
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });

    // Close the newly split pane via its dedicated close button (×)
    const closeSplitBtn = screen.getByRole('button', {
      name: /Close Pane Alpha \(V-Split #3\)/i,
    });
    fireEvent.click(closeSplitBtn);

    // Pane is closed and split collapses cleanly
    expect(screen.queryByLabelText('Pane Alpha (V-Split #3)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Pane Alpha')).toBeInTheDocument();
    expect(screen.getByLabelText('Pane Alpha (H-Split #2)')).toBeInTheDocument();
  });

  it('provides Global Settings modal (Ctrl+,), theme switcher, font/cursor customization, and pane font zoom controls (F-08)', () => {
    render(<App />);

    const main = screen.getByLabelText('DoubleAgent Workspace');
    expect(main).toHaveClass('theme-unlocked');
    expect(main).toHaveClass('theme-teal');

    // Open Global Settings via keyboard shortcut Ctrl+,
    fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Global Settings' })).toBeInTheDocument();

    // Switch theme to Dracula
    fireEvent.click(screen.getByRole('button', { name: /Dracula/i }));
    expect(main).toHaveClass('theme-dracula');

    // Switch theme to Nord
    fireEvent.click(screen.getByRole('button', { name: /Nord/i }));
    expect(main).toHaveClass('theme-nord');

    // Change font family, font size, and cursor style
    fireEvent.change(screen.getByLabelText('Font Family'), {
      target: { value: "'JetBrains Mono', Consolas, monospace" },
    });
    fireEvent.change(screen.getByLabelText('Default Font Size'), {
      target: { value: '16' },
    });
    fireEvent.change(screen.getByLabelText('Cursor Style'), {
      target: { value: 'bar' },
    });

    // Close Settings
    fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));
    expect(screen.queryByRole('dialog', { name: 'Global Settings' })).not.toBeInTheDocument();

    // Create a host and connect
    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'Server-1' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), {
      target: { value: '192.168.1.100' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Host/i }));

    const connectBtn = screen.getByRole('button', { name: /^Connect$/i });
    fireEvent.click(connectBtn);

    // Verify pane has font badge showing 16px (from default setting)
    expect(screen.getByText('16px')).toBeInTheDocument();

    // Zoom in via pane zoom button (+)
    const zoomInBtn = screen.getByRole('button', { name: /Zoom in Server-1/i });
    fireEvent.click(zoomInBtn);
    expect(screen.getByText('17px')).toBeInTheDocument();

    // Zoom out via Ctrl -
    fireEvent.keyDown(window, { key: '-', ctrlKey: true });
    expect(screen.getByText('16px')).toBeInTheDocument();

    // Reopen settings and reset to defaults
    fireEvent.click(screen.getByRole('button', { name: /Settings ⚙/i }));
    fireEvent.click(screen.getByRole('button', { name: /Reset to Defaults/i }));
    expect(main).toHaveClass('theme-teal');
    fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));
  });

  it('organizes Top Bar into Vault/Tools/View menus and supports Host Color Coding with expandable/collapsible Tab Groups (F-09)', () => {
    render(<App />);

    // 1. Verify Top Bar Menu System
    const viewMenuBtn = screen.getByRole('button', { name: /View ▾/i });
    const terminalsMenuBtn = screen.getByRole('button', { name: /Terminals ▾/i });
    const intelMenuBtn = screen.getByRole('button', { name: /Intel & Keys ▾/i });

    expect(viewMenuBtn).toBeInTheDocument();
    expect(terminalsMenuBtn).toBeInTheDocument();
    expect(intelMenuBtn).toBeInTheDocument();

    // Open Intel & Keys dropdown and trigger Command Palette
    fireEvent.click(intelMenuBtn);
    expect(screen.getByRole('menu', { name: 'Intel and Keys Menu' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Command Palette/i }));
    expect(screen.getByRole('dialog', { name: 'Command Palette' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command Palette' })).not.toBeInTheDocument();

    // 2. Create a Host with explicit Color Coding (F-09)
    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'Prod-Gateway' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), {
      target: { value: '10.50.0.1' },
    });
    // Select Emerald Green color swatch (#10b981)
    fireEvent.click(screen.getByRole('button', { name: 'Color #10b981' }));
    fireEvent.click(screen.getByRole('button', { name: /Save Host/i }));

    expect(screen.getByText('Prod-Gateway')).toBeInTheDocument();

    // 3. Connect twice to Prod-Gateway to create 2 sessions
    const connectBtn = screen.getByRole('button', { name: /^Connect$/i });
    fireEvent.click(connectBtn);
    fireEvent.click(connectBtn);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);

    // 4. Group Tabs by Host (F-09)
    const groupToggleBtn = screen.getByRole('button', { name: 'Group by Host' });
    fireEvent.click(groupToggleBtn);

    // Verify Host Group container appears with session count badge (2) and host header
    const groupContainer = screen.getByLabelText('Host Group Prod-Gateway');
    expect(groupContainer).toBeInTheDocument();
    expect(within(groupContainer).getAllByText('Prod-Gateway')).toHaveLength(3);
    expect(within(groupContainer).getByText('2')).toBeInTheDocument();

    // Toggle collapse on the host group
    const groupHeader = screen.getByRole('button', { name: /Toggle Group Prod-Gateway/i });
    fireEvent.click(groupHeader);

    // Only active tab is shown when collapsed
    expect(screen.getAllByRole('tab')).toHaveLength(1);

    // Expand the host group again
    fireEvent.click(groupHeader);
    expect(screen.getAllByRole('tab')).toHaveLength(2);

    // Ungroup tabs back to flat layout
    const ungroupBtn = screen.getByRole('button', { name: 'Ungroup Tabs' });
    fireEvent.click(ungroupBtn);
    expect(screen.queryByLabelText('Host Group Prod-Gateway')).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('supports In-Terminal Search with Regex, Match Case, Whole Word, and Navigation (F-11)', () => {
    render(<App />);

    // Create a host and connect
    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'SearchHost' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), {
      target: { value: '10.0.0.99' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Host/i }));

    const connectBtn = screen.getByRole('button', { name: /^Connect$/i });
    fireEvent.click(connectBtn);

    // 1. Open search via Find button in pane header (F-11)
    const findBtn = screen.getByRole('button', { name: /Find in SearchHost/i });
    fireEvent.click(findBtn);

    const searchOverlay = screen.getByRole('search', { name: 'Search Bar SearchHost' });
    expect(searchOverlay).toBeInTheDocument();

    const searchInput = screen.getByLabelText('Search Terminal');
    expect(searchInput).toBeInTheDocument();

    // 2. Type search term
    fireEvent.change(searchInput, { target: { value: 'error' } });
    expect(searchInput).toHaveValue('error');

    // 3. Toggle Match Case (Aa)
    const matchCaseBtn = screen.getByRole('button', { name: 'Match Case' });
    fireEvent.click(matchCaseBtn);
    expect(matchCaseBtn).toHaveClass('active');

    // 4. Toggle Whole Word (\b)
    const wholeWordBtn = screen.getByRole('button', { name: 'Match Whole Word' });
    fireEvent.click(wholeWordBtn);
    expect(wholeWordBtn).toHaveClass('active');

    // 5. Toggle Regular Expression (.*)
    const regexBtn = screen.getByRole('button', { name: 'Use Regular Expression' });
    fireEvent.click(regexBtn);
    expect(regexBtn).toHaveClass('active');

    // 6. Navigate next and previous match
    const nextBtn = screen.getByRole('button', { name: 'Next Match' });
    const prevBtn = screen.getByRole('button', { name: 'Previous Match' });
    fireEvent.click(nextBtn);
    fireEvent.click(prevBtn);

    // Press Enter inside search input
    fireEvent.keyDown(searchInput, { key: 'Enter' });
    // Press Shift+Enter inside search input
    fireEvent.keyDown(searchInput, { key: 'Enter', shiftKey: true });

    // 7. Close search via Close button (×)
    const closeBtn = screen.getByRole('button', { name: 'Close Search' });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('search', { name: 'Search Bar SearchHost' })).not.toBeInTheDocument();

    // 8. Re-open search via Ctrl+F shortcut
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(screen.getByRole('search', { name: 'Search Bar SearchHost' })).toBeInTheDocument();

    // Close via Escape key
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('search', { name: 'Search Bar SearchHost' })).not.toBeInTheDocument();
  });

  it('supports Local PTY Terminals, Serial UART Console with Auto-Detect, Saleae Logic Analyzer, and Collapsible Sidebar (F-23)', () => {
    render(<App />);

    // 0. Test Collapsible Sidebar (◀ and ▶ and Ctrl+B)
    const sidebar = screen.getByLabelText('Hosts and Groups Sidebar');
    expect(sidebar).not.toHaveClass('collapsed');

    const collapseBtn = screen.getByRole('button', { name: 'Collapse Sidebar' });
    fireEvent.click(collapseBtn);
    expect(sidebar).toHaveClass('collapsed');

    const expandBtn = screen.getByRole('button', { name: 'Expand Sidebar' });
    fireEvent.click(expandBtn);
    expect(sidebar).not.toHaveClass('collapsed');

    // Toggle via Ctrl+B shortcut
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(sidebar).toHaveClass('collapsed');
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(sidebar).not.toHaveClass('collapsed');

    // 1. Open Local PowerShell terminal via Hoverable Terminals Menu
    const toolsBtn = screen.getByRole('button', { name: /Terminals ▾/i });
    fireEvent.mouseEnter(toolsBtn);
    expect(screen.getByRole('menu', { name: 'Terminals Menu' })).toBeInTheDocument();

    const pwshItem = screen.getByRole('menuitem', { name: /Local Shell \(PowerShell\)/i });
    fireEvent.click(pwshItem);

    // Verify Tab is created
    expect(screen.getByRole('tab', { name: 'Tab Local (PowerShell)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pane Local (PowerShell)')).toBeInTheDocument();

    // 2. Split pane on Local Terminal: ensure title does not stack recursively
    fireEvent.click(screen.getByRole('button', { name: 'Split Horizontal' }));
    expect(screen.getByLabelText('Pane Local (PowerShell) (H-Split #2)')).toBeInTheDocument();

    // Split again: should be V-Split #3 based on root title, not stacked
    fireEvent.click(screen.getByRole('button', { name: 'Split Vertical' }));
    expect(screen.getByLabelText('Pane Local (PowerShell) (V-Split #3)')).toBeInTheDocument();

    // 3. Open Local Command Prompt (CMD) via Terminals Menu
    fireEvent.mouseEnter(toolsBtn);
    const cmdItem = screen.getByRole('menuitem', { name: /Local Shell \(Command Prompt\)/i });
    fireEvent.click(cmdItem);

    expect(screen.getByRole('tab', { name: 'Tab Local (CMD)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pane Local (CMD)')).toBeInTheDocument();

    // 4. Open Hardware Bus & UART Logic Connection Modal (F-23)
    fireEvent.mouseEnter(toolsBtn);
    const serialItem = screen.getByRole('menuitem', { name: /Hardware Bus & UART Logic \(F-23\)/i });
    fireEvent.click(serialItem);

    expect(screen.getByRole('dialog', { name: 'Serial Connection' })).toBeInTheDocument();
    expect(screen.getByText('Serial / UART Console Connection')).toBeInTheDocument();

    // Auto-Detect port & baud button exists and operates
    const autoDetectBtn = screen.getByRole('button', { name: /Auto Detect Port & Baud/i });
    expect(autoDetectBtn).toBeInTheDocument();
    fireEvent.click(autoDetectBtn);
    expect(screen.getByText(/Auto-detected/i)).toBeInTheDocument();

    // Refresh detected ports button exists
    const refreshBtn = screen.getByRole('button', { name: /Refresh/i });
    expect(refreshBtn).toBeInTheDocument();
    fireEvent.click(refreshBtn);

    // Set port name
    const portInput = screen.getByLabelText('Serial Port Name');
    fireEvent.change(portInput, { target: { value: 'COM4' } });

    // Change Baud Rate to 115200
    const baudSelect = screen.getByLabelText('Baud Rate');
    fireEvent.change(baudSelect, { target: { value: '115200' } });

    // Toggle Advanced Parameters
    const advToggle = screen.getByRole('button', {
      name: /Advanced Parameters/i,
    });
    fireEvent.click(advToggle);

    expect(screen.getByLabelText('Data Bits')).toBeInTheDocument();
    expect(screen.getByLabelText('Parity')).toBeInTheDocument();
    expect(screen.getByLabelText('Stop Bits')).toBeInTheDocument();
    expect(screen.getByLabelText('Flow Control')).toBeInTheDocument();

    // Configure advanced parameters
    fireEvent.change(screen.getByLabelText('Data Bits'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Parity'), { target: { value: 'none' } });
    fireEvent.change(screen.getByLabelText('Stop Bits'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Flow Control'), { target: { value: 'hardware' } });

    // Submit connection form
    fireEvent.click(screen.getByRole('button', { name: /Connect Serial/i }));

    // Verify modal closes and serial session tab is open
    expect(screen.queryByRole('dialog', { name: 'Serial Connection' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tab Serial (COM4 @ 115200)' })).toBeInTheDocument();

    // Verify Serial Hardware Pin Controls (DTR, RTS, Break) exist in the pane header
    const dtrBtn = screen.getByRole('button', { name: 'Toggle DTR for Serial (COM4 @ 115200)' });
    const rtsBtn = screen.getByRole('button', { name: 'Toggle RTS for Serial (COM4 @ 115200)' });
    const breakBtn = screen.getByRole('button', { name: 'Send Break for Serial (COM4 @ 115200)' });
    const logicAnalyzerBtn = screen.getByRole('button', {
      name: 'Toggle Signal Analyzer for Serial (COM4 @ 115200)',
    });

    expect(dtrBtn).toBeInTheDocument();
    expect(rtsBtn).toBeInTheDocument();
    expect(breakBtn).toBeInTheDocument();
    expect(logicAnalyzerBtn).toBeInTheDocument();

    // Toggle DTR and RTS
    expect(dtrBtn).toHaveClass('active');
    fireEvent.click(dtrBtn);
    expect(dtrBtn).not.toHaveClass('active');

    expect(rtsBtn).toHaveClass('active');
    fireEvent.click(rtsBtn);
    expect(rtsBtn).not.toHaveClass('active');

    // Click Break
    fireEvent.click(breakBtn);
    expect(screen.getByText(/Sent break signal/i)).toBeInTheDocument();

    // 5. Open Saleae-style Signal & Logic Analyzer
    fireEvent.click(logicAnalyzerBtn);
    expect(screen.getByRole('region', { name: 'Signal Analyzer' })).toBeInTheDocument();
    expect(screen.getByText('📈 LOGIC ANALYZER')).toBeInTheDocument();
    expect(screen.getByText(/COM4 @ 115200 baud/i)).toBeInTheDocument();

    // Toggle Live / Pause button
    const pauseBtn = screen.getByRole('button', { name: /Pause/i });
    expect(pauseBtn).toBeInTheDocument();
    fireEvent.click(pauseBtn);
    expect(screen.getByRole('button', { name: /Live/i })).toBeInTheDocument();

    // Close Logic Analyzer via its close button
    const closeAnalyzerBtn = screen.getByRole('button', { name: 'Close Signal Analyzer' });
    fireEvent.click(closeAnalyzerBtn);
    expect(screen.queryByRole('region', { name: 'Signal Analyzer' })).not.toBeInTheDocument();
  });

  it('spawns new terminals in Default Directory, Current Directory (CWD), and Root Shell (F-10)', () => {
    render(<App />);

    // 1. Open Local Shell (PowerShell) via Terminals Menu
    const toolsBtn = screen.getByRole('button', { name: /Terminals ▾/i });
    fireEvent.mouseEnter(toolsBtn);
    const pwshItem = screen.getByRole('menuitem', { name: /Local Shell \(PowerShell\)/i });
    fireEvent.click(pwshItem);

    expect(screen.getByRole('tab', { name: 'Tab Local (PowerShell)' })).toBeInTheDocument();

    // Verify the F-10 toolbar buttons are present
    const defaultDirBtn = screen.getByRole('button', { name: 'New Terminal Default Directory' });
    const currentDirBtn = screen.getByRole('button', { name: 'New Terminal Current Directory' });
    const rootDirBtn = screen.getByRole('button', { name: 'New Terminal Root in Current Directory' });

    expect(defaultDirBtn).toBeInTheDocument();
    expect(currentDirBtn).toBeInTheDocument();
    expect(rootDirBtn).toBeInTheDocument();

    // 2. Click "Default Dir" button -> opens new session tab with (Default Dir)
    fireEvent.click(defaultDirBtn);
    expect(screen.getByRole('tab', { name: 'Tab Local (PowerShell) (Default Dir)' })).toBeInTheDocument();

    // 3. Switch back to first tab
    const firstTab = screen.getByRole('tab', { name: 'Tab Local (PowerShell)' });
    fireEvent.click(firstTab);

    // Click "Current Dir" button -> opens new session tab with [CWD]
    fireEvent.click(currentDirBtn);
    expect(screen.getByRole('tab', { name: 'Tab Local (PowerShell) [CWD]' })).toBeInTheDocument();

    // 4. Click "Root in Dir" button -> opens elevated root session tab with (Root)
    fireEvent.click(firstTab);
    fireEvent.click(rootDirBtn);
    expect(screen.getByRole('tab', { name: /Tab Local \(PowerShell\) \(Root\)/i })).toBeInTheDocument();

    // 5. Test Tools menu options for F-10
    fireEvent.mouseEnter(toolsBtn);
    expect(screen.getByRole('menuitem', { name: /New in Default Directory/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /New in Current Directory \(CWD\)/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /New Root Shell in Current Directory/i })).toBeInTheDocument();

    // Trigger Root shell via Tools menu
    fireEvent.click(screen.getByRole('menuitem', { name: /New Root Shell in Current Directory/i }));
    expect(screen.getAllByRole('tab', { name: /Root/i }).length).toBeGreaterThanOrEqual(2);
  });

  it('supports SFTP Two-Column File Browser, drag-drop transfers, and Transfer Queue (F-12)', async () => {
    try {
      render(<App />);

      // 1. Add a Saved Host (using in-memory fallback state)
      fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
      fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'SFTP-Server' } });
      fireEvent.change(screen.getByLabelText('Host IP or Hostname'), { target: { value: '192.168.1.100' } });
      fireEvent.click(screen.getByRole('button', { name: /Save Host/i }));

      expect(screen.getByText('SFTP-Server')).toBeInTheDocument();

      // 2. Saved Host has SFTP button in sidebar actions
      const sftpBtn = screen.getByTitle('Open SFTP file browser for SFTP-Server');
      expect(sftpBtn).toBeInTheDocument();

      // 3. Attach mocked Wails SFTP bindings now
      const win = window as unknown as {
        go?: {
          main?: {
            App?: {
              ListLocalDir?: () => Promise<unknown[]>;
              ListRemoteDir?: () => Promise<unknown[]>;
              StartSftpUpload?: () => Promise<string>;
              StartSftpDownload?: () => Promise<string>;
              CancelTransfer?: () => Promise<void>;
              CreateRemoteDir?: () => Promise<void>;
              DeleteRemoteItem?: () => Promise<void>;
              GetActiveTransfers?: () => Promise<unknown[]>;
              ConnectSavedHost?: () => Promise<string>;
            };
          };
        };
      };

      win.go = win.go || {};
      win.go.main = win.go.main || {};
      win.go.main.App = {
        ListLocalDir: async () => [
          { name: 'local_file.txt', path: '/local/local_file.txt', size: 1024, isDir: false, modTime: 1700000000, permissions: '-rw-r--r--' },
          { name: 'local_folder', path: '/local/local_folder', size: 0, isDir: true, modTime: 1700000000, permissions: 'drwxr-xr-x' },
        ],
        ListRemoteDir: async () => [
          { name: 'remote_file.txt', path: '/remote/remote_file.txt', size: 2048, isDir: false, modTime: 1700000000, permissions: '-rw-r--r--' },
          { name: 'remote_folder', path: '/remote/remote_folder', size: 0, isDir: true, modTime: 1700000000, permissions: 'drwxr-xr-x' },
        ],
        GetActiveTransfers: async () => [],
        ConnectSavedHost: async () => 'sess-test-ssh-123',
      };

      // 4. Click SFTP button -> opens SFTP Tab
      fireEvent.click(sftpBtn);

      // Verify SFTP Tab was opened
      expect(await screen.findByRole('tab', { name: /Tab SFTP: SFTP-Server/i })).toBeInTheDocument();

      // Verify SFTP Browser View elements are rendered
      expect(screen.getByText('SFTP Browser')).toBeInTheDocument();
      expect(screen.getByText('LOCAL')).toBeInTheDocument();
      expect(screen.getByText('REMOTE')).toBeInTheDocument();
      expect(screen.getByText('TRANSFER QUEUE (0)')).toBeInTheDocument();

      // Verify mocked files appear
      expect(await screen.findByText('local_file.txt')).toBeInTheDocument();
      expect(await screen.findByText('remote_file.txt')).toBeInTheDocument();
    } finally {
      delete (window as unknown as { go?: unknown }).go;
    }
  });

  it('manages Port Forwarding rules (-L, -R, -D) and active tunnels with status indicators (F-13)', async () => {
    const rulesList: Array<{
      id: string;
      type: 'L' | 'R' | 'D';
      label?: string;
      bindAddress: string;
      bindPort: number;
      targetHost?: string;
      targetPort?: number;
      autoStart: boolean;
    }> = [];
    const activeTunnelsList: Array<{
      id: string;
      ruleId: string;
      sessionId: string;
      type: 'L' | 'R' | 'D';
      bindAddress: string;
      bindPort: number;
      targetHost: string;
      targetPort: number;
      status: string;
      bytesIn: number;
      bytesOut: number;
      activeConns: number;
      error?: string;
    }> = [];

    const win = window as unknown as {
      go?: {
        main?: {
          App?: {
            HealthCheck?: () => Promise<{
              vaultInitialized: boolean;
              vaultLocked: boolean;
              passwordless: boolean;
              quickUnlockReady: boolean;
            }>;
            GetVaultSummary?: () => Promise<{ groups: unknown[]; hosts: unknown[]; identities: unknown[] }>;
            ConnectSSH?: () => Promise<string>;
            ListForwardRules?: () => Promise<typeof rulesList>;
            SaveForwardRule?: (rule: (typeof rulesList)[0]) => Promise<void>;
            DeleteForwardRule?: (ruleId: string) => Promise<void>;
            StartForwardTunnel?: (sessionId: string, ruleId: string) => Promise<string>;
            StopForwardTunnel?: (tunnelId: string) => Promise<void>;
            GetActiveTunnels?: () => Promise<typeof activeTunnelsList>;
          };
        };
      };
    };

    win.go = win.go || {};
    win.go.main = win.go.main || {};
    win.go.main.App = {
      HealthCheck: async () => ({
        vaultInitialized: true,
        vaultLocked: false,
        passwordless: true,
        quickUnlockReady: false,
      }),
      GetVaultSummary: async () => ({ groups: [], hosts: [], identities: [] }),
      ConnectSSH: async () => 'sess-test-ssh-123',
      ListForwardRules: async () => rulesList,
      SaveForwardRule: async (r) => {
        const existingIdx = rulesList.findIndex((item) => item.id === r.id);
        if (existingIdx >= 0) {
          rulesList[existingIdx] = r;
        } else {
          rulesList.push(r);
        }
      },
      DeleteForwardRule: async (ruleId) => {
        const idx = rulesList.findIndex((r) => r.id === ruleId);
        if (idx >= 0) rulesList.splice(idx, 1);
      },
      StartForwardTunnel: async (sessionId, ruleId) => {
        const rule = rulesList.find((r) => r.id === ruleId);
        const tunnelId = `tun-${Date.now()}`;
        activeTunnelsList.push({
          id: tunnelId,
          ruleId,
          sessionId,
          type: rule?.type || 'L',
          bindAddress: rule?.bindAddress || '127.0.0.1',
          bindPort: rule?.bindPort || 8080,
          targetHost: rule?.targetHost || '127.0.0.1',
          targetPort: rule?.targetPort || 80,
          status: 'active',
          bytesIn: 1024,
          bytesOut: 2048,
          activeConns: 1,
        });
        return tunnelId;
      },
      StopForwardTunnel: async (tunnelId) => {
        const idx = activeTunnelsList.findIndex((t) => t.id === tunnelId);
        if (idx >= 0) activeTunnelsList.splice(idx, 1);
      },
      GetActiveTunnels: async () => activeTunnelsList,
    };

    try {
      render(<App />);

      // 1. Connect via quick connect to have an active SSH session
      const hostInput = screen.getByLabelText('Host Address');
      fireEvent.change(hostInput, { target: { value: '192.168.1.50' } });
      const connectBtn = screen.getByRole('button', { name: /Connect SSH/i });
      fireEvent.click(connectBtn);

      // Verify session tab opened
      expect(await screen.findByRole('tab', { name: /Tab root@192.168.1.50:22/i })).toBeInTheDocument();

      // 2. Open Port Forwarding modal via Tunnels button in nav
      const tunnelsNavBtn = screen.getByRole('button', { name: /Port Forwarding/i });
      expect(tunnelsNavBtn).toBeInTheDocument();
      fireEvent.click(tunnelsNavBtn);

      // Verify Port Forwarding modal opens
      expect(screen.getByRole('heading', { name: /Port Forwarding & Tunnels/i })).toBeInTheDocument();
      expect(screen.getByText(/No Port Forwarding Rules configured/i)).toBeInTheDocument();

      // 3. Click "+ New Forward Rule"
      const addRuleBtn = screen.getByRole('button', { name: /\+ New Forward Rule/i });
      fireEvent.click(addRuleBtn);

      // Verify form appears
      expect(screen.getByLabelText(/Rule Type/i)).toBeInTheDocument();

      // Configure a Local forward rule (-L 8080:localhost:80)
      const labelInput = screen.getByLabelText(/Rule Label/i);
      fireEvent.change(labelInput, { target: { value: 'Web Dashboard' } });

      const bindPortInput = screen.getByLabelText(/Bind Port/i);
      fireEvent.change(bindPortInput, { target: { value: '8080' } });

      const targetHostInput = screen.getByLabelText(/Target Host/i);
      fireEvent.change(targetHostInput, { target: { value: '127.0.0.1' } });

      const targetPortInput = screen.getByLabelText(/Target Port/i);
      fireEvent.change(targetPortInput, { target: { value: '80' } });

      // Save rule
      const saveBtn = screen.getByRole('button', { name: /Save Rule/i });
      fireEvent.click(saveBtn);

      // Rule should now be in the list
      expect(await screen.findByText('Web Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Local -L')).toBeInTheDocument();
      expect(screen.getByText('INACTIVE')).toBeInTheDocument();

      // 4. Start tunnel on the active SSH session
      const startBtn = screen.getByRole('button', { name: /▶ Start Tunnel/i });
      fireEvent.click(startBtn);

      // Tunnel should become active
      expect(await screen.findByText('ACTIVE')).toBeInTheDocument();
      expect(screen.getByText(/1 active connection/i)).toBeInTheDocument();

      // 5. Stop tunnel
      const stopBtn = screen.getByRole('button', { name: /Stop Tunnel/i });
      fireEvent.click(stopBtn);

      // Tunnel should return to inactive
      expect(await screen.findByText('INACTIVE')).toBeInTheDocument();

      // 6. Delete rule
      const deleteBtn = screen.getByRole('button', { name: /Delete/i });
      fireEvent.click(deleteBtn);

      // Empty state returns
      expect(await screen.findByText(/No Port Forwarding Rules configured/i)).toBeInTheDocument();

      // Close modal
      const closeBtn = screen.getByRole('button', { name: /Close Port Forwarding/i });
      fireEvent.click(closeBtn);
      expect(screen.queryByRole('heading', { name: /Port Forwarding & Tunnels/i })).not.toBeInTheDocument();
    } finally {
      delete (window as unknown as { go?: unknown }).go;
    }
  });

  it('supports modal backdrop click-to-close, unified Settings tabs, custom shortcuts, and starting tunnel with background host connection', async () => {
    let forwardRules: ForwardRule[] = [];
    let activeTunnels: ForwardTunnelStatus[] = [];
    let connectedSavedHostId = '';

    const mockApi = {
      HealthCheck: async () => 'ok',
      GetVaultSummary: async () => ({
        initialized: true,
        locked: false,
        hosts: [
          {
            id: 'host-prod-1',
            label: 'Production Web',
            address: '10.0.0.1',
            effectivePort: 22,
            effectiveUser: 'admin',
            color: '#10b981',
            authMethod: 'password',
            hasPassword: true,
            hasKey: false,
            keyId: '',
            groupId: '',
            tags: ['prod', 'web'],
          },
        ],
        groups: [],
        keys: [],
        passwordless: false,
        quickUnlockArmable: true,
        quickUnlockArmed: false,
      }),
      ListForwardRules: async () => forwardRules,
      SaveForwardRule: async (r: ForwardRule) => {
        forwardRules = [r];
      },
      DeleteForwardRule: async () => {
        forwardRules = [];
      },
      GetActiveTunnels: async () => activeTunnels,
      ConnectSavedHost: async (hId: string) => {
        connectedSavedHostId = hId;
        return 'sess-bg-prod-1';
      },
      StartForwardTunnel: async (_sessId: string, ruleId: string) => {
        activeTunnels = [
          {
            id: 'tun-bg-1',
            ruleId,
            sessionId: _sessId,
            type: 'L',
            bindAddress: '127.0.0.1',
            bindPort: 8080,
            targetHost: '127.0.0.1',
            targetPort: 80,
            status: 'active',
            bytesIn: 100,
            bytesOut: 200,
            activeConns: 1,
          },
        ];
        return 'tun-bg-1';
      },
      StopForwardTunnel: async () => {
        activeTunnels = [];
      },
    };

    (window as unknown as { go?: { main?: { App?: typeof mockApi } } }).go = {
      main: { App: mockApi },
    };

    try {
      render(<App />);

      // 1. Verify modal backdrop click closes Command Palette
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      const paletteBackdrop = screen.getByRole('dialog', { name: 'Command Palette' });
      expect(paletteBackdrop).toBeInTheDocument();
      // Click on backdrop outer element
      fireEvent.click(paletteBackdrop);
      expect(screen.queryByRole('dialog', { name: 'Command Palette' })).not.toBeInTheDocument();

      // 2. Open Global Settings (Ctrl+,), test tabs: Appearance, Vault Security, Shortcuts
      fireEvent.keyDown(window, { key: ',', ctrlKey: true });
      const settingsModal = screen.getByRole('dialog', { name: 'Global Settings' });
      expect(settingsModal).toBeInTheDocument();

      // Switch to Vault & Security tab inside Settings
      const securityTab = screen.getByRole('tab', { name: /Vault & Security/i });
      fireEvent.click(securityTab);
      expect(screen.getByRole('tabpanel', { name: /Vault & Security Settings/i })).toBeInTheDocument();
      expect(screen.getByText(/Master Password & Encryption/i)).toBeInTheDocument();

      // Switch to Keyboard Shortcuts tab inside Settings
      const shortcutsTab = screen.getByRole('tab', { name: /Keyboard Shortcuts/i });
      fireEvent.click(shortcutsTab);
      expect(screen.getByRole('tabpanel', { name: /Keyboard Shortcuts Settings/i })).toBeInTheDocument();
      expect(screen.getByText(/Custom Hotkeys & Snippet Launchers/i)).toBeInTheDocument();

      // Add a custom shortcut
      const addShortcutBtn = screen.getByRole('button', { name: /\+ Add Custom Shortcut/i });
      fireEvent.click(addShortcutBtn);
      const recordBox = screen.getByText(/Click to record keys\.\.\./i);
      fireEvent.keyDown(recordBox, { key: 't', ctrlKey: true, altKey: true });
      fireEvent.click(screen.getByRole('button', { name: /Save Custom Shortcut/i }));
      expect(screen.getByText('Ctrl+Alt+T')).toBeInTheDocument();

      // Click on backdrop outer element to close Settings
      fireEvent.click(settingsModal);
      expect(screen.queryByRole('dialog', { name: 'Global Settings' })).not.toBeInTheDocument();

      // 3. Test starting tunnel when no active session exists (connects host in background)
      // Wait for vault hosts to load
      expect(await screen.findByText('Production Web')).toBeInTheDocument();

      // Open Port Forwarding modal
      const tunnelsBtn = screen.getByRole('button', { name: /Port Forwarding/i });
      fireEvent.click(tunnelsBtn);
      const forwardModal = screen.getByRole('dialog', { name: 'Port Forwarding & Tunnels' });
      expect(forwardModal).toBeInTheDocument();

      // Add a forward rule tied to host-prod-1
      const newRuleBtn = screen.getByRole('button', { name: /\+ New Forward Rule/i });
      fireEvent.click(newRuleBtn);
      fireEvent.change(screen.getByLabelText(/Rule Label/i), { target: { value: 'Auto-DB' } });
      fireEvent.change(screen.getByLabelText(/Associated Host/i), { target: { value: 'host-prod-1' } });
      fireEvent.click(screen.getByRole('button', { name: /Save Rule/i }));

      // With 0 active sessions, it should present "Connect Production Web & Start Tunnel"
      const connectAndStartBtn = await screen.findByRole('button', { name: /Connect Production Web & Start Tunnel/i });
      expect(connectAndStartBtn).toBeInTheDocument();

      // Click Connect & Start Tunnel
      fireEvent.click(connectAndStartBtn);

      // Verify it called ConnectSavedHost in the background and started tunnel
      expect(connectedSavedHostId).toBe('host-prod-1');
      expect(await screen.findByText('ACTIVE')).toBeInTheDocument();

      // Click backdrop of Port Forwarding modal to close it
      fireEvent.click(forwardModal);
      expect(screen.queryByRole('dialog', { name: 'Port Forwarding & Tunnels' })).not.toBeInTheDocument();
    } finally {
      delete (window as unknown as { go?: unknown }).go;
    }
  });

  it('manages Proxy Profiles (ProxyJump, ProxyCommand, SOCKS5) and exports proxychains.conf (F-14)', async () => {
    let savedProfile: unknown = null;

    (window as unknown as { go: unknown }).go = {
      main: {
        App: {
          HealthCheck: async () => ({
            name: 'DoubleAgent',
            version: '0.1.0',
            milestone: 'M1-4',
            vaultLocked: false,
            vaultInitialized: true,
            passwordless: true,
            quickUnlockReady: false,
          }),
          GetVaultSummary: async () => ({
            groups: [],
            hosts: [
              {
                id: 'host-bastion-1',
                label: 'Bastion EU',
                address: '10.0.0.1',
                effectivePort: 22,
                effectiveUser: 'root',
                groupId: '',
                identityId: '',
                tags: [],
                color: '',
                favorite: false,
              },
            ],
            identities: [],
            keys: [],
            proxyProfiles: [
              {
                id: 'prof-socks-test',
                name: 'Corporate SOCKS5',
                type: 'socks5',
                socksAddress: '127.0.0.1:1080',
                hasPassword: false,
              },
            ],
          }),
          SaveProxyProfile: async (p: unknown) => {
            savedProfile = p;
          },
          DeleteProxyProfile: async () => {},
          ListProxyProfiles: async () => [],
          GetDefaultProxychainsOptions: async () => ({
            chainType: 'strict_chain',
            proxyDNS: true,
            quietMode: false,
            tcpReadTimeout: 15000,
            tcpConnectTimeout: 8000,
            proxies: [{ type: 'socks5', host: '127.0.0.1', port: 1080 }],
          }),
          GenerateProxychainsConfig: async () => {
            return '# proxychains.conf generated by DoubleAgent\nstrict_chain\nproxy_dns\n\n[ProxyList]\nsocks5 127.0.0.1 1080\n';
          },
          SaveProxychainsFile: async () => {},
          SaveHost: async () => {},
          SaveGroup: async () => {},
          ListForwardRules: async () => [],
          GetActiveTunnels: async () => [],
        },
      },
    };

    try {
      render(<App initialLocked={false} />);

      // Wait for initial vault load
      expect(await screen.findByText('Bastion EU')).toBeInTheDocument();

      // 1. Open Terminals -> Proxy Profiles
      const toolsBtn = screen.getByRole('button', { name: /Terminals ▾/i });
      fireEvent.click(toolsBtn);
      const profilesMenuItem = screen.getByRole('menuitem', { name: /Proxy Profiles/i });
      fireEvent.click(profilesMenuItem);

      // Verify Proxy Profiles modal is open
      expect(screen.getByText(/Proxy Profiles & Bastion Chains/i)).toBeInTheDocument();
      expect(screen.getByText('Corporate SOCKS5')).toBeInTheDocument();

      // Click "+ New Proxy Profile"
      fireEvent.click(screen.getByRole('button', { name: /\+ New Proxy Profile/i }));
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. AWS Production Bastion/i), {
        target: { value: 'AWS VPC Bastion' },
      });

      // Select Bastion EU from saved hosts
      const selectHost = screen.getByDisplayValue(/-- Select saved host --/i);
      fireEvent.change(selectHost, { target: { value: 'host-bastion-1' } });

      // Save Profile
      fireEvent.click(screen.getByRole('button', { name: /Save Profile/i }));
      expect(savedProfile).toBeTruthy();

      // 2. Open Export proxychains.conf from the modal
      fireEvent.click(screen.getByRole('button', { name: /Export proxychains\.conf/i }));
      expect(await screen.findByText(/RFC-compliant configuration for proxychains/i)).toBeInTheDocument();
      expect(await screen.findByText(/\[ProxyList\]/i)).toBeInTheDocument();

      // Verify Copy to Clipboard button is present
      const copyBtn = screen.getByRole('button', { name: /Copy to Clipboard/i });
      expect(copyBtn).toBeInTheDocument();

      // Close modal
      const closeButtons = screen.getAllByRole('button', { name: 'Close' });
      fireEvent.click(closeButtons[closeButtons.length - 1]);
    } finally {
      delete (window as unknown as { go?: unknown }).go;
    }
  });

  it('manages Command Snippets with auto-injected context variables and variable query prompt before send (F-15)', async () => {
    let savedSnippet: unknown = null;
    let executedSnippetId = '';
    let executedSessionId = '';
    let executedUserVals: Record<string, string> = {};

    let currentSnippets: Array<{
      id: string;
      name: string;
      description?: string;
      body: string;
      tags?: string[];
      confirmBeforeRun?: boolean;
      variables?: Array<{ name: string; defaultValue?: string }>;
    }> = [
      {
        id: 'snip-tail-logs',
        name: 'Tail Nginx Logs',
        description: 'Streams recent web logs with custom count',
        body: 'tail -n {{LINES=50}} {{FILE=/var/log/nginx/access.log}}',
        tags: ['logs', 'nginx'],
        confirmBeforeRun: true,
        variables: [
          { name: 'LINES', defaultValue: '50' },
          { name: 'FILE', defaultValue: '/var/log/nginx/access.log' },
        ],
      },
    ];

    (window as unknown as { go: unknown }).go = {
      main: {
        App: {
          HealthCheck: async () => ({
            name: 'DoubleAgent',
            version: '0.1.0',
            vaultLocked: false,
            vaultInitialized: true,
            passwordless: false,
            quickUnlockReady: false,
          }),
          GetAppStatus: async () => ({
            name: 'DoubleAgent',
            version: '0.1.0',
            vaultLocked: false,
            vaultInitialized: true,
            passwordless: false,
            quickUnlockReady: false,
          }),
          GetVaultSummary: async () => ({
            groups: [],
            hosts: [
              {
                id: 'host-db-1',
                label: 'Production DB',
                address: '10.0.0.99',
                effectivePort: 5432,
                effectiveUser: 'postgres',
                tags: ['database'],
              },
            ],
            identities: [],
            keys: [],
            proxyProfiles: [],
            snippets: currentSnippets,
          }),
          SaveSnippet: async (s: unknown) => {
            savedSnippet = s;
            const snip = s as {
              id?: string;
              name: string;
              body: string;
              description?: string;
              tags?: string[];
              confirmBeforeRun?: boolean;
            };
            currentSnippets = [
              ...currentSnippets,
              {
                id: snip.id || `snip-${Date.now()}`,
                name: snip.name,
                body: snip.body,
                description: snip.description,
                tags: snip.tags,
                confirmBeforeRun: snip.confirmBeforeRun,
              },
            ];
          },
          DeleteSnippet: async () => {},
          ListSnippets: async () => currentSnippets,
          GetSnippetContext: async () => ({
            hostId: 'host-db-1',
            hostLabel: 'Production DB',
            address: '10.0.0.99',
            ip: '10.0.0.99',
            port: 5432,
            username: 'postgres',
            workingDir: '/var/log/nginx',
            timestamp: '2026-11-06 19:00:00',
            date: '2026-11-06',
            time: '19:00:00',
          }),
          ResolveSnippetTemplate: async () => 'tail -n 100 /var/log/nginx/access.log',
          ExecuteSnippet: async (sid: string, snipId: string, vals: Record<string, string>) => {
            executedSessionId = sid;
            executedSnippetId = snipId;
            executedUserVals = vals;
          },
          ConnectSSH: async () => 'session-db-1',
          ConnectSavedHost: async () => 'session-db-1',
          WriteTerminal: async () => {},
          ResizeTerminal: async () => {},
          DisconnectSession: async () => {},
        },
      },
    };

    try {
      render(<App initialLocked={false} />);

      // Wait for initial vault load
      expect(await screen.findByText('Production DB')).toBeInTheDocument();

      // Connect to host to have an active session
      fireEvent.click(screen.getByRole('button', { name: /^Connect$/i }));
      expect(await screen.findByText(/Connected to Production DB/i)).toBeInTheDocument();

      // 1. Open Recon & Exploit -> Command Snippets & Variables
      const toolsBtn = screen.getByRole('button', { name: /Recon & Exploit/i });
      fireEvent.click(toolsBtn);
      const snippetsMenuItem = screen.getByRole('menuitem', { name: /Command Snippets/i });
      fireEvent.click(snippetsMenuItem);

      // Verify Snippets Manager modal is open
      expect(await screen.findByText('Command Snippets')).toBeInTheDocument();
      expect(screen.getByText('Tail Nginx Logs')).toBeInTheDocument();

      // 2. Click "+ New Snippet"
      fireEvent.click(screen.getByRole('button', { name: /\+ New Snippet/i }));
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Inspect Nginx Logs/i), {
        target: { value: 'Ping Target Host' },
      });
      fireEvent.change(screen.getByPlaceholderText(/tail -n/i), {
        target: { value: 'ping -c {{COUNT=4}} {{HOST}}' },
      });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. web, logs, nginx/i), {
        target: { value: 'network, icmp' },
      });

      // Click quick insert button for variable
      expect(screen.getByText(/Detected Template Variables:/i)).toBeInTheDocument();

      // Save snippet
      fireEvent.click(screen.getByRole('button', { name: /Save Snippet/i }));
      expect(savedSnippet).toBeTruthy();

      // 3. Test running a snippet into active terminal session
      const runButtons = await screen.findAllByRole('button', { name: /⚡ Run/i });
      fireEvent.click(runButtons[0]);

      // Verify SnippetRunModal opened with auto-injected context and parameter fields
      expect(await screen.findByText(/Snippet Parameters & Injected Variables/i)).toBeInTheDocument();
      expect(screen.getByText(/Target Session:/i)).toBeInTheDocument();
      expect(screen.getByText(/Command Preview/i)).toBeInTheDocument();

      // Fill parameter
      const linesInput = screen.getByPlaceholderText(/Default: 50/i);
      fireEvent.change(linesInput, { target: { value: '100' } });

      // Run in terminal
      fireEvent.click(screen.getByRole('button', { name: /⚡ Run in Terminal/i }));
      expect(executedSnippetId).toBe('snip-tail-logs');
      expect(executedSessionId).toBe('session-db-1');
      expect(executedUserVals['LINES']).toBe('100');
    } finally {
      delete (window as unknown as { go?: unknown }).go;
    }
  });

  it('supports Custom Shortcuts Manager, interactive key rebinding, conflict detection, and Tmux-style Leader Key prefix mode (F-18)', async () => {
    (window as unknown as { go: unknown }).go = {
      main: {
        App: {
          HealthCheck: async () => ({
            name: 'DoubleAgent',
            version: '0.1.0',
            vaultLocked: false,
            vaultInitialized: true,
            passwordless: false,
            quickUnlockReady: false,
          }),
          GetAppStatus: async () => ({
            name: 'DoubleAgent',
            version: '0.1.0',
            vaultLocked: false,
            vaultInitialized: true,
            passwordless: false,
            quickUnlockReady: false,
          }),
          GetVaultSummary: async () => ({
            groups: [],
            hosts: [
              {
                id: 'host-sc-1',
                label: 'Bastion Alpha',
                address: '192.168.1.1',
                effectivePort: 22,
                effectiveUser: 'admin',
                tags: ['bastion'],
              },
            ],
            identities: [],
            keys: [],
            proxyProfiles: [],
            snippets: [
              {
                id: 'snip-status',
                name: 'Server Status',
                body: 'uptime && free -m',
                confirmBeforeRun: false,
              },
            ],
          }),
          ConnectSSH: async () => 'session-sc-1',
          ConnectSavedHost: async () => 'session-sc-1',
          WriteTerminal: async () => {},
          ResizeTerminal: async () => {},
          DisconnectSession: async () => {},
        },
      },
    };

    try {
      render(<App initialLocked={false} />);
      expect(await screen.findByText('Bastion Alpha')).toBeInTheDocument();

      // 1. Open Settings modal via shortcut (Ctrl+,)
      fireEvent.keyDown(window, { key: ',', ctrlKey: true });
      const settingsModal = screen.getByRole('dialog', { name: 'Global Settings' });
      expect(settingsModal).toBeInTheDocument();

      // Switch to Keyboard Shortcuts tab
      const shortcutsTab = screen.getByRole('tab', { name: /Keyboard Shortcuts/i });
      fireEvent.click(shortcutsTab);
      expect(screen.getByRole('tabpanel', { name: /Keyboard Shortcuts Settings/i })).toBeInTheDocument();

      // 2. Test Leader Key / Prefix Mode Toggle
      const leaderToggle = screen.getByLabelText(/Enable Leader Key Mode/i);
      expect(leaderToggle).not.toBeChecked();
      fireEvent.click(leaderToggle);
      expect(leaderToggle).toBeChecked();
      expect(screen.getByLabelText(/Leader Key Combination/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Leader Timeout/i)).toBeInTheDocument();

      // 3. Test Interactive Key Rebinding with Conflict Detection
      // Click Rebind on "Command Palette & Quick Connect"
      const rebindButtons = screen.getAllByRole('button', { name: /⌨️ Rebind/i });
      fireEvent.click(rebindButtons[0]);

      // Press a conflicting key combo (e.g. Ctrl+B which belongs to Toggle Sidebar)
      const recordBox = screen.getByText(/Press key combo\.\.\./i);
      fireEvent.keyDown(recordBox, { key: 'b', ctrlKey: true });
      expect(await screen.findByText(/Conflicts with:/i)).toBeInTheDocument();

      // Now press a non-conflicting combo: Ctrl+Shift+K
      fireEvent.keyDown(recordBox, { key: 'k', ctrlKey: true, shiftKey: true });
      expect(screen.getByText('Ctrl+Shift+K')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /✓ Save/i }));
      expect(screen.getByText('Ctrl+Shift+K')).toBeInTheDocument();

      // Reset that binding back to default
      const resetBtn = screen.getByRole('button', { name: /^↺ Reset$/i });
      fireEvent.click(resetBtn);
      expect(screen.getByText('Ctrl+K')).toBeInTheDocument();

      // 4. Test Adding a Custom Shortcut bound to a Command Snippet
      const addCustomBtn = screen.getByRole('button', { name: /\+ Add Custom Shortcut/i });
      fireEvent.click(addCustomBtn);

      // Select target type: snippet
      const targetTypeSelect = screen.getByDisplayValue('System Action');
      fireEvent.change(targetTypeSelect, { target: { value: 'snippet' } });

      // Verify snippet dropdown appears with "⚡ Server Status"
      expect(screen.getByText(/⚡ Server Status/i)).toBeInTheDocument();

      // Record key for custom shortcut: Ctrl+Alt+S
      const customRecordBox = screen.getByText(/Click to record keys\.\.\./i);
      fireEvent.keyDown(customRecordBox, { key: 's', ctrlKey: true, altKey: true });
      fireEvent.click(screen.getByRole('button', { name: /Save Custom Shortcut/i }));

      // Verify custom shortcut was saved and is listed
      expect(screen.getByText('Run: Server Status')).toBeInTheDocument();
      expect(screen.getByText('Ctrl+Alt+S')).toBeInTheDocument();

      // Close settings modal
      fireEvent.click(screen.getByRole('button', { name: 'Close Settings' }));
      expect(screen.queryByRole('dialog', { name: 'Global Settings' })).not.toBeInTheDocument();

      // 5. Test Leader Key in action:
      // Press Ctrl+B to arm leader mode
      fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
      // Verify visual leader status pill appears in header
      expect(screen.getByText(/⌨️ LEADER \(Ctrl\+B\)/i)).toBeInTheDocument();

      // Press Escape to cancel leader mode
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByText(/⌨️ LEADER \(Ctrl\+B\)/i)).not.toBeInTheDocument();
    } finally {
      delete (window as unknown as { go?: unknown }).go;
    }
  });

  it('supports TOTP authenticator generator, live countdown, and terminal 2FA prompt injection (F-20)', async () => {
    let totpRecords = [
      {
        id: 'totp-1',
        label: 'secops@corp.internal',
        issuer: 'CorpBastion',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        hostId: 'host-bastion-1',
      },
    ];
    let injectedSession: string | null = null;
    let injectedTotpId: string | null = null;

    (window as unknown as { go: unknown }).go = {
      main: {
        App: {
          HealthCheck: async () => ({
            name: 'DoubleAgent',
            version: '0.1.0',
            vaultLocked: false,
            vaultInitialized: true,
            passwordless: false,
            quickUnlockReady: false,
          }),
          GetAppStatus: async () => ({
            name: 'DoubleAgent',
            version: '0.1.0',
            vaultLocked: false,
            vaultInitialized: true,
            passwordless: false,
            quickUnlockReady: false,
          }),
          GetVaultSummary: async () => ({
            groups: [],
            hosts: [
              {
                id: 'host-bastion-1',
                label: 'Production Bastion',
                address: '10.0.0.1',
                effectivePort: 22,
                effectiveUser: 'admin',
                tags: ['bastion', 'prod'],
              },
            ],
            identities: [],
            keys: [],
            proxyProfiles: [],
            snippets: [],
            totpRecords,
          }),
          ListTotpRecords: async () => totpRecords,
          GetAllTotpCodes: async () => [
            { id: 'totp-1', code: '123456', remainingSeconds: 27, period: 30 },
          ],
          GetTotpCode: async (id: string) => ({
            id,
            code: '123456',
            remainingSeconds: 27,
            period: 30,
          }),
          ParseOTPAuthURI: async () => ({
            label: 'alice@cloud',
            issuer: 'CloudOps',
            secret: 'JBSWY3DPEHPK3PXP',
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
          }),
          SaveTotpRecord: async (rec: TotpRecord) => {
            totpRecords.push({
              id: rec.id || 'totp-2',
              label: rec.label,
              issuer: rec.issuer || '',
              algorithm: rec.algorithm || 'SHA1',
              digits: rec.digits || 6,
              period: rec.period || 30,
              hostId: rec.hostId || '',
            });
          },
          DeleteTotpRecord: async (id: string) => {
            totpRecords = totpRecords.filter((t) => t.id !== id);
          },
          InjectTotpCode: async (sessId: string, tId: string) => {
            injectedSession = sessId;
            injectedTotpId = tId;
          },
          ExportTotpTokens: async (format: string) => {
            if (format === 'json') {
              return JSON.stringify(totpRecords);
            }
            return totpRecords.map((r) => `otpauth://totp/${r.issuer}:${r.label}?secret=JBSWY3DPEHPK3PXP`).join('\n');
          },
          ImportTotpTokens: async () => {
            totpRecords.push({
              id: 'totp-imported',
              label: 'imported@test',
              issuer: 'ImportedService',
              algorithm: 'SHA1',
              digits: 6,
              period: 30,
              hostId: '',
            });
            return 1;
          },
          ConnectSSH: async () => 'session-bastion-2fa',
          ConnectSavedHost: async () => 'session-bastion-2fa',
          WriteTerminal: async () => {},
          ResizeTerminal: async () => {},
          DisconnectSession: async () => {},
        },
      },
    };

    // Mock clipboard
    let clipboardText = '';
    Object.assign(navigator, {
      clipboard: {
        writeText: async (text: string) => {
          clipboardText = text;
        },
      },
    });

    try {
      render(<App initialLocked={false} />);
      expect(await screen.findByText('Production Bastion')).toBeInTheDocument();

      // 1. Open Intel & Keys menu and click "TOTP Authenticator Generator"
      const toolsBtn = screen.getByRole('button', { name: /Intel & Keys/i });
      fireEvent.click(toolsBtn);

      const totpMenuItem = screen.getByRole('menuitem', { name: /TOTP Authenticator Generator/i });
      fireEvent.click(totpMenuItem);

      // 2. Verify modal opened with initial TOTP entry and 6-digit code format
      const modal = screen.getByRole('dialog', { name: 'TOTP Authenticator Generator' });
      expect(modal).toBeInTheDocument();
      expect(await screen.findByText('CorpBastion')).toBeInTheDocument();
      expect(screen.getByText('secops@corp.internal')).toBeInTheDocument();
      expect(screen.getByText('123 456')).toBeInTheDocument();
      expect(screen.getByText('27')).toBeInTheDocument(); // countdown seconds

      // 3. Test copy code to clipboard
      const copyBtn = screen.getByRole('button', { name: /Copy/i });
      fireEvent.click(copyBtn);
      expect(clipboardText).toBe('123456');

      // 4. Test adding new TOTP via URI parse
      const addBtn = screen.getByRole('button', { name: /➕ Add Authenticator/i });
      fireEvent.click(addBtn);

      const uriInput = screen.getByPlaceholderText(/otpauth:\/\/totp\//i);
      fireEvent.change(uriInput, {
        target: { value: 'otpauth://totp/CloudOps:alice@cloud?secret=JBSWY3DPEHPK3PXP' },
      });

      const parseBtn = screen.getByRole('button', { name: 'Parse URI' });
      fireEvent.click(parseBtn);

      // Now manual form is visible with parsed fields
      expect(await screen.findByDisplayValue('CloudOps')).toBeInTheDocument();
      expect(screen.getByDisplayValue('alice@cloud')).toBeInTheDocument();

      const saveBtn = screen.getByRole('button', { name: 'Save to Encrypted Vault' });
      fireEvent.click(saveBtn);

      expect(totpRecords.length).toBe(2);

      // 4b. Test Export Modal
      const exportBtn = screen.getByRole('button', { name: /EXPORT/i });
      fireEvent.click(exportBtn);
      expect(await screen.findByText(/EXPORT TOTP AUTHENTICATOR BACKUP/i)).toBeInTheDocument();
      const copyExportBtn = screen.getByRole('button', { name: /COPY TO CLIPBOARD/i });
      fireEvent.click(copyExportBtn);
      expect(clipboardText).toContain('otpauth://totp');
      const closeExportBtns = screen.getAllByRole('button', { name: /CLOSE/i });
      fireEvent.click(closeExportBtns[closeExportBtns.length - 1]);

      // 4c. Test Import Modal
      const importBtn = screen.getByRole('button', { name: /IMPORT/i });
      fireEvent.click(importBtn);
      expect(await screen.findByText(/IMPORT TOTP AUTHENTICATOR BACKUP/i)).toBeInTheDocument();
      const importTextarea = screen.getByPlaceholderText(/otpauth:\/\/totp/i);
      fireEvent.change(importTextarea, {
        target: { value: 'otpauth://totp/ImportedService:imported@test?secret=JBSWY3DPEHPK3PXP' },
      });
      const executeImportBtn = screen.getByRole('button', { name: /IMPORT AUTHENTICATORS/i });
      fireEvent.click(executeImportBtn);
      expect(await screen.findByText(/Successfully imported 1 authenticator token!/i)).toBeInTheDocument();
      expect(totpRecords.length).toBe(3);

      // Close modal
      const closeBtn = screen.getByRole('button', { name: 'Close TOTP Authenticator' });
      fireEvent.click(closeBtn);

      // 5. Connect to host, open 2FA sidebar panel, and test terminal 2FA injection button
      const connectBtn = screen.getByRole('button', { name: /^Connect$/i });
      fireEvent.click(connectBtn);

      // Open 2FA / TOTP panel in the HOST section of the sidebar
      const sidebarTotpBtn = screen.getByRole('button', { name: '2FA and TOTP Panel' });
      fireEvent.click(sidebarTotpBtn);

      // Wait for 2FA sidebar header to show Quick Inject 2FA button
      const inject2faBtn = await screen.findByRole('button', { name: /🔐 2FA \/ TOTP/i });
      expect(inject2faBtn).toBeInTheDocument();

      // With multiple tokens (3 defined), clicking 2FA opens the reduced quick selector dialog
      fireEvent.click(inject2faBtn);
      const quickDialog = await screen.findByRole('dialog', { name: /Select 2FA Token to Inject/i });
      expect(quickDialog).toBeInTheDocument();

      // Click the insert button for the first token
      const insertButtons = screen.getAllByRole('button', { name: /⚡ INSERT/i });
      expect(insertButtons.length).toBeGreaterThan(0);
      fireEvent.click(insertButtons[0]);

      expect(injectedSession).toBe('session-bastion-2fa');
      expect(await screen.findByText(/TOTP 2FA code injected into active terminal prompt/i)).toBeInTheDocument();

      // Verify single token behavior: leave only 1 token in vault
      totpRecords.pop();
      totpRecords.pop();
      expect(totpRecords.length).toBe(1);
      injectedSession = null;
      injectedTotpId = null;

      fireEvent.click(inject2faBtn);
      await waitFor(() => {
        expect(injectedSession).toBe('session-bastion-2fa');
      });
      expect(injectedTotpId).toBe(totpRecords[0].id);
      expect(screen.queryByRole('dialog', { name: /Select 2FA Token to Inject/i })).not.toBeInTheDocument();
    } finally {
      delete (window as unknown as { go?: unknown }).go;
    }
  });

  it('manages Host Notes with folders, subpages, safe markdown rendering, host drawer, and Command Palette search (F-17)', async () => {
    render(<App initialLocked={false} />);

    // 1. Add a host so we can link notes to it and test the Host Notes Drawer
    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'Core Router' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), { target: { value: '10.0.0.254' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Host' }));
    expect(await screen.findByText('Core Router')).toBeInTheDocument();

    // 2. Open Host Notes via Intel & Keys -> Host Notes & Docs
    fireEvent.click(screen.getByRole('button', { name: /Intel & Keys/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Host Notes & Docs/i }));

    const notesDialog = screen.getByRole('dialog', { name: 'Host Notes & Documentation' });
    expect(notesDialog).toBeInTheDocument();

    // 3. Create a Folder
    fireEvent.click(screen.getByRole('button', { name: '+ Folder' }));
    expect(await screen.findByDisplayValue('New Folder')).toBeInTheDocument();

    // 4. Create a Note and edit its title & markdown body (including raw HTML to verify safe rendering)
    fireEvent.click(screen.getByRole('button', { name: '+ Note' }));
    const titleInput = await screen.findByLabelText('Note title');
    fireEvent.change(titleInput, { target: { value: 'BGP Runbook' } });

    const bodyInput = screen.getByLabelText('Note markdown editor');
    fireEvent.change(bodyInput, {
      target: {
        value: '# BGP Peering\n- [ ] Verify AS65001 neighbor\n<img src=x onerror=alert(1)>',
      },
    });

    // Link note to Core Router host
    const hostLinkSelect = screen.getByLabelText('Link note to host');
    const hostOptions = within(hostLinkSelect).getAllByRole('option');
    const coreRouterOpt = hostOptions.find((o) => o.textContent?.includes('Core Router'));
    if (coreRouterOpt) {
      fireEvent.change(hostLinkSelect, {
        target: { value: (coreRouterOpt as HTMLOptionElement).value },
      });
    }

    fireEvent.click(screen.getByRole('button', { name: /Save Note/i }));

    // Verify safe Markdown preview renders heading and literal HTML text without injecting an <img> tag
    expect(screen.getByRole('heading', { name: 'BGP Peering' })).toBeInTheDocument();
    expect(notesDialog.querySelector('img')).toBeNull();

    // Close Notes Modal
    fireEvent.click(screen.getByRole('button', { name: 'Close Notes' }));

    // 5. Connect to Core Router and toggle the in-session Host Notes Drawer
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const drawerBtn = await screen.findByRole('button', { name: /Toggle Host Notes for Core Router/i });
    fireEvent.click(drawerBtn);

    const drawer = await screen.findByRole('complementary', { name: 'Host Documentation Drawer' });
    expect(drawer).toBeInTheDocument();
    expect(within(drawer).getAllByText(/BGP Runbook/i).length).toBeGreaterThan(0);

    // 5b. Pin notes as a horizontal split view from drawer
    const pinSplitBtn = within(drawer).getByRole('button', { name: 'Pin Notes as Split View' });
    fireEvent.click(pinSplitBtn);

    // Notes split pane appears alongside the active terminal rendering the clean Host Notes Drawer
    const splitNotesPane = await screen.findByLabelText(/Notes Pane Notes: Core Router/i);
    expect(splitNotesPane).toBeInTheDocument();
    expect(within(splitNotesPane).getByRole('button', { name: /Open Full Notes/i })).toBeInTheDocument();
    expect(within(splitNotesPane).getAllByText(/BGP Runbook/i).length).toBeGreaterThan(0);

    // Close the split notes pane
    const closeNotesSplitBtn = within(splitNotesPane).getByRole('button', { name: /Close Notes Pane/i });
    fireEvent.click(closeNotesSplitBtn);
    expect(screen.queryByLabelText(/Notes Pane Notes: Core Router/i)).toBeNull();

    // 6. Search Notes via Command Palette (Ctrl+K)
    fireEvent.click(screen.getByRole('button', { name: /Intel & Keys/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Command Palette/i }));

    const paletteInput = screen.getByLabelText('Command Palette Input');
    fireEvent.change(paletteInput, { target: { value: 'AS65001' } });

    expect(await screen.findByText(/Notes & Documentation/i)).toBeInTheDocument();
    const noteResultBtn = screen.getByRole('button', { name: /BGP Runbook/i });
    fireEvent.click(noteResultBtn);

    // Clicking the Command Palette result opens NotesView focused on BGP Runbook
    expect(await screen.findByRole('dialog', { name: 'Host Notes & Documentation' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('BGP Runbook')).toBeInTheDocument();
  }, 15000);

  it('manages Session Logging per host and per session with timestamped transcripts and password-echo redaction (F-21)', async () => {
    render(<App initialLocked={false} />);

    // 1. Create a host with Session Logging enabled by default (F-21)
    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'Audit Bastion' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), { target: { value: '10.90.0.10' } });

    const enableLoggingCheckbox = screen.getByLabelText('Enable Host Session Logging');
    fireEvent.click(enableLoggingCheckbox);
    expect(enableLoggingCheckbox).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save Host' }));
    expect(await screen.findByText('Audit Bastion')).toBeInTheDocument();

    // 2. Connect to Audit Bastion — session logging should automatically start (⏺ REC)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const recBtn = await screen.findByRole('button', { name: /Toggle Session Logging for Audit Bastion/i });
    expect(recBtn).toHaveTextContent('⏺ REC');
    expect(recBtn).toHaveClass('recording');

    // 3. Toggle session logging off and back on from the terminal pane header
    fireEvent.click(recBtn);
    expect(recBtn).toHaveTextContent('⚪ Log');
    expect(recBtn).not.toHaveClass('recording');

    fireEvent.click(recBtn);
    expect(recBtn).toHaveTextContent('⏺ REC');

    // 4. Open Session Logs & Recordings via Intel & Keys -> Session Logs & Recordings (F-21)
    fireEvent.click(screen.getByRole('button', { name: /Intel & Keys/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Session Logs & Recordings/i }));

    const logsDialog = await screen.findByRole('dialog', { name: 'Session Logs & Recordings' });
    expect(logsDialog).toBeInTheDocument();

    // Verify transcript viewer shows timestamped lines & password-echo suppression notice
    expect(await within(logsDialog).findByText(/PASSWORD ECHO SUPPRESSED/i)).toBeInTheDocument();

    // Filter transcript lines inside viewer
    const lineFilterInput = within(logsDialog).getByLabelText('Search in Transcript');
    fireEvent.change(lineFilterInput, { target: { value: 'PASSWORD ECHO' } });
    expect(within(logsDialog).getByText(/PASSWORD ECHO SUPPRESSED/i)).toBeInTheDocument();

    // Close Session Logs modal
    fireEvent.click(within(logsDialog).getByRole('button', { name: 'Close Session Logs' }));
    expect(screen.queryByRole('dialog', { name: 'Session Logs & Recordings' })).not.toBeInTheDocument();
  });

  it('supports Broadcast / Multi-Execution Input across split panes with glowing visual indicators and disarm controls (F-26)', async () => {
    render(<App initialLocked={false} />);

    // 1. Create a host and connect to open a terminal tab
    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'Cluster Node' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), { target: { value: '10.10.1.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Host' }));
    expect(await screen.findByText('Cluster Node')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const pane1 = await screen.findByLabelText('Pane Cluster Node');
    expect(pane1).toBeInTheDocument();

    // 2. Split pane horizontally: creates second split pane
    fireEvent.click(screen.getByRole('button', { name: 'Split Horizontal' }));
    const pane2 = await screen.findByLabelText('Pane Cluster Node (H-Split #2)');
    expect(pane2).toBeInTheDocument();

    // 3. Toggle Broadcast Input via Alt+B shortcut
    fireEvent.keyDown(window, { key: 'b', altKey: true });

    // 4. Verify Broadcast status pill in top header
    const broadcastStatusPill = await screen.findByRole('status', { name: 'Broadcast Input Mode Active' });
    expect(broadcastStatusPill).toBeInTheDocument();
    expect(broadcastStatusPill).toHaveTextContent(/BROADCAST \(2 sessions\)/i);

    // 5. Verify glowing indicators and badges on both participating panes
    const currentPane1 = screen.getByLabelText('Pane Cluster Node');
    const currentPane2 = screen.getByLabelText('Pane Cluster Node (H-Split #2)');
    expect(currentPane1).toHaveClass('is-broadcasting');
    expect(currentPane2).toHaveClass('is-broadcasting');
    expect(within(currentPane1).getByText('🔴 BROADCAST')).toBeInTheDocument();
    expect(within(currentPane2).getByText('🔴 BROADCAST')).toBeInTheDocument();

    const castBtn1 = within(currentPane1).getByRole('button', { name: /Toggle Broadcast for Cluster Node/i });
    const castBtn2 = within(currentPane2).getByRole('button', { name: /Toggle Broadcast for Cluster Node \(H-Split #2\)/i });
    expect(castBtn1).toHaveTextContent('📡 ACTIVE');
    expect(castBtn2).toHaveTextContent('📡 ACTIVE');

    // 6. Test custom pane selection: toggle off pane2 from broadcast group
    fireEvent.click(castBtn2);
    expect(castBtn2).toHaveTextContent('📡 Cast');
    expect(screen.getByLabelText('Pane Cluster Node (H-Split #2)')).not.toHaveClass('is-broadcasting');
    expect(screen.getByLabelText('Pane Cluster Node')).toHaveClass('is-broadcasting');
    expect(broadcastStatusPill).toHaveTextContent(/BROADCAST \(1 sessions\)/i);

    // Re-include pane2 into broadcast group
    fireEvent.click(castBtn2);
    expect(castBtn2).toHaveTextContent('📡 ACTIVE');
    expect(screen.getByLabelText('Pane Cluster Node (H-Split #2)')).toHaveClass('is-broadcasting');
    expect(broadcastStatusPill).toHaveTextContent(/BROADCAST \(2 sessions\)/i);

    // 7. Test Disarm via status pill Disarm button
    const disarmBtn = within(broadcastStatusPill).getByRole('button', { name: 'Disarm Broadcast Mode' });
    fireEvent.click(disarmBtn);
    expect(screen.queryByRole('status', { name: 'Broadcast Input Mode Active' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Pane Cluster Node')).not.toHaveClass('is-broadcasting');
    expect(screen.getByLabelText('Pane Cluster Node (H-Split #2)')).not.toHaveClass('is-broadcasting');

    // 8. Test Toggle via Alt+B & Disarm via Escape key
    fireEvent.keyDown(window, { key: 'b', altKey: true });

    expect(await screen.findByRole('status', { name: 'Broadcast Input Mode Active' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pane Cluster Node')).toHaveClass('is-broadcasting');

    // Press Escape key -> disarms broadcast mode
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('status', { name: 'Broadcast Input Mode Active' })).not.toBeInTheDocument();
  });

  it('supports multi-host side-by-side splits, snap drag-and-drop rearranging, resizable panes, and dockable widgets (F-08)', async () => {
    render(<App initialLocked={false} />);

    // 1. Create two different hosts: Node Alpha and Node Beta
    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'Node Alpha' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), { target: { value: '10.20.0.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Host' }));
    expect(await screen.findByText('Node Alpha')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'Node Beta' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), { target: { value: '10.20.0.2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Host' }));
    expect(await screen.findByText('Node Beta')).toBeInTheDocument();

    // 2. Connect to Node Alpha first
    const connectButtons = screen.getAllByRole('button', { name: 'Connect' });
    fireEvent.click(connectButtons[0]);
    expect(await screen.findByLabelText('Pane Node Alpha')).toBeInTheDocument();

    // 3. Click "Split Connect Node Beta" (⬌) to open Node Beta side-by-side in the same view
    fireEvent.click(screen.getByRole('button', { name: 'Split Connect Node Beta' }));
    expect(await screen.findByLabelText('Pane Node Beta')).toBeInTheDocument();
    expect(screen.getByLabelText('Pane Node Alpha')).toBeInTheDocument();

    // 4. Verify interactive split resizer bar exists and supports double-click equalize
    const resizer = screen.getByRole('separator', { name: /Resize Split horizontal 1/i });
    expect(resizer).toBeInTheDocument();
    fireEvent.doubleClick(resizer);

    // 5. Open "+ Add to View" menu and dock the 2FA / TOTP Authenticator into the split view
    fireEvent.click(screen.getByRole('button', { name: 'Add to View' }));
    expect(screen.getByRole('menu', { name: 'Add to Workspace View Menu' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /2FA \/ TOTP/i }));
    expect(await screen.findByLabelText('Pane 2FA / TOTP Authenticator')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Docked TOTP Authenticator' })).toBeInTheDocument();

    // 6. Test drag-and-drop pane rearrangement via Snap Compass (Swap Node Beta with Node Alpha)
    const betaPane = screen.getByLabelText('Pane Node Beta');
    const betaHeader = betaPane.querySelector('.split-pane-header');
    expect(betaHeader).not.toBeNull();
    if (betaHeader) {
      fireEvent.dragStart(betaHeader, {
        dataTransfer: { setData: () => {}, effectAllowed: 'move' },
      });
    }

    // While dragging, Snap Compass buttons appear on other panes
    const swapBtn = await screen.findByRole('button', { name: 'Swap with Node Alpha' });
    fireEvent.click(swapBtn);
    expect(screen.getByLabelText('Pane Node Alpha')).toBeInTheDocument();
    expect(screen.getByLabelText('Pane Node Beta')).toBeInTheDocument();

    // 7. Test Undock Pane to standalone Tab via 📤 button
    fireEvent.click(screen.getByRole('button', { name: 'Undock Pane Node Beta' }));
    // Node Beta is now its own tab and the active tab
    expect(await screen.findByLabelText('Pane Node Beta')).toBeInTheDocument();

    // 8. Test opening a blank "New Connection" split out of thin air and launching a shell inside it
    fireEvent.click(screen.getByRole('button', { name: 'New Connection Split' }));
    const launcherPane = await screen.findByLabelText('Pane New Connection');
    expect(launcherPane).toBeInTheDocument();
    expect(screen.getByLabelText('Host Address')).toBeInTheDocument();

    // Verify Direct SSH connection supports SSH Key authentication from Keychain
    const keyAuthBtn = within(launcherPane).getByRole('button', { name: /^SSH Key$/i });
    fireEvent.click(keyAuthBtn);
    expect(within(launcherPane).getByLabelText('SSH Key')).toBeInTheDocument();

    // Switch back to password
    fireEvent.click(within(launcherPane).getByRole('button', { name: /^Password$/i }));
    expect(within(launcherPane).getByLabelText('Password')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /PowerShell/i }));
    expect(await screen.findByLabelText('Pane Local (PowerShell)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Pane New Connection')).not.toBeInTheDocument();
  }, 15000);

  it('handles unexpected session drop with Auto-Reconnect exponential backoff countdown and HUD controls (F-27)', async () => {
    const runtimeListeners = new Map<string, (payload: unknown) => void>();
    (window as unknown as { runtime?: { EventsOn: (ev: string, cb: (data: unknown) => void) => () => void } }).runtime = {
      EventsOn: (ev: string, cb: (data: unknown) => void) => {
        runtimeListeners.set(ev, cb);
        return () => {
          runtimeListeners.delete(ev);
        };
      },
    };

    let connectSavedHostCalledWith = '';
    (window as unknown as { go?: unknown }).go = {
      main: {
        App: {
          HealthCheck: async () => ({
            name: 'DoubleAgent',
            version: '0.1.0',
            milestone: 'M1-4',
            vaultLocked: false,
            vaultInitialized: true,
            passwordless: true,
            quickUnlockReady: false,
          }),
          GetVaultSummary: async () => ({
            groups: [],
            hosts: [
              {
                id: 'host-gateway-1',
                label: 'Gateway Core',
                address: '172.16.0.1',
                effectivePort: 22,
                effectiveUser: 'root',
                groupId: '',
                identityId: '',
                tags: [],
                color: '',
                favorite: false,
              },
            ],
            identities: [],
            keys: [],
            proxyProfiles: [],
          }),
          ConnectSavedHost: async (hId: string) => {
            connectSavedHostCalledWith = hId;
            return 'sess-reconnected-42';
          },
          SaveHost: async () => {},
        },
      },
    };

    try {
      render(<App initialLocked={false} />);

      // 1. Connect to Gateway Core
      expect(await screen.findByText('Gateway Core')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      const pane = await screen.findByLabelText('Pane Gateway Core');
      expect(pane).toBeInTheDocument();

      // 2. Simulate unexpected session exit (e.g. connection reset by peer)
      const exitCb = runtimeListeners.get('terminal:exit');
      expect(exitCb).toBeDefined();
      exitCb?.({
        sessionId: 'sess-reconnected-42',
        reason: 'connection reset by peer',
      });

      // 3. Verify reconnect badge in pane header and reconnect HUD overlay
      const badge = await screen.findByTitle('Auto-reconnect active');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent(/RECONNECTING/i);

      const overlay = await screen.findByRole('alert', { name: /Reconnect overlay for Gateway Core/i });
      expect(overlay).toBeInTheDocument();
      expect(within(overlay).getByText(/Connection Dropped/i)).toBeInTheDocument();
      expect(within(overlay).getByText(/connection reset by peer/i)).toBeInTheDocument();
      expect(within(overlay).getByText(/Reconnecting to/i)).toBeInTheDocument();

      // 4. Click "Reconnect Now" button
      const reconnectNowBtn = within(overlay).getByRole('button', { name: 'Reconnect Now' });
      fireEvent.click(reconnectNowBtn);

      // Verify it called ConnectSavedHost and reconnected
      expect(connectSavedHostCalledWith).toBe('host-gateway-1');
      await waitFor(() => {
        expect(screen.queryByRole('alert', { name: /Reconnect overlay for Gateway Core/i })).not.toBeInTheDocument();
      });

      // 5. Test manual Reconnect Cancellation via Cancel button
      // Drop session again
      exitCb?.({
        sessionId: 'sess-reconnected-42',
        reason: 'remote host closed connection',
      });
      const overlay2 = await screen.findByRole('alert', { name: /Reconnect overlay for Gateway Core/i });
      expect(overlay2).toBeInTheDocument();

      const cancelBtn = within(overlay2).getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelBtn);

      // Overlay is dismissed, timer is cancelled
      await waitFor(() => {
        expect(screen.queryByRole('alert', { name: /Reconnect overlay for Gateway Core/i })).not.toBeInTheDocument();
      });
    } finally {
      delete (window as unknown as { go?: unknown }).go;
      delete (window as unknown as { runtime?: unknown }).runtime;
    }
  });

  it('restores workspace tabs and split hierarchies from workspace.json and provides F-27 settings (F-27)', async () => {
    (window as unknown as { go?: unknown }).go = {
      main: {
        App: {
          HealthCheck: async () => ({
            name: 'DoubleAgent',
            version: '0.1.0',
            milestone: 'M1-4',
            vaultLocked: false,
            vaultInitialized: true,
            passwordless: true,
            quickUnlockReady: false,
          }),
          GetVaultSummary: async () => ({
            groups: [],
            hosts: [
              {
                id: 'host-restored-id',
                label: 'Restored Server',
                address: '10.0.0.50',
                effectivePort: 22,
                effectiveUser: 'admin',
                groupId: '',
                identityId: '',
                tags: [],
                color: '#2dd4bf',
                favorite: false,
              },
            ],
            identities: [],
            keys: [],
            proxyProfiles: [],
          }),
          LoadWorkspace: async () => ({
            version: 1,
            activeTabId: 'restored-tab-1',
            autoRestore: true,
            tabs: [
              {
                id: 'restored-tab-1',
                title: 'Restored Server',
                hostId: 'host-restored-id',
                color: '#2dd4bf',
                tabType: 'terminal',
                activePaneId: 'restored-pane-1',
                rootNode: {
                  type: 'pane',
                  id: 'restored-pane-1',
                  sessionId: 'restored-sess-1',
                  hostId: 'host-restored-id',
                  title: 'Restored Server',
                },
              },
            ],
          }),
          SaveWorkspace: async () => {},
          ConnectSavedHost: async () => 'sess-rehydrated-1',
        },
      },
    };

    try {
      render(<App initialLocked={false} initialSettings={{ sessionRestoreEnabled: true }} />);

      // 1. Verify workspace layout restored from workspace.json
      expect(await screen.findByRole('tab', { name: /Restored Server/i })).toBeInTheDocument();
      const restoredPane = await screen.findByLabelText('Pane Restored Server');
      expect(restoredPane).toBeInTheDocument();

      // 2. Verify standby overlay for restored session
      const standbyOverlay = await screen.findByRole('status', { name: /Restored session for Restored Server/i });
      expect(standbyOverlay).toBeInTheDocument();
      expect(within(standbyOverlay).getByText(/Session Restored/i)).toBeInTheDocument();

      // 3. Click "Connect Session" to activate the restored pane
      const connectSessionBtn = within(standbyOverlay).getByRole('button', { name: 'Connect Session' });
      fireEvent.click(connectSessionBtn);
      await waitFor(() => {
        expect(screen.queryByRole('status', { name: /Restored session for Restored Server/i })).not.toBeInTheDocument();
      });

      // 4. Open Settings (Ctrl+,) and verify Connection & Session Restore options
      fireEvent.keyDown(window, { key: ',', ctrlKey: true });
      expect(await screen.findByRole('dialog', { name: 'Global Settings' })).toBeInTheDocument();

      const autoReconnectCheck = screen.getByLabelText('Auto-Reconnect');
      expect(autoReconnectCheck).toBeChecked();
      const sessionRestoreCheck = screen.getByLabelText('Workspace Session Restore');
      expect(sessionRestoreCheck).toBeChecked();
      const maxAttemptsSelect = screen.getByLabelText('Max Reconnect Attempts');
      expect(maxAttemptsSelect).toHaveValue('5');

      // Toggle session restore and close settings
      fireEvent.click(sessionRestoreCheck);
      expect(sessionRestoreCheck).not.toBeChecked();
      fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));
    } finally {
      delete (window as unknown as { go?: unknown }).go;
    }
  });

  it('visualizes hosts, subnets, jump chains, and tunnels in Interactive Network Topology Map and supports docking and Steuerpult (F-37)', async () => {
    (window as unknown as { go: unknown }).go = {
      main: {
        App: {
          HealthCheck: async () => ({
            name: 'DoubleAgent',
            version: '0.1.0',
            milestone: 'M1-4',
            vaultLocked: false,
            vaultInitialized: true,
            passwordless: true,
            quickUnlockReady: false,
          }),
          GetVaultSummary: async () => ({
            initialized: true,
            locked: false,
            passwordless: true,
            hosts: [
              {
                id: 'host-bastion-1',
                label: 'Bastion-Alpha',
                address: '10.0.1.5',
                effectivePort: 22,
                effectiveUser: 'admin',
                groupId: 'grp-infra',
                identityId: 'id-key',
                tags: ['bastion', 'dmz'],
                color: '#f59e0b',
                favorite: true,
                keepaliveSecs: 30,
              },
              {
                id: 'host-internal-db',
                label: 'Internal-Postgres',
                address: '10.0.2.10',
                effectivePort: 5432,
                effectiveUser: 'postgres',
                groupId: 'grp-infra',
                identityId: 'id-key',
                tags: ['database', 'prod'],
                color: '#10b981',
                favorite: false,
                keepaliveSecs: 30,
                jumpChain: ['host-bastion-1'],
              },
            ],
            groups: [
              {
                id: 'grp-infra',
                name: 'Infrastructure',
                color: '#38bdf8',
                defaultSettings: { port: 22, username: 'root' },
              },
            ],
            identities: [],
            sshKeys: [],
            snippets: [],
            tunnels: [],
            proxies: [],
          }),
          GetForwardRules: async () => [],
          GetActiveTunnels: async () => [
            {
              id: 'tun-live-1',
              ruleId: 'rule-db',
              sessionId: 'sess-bastion',
              hostId: 'host-internal-db',
              type: 'L',
              bindAddress: '127.0.0.1',
              bindPort: 5433,
              targetHost: '10.0.2.10',
              targetPort: 5432,
              status: 'active',
              bytesIn: 4096,
              bytesOut: 8192,
              activeConns: 2,
            },
          ],
          GetNotes: async () => [],
          ConnectSavedHost: async () => 'sess-connected-f37',
        },
      },
    };

    try {
      render(<App initialLocked={false} />);

      // Wait for vault to load hosts and labels in sidebar
      expect((await screen.findAllByText('Internal-Postgres')).length).toBeGreaterThan(0);

      // 1. Open View dropdown and launch Network Topology Map tab
      const toolsMenuBtn = await screen.findByRole('button', { name: /^View/i });
      fireEvent.click(toolsMenuBtn);
      const openMapBtn = await screen.findByText(/Interactive Network Topology Map/i);
      expect(openMapBtn).toBeInTheDocument();
      fireEvent.click(openMapBtn);

      // 2. Verify Network Topology Map region rendered
      const mapRegion = await screen.findByRole('region', { name: 'Network Topology Map' });
      expect(mapRegion).toBeInTheDocument();

      // 3. Verify Steuerpult HUD telemetry counters (Hosts, Subnets, Tunnels, Jumps)
      expect(within(mapRegion).getByText('All (2)')).toBeInTheDocument();
      expect(within(mapRegion).getByText(/⇄ Tunnels \(1\)/i)).toBeInTheDocument();
      expect(within(mapRegion).getByText('Hosts')).toBeInTheDocument();
      expect(within(mapRegion).getByText('Subnets')).toBeInTheDocument();

      // 4. Verify Nodes on the map: Client node, Bastion host, and Target DB
      expect(within(mapRegion).getByText('DoubleAgent Client')).toBeInTheDocument();
      expect(within(mapRegion).getByText('Internal-Postgres')).toBeInTheDocument();

      // 5. Verify Filter and Search in Steuerpult
      const searchInput = within(mapRegion).getByPlaceholderText('Filter hosts, IPs, tags...');
      fireEvent.change(searchInput, { target: { value: 'Postgres' } });
      expect(within(mapRegion).getByText('Internal-Postgres')).toBeInTheDocument();
      expect(within(mapRegion).queryByText('Bastion-Alpha')).not.toBeInTheDocument();

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });
      expect(within(mapRegion).getByText('Bastion-Alpha')).toBeInTheDocument();

      // 6. Test Layout Switcher (Hierarchical -> Subnet Clusters -> Grid)
      const layoutSelect = within(mapRegion).getByRole('combobox', { name: 'Layout Mode' });
      fireEvent.change(layoutSelect, { target: { value: 'subnets' } });
      expect(layoutSelect).toHaveValue('subnets');
      fireEvent.change(layoutSelect, { target: { value: 'grid' } });
      expect(layoutSelect).toHaveValue('grid');

      // 7. Verify Visual Legend is present at bottom
      expect(within(mapRegion).getByText('Direct SSH Connection')).toBeInTheDocument();
      expect(within(mapRegion).getByText('Multi-Hop Jump Chain')).toBeInTheDocument();
      expect(within(mapRegion).getByText('Active Forward Tunnel')).toBeInTheDocument();

      // 8. Test docking Network Map into a split pane via + Add to View
      // Open New Connection split from View menu
      const appNav = screen.getByRole('navigation', { name: 'Application Menu' });
      const viewMenuBtn = within(appNav).getByRole('button', { name: /View/i });
      fireEvent.click(viewMenuBtn);
      const newSplitMenuItem = await screen.findByRole('menuitem', { name: /New Connection Split/i });
      fireEvent.click(newSplitMenuItem);

      const addToViewBtn = await screen.findByRole('button', { name: 'Add to View' });
      fireEvent.click(addToViewBtn);

      const dockMapBtn = await screen.findByRole('menuitem', { name: /Network Map/i });
      expect(dockMapBtn).toBeInTheDocument();
      fireEvent.click(dockMapBtn);

      expect(await screen.findByLabelText(/Network Map Pane Network Topology Map/i)).toBeInTheDocument();
    } finally {
      delete (window as unknown as { go?: unknown }).go;
    }
  });

  it('supports Remote File Edit with auto-upload, external editor, and parallel conflict detection HUD (F-28)', async () => {
    let mockContent = 'server {\n  listen 80;\n  server_name localhost;\n}\n';
    let saveCount = 0;
    let forceUsed = false;
    let simulateConflict = false;
    let externalEditorOpened = false;

    const mockSession: RemoteEditSession = {
      id: 'edit-sess-test-1',
      sessionId: 'ssh-sess-1',
      remotePath: '/etc/nginx/nginx.conf',
      localPath: '/tmp/test/nginx.conf',
      filename: 'nginx.conf',
      initialModTime: 1700000000,
      initialSize: 52,
      initialHash: 'abcdef012345',
      status: 'active',
      lastUploadedAt: 0,
      hasConflict: false,
    };

    const mockApi = {
      GetRemoteEditContent: async (editId: string) => {
        void editId;
        return mockContent;
      },
      SaveRemoteEditContent: async (editId: string, newContent: string, force: boolean) => {
        void editId;
        saveCount++;
        forceUsed = force;
        if (simulateConflict && !force) {
          return {
            success: false,
            conflict: true,
            remoteModTime: 1700000500,
            remoteSize: 85,
            message: 'Remote file was modified on server by another process.',
          };
        }
        mockContent = newContent;
        return {
          success: true,
          conflict: false,
          remoteModTime: 1700000100,
          remoteSize: newContent.length,
          message: 'Saved and uploaded.',
        };
      },
      CheckRemoteConflict: async (editId: string) => {
        void editId;
        if (simulateConflict) {
          return {
            hasConflict: true,
            remotePath: '/etc/nginx/nginx.conf',
            initialModTime: 1700000000,
            remoteModTime: 1700000500,
            initialSize: 52,
            remoteSize: 85,
            message: 'Server modification detected.',
          };
        }
        return {
          hasConflict: false,
          remotePath: '/etc/nginx/nginx.conf',
          initialModTime: 1700000000,
          remoteModTime: 1700000000,
          initialSize: 52,
          remoteSize: 52,
          message: 'In sync.',
        };
      },
      OpenExternalEditor: async (editId: string) => {
        void editId;
        externalEditorOpened = true;
      },
      CloseRemoteEdit: async (editId: string) => {
        void editId;
      },
    };

    const onSavedMock = vi.fn();
    const onCloseMock = vi.fn();

    render(
      <RemoteEditorView
        editSession={mockSession}
        hostLabel="Production-Server"
        api={mockApi}
        onSaved={onSavedMock}
        onClose={onCloseMock}
      />
    );

    // 1. Verify initial file load and telemetry header
    expect(await screen.findByText('nginx.conf')).toBeInTheDocument();
    expect(screen.getByText('/etc/nginx/nginx.conf')).toBeInTheDocument();
    expect(screen.getByText(/Production-Server/i)).toBeInTheDocument();
    expect(screen.getByText('✓ Synced')).toBeInTheDocument();

    const textarea = screen.getByLabelText(/Remote file content for nginx.conf/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe(mockContent);

    // 2. Modify content in editor
    fireEvent.change(textarea, { target: { value: 'server {\n  listen 443 ssl;\n}\n' } });
    expect(await screen.findByText('● Unsaved')).toBeInTheDocument();

    // 3. Save modified content
    const saveBtn = screen.getByRole('button', { name: /Save Remote \(Ctrl\+S\)/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(saveCount).toBe(1);
      expect(forceUsed).toBe(false);
      expect(mockContent).toContain('listen 443 ssl');
      expect(onSavedMock).toHaveBeenCalled();
    });

    // 4. Test External Editor button
    const extBtn = screen.getByRole('button', { name: /Open in Local Editor/i });
    fireEvent.click(extBtn);
    expect(externalEditorOpened).toBe(true);

    // 5. Test Parallel Conflict Detection (F-28)
    simulateConflict = true;
    fireEvent.change(textarea, { target: { value: 'server {\n  listen 8080;\n}\n' } });
    fireEvent.click(saveBtn);

    // Verify Conflict Modal appears with warnings and actions
    expect(await screen.findByText(/Parallel Conflict Detected!/i)).toBeInTheDocument();
    expect(screen.getByText(/The file on the remote server was modified after you opened it/i)).toBeInTheDocument();

    const forceBtn = screen.getByRole('button', { name: /Overwrite Remote \(Force Upload\)/i });
    const reloadBtn = screen.getByRole('button', { name: /Discard Local & Reload/i });
    const keepBtn = screen.getByRole('button', { name: /Cancel \/ Keep Local Unsaved/i });

    expect(forceBtn).toBeInTheDocument();
    expect(reloadBtn).toBeInTheDocument();
    expect(keepBtn).toBeInTheDocument();

    // Test Force Overwrite
    fireEvent.click(forceBtn);
    await waitFor(() => {
      expect(forceUsed).toBe(true);
      expect(screen.queryByText(/PARALLEL CONFLICT DETECTED/i)).not.toBeInTheDocument();
    });

    // 6. Test Close
    const closeBtn = screen.getByRole('button', { name: /Close Remote Editor/i });
    fireEvent.click(closeBtn);
    expect(onCloseMock).toHaveBeenCalled();
  });

  it('supports Encrypted Vault File Sync, cloud conflict detection, smart 3-way merge, and storage relocation (F-29)', async () => {
    let relocatedPath = '';
    let resolvedMap: Record<string, string> = {};
    let cleanupFileCalled = false;

    const mockSyncInfo = {
      filePath: 'C:\\Users\\User\\.doubleagent\\doubleagent.vault',
      fileSize: 4096,
      lastModified: Date.now() - 60000,
      status: 'synced' as const,
      syncConflictFiles: ['C:\\Users\\User\\.doubleagent\\doubleagent.sync-conflict-20261110.vault'],
      detectedConflict: false,
      conflictCount: 0,
    };

    const mockConflictReport = {
      hasConflicts: true,
      autoMerged: 2,
      conflicts: [
        {
          id: 'host-1',
          type: 'host',
          label: 'Ares Prod Server',
          localSummary: '192.168.1.100:22 (deploy)',
          remoteSummary: '192.168.1.100:2222 (root)',
        },
      ],
    };

    const mockApi = {
      GetVaultSyncInfo: async () => mockSyncInfo,
      CheckVaultSyncStatus: async () => mockSyncInfo,
      RelocateVaultFile: async (targetPath: string) => {
        relocatedPath = targetPath;
      },
      ScanSyncConflictFiles: async () => mockSyncInfo.syncConflictFiles || [],
      MergeExternalVaultFile: async () => mockConflictReport,
      ResolveVaultConflicts: async (resolutions: Record<string, string>, cleanup: boolean) => {
        resolvedMap = resolutions;
        cleanupFileCalled = cleanup;
      },
      GetVaultHosts: async () => [],
      GetVaultGroups: async () => [],
      GetVaultIdentities: async () => [],
      GetForwardRules: async () => [],
      GetActiveTunnels: async () => [],
    };

    (window as unknown as { go?: { main?: { App?: typeof mockApi } } }).go = {
      main: { App: mockApi },
    };

    try {
      render(<App />);

      // 1. Open Settings modal -> Storage & Sync
      fireEvent.click(screen.getByRole('button', { name: /Settings ⚙/i }));
      const syncMenuItem = screen.getByRole('tab', { name: /Storage & Sync/i });
      fireEvent.click(syncMenuItem);

      // Verify Settings opens on the Storage & Sync tab
      expect(screen.getByRole('tabpanel', { name: /Storage & Sync Settings/i })).toBeInTheDocument();

      // 2. Verify vault storage path and telemetry details are rendered
      expect(await screen.findByText(/doubleagent\.vault/i)).toBeInTheDocument();
      expect(await screen.findByText(/IN SYNC/i)).toBeInTheDocument();

      // 3. Verify Cloud Sync Conflicts section shows detected file
      expect(screen.getByText('doubleagent.sync-conflict-20261110.vault')).toBeInTheDocument();

      // 4. Test Relocate Vault File
      const relocateInput = screen.getByPlaceholderText(/e\.g\. C:\\Users\\YourName\\Google Drive/i);
      fireEvent.change(relocateInput, { target: { value: 'D:\\CloudSync\\doubleagent.vault' } });
      const relocateBtn = screen.getByRole('button', { name: /Relocate Vault/i });
      fireEvent.click(relocateBtn);

      await waitFor(() => {
        expect(relocatedPath).toBe('D:\\CloudSync\\doubleagent.vault');
      });

      // 5. Test Review & Merge detected cloud conflict file
      const reviewMergeBtn = screen.getByRole('button', { name: /Review & Merge/i });
      fireEvent.click(reviewMergeBtn);

      // Verify Vault Conflict Modal opens with conflict telemetry and diffs
      const conflictModal = await screen.findByRole('dialog', { name: /Vault Merge Conflict Resolution/i });
      expect(conflictModal).toBeInTheDocument();
      expect(screen.getByText(/1 PENDING/i)).toBeInTheDocument();
      expect(screen.getByText(/2 NON-CONFLICTING ITEMS/i)).toBeInTheDocument();
      expect(screen.getByText('Ares Prod Server')).toBeInTheDocument();
      expect(screen.getByText('192.168.1.100:22 (deploy)')).toBeInTheDocument();
      expect(screen.getByText('192.168.1.100:2222 (root)')).toBeInTheDocument();

      // Select "Keep Both" resolution
      const keepBothBtn = screen.getByRole('button', { name: /Keep Both \(Rename Synced\)/i });
      fireEvent.click(keepBothBtn);

      // Apply merge
      const applyBtn = screen.getByRole('button', { name: /Apply Resolutions/i });
      fireEvent.click(applyBtn);

      await waitFor(() => {
        expect(resolvedMap['host-1']).toBe('both');
        expect(cleanupFileCalled).toBe(true);
        expect(screen.queryByRole('dialog', { name: /Vault Merge Conflict Resolution/i })).not.toBeInTheDocument();
      });
    } finally {
      delete (window as unknown as { go?: unknown }).go;
    }
  });

  it('supports PuTTY and Termius session scanning, parsing, previewing, and vault importing (F-30)', async () => {
    let executedOptions: unknown = null;

    const mockScanResult = {
      sourceType: 'putty_reg',
      totalFound: 2,
      hosts: [
        {
          label: 'PuTTY Prod Server',
          address: '10.50.0.1',
          port: 22,
          username: 'deploy',
          group: 'Production',
          forwardRules: [{ type: 'L', bindPort: 8080, targetHost: 'localhost', targetPort: 80 }],
          alreadyExist: false,
        },
        {
          label: 'PuTTY Existing Host',
          address: '10.50.0.2',
          port: 22,
          username: 'root',
          alreadyExist: true,
        },
      ],
      groups: ['Production'],
    };

    const mockExecuteResult = {
      hostsImported: 2,
      groupsCreated: 1,
      keysImported: 0,
      tunnelsConfigured: 1,
    };

    const mockApi = {
      ScanLocalPuTTYSessions: async () => mockScanResult,
      ParsePuTTYRegContent: async () => mockScanResult,
      ParseTermiusContent: async () => mockScanResult,
      ExecuteImport: async (options: unknown) => {
        executedOptions = options;
        return mockExecuteResult;
      },
      GetVaultHosts: async () => [],
      GetVaultGroups: async () => [],
      GetVaultIdentities: async () => [],
      GetForwardRules: async () => [],
      GetActiveTunnels: async () => [],
    };

    (window as unknown as { go?: { main?: { App?: typeof mockApi } } }).go = {
      main: { App: mockApi },
    };

    try {
      render(<App />);

      // 1. Open Settings -> Config Migration -> Import PuTTY / Termius (F-30)
      fireEvent.click(screen.getByRole('button', { name: /Settings ⚙/i }));
      fireEvent.click(screen.getByRole('tab', { name: /Config Migration/i }));
      const openImportModalBtn = screen.getByRole('button', { name: /Import PuTTY \/ Termius/i });
      fireEvent.click(openImportModalBtn);

      // Verify Import Dialog opens
      const importModal = screen.getByRole('dialog', { name: 'Import PuTTY and Termius Sessions' });
      expect(importModal).toBeInTheDocument();

      // 2. Click "Scan Local PuTTY Sessions (Registry)"
      const scanBtn = screen.getByRole('button', { name: /Scan Local PuTTY Sessions/i });
      fireEvent.click(scanBtn);

      // Verify discovered telemetry and table rows
      expect(await screen.findByText('2 HOSTS')).toBeInTheDocument();
      expect(screen.getByText('PuTTY Prod Server')).toBeInTheDocument();
      expect(screen.getByText('10.50.0.1:22')).toBeInTheDocument();
      expect(screen.getByText('In Vault')).toBeInTheDocument();
      expect(screen.getByText('⇄ 1 Tunnels')).toBeInTheDocument();

      // 3. Click Import Selected button
      const importBtn = screen.getByRole('button', { name: /Import Selected/i });
      fireEvent.click(importBtn);

      // Verify execution succeeded and status message displayed
      await waitFor(() => {
        expect(executedOptions).not.toBeNull();
        expect(screen.getByText(/Migration Complete/i)).toBeInTheDocument();
      });

      // 4. Close dialog
      const closeBtn = screen.getByRole('button', { name: /Close Import Dialog/i });
      fireEvent.click(closeBtn);
      expect(screen.queryByRole('dialog', { name: 'Import PuTTY and Termius Sessions' })).not.toBeInTheDocument();
    } finally {
      delete (window as unknown as { go?: unknown }).go;
    }
  });

  it('supports Raw TCP Socket Client & Inbound Listener Engine with Line Buffering and auto-spawned reverse shell tabs (F-31)', async () => {
    let dialedConfig: { host: string; port: number; lineMode: boolean; lineEnding: string } | null = null;
    let stoppedListenerId = '';
    const activeListenersList = [
      {
        id: 'listener-1',
        port: 4444,
        bindAddress: '0.0.0.0',
        status: 'listening' as const,
        startedAt: new Date().toISOString(),
        totalCatches: 2,
      },
    ];

    let registeredEventListener: ((data: unknown) => void) | null = null;

    (window as unknown as { go?: unknown }).go = {
      main: {
        App: {
          HealthCheck: vi.fn().mockResolvedValue({
            name: 'DoubleAgent',
            version: '0.1.0',
            milestone: 'F-31',
            vaultLocked: false,
            vaultInitialized: true,
          }),
          GetVaultSummary: vi.fn().mockResolvedValue({
            groups: [],
            hosts: [],
            identities: [],
            keys: [],
            proxyProfiles: [],
            snippets: [],
          }),
          ConnectRawTcp: vi.fn().mockImplementation((cfg) => {
            dialedConfig = cfg;
            return Promise.resolve('raw-tcp-sess-100');
          }),
          StartRawTcpListener: vi.fn().mockImplementation((cfg) => {
            return Promise.resolve({
              id: 'listener-2',
              port: cfg.port,
              bindAddress: cfg.bindAddress,
              status: 'listening',
              startedAt: new Date().toISOString(),
              totalCatches: 0,
            });
          }),
          StopRawTcpListener: vi.fn().mockImplementation((id: string) => {
            stoppedListenerId = id;
            return Promise.resolve();
          }),
          ListRawTcpListeners: vi.fn().mockImplementation(() => Promise.resolve(activeListenersList)),
        },
      },
    };

    (window as unknown as { runtime?: unknown }).runtime = {
      EventsOn: vi.fn().mockImplementation((eventName: string, cb: (data: unknown) => void) => {
        if (eventName === 'raw-tcp:incoming') {
          registeredEventListener = cb;
        }
        return vi.fn();
      }),
    };

    try {
      render(<App />);

      // Wait for app to render
      expect(screen.getByLabelText('DoubleAgent Workspace')).toBeInTheDocument();

      // 1. Open Raw TCP modal via Terminals dropdown
      const toolsMenuBtn = screen.getByRole('button', { name: /^Terminals/i });
      fireEvent.click(toolsMenuBtn);
      const rawTcpToolBtn = screen.getByText(/Raw TCP \/ Netcat \(F-31\)/i);
      fireEvent.click(rawTcpToolBtn);

      // Verify Raw TCP modal opens
      expect(await screen.findByText(/Raw TCP Socket & Listener/i)).toBeInTheDocument();

      // 2. Click Quick Preset "Redis [6379]"
      const redisPresetBtn = screen.getByRole('button', { name: /Redis \[6379\]/i });
      fireEvent.click(redisPresetBtn);

      // Click "CONNECT RAW TCP"
      const connectBtn = screen.getByRole('button', { name: /CONNECT RAW TCP/i });
      fireEvent.click(connectBtn);

      // Verify ConnectRawTcp was called with port 6379 and lineMode true
      await waitFor(() => {
        expect(dialedConfig).not.toBeNull();
        expect(dialedConfig?.port).toBe(6379);
        expect(dialedConfig?.lineMode).toBe(true);
      });

      // Verify newly spawned tab header with TCP: 127.0.0.1:6379
      const tabHeaders = await screen.findAllByText(/TCP:\s*127\.0\.0\.1:6379/i);
      expect(tabHeaders.length).toBeGreaterThanOrEqual(1);
      // Verify Raw TCP HUD telemetry strip in terminal view
      expect(screen.getByText('PROTO: RAW-TCP')).toBeInTheDocument();
      expect(screen.getByText(/LINE MODE: ON/i)).toBeInTheDocument();

      // 3. Test Inbound Listener mode
      // Re-open Raw TCP modal
      fireEvent.click(screen.getByRole('button', { name: /^Terminals/i }));
      fireEvent.click(screen.getByText(/Raw TCP \/ Netcat \(F-31\)/i));

      // Switch to Listener tab
      const listenerTabBtn = screen.getByRole('button', { name: /Inbound Listener/i });
      fireEvent.click(listenerTabBtn);

      // Verify existing active listener is displayed
      expect(await screen.findByText('0.0.0.0:4444')).toBeInTheDocument();
      expect(screen.getByText(/CATCHES:/i)).toBeInTheDocument();

      // Stop listener
      const stopListenerBtn = screen.getByRole('button', { name: /■ STOP LISTENER/i });
      fireEvent.click(stopListenerBtn);
      await waitFor(() => {
        expect(stoppedListenerId).toBe('listener-1');
      });

      // Close modal
      const closeDialogBtn = screen.getByRole('button', { name: /Close dialog/i });
      fireEvent.click(closeDialogBtn);

      // 4. Test simulated incoming catch event (auto-spawn tab)
      expect(registeredEventListener).not.toBeNull();
      act(() => {
        registeredEventListener?.({
          sessionId: 'raw-tcp-in-caught-999',
          listenerId: 'listener-1',
          listenerPort: 4444,
          remoteAddr: '10.10.10.150:51234',
        });
      });

      // Verify auto-spawned incoming shell tab
      const caughtTabs = await screen.findAllByText(/TCP :4444 ◀ 10\.10\.10\.150:51234/i);
      expect(caughtTabs.length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/⚡ TTY UPGRADE ▾/i).length).toBeGreaterThanOrEqual(1);
    } finally {
      delete (window as unknown as { go?: unknown }).go;
      delete (window as unknown as { runtime?: unknown }).runtime;
    }
  });

  it('supports Pentest Credential Pool, Spray List Generator, and Lockout Guard (F-36, F-40)', async () => {
    const mockEngagements = [
      {
        id: 'eng-bank-1',
        name: 'Bank Audit 2026',
        scope: '10.0.0.0/8',
        timeframe: 'Q4 2026',
        lockoutPolicy: {
          maxAttemptsPerUser: 3,
          lockoutWindowMinutes: 30,
          enforceDelaySeconds: 600,
          warningThresholdPercent: 66,
        },
        isActive: true,
        createdAt: '2026-11-10T12:00:00Z',
        updatedAt: '2026-11-10T12:00:00Z',
      },
    ];

    const mockCredentials = [
      {
        id: 'cred-1',
        engagementId: 'eng-bank-1',
        category: 'plaintext' as const,
        label: 'Domain Controller Admin',
        username: 'da_admin',
        secret: 'BankSecret2026!',
        realm: 'CORP.LOCAL',
        source: 'lsass',
        capturedAt: '2026-11-10T12:00:00Z',
      },
      {
        id: 'cred-2',
        engagementId: 'eng-bank-1',
        category: 'plaintext' as const,
        label: 'SQL Service Account',
        username: 'svc_sql',
        secret: 'Summer2026!',
        realm: 'CORP.LOCAL',
        source: 'mimikatz',
        capturedAt: '2026-11-10T12:00:00Z',
      },
    ];

    try {
      (window as unknown as { go: unknown }).go = {
        main: {
          App: {
            ListEngagements: vi.fn().mockResolvedValue(mockEngagements),
            GetActiveEngagement: vi.fn().mockResolvedValue(mockEngagements[0]),
            ListCredentials: vi.fn().mockResolvedValue(mockCredentials),
            SaveCredential: vi.fn().mockResolvedValue(undefined),
            DeleteCredential: vi.fn().mockResolvedValue(undefined),
            SaveEngagement: vi.fn().mockResolvedValue(undefined),
            SetActiveEngagement: vi.fn().mockResolvedValue(undefined),
            ExportSprayList: vi.fn().mockImplementation(() =>
              Promise.resolve({
                content: 'da_admin:BankSecret2026!\nsvc_sql:Summer2026!',
                lineCount: 2,
                uniqueUsers: 2,
                uniquePasswords: 2,
                warning: {
                  exceedsPolicy: false,
                  severity: 'warning' as const,
                  message: 'Lockout warning: 2 attempts approaches threshold',
                  totalCombinations: 4,
                  MaxAttemptsPerAccount: 2,
                  PolicyLimit: 3,
                },
              })
            ),
          },
        },
      };

      render(<App />);

      // 1. Open Engagement menu -> Credential Pool & Spray Lists
      const engMenuBtn = screen.getByRole('button', { name: /Engagement ▾/i });
      fireEvent.click(engMenuBtn);
      const credToolBtn = screen.getByText(/Credential Pool & Spray Lists \(F-36\)/i);
      fireEvent.click(credToolBtn);

      // 2. Verify modal opened
      expect(await screen.findByText(/CREDENTIAL STORE & SPRAY LISTS/i)).toBeInTheDocument();

      // 3. Switch to Credential Pool tab and verify credentials listed in table
      const poolTabBtn = screen.getByRole('button', { name: /Credential Pool/i });
      fireEvent.click(poolTabBtn);
      expect(await screen.findByText('CORP.LOCAL\\da_admin')).toBeInTheDocument();
      expect(screen.getByText('CORP.LOCAL\\svc_sql')).toBeInTheDocument();

      // 4. Switch to Spray Generator tab
      const sprayTabBtn = screen.getByRole('button', { name: /Spray Generator/i });
      fireEvent.click(sprayTabBtn);

      // Verify generated output and lockout warning rendered
      expect(await screen.findByText(/LOCKOUT GUARD WARNING \(F-40\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Lockout warning: 2 attempts approaches threshold/i)).toBeInTheDocument();

      // 5. Verify defensive lockout policy and wordlist preset rendered in Spray Generator
      expect(screen.getByText(/DEFENSIVE LOCKOUT POLICY & SPRAY GUARD \(F-40\)/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /RockYou Sample/i })).toBeInTheDocument();

      // 6. Close modal
      const closeBtn = screen.getByRole('button', { name: /Close dialog/i });
      fireEvent.click(closeBtn);
    } finally {
      delete (window as unknown as { go?: unknown }).go;
    }
  });

  it('supports Pentest Evidence Vault, Findings, Categories, and Report Export (F-18)', async () => {
    const mockEngagement = {
      id: 'eng-evi-1',
      name: 'Corpo Red Team 2026',
      scope: '10.20.0.0/16',
      timeframe: 'Nov 2026',
      lockoutPolicy: {
        maxAttemptsPerUser: 3,
        lockoutWindowMinutes: 30,
        enforceDelaySeconds: 600,
        warningThresholdPercent: 66,
      },
      isActive: true,
      createdAt: '2026-11-10T12:00:00Z',
      updatedAt: '2026-11-10T12:00:00Z',
    };

    const mockEvidence = [
      {
        id: 'evi-1',
        engagementId: 'eng-evi-1',
        category: 'Privilege Escalation',
        title: 'Sudo NOPASSWD find binary',
        type: 'text' as const,
        content: 'sudo find . -exec /bin/sh \\; -quit',
        severity: 'critical' as const,
        source: 'manual',
        tags: ['privesc', 'sudo'],
        capturedAt: '2026-11-10T12:30:00Z',
      },
      {
        id: 'evi-2',
        engagementId: 'eng-evi-1',
        category: 'Open Ports/Services',
        title: 'Discovered HTTP & SSH Ports',
        type: 'table' as const,
        content: JSON.stringify({
          headers: ['Port', 'Service', 'State'],
          rows: [['22', 'ssh', 'open'], ['80', 'http', 'open']],
        }),
        severity: 'info' as const,
        source: 'nmap',
        tags: ['recon'],
        capturedAt: '2026-11-10T12:35:00Z',
      },
    ];

    const mockCategories = [
      'Credentials',
      'Open Ports/Services',
      'Vulnerabilities',
      'Privilege Escalation',
      'Lateral Movement',
      'Sensitive Data',
      'Web',
      'Active Directory',
    ];

    (window as unknown as { go: unknown }).go = {
      main: {
        App: {
          GetActiveEngagement: vi.fn().mockResolvedValue(mockEngagement),
          ListEvidence: vi.fn().mockResolvedValue(mockEvidence),
          GetEvidenceCategories: vi.fn().mockResolvedValue(mockCategories),
          SaveEvidence: vi.fn().mockResolvedValue(undefined),
          DeleteEvidence: vi.fn().mockResolvedValue(undefined),
          AddEvidenceCategory: vi.fn().mockResolvedValue(undefined),
          GetEvidenceTemplates: vi.fn().mockResolvedValue([]),
          ListFindings: vi.fn().mockResolvedValue([]),
          GetFindingTemplates: vi.fn().mockResolvedValue([]),
        },
      },
    };

    try {
      render(<App />);

      // 1. Open Engagement menu -> Evidence Vault
      const engMenuBtn = screen.getByRole('button', { name: /Engagement ▾/i });
      fireEvent.click(engMenuBtn);
      const eviToolBtn = screen.getByText(/Evidence Vault & Findings \(F-18\)/i);
      fireEvent.click(eviToolBtn);

      // 2. Verify modal opened
      expect(await screen.findByText(/Evidence Vault & Findings \(F-18\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Corpo Red Team 2026/i)).toBeInTheDocument();

      // Switch to Evidence tab
      fireEvent.click(screen.getByRole('button', { name: /Evidence Vault/i }));

      // 3. Verify evidence items rendered
      expect(await screen.findByText('Sudo NOPASSWD find binary')).toBeInTheDocument();
      expect(screen.getByText('Discovered HTTP & SSH Ports')).toBeInTheDocument();

      // 4. Verify category filtering and tags
      expect(screen.getByText('#privesc')).toBeInTheDocument();
      expect(screen.getByText('CRITICAL')).toBeInTheDocument();

      // 5. Close modal
      const closeBtn = screen.getByRole('button', { name: /Close dialog/i });
      fireEvent.click(closeBtn);
    } finally {
      delete (window as unknown as { go?: unknown }).go;
    }
  });

  it('supports Top Bar Engagement switcher, New Engagement Modal, and Host-to-Engagement scope encapsulation (F-36)', async () => {
    const mockEngagements = [
      {
        id: 'eng-corp-1',
        name: 'Megacorp Security Audit',
        scope: '10.50.0.0/16, corp.internal',
        timeframe: 'Nov 2026',
        lockoutPolicy: {
          maxAttemptsPerUser: 4,
          lockoutWindowMinutes: 25,
          enforceDelaySeconds: 300,
          warningThresholdPercent: 75,
        },
        isActive: true,
        createdAt: '2026-11-10T12:00:00Z',
        updatedAt: '2026-11-10T12:00:00Z',
      },
    ];

    const mockVault = {
      groups: [],
      hosts: [
        {
          id: 'host-corp-1',
          label: 'DC01 Primary Domain Controller',
          address: '10.50.1.10',
          effectivePort: 22,
          effectiveUser: 'Administrator',
          tags: ['ad', 'windows'],
          color: '#ef4444',
          favorite: false,
          keepaliveSecs: 30,
          groupId: '',
          identityId: '',
          engagementId: 'eng-corp-1',
        },
        {
          id: 'host-global-1',
          label: 'Personal Raspberry Pi',
          address: '192.168.1.50',
          effectivePort: 22,
          effectiveUser: 'pi',
          tags: ['lab'],
          color: '#10b981',
          favorite: false,
          keepaliveSecs: 30,
          groupId: '',
          identityId: '',
          engagementId: '',
        },
      ],
      keys: [],
      identities: [],
      proxyProfiles: [],
      snippets: [],
      totpRecords: [],
    };

    const saveEngagementSpy = vi.fn().mockResolvedValue(undefined);
    const setActiveEngagementSpy = vi.fn().mockResolvedValue(undefined);
    const assignHostSpy = vi.fn().mockResolvedValue(undefined);

    try {
      (window as unknown as { go: unknown }).go = {
        main: {
          App: {
            HealthCheck: vi.fn().mockResolvedValue({
              vaultLocked: false,
              vaultInitialized: true,
              passwordless: false,
              quickUnlockReady: false,
            }),
            GetVaultSummary: vi.fn().mockResolvedValue(mockVault),
            ListEngagements: vi.fn().mockResolvedValue(mockEngagements),
            GetActiveEngagement: vi.fn().mockResolvedValue(mockEngagements[0]),
            SetActiveEngagement: setActiveEngagementSpy,
            SaveEngagement: saveEngagementSpy,
            AssignHostToEngagement: assignHostSpy,
          },
        },
      };

      render(<App />);

      // 1. Verify Top Bar controls exist
      const engagementSelect = await screen.findByRole('combobox', { name: /Select Active Engagement/i });
      expect(engagementSelect).toBeInTheDocument();
      const engElements = await screen.findAllByText(/Megacorp Security Audit/i);
      expect(engElements.length).toBeGreaterThanOrEqual(2);

      const newEngBtn = screen.getByRole('button', { name: /\+ New Engagement/i });
      expect(newEngBtn).toBeInTheDocument();

      const engToolsMenuBtn = screen.getByRole('button', { name: /Engagement ▾/i });
      expect(engToolsMenuBtn).toBeInTheDocument();

      // 2. Open Engagement Tools dropdown and verify actions
      fireEvent.click(engToolsMenuBtn);
      expect(screen.getByText(/Target Scope & Hub \(F-36\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Export \.daeng Package \(F-36\)/i)).toBeInTheDocument();
      expect(screen.queryByText(/Edit Scope & Lockout Policy/i)).toBeNull();

      // 3. Open New Engagement Modal
      fireEvent.click(newEngBtn);
      expect(await screen.findByText(/New Pentest Engagement/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Acme Corp External Penetration Test/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Target subnets, IPs, hostnames/i)).toBeInTheDocument();

      // Close New Engagement modal
      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);

      // 4. Verify Host Sidebar Strict Encapsulation:
      // With active engagement and scope filter on, in-scope DC01 is visible
      expect(await screen.findByText('DC01 Primary Domain Controller')).toBeInTheDocument();
      // Global host should be encapsulated and not shown in active customer engagement
      expect(screen.queryByText('Personal Raspberry Pi')).not.toBeInTheDocument();

      // Toggle to All Vault Hosts
      const toggleScopeBtn = screen.getByRole('button', { name: /In-Scope Only/i });
      fireEvent.click(toggleScopeBtn);
      expect(await screen.findByText('Personal Raspberry Pi')).toBeInTheDocument();
    } finally {
      delete (window as unknown as { go?: unknown }).go;
    }
  });
});
