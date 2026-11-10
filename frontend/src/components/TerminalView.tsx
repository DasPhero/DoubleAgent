import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';

import { CustomShortcutItem } from '../types/shortcuts';

export interface AppGlobalSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
  scrollback: number;
  colorTheme: 'teal' | 'dracula' | 'one-dark' | 'nord' | 'monokai' | 'crimson';
  // Keyboard Shortcuts & Leader Key (F-18 / Roadmap)
  keybindings?: Record<string, string>;
  leaderKeyEnabled?: boolean;
  leaderKey?: string;
  leaderTimeoutMs?: number;
  customShortcuts?: CustomShortcutItem[];
  // Auto-Reconnect & Session Restore (F-27)
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  sessionRestoreEnabled?: boolean;
}

export const DEFAULT_SETTINGS: AppGlobalSettings = {
  fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
  fontSize: 14,
  lineHeight: 1.2,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  colorTheme: 'teal',
  keybindings: {},
  leaderKeyEnabled: false,
  leaderKey: 'Ctrl+B',
  leaderTimeoutMs: 2000,
  customShortcuts: [],
  autoReconnect: true,
  maxReconnectAttempts: 5,
  sessionRestoreEnabled: false,
};

export function getThemeColors(theme: string) {
  switch (theme) {
    case 'dracula':
      return {
        background: '#282a36',
        foreground: '#f8f8f2',
        cursor: '#bd93f9',
        selectionBackground: '#44475a',
        black: '#21222c',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#f8f8f2',
      };
    case 'one-dark':
      return {
        background: '#21252b',
        foreground: '#abb2bf',
        cursor: '#61afef',
        selectionBackground: '#3e4451',
        black: '#1e2127',
        red: '#e06c75',
        green: '#98c379',
        yellow: '#e5c07b',
        blue: '#61afef',
        magenta: '#c678dd',
        cyan: '#56b6c2',
        white: '#abb2bf',
      };
    case 'nord':
      return {
        background: '#2e3440',
        foreground: '#d8dee9',
        cursor: '#88c0d0',
        selectionBackground: '#434c5e',
        black: '#3b4252',
        red: '#bf616a',
        green: '#a3be8c',
        yellow: '#ebcb8b',
        blue: '#81a1c1',
        magenta: '#b48ead',
        cyan: '#88c0d0',
        white: '#e5e9f0',
      };
    case 'monokai':
      return {
        background: '#2d2a2e',
        foreground: '#fcfcfa',
        cursor: '#ffd866',
        selectionBackground: '#403e41',
        black: '#403e41',
        red: '#ff6188',
        green: '#a9dc76',
        yellow: '#ffd866',
        blue: '#fc9867',
        magenta: '#ab9df2',
        cyan: '#78dce8',
        white: '#fcfcfa',
      };
    case 'crimson':
      return {
        background: '#180b0e',
        foreground: '#fecaca',
        cursor: '#f43f5e',
        selectionBackground: '#451a1e',
        black: '#1a0d10',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#ec4899',
        cyan: '#06b6d4',
        white: '#f3f4f6',
      };
    case 'teal':
    default:
      return {
        background: '#0f1117',
        foreground: '#e2e8f0',
        cursor: '#38bdf8',
        selectionBackground: '#334155',
        black: '#0f1117',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#38bdf8',
        magenta: '#c084fc',
        cyan: '#2dd4bf',
        white: '#f1f5f9',
      };
  }
}

interface PoolEntry {
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  unicode11Addon: Unicode11Addon;
  wrapper: HTMLDivElement;
  currentFontSize: number;
  dataDisposable: { dispose: () => void };
  resizeDisposable: { dispose: () => void };
}

const terminalPool = new Map<string, PoolEntry>();
const inputCallbacks = new Map<string, (data: string) => void>();
const resizeCallbacks = new Map<string, (cols: number, rows: number) => void>();
const sessionCwdMap = new Map<string, string>();

export function getSessionCwd(sessionId: string): string | undefined {
  return sessionCwdMap.get(sessionId);
}

export function setSessionCwd(sessionId: string, cwd: string): void {
  if (cwd) {
    sessionCwdMap.set(sessionId, cwd);
  }
}

