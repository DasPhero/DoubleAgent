export type ShortcutCategory = 'navigation' | 'terminal' | 'sessions' | 'tools';

export type ShortcutActionId =
  | 'command_palette'
  | 'global_settings'
  | 'toggle_sidebar'
  | 'new_tab'
  | 'close_pane'
  | 'split_horizontal'
  | 'split_vertical'
  | 'cycle_tabs_prev'
  | 'cycle_tabs_next'
  | 'cycle_panes_prev'
  | 'cycle_panes_next'
  | 'find_in_terminal'
  | 'font_zoom_in'
  | 'font_zoom_out'
  | 'font_zoom_reset'
  | 'quick_connect'
  | 'open_default_dir'
  | 'open_current_dir'
  | 'open_root_shell'
  | 'disconnect_active'
  | 'inject_password'
  | 'open_keychain'
  | 'open_tunnels'
  | 'open_snippets'
  | 'open_proxy_profiles'
  | 'open_sftp'
  | 'lock_vault';

export interface ShortcutDefinition {
  actionId: ShortcutActionId;
  label: string;
  description: string;
  category: ShortcutCategory;
  defaultKey: string;
  leaderKey?: string; // Leader chord suffix (e.g. 'c' or 'x')
}

export interface CustomShortcutItem {
  id: string;
  action: string;
  keyCombo: string;
  snippetId?: string;
  snippetName?: string;
}

