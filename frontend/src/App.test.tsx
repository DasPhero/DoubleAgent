import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { ForwardRule, ForwardTunnelStatus } from './types/forward';
import { TotpRecord } from './types/totp';

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

    // Create a Group with Port 2222 and Username deploy (F-01)
    fireEvent.click(screen.getByRole('button', { name: /\+ Group/i }));
    fireEvent.change(screen.getByLabelText('Group Name'), { target: { value: 'Production' } });
    fireEvent.change(screen.getByLabelText('Default Group Port'), { target: { value: '2222' } });
    fireEvent.change(screen.getByLabelText('Default Group Username'), {
      target: { value: 'deploy' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Group/i }));

    expect(screen.getByText(/Production/)).toBeInTheDocument();

    // Create a Host in that group inheriting Port 2222 and Username deploy (F-01)
    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'Bastion 01' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), {
      target: { value: '10.10.0.5' },
    });
    const groupSelect = screen.getByLabelText('Host Group') as HTMLSelectElement;
    fireEvent.change(groupSelect, { target: { value: groupSelect.options[1].value } });
    fireEvent.click(screen.getByRole('button', { name: /Save Host/i }));

    expect(screen.getByText('Bastion 01')).toBeInTheDocument();
    expect(screen.getByText('deploy@10.10.0.5:2222')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /Keychain/i }));
    fireEvent.change(screen.getByLabelText('Key Label'), { target: { value: 'Laptop Ed25519' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Keypair/i }));

    expect(screen.getByText(/Laptop Ed25519 \(ed25519\)/i)).toBeInTheDocument();

    // Copy Public Key (F-04)
    fireEvent.click(screen.getByRole('button', { name: /Copy Public Key/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));

    // Open Import ssh_config (F-22)
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
    const vaultMenuBtn = screen.getByRole('button', { name: /Vault ▾/i });
    const toolsMenuBtn = screen.getByRole('button', { name: /Tools ▾/i });
    const viewMenuBtn = screen.getByRole('button', { name: /View ▾/i });

    expect(vaultMenuBtn).toBeInTheDocument();
    expect(toolsMenuBtn).toBeInTheDocument();
    expect(viewMenuBtn).toBeInTheDocument();

    // Open Tools dropdown and trigger Command Palette
    fireEvent.click(toolsMenuBtn);
    expect(screen.getByRole('menu', { name: 'Tools Menu' })).toBeInTheDocument();
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

    // 1. Open Local PowerShell terminal via Hoverable Tools Menu
    const toolsBtn = screen.getByRole('button', { name: /Tools ▾/i });
    fireEvent.mouseEnter(toolsBtn);
    expect(screen.getByRole('menu', { name: 'Tools Menu' })).toBeInTheDocument();

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

    // 3. Open Local Command Prompt (CMD) via Tools Menu
    fireEvent.mouseEnter(toolsBtn);
    const cmdItem = screen.getByRole('menuitem', { name: /Local Shell \(Command Prompt\)/i });
    fireEvent.click(cmdItem);

    expect(screen.getByRole('tab', { name: 'Tab Local (CMD)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pane Local (CMD)')).toBeInTheDocument();

    // 4. Open Serial / UART Console Connection Modal (F-23)
    fireEvent.mouseEnter(toolsBtn);
    const serialItem = screen.getByRole('menuitem', { name: /Serial \/ UART Console \(COM\)/i });
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

    // 1. Open Local Shell (PowerShell) via Tools Menu
    const toolsBtn = screen.getByRole('button', { name: /Tools ▾/i });
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

      // 1. Open Tools -> Proxy Profiles
      const toolsBtn = screen.getByRole('button', { name: /Tools/i });
      fireEvent.click(toolsBtn);
      const profilesMenuItem = screen.getByRole('menuitem', { name: /Proxy Profiles/i });
      fireEvent.click(profilesMenuItem);

      // Verify Proxy Profiles modal is open
      expect(screen.getByText('Proxy Profiles')).toBeInTheDocument();
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

      // 1. Open Tools -> Command Snippets & Variables
      const toolsBtn = screen.getByRole('button', { name: /Tools/i });
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

      // 1. Open Tools menu and click "TOTP Authenticator Generator"
      const toolsBtn = screen.getByRole('button', { name: /Tools/i });
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

      // Close modal
      const closeBtn = screen.getByRole('button', { name: 'Close TOTP Authenticator' });
      fireEvent.click(closeBtn);

      // 5. Connect to host and test terminal 2FA injection button
      const connectBtn = screen.getByRole('button', { name: /^Connect$/i });
      fireEvent.click(connectBtn);

      // Wait for terminal session header to show 2FA button
      const inject2faBtn = await screen.findByRole('button', { name: /🔐 2FA \/ TOTP/i });
      expect(inject2faBtn).toBeInTheDocument();

      fireEvent.click(inject2faBtn);
      expect(injectedSession).toBe('session-bastion-2fa');
      expect(injectedTotpId).toBe('');
      expect(await screen.findByText(/TOTP 2FA code injected into active terminal prompt/i)).toBeInTheDocument();
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

    // 2. Open Host Notes via Tools -> Host Notes & Docs
    fireEvent.click(screen.getByRole('button', { name: /Tools/i }));
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

    fireEvent.click(screen.getByRole('button', { name: /💾 Save Note/i }));

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
    fireEvent.click(screen.getByRole('button', { name: /Tools/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Command Palette/i }));

    const paletteInput = screen.getByLabelText('Command Palette Input');
    fireEvent.change(paletteInput, { target: { value: 'AS65001' } });

    expect(await screen.findByText(/Notes & Documentation/i)).toBeInTheDocument();
    const noteResultBtn = screen.getByRole('button', { name: /BGP Runbook/i });
    fireEvent.click(noteResultBtn);

    // Clicking the Command Palette result opens NotesView focused on BGP Runbook
    expect(await screen.findByRole('dialog', { name: 'Host Notes & Documentation' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('BGP Runbook')).toBeInTheDocument();
  });

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

    // 4. Open Session Logs & Recordings via Tools -> Session Logs & Recordings (F-21)
    fireEvent.click(screen.getByRole('button', { name: /Tools/i }));
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
});
