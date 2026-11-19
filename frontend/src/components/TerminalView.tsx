import React, { useEffect, useRef } from 'react';
import { CyberIcon } from './CyberIcon';
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
  colorTheme: 'teal' | 'one-dark' | 'crimson' | 'neon' | 'vice' | 'viper' | 'voltage' | 'plasma';
  // Glass terminal background (shared HUD art behind the whole terminal space)
  terminalBg?: 'none' | 'minimal' | 'grid' | 'pulse' | 'watermark' | 'matrix';
  terminalBgOpacity?: number;
  terminalBgAnimate?: boolean;
  // Low-Latency / RDP Performance Mode (disables blur, glow shadows, animations, and terminal transparency)
  lowLatencyMode?: boolean;
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
  terminalBg: 'none',
  terminalBgOpacity: 0.75,
  terminalBgAnimate: true,
  lowLatencyMode: false,
};

/**
 * Terminal theme. When a glass treatment is active the xterm background is made FULLY
 * transparent (text only) and the translucent "glass" tint is supplied by the pane's CSS
 * (.terminal-bg-wrap.has-bg .split-pane), so it works regardless of xterm's renderer.
 */
export function getTerminalTheme(settings: AppGlobalSettings) {
  const base = getThemeColors(settings.colorTheme);
  const bg = settings.terminalBg ?? 'none';
  if (settings.lowLatencyMode || bg === 'none') {
    return base;
  }
  return { ...base, background: 'rgba(0, 0, 0, 0)' };
}