export const SYSTEM_SHORTCUTS: ShortcutDefinition[] = [
  // Navigation & Tabs
  {
    actionId: 'command_palette',
    label: 'Command Palette & Quick Connect',
    description: 'Open fuzzy finder for hosts, snippets, tunnels, and actions',
    category: 'navigation',
    defaultKey: 'Ctrl+K',
    leaderKey: 'k',
  },
  {
    actionId: 'global_settings',
    label: 'Global Settings',
    description: 'Open settings dialog for appearance, security, and shortcuts',
    category: 'navigation',
    defaultKey: 'Ctrl+,',
    leaderKey: ',',
  },
  {
    actionId: 'toggle_sidebar',
    label: 'Toggle Sidebar',
    description: 'Collapse or expand the left hosts & tools navigation sidebar',
    category: 'navigation',
    defaultKey: 'Ctrl+B',
    leaderKey: 'b',
  },
  {
    actionId: 'new_tab',
    label: 'New Session Tab',
    description: 'Create a new terminal tab',
    category: 'navigation',
    defaultKey: 'Alt+N',
    leaderKey: 'c',
  },
  {
    actionId: 'close_pane',
    label: 'Close Active Pane / Tab',
    description: 'Close the focused split pane or session tab',
    category: 'navigation',
    defaultKey: 'Alt+W',
    leaderKey: 'x',
  },
  {
    actionId: 'split_horizontal',
    label: 'Split Pane Horizontally',
    description: 'Split the current pane horizontally (top and bottom)',
    category: 'navigation',
    defaultKey: 'Alt+H',
    leaderKey: '"',
  },
  {
    actionId: 'split_vertical',
    label: 'Split Pane Vertically',
    description: 'Split the current pane vertically (left and right)',
    category: 'navigation',
    defaultKey: 'Alt+V',
    leaderKey: '%',
  },
  {
    actionId: 'cycle_tabs_prev',
    label: 'Previous Tab',
    description: 'Switch focus to the previous session tab',
    category: 'navigation',
    defaultKey: 'Alt+ArrowLeft',
    leaderKey: 'p',
  },
  {
    actionId: 'cycle_tabs_next',
    label: 'Next Tab',
    description: 'Switch focus to the next session tab',
    category: 'navigation',
    defaultKey: 'Alt+ArrowRight',
    leaderKey: 'n',
  },
  {
    actionId: 'cycle_panes_prev',
    label: 'Previous Split Pane',
    description: 'Switch focus to previous pane within active split layout',
    category: 'navigation',
    defaultKey: 'Alt+ArrowUp',
    leaderKey: 'Up',
  },
  {
    actionId: 'cycle_panes_next',
    label: 'Next Split Pane',
    description: 'Switch focus to next pane within active split layout',
    category: 'navigation',
    defaultKey: 'Alt+ArrowDown',
    leaderKey: 'Down',
  },

  // Terminal & Fonts
  {
    actionId: 'find_in_terminal',
    label: 'Find in Terminal',
    description: 'Open in-terminal search bar with regex and match highlight',
    category: 'terminal',
    defaultKey: 'Ctrl+F',
    leaderKey: 'f',
  },
  {
    actionId: 'font_zoom_in',
    label: 'Zoom In Font Size',
    description: 'Increase terminal font size for the active pane',
    category: 'terminal',
    defaultKey: 'Ctrl+=',
    leaderKey: '+',
  },
  {
    actionId: 'font_zoom_out',
    label: 'Zoom Out Font Size',
    description: 'Decrease terminal font size for the active pane',
    category: 'terminal',
    defaultKey: 'Ctrl+-',
    leaderKey: '-',
  },
  {
    actionId: 'font_zoom_reset',
    label: 'Reset Font Size',
    description: 'Reset active pane terminal font size to global default',
    category: 'terminal',
    defaultKey: 'Ctrl+0',
    leaderKey: '0',
  },

  // Sessions & CWD
  {
    actionId: 'quick_connect',
    label: 'Focus Quick Connect Bar',
    description: 'Focus the quick connect host address input field',
    category: 'sessions',
    defaultKey: 'Alt+Q',
    leaderKey: 'q',
  },
  {
    actionId: 'open_default_dir',
    label: 'New Terminal in Default Dir',
    description: 'Spawn new terminal positioned in host default directory',
    category: 'sessions',
    defaultKey: 'Alt+D',
    leaderKey: 'd',
  },
  {
    actionId: 'open_current_dir',
    label: 'New Terminal in Current Dir',
    description: 'Spawn new terminal positioned in active session CWD (OSC 7)',
    category: 'sessions',
    defaultKey: 'Alt+C',
    leaderKey: 'w',
  },
  {
    actionId: 'open_root_shell',
    label: 'New Elevated Root Shell',
    description: 'Spawn new elevated root terminal session in active CWD',
    category: 'sessions',
    defaultKey: 'Alt+R',
    leaderKey: 'r',
  },
  {
    actionId: 'disconnect_active',
    label: 'Disconnect Active Session',
    description: 'Terminate connection for the focused terminal session',
    category: 'sessions',
    defaultKey: 'Ctrl+Shift+D',
    leaderKey: 'd',
  },
  {
    actionId: 'inject_password',
    label: 'Inject Saved Password',
    description: 'Securely inject stored host password into active terminal',
    category: 'sessions',
    defaultKey: 'Ctrl+Shift+I',
    leaderKey: 'i',
  },

  // Tools & Modals
  {
    actionId: 'open_snippets',
    label: 'Command Snippets Manager',
    description: 'Open snippets library with template variable injection',
    category: 'tools',
    defaultKey: 'Alt+S',
    leaderKey: 's',
  },
  {
    actionId: 'open_tunnels',
    label: 'Port Forwarding & Tunnels',
    description: 'Open port forwarding manager (-L, -R, -D)',
    category: 'tools',
    defaultKey: 'Alt+T',
    leaderKey: 't',
  },
  {
    actionId: 'open_proxy_profiles',
    label: 'Proxy Profiles & ProxyJump',
    description: 'Open proxy profiles and jump chains manager',
    category: 'tools',
    defaultKey: 'Alt+P',
    leaderKey: 'j',
  },
  {
    actionId: 'open_sftp',
    label: 'SFTP File Browser',
    description: 'Open two-column SFTP browser for active host',
    category: 'tools',
    defaultKey: 'Alt+F',
    leaderKey: 'e',
  },
  {
    actionId: 'open_keychain',
    label: 'SSH Keychain',
    description: 'Open SSH keypairs and credentials manager',
    category: 'tools',
    defaultKey: 'Alt+K',
    leaderKey: 'a',
  },
  {
    actionId: 'lock_vault',
    label: 'Lock Vault Immediately',
    description: 'Securely lock encrypted vault and clear credentials from memory',
    category: 'tools',
    defaultKey: 'Ctrl+Shift+L',
    leaderKey: 'l',
  },
];

