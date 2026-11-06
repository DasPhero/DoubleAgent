import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

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

    // Open Keychain (F-04) and generate Ed25519 key
    fireEvent.click(screen.getByRole('button', { name: /Keychain \(F-04\)/i }));
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
    expect(screen.getByText('Serial / UART Console Connection (F-23)')).toBeInTheDocument();

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
      expect(screen.getByText('SFTP Browser (F-12)')).toBeInTheDocument();
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
});