export function parseOsc7Url(url: string): string | null {
  try {
    let clean = url.trim();
    if (!clean.startsWith('file://')) {
      return null;
    }
    clean = clean.slice(7);
    const slashIdx = clean.indexOf('/');
    if (slashIdx !== -1) {
      clean = clean.slice(slashIdx);
    }
    let decoded = decodeURIComponent(clean);
    if (/^\/[a-zA-Z]:/.test(decoded)) {
      decoded = decoded.slice(1);
    }
    return decoded;
  } catch {
    return null;
  }
}

export function getTerminalFontSize(sessionId: string): number {
  return terminalPool.get(sessionId)?.currentFontSize || 14;
}

export function changeTerminalFontSize(sessionId: string, delta: number): number {
  const entry = terminalPool.get(sessionId);
  if (!entry) {
    return 14;
  }
  const current = entry.term.options.fontSize || 14;
  const next = Math.max(8, Math.min(36, current + delta));
  entry.term.options.fontSize = next;
  entry.currentFontSize = next;
  try {
    entry.fitAddon.fit();
  } catch {
    // ignore layout fit error
  }
  return next;
}

export function resetTerminalFontSize(sessionId: string, defaultSize: number): void {
  const entry = terminalPool.get(sessionId);
  if (!entry) {
    return;
  }
  entry.term.options.fontSize = defaultSize;
  entry.currentFontSize = defaultSize;
  try {
    entry.fitAddon.fit();
  } catch {
    // ignore layout fit error
  }
}

export function applySettingsToAllTerminals(settings: AppGlobalSettings): void {
  const themeObj = getThemeColors(settings.colorTheme);
  for (const entry of terminalPool.values()) {
    entry.term.options.fontFamily = settings.fontFamily;
    entry.term.options.cursorStyle = settings.cursorStyle;
    entry.term.options.cursorBlink = settings.cursorBlink;
    entry.term.options.lineHeight = settings.lineHeight;
    entry.term.options.theme = themeObj;
    try {
      entry.fitAddon.fit();
    } catch {
      // ignore
    }
  }
}

export function disposeTerminal(sessionId: string): void {
  const entry = terminalPool.get(sessionId);
  if (entry) {
    try {
      entry.dataDisposable.dispose();
      entry.resizeDisposable.dispose();
      entry.term.dispose();
    } catch {
      // ignore disposal errors
    }
    terminalPool.delete(sessionId);
    inputCallbacks.delete(sessionId);
    resizeCallbacks.delete(sessionId);
    sessionCwdMap.delete(sessionId);
  }
}

export interface TerminalSearchOptions {
  regex?: boolean;
  wholeWord?: boolean;
  caseSensitive?: boolean;
  incremental?: boolean;
}

export function searchTerminalNext(
  sessionId: string,
  query: string,
  options?: TerminalSearchOptions
): boolean {
  const entry = terminalPool.get(sessionId);
  if (!entry || !query) {
    return false;
  }
  return entry.searchAddon.findNext(query, {
    regex: options?.regex,
    wholeWord: options?.wholeWord,
    caseSensitive: options?.caseSensitive,
    incremental: options?.incremental ?? true,
    decorations: {
      matchBackground: '#334155',
      matchBorder: '#64748b',
      matchOverviewRuler: '#38bdf8',
      activeMatchBackground: '#0284c7',
      activeMatchBorder: '#38bdf8',
      activeMatchColorOverviewRuler: '#38bdf8',
    },
  });
}

export function searchTerminalPrevious(
  sessionId: string,
  query: string,
  options?: TerminalSearchOptions
): boolean {
  const entry = terminalPool.get(sessionId);
  if (!entry || !query) {
    return false;
  }
  return entry.searchAddon.findPrevious(query, {
    regex: options?.regex,
    wholeWord: options?.wholeWord,
    caseSensitive: options?.caseSensitive,
    decorations: {
      matchBackground: '#334155',
      matchBorder: '#64748b',
      matchOverviewRuler: '#38bdf8',
      activeMatchBackground: '#0284c7',
      activeMatchBorder: '#38bdf8',
      activeMatchColorOverviewRuler: '#38bdf8',
    },
  });
}

export function clearTerminalSearch(sessionId: string): void {
  const entry = terminalPool.get(sessionId);
  if (entry) {
    try {
      entry.searchAddon.clearDecorations();
    } catch {
      // ignore
    }
  }
}