export function getThemeColors(theme: string) {
  switch (theme) {
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
    case 'crimson':
      return {
        background: '#0d0608',
        foreground: '#fecaca',
        cursor: '#ff2e2e',
        selectionBackground: '#3d1114',
        black: '#1a0a0c',
        red: '#ff2e2e',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#ec4899',
        cyan: '#06b6d4',
        white: '#f3f4f6',
      };
    case 'neon':
      return {
        background: '#0c0718',
        foreground: '#f0e6ff',
        cursor: '#ff2bd6',
        selectionBackground: '#3a1d52',
        black: '#1a0f2e',
        red: '#ff4d6d',
        green: '#3ad6a0',
        yellow: '#ff9e4d',
        blue: '#7c3aed',
        magenta: '#ff2bd6',
        cyan: '#4dd6ff',
        white: '#f0e6ff',
      };
    case 'vice':
      return {
        background: '#07131a',
        foreground: '#d7f5ee',
        cursor: '#2dd4bf',
        selectionBackground: '#133a3a',
        black: '#0a1a1f',
        red: '#fb7185',
        green: '#34d399',
        yellow: '#fde047',
        blue: '#38bdf8',
        magenta: '#ff6ec7',
        cyan: '#2dd4bf',
        white: '#e6fffb',
      };
    case 'viper':
      return {
        background: '#0a0f08',
        foreground: '#d7ffb0',
        cursor: '#aaff00',
        selectionBackground: '#1f3a0a',
        black: '#121a0d',
        red: '#ff5555',
        green: '#39ff14',
        yellow: '#eaff00',
        blue: '#6ee7ff',
        magenta: '#d946ef',
        cyan: '#4dffd0',
        white: '#e8ffd9',
      };
    case 'voltage':
      return {
        background: '#0a0f1c',
        foreground: '#d7e6ff',
        cursor: '#2f9bff',
        selectionBackground: '#16305c',
        black: '#121a2e',
        red: '#ff5c7a',
        green: '#34d399',
        yellow: '#ffe014',
        blue: '#2f9bff',
        magenta: '#c07cff',
        cyan: '#38bdf8',
        white: '#e6efff',
      };
    case 'plasma':
      return {
        background: '#0a0609',
        foreground: '#e6f6fa',
        cursor: '#ff2b4e',
        selectionBackground: '#3a0f16',
        black: '#1a0a0f',
        red: '#ff2b4e',
        green: '#2ee6c0',
        yellow: '#ffd166',
        blue: '#22d3ee',
        magenta: '#ff6ec7',
        cyan: '#22d3ee',
        white: '#e6f6fa',
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

export function getTerminalDimensions(sessionId: string): { cols: number; rows: number } {
  const entry = terminalPool.get(sessionId);
  if (entry?.term) {
    return { cols: entry.term.cols || 120, rows: entry.term.rows || 32 };
  }
  return { cols: 120, rows: 32 };
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
  const themeObj = getTerminalTheme(settings);
  const useTransparency = !settings.lowLatencyMode && (settings.terminalBg ?? 'none') !== 'none';
  for (const entry of terminalPool.values()) {
    entry.term.options.fontFamily = settings.fontFamily;
    entry.term.options.fontSize = settings.fontSize;
    entry.currentFontSize = settings.fontSize;
    entry.term.options.scrollback = settings.scrollback;
    entry.term.options.cursorStyle = settings.cursorStyle;
    entry.term.options.cursorBlink = settings.cursorBlink;
    entry.term.options.lineHeight = settings.lineHeight;
    entry.term.options.allowTransparency = useTransparency;
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
  onSelectionContextMenu?: (e: MouseEvent, sessionId: string, selectedText: string) => void;
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
  onSelectionContextMenu,
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
  const onSelectionContextMenuRef = useRef(onSelectionContextMenu);
  onSelectionContextMenuRef.current = onSelectionContextMenu;
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
      const themeColors = getTerminalTheme(cfg);
      const useTransparency = !cfg.lowLatencyMode && (cfg.terminalBg ?? 'none') !== 'none';
      const term = new Terminal({
        cursorBlink: cfg.cursorBlink,
        cursorStyle: cfg.cursorStyle,
        fontFamily: cfg.fontFamily,
        fontSize: cfg.fontSize,
        lineHeight: cfg.lineHeight,
        scrollback: cfg.scrollback,
        allowProposedApi: true,
        allowTransparency: useTransparency,
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
      // and intercept Ctrl + / - / 0 to zoom font size in the pane.
      // Note: xterm.js invokes attachCustomKeyEventHandler for keydown, keypress, AND keyup,
      // so side effects MUST only run when e.type === 'keydown'.
      let lastClipboardPasteTs = 0;
      wrapper.addEventListener(
        'paste',
        (ev: ClipboardEvent) => {
          if (Date.now() - lastClipboardPasteTs < 250) {
            ev.preventDefault();
            ev.stopPropagation();
          }
        },
        true
      );

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
          if (e.type === 'keydown') {
            onToggleSearchRef.current?.(sessionId);
          }
          return false;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
          if (term.hasSelection()) {
            if (e.type === 'keydown') {
              const sel = term.getSelection();
              if (sel && navigator.clipboard?.writeText) {
                void navigator.clipboard.writeText(sel);
              }
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
          e.stopPropagation();
          if (e.type === 'keydown' && !e.repeat) {
            lastClipboardPasteTs = Date.now();
            if (navigator.clipboard?.readText) {
              void navigator.clipboard.readText().then((text) => {
                if (text) {
                  inputCallbacks.get(sessionId)?.(text);
                }
              });
            }
          }
          return false;
        }
        if (
          (e.ctrlKey || e.metaKey) &&
          (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_' || e.key === '0')
        ) {
          e.preventDefault();
          if (e.type === 'keydown') {
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

      // Right-click: Open Selection Context Menu (F-19) if text is selected, or Paste from clipboard if nothing is selected
      wrapper.addEventListener('contextmenu', (ev: MouseEvent) => {
        ev.preventDefault();
        if (term.hasSelection()) {
          const sel = term.getSelection();
          if (sel && sel.trim().length > 0) {
            if (onSelectionContextMenuRef.current) {
              onSelectionContextMenuRef.current(ev, sessionId, sel);
            } else if (navigator.clipboard?.writeText) {
              void navigator.clipboard.writeText(sel);
            }
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
              <CyberIcon name="keyboard" size={14} /> LINE MODE: {lineMode ? 'ON' : 'OFF'}
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
              <CyberIcon name="return" size={14} /> {lineEnding.toUpperCase()}
            </button>
            <div className="raw-tcp-tty-dropdown-wrap" style={{ position: 'relative' }}>
              <button
                type="button"
                className="raw-tcp-tool-btn tty-upgrade-btn"
                onClick={() => setShowTtyMenu((prev) => !prev)}
                title="Reverse Shell TTY Upgrade Helpers"
              >
                <CyberIcon name="bolt" size={14} /> TTY UPGRADE <CyberIcon name="chevron-down" size={14} />
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
                    <CyberIcon name="terminal" size={14} /> Spawn Python3 PTY
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onInputRef.current(sessionId, `python -c 'import pty; pty.spawn("/bin/bash")'\n`);
                      setShowTtyMenu(false);
                    }}
                  >
                    <CyberIcon name="terminal" size={14} /> Spawn Python PTY
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onInputRef.current(sessionId, `export TERM=xterm-256color\n`);
                      setShowTtyMenu(false);
                    }}
                  >
                    <CyberIcon name="terminal" size={14} /> Export TERM=xterm-256color
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onInputRef.current(sessionId, `stty raw -echo; fg\n`);
                      setShowTtyMenu(false);
                    }}
                  >
                    <CyberIcon name="bolt" size={14} /> Fix stty raw -echo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onInputRef.current(sessionId, `/bin/sh -i\n`);
                      setShowTtyMenu(false);
                    }}
                  >
                    <CyberIcon name="terminal" size={14} /> Spawn /bin/sh -i
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


