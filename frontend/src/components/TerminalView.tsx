import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';

export interface TerminalViewProps {
  sessionId: string;
  onInput: (sessionId: string, data: string) => void;
  onResize: (sessionId: string, cols: number, rows: number) => void;
  registerWriter?: (sessionId: string, writeFn: (chunk: string) => void) => void;
  registerFocuser?: (sessionId: string, focusFn: () => void) => void;
}

export function TerminalView({
  sessionId,
  onInput,
  onResize,
  registerWriter,
  registerFocuser,
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      fontSize: 14,
      scrollback: 10000,
      allowProposedApi: true,
      theme: {
        background: '#0f1117',
        foreground: '#e2e8f0',
        cursor: '#38bdf8',
        selectionBackground: '#334155',
      },
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const unicode11Addon = new Unicode11Addon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = '11';

    term.open(container);

    try {
      fitAddon.fit();
      term.focus();
    } catch {
      // Ignore layout fit errors in headless test environments (jsdom)
    }

    if (registerWriter) {
      registerWriter(sessionId, (chunk: string) => {
        // Golden Rule 2: Terminal output is strictly written to xterm.js, never innerHTML.
        term.write(chunk);
      });
    }

    if (registerFocuser) {
      registerFocuser(sessionId, () => {
        try {
          term.focus();
        } catch {
          // Ignore in headless test environment
        }
      });
    }

    const dataDisposable = term.onData((data: string) => {
      onInput(sessionId, data);
    });

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      onResize(sessionId, cols, rows);
    });

    const handleWindowResize = (): void => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore in headless test environment
      }
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      term.dispose();
    };
  }, [sessionId, onInput, onResize, registerWriter, registerFocuser]);

  return (
    <div
      className="terminal-container"
      data-testid={`terminal-container-${sessionId}`}
      ref={containerRef}
    />
  );
}