export interface TerminalViewProps {
  sessionId: string;
  onInput: (sessionId: string, data: string) => void;
  onResize: (sessionId: string, cols: number, rows: number) => void;
  registerWriter?: (sessionId: string, writeFn: (chunk: string) => void) => void;
  registerFocuser?: (sessionId: string, focusFn: () => void) => void;
  settings?: AppGlobalSettings;
  onFontSizeChange?: (sessionId: string, newSize: number) => void;
  onToggleSearch?: (sessionId: string) => void;
  onCwdChange?: (sessionId: string, cwd: string) => void;
  isRawTcp?: boolean;
  rawTcpHost?: string;
  rawTcpPort?: number;
  initialLineMode?: boolean;
  initialLineEnding?: 'crlf' | 'lf' | 'cr';
}

export function TerminalView({
  sessionId,
  onInput,
  onResize,
  registerWriter,
  registerFocuser,
  settings,
  onFontSizeChange,
  onToggleSearch,
  onCwdChange,
  isRawTcp,
  rawTcpHost,
  rawTcpPort,
  initialLineMode,
  initialLineEnding,
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [lineMode, setLineMode] = React.useState(initialLineMode ?? false);
  const [lineEnding, setLineEnding] = React.useState<'crlf' | 'lf' | 'cr'>(initialLineEnding ?? 'crlf');
  const [showTtyMenu, setShowTtyMenu] = React.useState(false);
  const lineBufferRef = useRef('');
  const lineModeRef = useRef(lineMode);
  lineModeRef.current = lineMode;
  const lineEndingRef = useRef(lineEnding);
  lineEndingRef.current = lineEnding;

  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const onFontSizeChangeRef = useRef(onFontSizeChange);
  onFontSizeChangeRef.current = onFontSizeChange;
  const onToggleSearchRef = useRef(onToggleSearch);
  onToggleSearchRef.current = onToggleSearch;
  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;
  const registerWriterRef = useRef(registerWriter);
  registerWriterRef.current = registerWriter;
  const registerFocuserRef = useRef(registerFocuser);
  registerFocuserRef.current = registerFocuser;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    inputCallbacks.set(sessionId, (data: string) => onInputRef.current(sessionId, data));
    resizeCallbacks.set(sessionId, (cols: number, rows: number) => onResizeRef.current(sessionId, cols, rows));

    const cfg = settings || DEFAULT_SETTINGS;
    let entry = terminalPool.get(sessionId);

    if (!entry) {
      const themeColors = getThemeColors(cfg.colorTheme);
      const term = new Terminal({
        cursorBlink: cfg.cursorBlink,
        cursorStyle: cfg.cursorStyle,
        fontFamily: cfg.fontFamily,
        fontSize: cfg.fontSize,
        lineHeight: cfg.lineHeight,
        scrollback: cfg.scrollback,
        allowProposedApi: true,
        theme: themeColors,
      });

      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon({ highlightLimit: 1000 });
      const unicode11Addon = new Unicode11Addon();

      term.loadAddon(fitAddon);
      term.loadAddon(searchAddon);
      term.loadAddon(unicode11Addon);
      term.unicode.activeVersion = '11';

      const wrapper = document.createElement('div');
      wrapper.className = 'xterm-instance-wrapper';
      wrapper.style.width = '100%';
      wrapper.style.height = '100%';
      wrapper.style.overflow = 'hidden';

      try {
        term.open(wrapper);
      } catch {
        // Ignore layout fit / matchMedia errors in headless test environments (jsdom)
      }

      // Prevent Alt+Arrow, Ctrl+K, Ctrl+,, and Ctrl+F from sending raw ANSI escape sequences to the remote terminal,
      // and intercept Ctrl + / - / 0 to zoom font size in the pane
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (
          e.altKey &&
          (e.key === 'ArrowUp' ||
            e.key === 'ArrowDown' ||
            e.key === 'ArrowLeft' ||
            e.key === 'ArrowRight')
        ) {
          return false;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
          return false;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === ',') {
          return false;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          onToggleSearchRef.current?.(sessionId);
          return false;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
          if (term.hasSelection()) {
            const sel = term.getSelection();
            if (sel && navigator.clipboard?.writeText) {
              void navigator.clipboard.writeText(sel);
            }
            return false;
          }
          if (e.shiftKey) {
            return false;
          }
          return true;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
          e.preventDefault();
          if (navigator.clipboard?.readText) {
            void navigator.clipboard.readText().then((text) => {
              if (text) {
                inputCallbacks.get(sessionId)?.(text);
              }
            });
          }
          return false;
        }
        if (
          (e.ctrlKey || e.metaKey) &&
          (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_' || e.key === '0')
        ) {
          e.preventDefault();
          if (e.key === '=' || e.key === '+') {
            const next = changeTerminalFontSize(sessionId, +1);
            onFontSizeChangeRef.current?.(sessionId, next);
          } else if (e.key === '-' || e.key === '_') {
            const next = changeTerminalFontSize(sessionId, -1);
            onFontSizeChangeRef.current?.(sessionId, next);
          } else if (e.key === '0') {
            resetTerminalFontSize(sessionId, cfg.fontSize);
            onFontSizeChangeRef.current?.(sessionId, cfg.fontSize);
          }
          return false;
        }
        return true;
      });

      const dataDisposable = term.onData((data: string) => {
        if (isRawTcp && lineModeRef.current) {
          for (let i = 0; i < data.length; i++) {
            const ch = data[i];
            if (ch === '\r' || ch === '\n') {
              term.write('\r\n');
              let ending = '\r\n';
              if (lineEndingRef.current === 'lf') ending = '\n';
              else if (lineEndingRef.current === 'cr') ending = '\r';
              inputCallbacks.get(sessionId)?.(lineBufferRef.current + ending);
              lineBufferRef.current = '';
            } else if (ch === '\x7f' || ch === '\b') {
              if (lineBufferRef.current.length > 0) {
                lineBufferRef.current = lineBufferRef.current.slice(0, -1);
                term.write('\b \b');
              }
            } else if (ch === '\x03') {
              lineBufferRef.current = '';
              term.write('^C\r\n');
              inputCallbacks.get(sessionId)?.('\x03');
            } else {
              lineBufferRef.current += ch;
              term.write(ch);
            }
          }
        } else {
          inputCallbacks.get(sessionId)?.(data);
        }
      });

      const resizeDisposable = term.onResize(({ cols, rows }) => {
        resizeCallbacks.get(sessionId)?.(cols, rows);
      });

      // OSC 7 Working Directory reporting (F-10)
      try {
        term.parser.registerOscHandler(7, (data: string) => {
          const parsed = parseOsc7Url(data);
          if (parsed) {
            sessionCwdMap.set(sessionId, parsed);
            onCwdChangeRef.current?.(sessionId, parsed);
          }
          return true;
        });
      } catch {
        // Ignore parser registration errors in mock environments
      }

      // Right-click: Copy selection if text is selected, or Paste from clipboard if nothing is selected
      wrapper.addEventListener('contextmenu', (ev: MouseEvent) => {
        ev.preventDefault();
        if (term.hasSelection()) {
          const sel = term.getSelection();
          if (sel && navigator.clipboard?.writeText) {
            void navigator.clipboard.writeText(sel);
          }
        } else {
          if (navigator.clipboard?.readText) {
            void navigator.clipboard.readText().then((text) => {
              if (text) {
                inputCallbacks.get(sessionId)?.(text);
              }
            });
          }
        }
      });

      entry = {
        term,
        fitAddon,
        searchAddon,
        unicode11Addon,
        wrapper,
        currentFontSize: cfg.fontSize,
        dataDisposable,
        resizeDisposable,
      };
      terminalPool.set(sessionId, entry);
    }

    if (entry.wrapper.parentNode !== container) {
      container.appendChild(entry.wrapper);
    }

    const refreshTerminalLayout = () => {
      try {
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          entry?.fitAddon.fit();
          entry?.term.refresh(0, entry.term.rows - 1);
          entry?.term.scrollToBottom();
        }
      } catch {
        // Ignore layout fit error in headless test environment
      }
    };
    refreshTerminalLayout();
    const rafId = requestAnimationFrame(refreshTerminalLayout);
    const timerId = setTimeout(refreshTerminalLayout, 50);

    try {
      entry.term.focus();
    } catch {
      // Ignore in headless test environment
    }

    if (registerWriterRef.current) {
      registerWriterRef.current(sessionId, (chunk: string) => {
        // Golden Rule 2: Terminal output is strictly written to xterm.js, never innerHTML.
        entry?.term.write(chunk);
      });
    }

    if (registerFocuserRef.current) {
      registerFocuserRef.current(sessionId, () => {
        try {
          if (container.clientWidth > 0 && container.clientHeight > 0) {
            entry?.fitAddon.fit();
            entry?.term.refresh(0, entry.term.rows - 1);
            entry?.term.scrollToBottom();
          }
          entry?.term.focus();
        } catch {
          // Ignore in headless test environment
        }
      });
    }

    // Prevent wheel bubbling / scroll chaining to application and support Ctrl+MouseWheel zooming
    const handleWheel = (e: WheelEvent): void => {
      e.stopPropagation();
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1 : -1;
        const next = changeTerminalFontSize(sessionId, delta);
        onFontSizeChangeRef.current?.(sessionId, next);
      }
    };
    container.addEventListener('wheel', handleWheel, { passive: false });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          try {
            entry?.fitAddon.fit();
            entry?.term.scrollToBottom();
          } catch {
            // Ignore layout fit error
          }
        }
      });
      resizeObserver.observe(container);
    }

    const handleWindowResize = (): void => {
      try {
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          entry?.fitAddon.fit();
          entry?.term.scrollToBottom();
        }
      } catch {
        // Ignore in headless test environment
      }
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      window.removeEventListener('resize', handleWindowResize);
      container.removeEventListener('wheel', handleWheel);
      resizeObserver?.disconnect();
      if (entry?.wrapper.parentNode === container) {
        container.removeChild(entry.wrapper);
      }
      // Note: We deliberately do NOT call term.dispose() here so that
      // vertical/horizontal split tree reorganizations and tab switches
      // preserve all buffer data and session logs.
      // Terminals are disposed cleanly via disposeTerminal(sessionId) upon session close.
    };
  }, [sessionId, settings, isRawTcp]);

  return (
    <div
      className="terminal-view-wrapper"
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', position: 'relative' }}
    >
      {isRawTcp && (
        <div className="raw-tcp-hud-bar">
          <div className="raw-tcp-hud-left">
            <span className="raw-tcp-hud-badge">PROTO: RAW-TCP</span>
            {rawTcpHost && (
              <span className="raw-tcp-hud-target">
                {rawTcpHost}:{rawTcpPort}
              </span>
            )}
          </div>
          <div className="raw-tcp-hud-right">
            <button
              type="button"
              className={`raw-tcp-tool-btn ${lineMode ? 'active' : ''}`}
              onClick={() => {
                const next = !lineMode;
                setLineMode(next);
                lineBufferRef.current = '';
              }}
              title="Toggle Line Buffering & Local Echo (essential for HTTP/SMTP/Redis)"
            >
              ⌨ LINE MODE: {lineMode ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              className="raw-tcp-tool-btn"
              onClick={() => {
                const nextEnding = lineEnding === 'crlf' ? 'lf' : lineEnding === 'lf' ? 'cr' : 'crlf';
                setLineEnding(nextEnding);
              }}
              title="Cycle Line Ending Sequence (CRLF / LF / CR)"
            >
              ↵ {lineEnding.toUpperCase()}
            </button>
            <div className="raw-tcp-tty-dropdown-wrap" style={{ position: 'relative' }}>
              <button
                type="button"
                className="raw-tcp-tool-btn tty-upgrade-btn"
                onClick={() => setShowTtyMenu((prev) => !prev)}
                title="Reverse Shell TTY Upgrade Helpers"
              >
                ⚡ TTY UPGRADE ▾
              </button>
              {showTtyMenu && (
                <div className="raw-tcp-tty-menu">
                  <button
                    type="button"
                    onClick={() => {
                      onInputRef.current(sessionId, `python3 -c 'import pty; pty.spawn("/bin/bash")'\n`);
                      setShowTtyMenu(false);
                    }}
                  >
                    🐍 Spawn Python3 PTY
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onInputRef.current(sessionId, `python -c 'import pty; pty.spawn("/bin/bash")'\n`);
                      setShowTtyMenu(false);
                    }}
                  >
                    🐍 Spawn Python PTY
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onInputRef.current(sessionId, `export TERM=xterm-256color\n`);
                      setShowTtyMenu(false);
                    }}
                  >
                    📟 Export TERM=xterm-256color
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onInputRef.current(sessionId, `stty raw -echo; fg\n`);
                      setShowTtyMenu(false);
                    }}
                  >
                    ⚡ Fix stty raw -echo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onInputRef.current(sessionId, `/bin/sh -i\n`);
                      setShowTtyMenu(false);
                    }}
                  >
                    🐚 Spawn /bin/sh -i
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <div
        className="terminal-container"
        data-testid={`terminal-container-${sessionId}`}
        ref={containerRef}
        style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
      />
    </div>
  );
}