/**
 * Normalizes a KeyboardEvent into a standard shortcut string representation.
 * Example: 'Ctrl+K', 'Ctrl+Shift+P', 'Alt+ArrowRight'.
 * Returns empty string if only modifier keys were pressed.
 */
export function normalizeKeyboardShortcut(e: KeyboardEvent): string {
  const isModifierOnly =
    e.key === 'Control' ||
    e.key === 'Shift' ||
    e.key === 'Alt' ||
    e.key === 'Meta';
  if (isModifierOnly) return '';

  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey && !e.ctrlKey) parts.push('Meta');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let keyPart = e.key;
  if (keyPart === ' ') {
    keyPart = 'Space';
  } else if (keyPart === 'Escape') {
    keyPart = 'Esc';
  } else if (keyPart.length === 1) {
    keyPart = keyPart.toUpperCase();
  }

  // Handle aliases like '=' for '+'
  if (keyPart === '+') keyPart = '=';

  parts.push(keyPart);
  return parts.join('+');
}

/**
 * Normalizes a shortcut string for consistent comparison.
 */
export function canonicalizeShortcutString(combo: string): string {
  if (!combo) return '';
  const parts = combo
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);

  let hasCtrl = false;
  let hasMeta = false;
  let hasAlt = false;
  let hasShift = false;
  let mainKey = '';

  for (const p of parts) {
    const low = p.toLowerCase();
    if (low === 'ctrl' || low === 'control') hasCtrl = true;
    else if (low === 'meta' || low === 'cmd' || low === 'command') hasMeta = true;
    else if (low === 'alt' || low === 'option') hasAlt = true;
    else if (low === 'shift') hasShift = true;
    else {
      let k = p;
      if (k === ' ' || k.toLowerCase() === 'space') k = 'Space';
      else if (k.toLowerCase() === 'esc' || k.toLowerCase() === 'escape') k = 'Esc';
      else if (k === '+' || k === '=') k = '=';
      else if (k.length === 1) k = k.toUpperCase();
      mainKey = k;
    }
  }

  const result: string[] = [];
  if (hasCtrl) result.push('Ctrl');
  if (hasMeta) result.push('Meta');
  if (hasAlt) result.push('Alt');
  if (hasShift) result.push('Shift');
  if (mainKey) result.push(mainKey);
  return result.join('+');
}

/**
 * Checks whether a KeyboardEvent matches a given shortcut string representation.
 */
export function matchesShortcut(e: KeyboardEvent, targetCombo: string): boolean {
  if (!targetCombo) return false;
  const eventCombo = normalizeKeyboardShortcut(e);
  if (!eventCombo) return false;

  const c1 = canonicalizeShortcutString(eventCombo);
  const c2 = canonicalizeShortcutString(targetCombo);
  return c1 === c2;
}

/**
 * Detects if a candidate shortcut combination conflicts with an existing action.
 */
export function findShortcutConflict(
  keybindings: Record<string, string>,
  currentActionId: string,
  candidateCombo: string
): ShortcutDefinition | null {
  const normCandidate = canonicalizeShortcutString(candidateCombo);
  if (!normCandidate) return null;

  for (const def of SYSTEM_SHORTCUTS) {
    if (def.actionId === currentActionId) continue;
    const activeKey = keybindings[def.actionId] || def.defaultKey;
    if (canonicalizeShortcutString(activeKey) === normCandidate) {
      return def;
    }
  }
  return null;
}
