import React, { useEffect, useRef } from 'react';

export interface TerminalContextMenuProps {
  x: number;
  y: number;
  sessionId: string;
  selectedText: string;
  hostLabel?: string;
  onCopy: () => void;
  onSaveAsCredential: () => void;
  onSaveAsEvidence: () => void;
  onRunInTerminal?: () => void;
  onClose: () => void;
}

export function TerminalContextMenu({
  x,
  y,
  selectedText,
  hostLabel,
  onCopy,
  onSaveAsCredential,
  onSaveAsEvidence,
  onRunInTerminal,
  onClose,
}: TerminalContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on Escape or click outside
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Adjust position to stay strictly inside viewport
  const menuWidth = 260;
  const menuHeight = 220;
  const posX = Math.max(10, Math.min(x, (window.innerWidth || 800) - menuWidth - 10));
  const posY = Math.max(10, Math.min(y, (window.innerHeight || 600) - menuHeight - 10));

  const previewSnippet =
    selectedText.trim().replace(/\s+/g, ' ').slice(0, 32) +
    (selectedText.trim().length > 32 ? '...' : '');

  return (
    <div
      ref={menuRef}
      className="terminal-hud-context-menu"
      role="menu"
      aria-label="Terminal Selection Context Menu"
      style={{
        position: 'fixed',
        left: `${posX}px`,
        top: `${posY}px`,
        width: `${menuWidth}px`,
        zIndex: 100050,
      }}
    >
      <div className="menu-header">
        <span className="cyber-hazard-stripes">///</span>
        <span className="menu-title">TERMINAL CONTEXT (F-19)</span>
      </div>

      <div className="menu-preview-row font-mono" title={selectedText.trim()}>
        <span className="preview-label">SELECTION:</span> &ldquo;{previewSnippet}&rdquo;
      </div>

      {hostLabel && (
        <div className="menu-host-badge font-mono">
          <span>🖥️ {hostLabel}</span>
        </div>
      )}

      <div className="menu-items">
        <button
          type="button"
          className="menu-item-btn"
          role="menuitem"
          onClick={() => {
            onCopy();
            onClose();
          }}
        >
          <span className="item-icon">📋</span>
          <span className="item-label">Copy Selection</span>
          <span className="item-shortcut">Ctrl+C</span>
        </button>

        <button
          type="button"
          className="menu-item-btn highlight-cred"
          role="menuitem"
          onClick={() => {
            onSaveAsCredential();
            onClose();
          }}
        >
          <span className="item-icon">🔑</span>
          <span className="item-label">Save as Credential...</span>
          <span className="item-tag">VAULT</span>
        </button>

        <button
          type="button"
          className="menu-item-btn highlight-ev"
          role="menuitem"
          onClick={() => {
            onSaveAsEvidence();
            onClose();
          }}
        >
          <span className="item-icon">🛡️</span>
          <span className="item-label">Save as Evidence...</span>
          <span className="item-tag">PENTEST</span>
        </button>

        {onRunInTerminal && (
          <button
            type="button"
            className="menu-item-btn"
            role="menuitem"
            onClick={() => {
              onRunInTerminal();
              onClose();
            }}
          >
            <span className="item-icon">⚡</span>
            <span className="item-label">Execute in Terminal</span>
          </button>
        )}

        <div className="menu-divider" />

        <button
          type="button"
          className="menu-item-btn dismiss-btn"
          role="menuitem"
          onClick={onClose}
        >
          <span className="item-icon">✕</span>
          <span className="item-label">Dismiss</span>
          <span className="item-shortcut">Esc</span>
        </button>
      </div>
    </div>
  );
}
