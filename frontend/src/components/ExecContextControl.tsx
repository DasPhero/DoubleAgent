import React, { useEffect, useRef, useState } from 'react';
import { CyberIcon } from './CyberIcon';
import type { AttachableSshSession, RemoteExecutionContext } from '../types/remoteAgent';

export interface ExecContextControlProps {
  context: RemoteExecutionContext;
  sshSessions: AttachableSshSession[];
  busySessionId: string | null;
  onAttachAgent: (sessionId: string, label: string) => void;
  onSelectContext: (sessionId: string) => void;
  onDetachAgent: (sessionId: string) => void;
  onOpenRemoteShell: () => void;
  onBrowseRemoteDirs: () => void;
}

export const ExecContextControl: React.FC<ExecContextControlProps> = ({
  context,
  sshSessions,
  busySessionId,
  onAttachAgent,
  onSelectContext,
  onDetachAgent,
  onOpenRemoteShell,
  onBrowseRemoteDirs,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const isAgent = context.mode === 'agent' && Boolean(context.activeAgent);
  const activeAgent = context.activeAgent;
  const attachedIds = new Set(context.attachedAgents.map((a) => a.sessionId));
  const attachableSessions = sshSessions.filter((s) => !attachedIds.has(s.sessionId));

  const pillLabel = isAgent && activeAgent
    ? `Agent: ${activeAgent.hostname || activeAgent.label}${activeAgent.primaryIp ? ` (${activeAgent.primaryIp})` : ''}`
    : 'Exec: Local';

  return (
    <div className="nav-menu-container exec-context-control" ref={containerRef}>
      <button
        type="button"
        className={`nav-menu-trigger exec-context-pill ${isAgent ? 'is-agent' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Execution Context"
        onClick={() => setOpen((prev) => !prev)}
        title={
          isAgent && activeAgent
            ? `Remote Companion Agent active on ${activeAgent.hostname} (${activeAgent.os}/${activeAgent.arch})`
            : 'Execution Context: Local Workstation (click to attach to an active Linux SSH session)'
        }
      >
        {isAgent ? (
          <span className="status-led status-led-green" aria-hidden="true" />
        ) : (
          <CyberIcon name="desktop" size={12} />
        )}
        <span className="exec-context-pill-label">{pillLabel}</span>
        <CyberIcon name="chevron-down" size={10} />
      </button>

      {open && (
        <div
          className="nav-dropdown-menu exec-context-menu"
          role="menu"
          aria-label="Execution Context Menu"
        >
          <div className="nav-dropdown-header">EXECUTION CONTEXT</div>

          <button
            type="button"
            className={`nav-dropdown-item ${!isAgent ? 'active-context-item' : ''}`}
            role="menuitem"
            onClick={() => {
              onSelectContext('');
              setOpen(false);
            }}
          >
            <CyberIcon name="desktop" size={13} />
            <span>Local Workstation</span>
            {!isAgent && <CyberIcon name="check" size={12} style={{ marginLeft: 'auto' }} />}
          </button>

          {context.attachedAgents.length > 0 && (
            <>
              <div className="nav-dropdown-divider" />
              <div className="nav-dropdown-header">ATTACHED REMOTE AGENTS</div>
              {context.attachedAgents.map((agent) => (
                <div key={agent.sessionId} className="exec-context-agent-row">
                  <button
                    type="button"
                    className={`nav-dropdown-item exec-context-agent-btn ${agent.active ? 'active-context-item' : ''}`}
                    role="menuitem"
                    onClick={() => {
                      onSelectContext(agent.sessionId);
                      setOpen(false);
                    }}
                  >
                    <span className="status-led status-led-green" aria-hidden="true" />
                    <span className="exec-context-agent-name">
                      {agent.hostname || agent.label}
                      {agent.primaryIp ? ` (${agent.primaryIp})` : ''}
                    </span>
                    {agent.active && <CyberIcon name="check" size={12} style={{ marginLeft: 'auto' }} />}
                  </button>
                  <button
                    type="button"
                    className="exec-context-detach-btn"
                    title={`Detach agent from ${agent.hostname || agent.label}`}
                    aria-label={`Detach ${agent.hostname || agent.label}`}
                    onClick={() => {
                      onDetachAgent(agent.sessionId);
                    }}
                  >
                    <CyberIcon name="close" size={11} />
                  </button>
                </div>
              ))}
            </>
          )}

          {isAgent && activeAgent && (
            <>
              <div className="nav-dropdown-divider" />
              <div className="nav-dropdown-header">REMOTE ACTIONS ({activeAgent.hostname})</div>
              <button
                type="button"
                className="nav-dropdown-item"
                role="menuitem"
                onClick={() => {
                  onOpenRemoteShell();
                  setOpen(false);
                }}
              >
                <CyberIcon name="terminal" size={13} />
                <span>Open Remote Shell ({activeAgent.defaultShell || '/bin/bash'})</span>
              </button>
              <button
                type="button"
                className="nav-dropdown-item"
                role="menuitem"
                onClick={() => {
                  onBrowseRemoteDirs();
                  setOpen(false);
                }}
              >
                <CyberIcon name="folder" size={13} />
                <span>Browse Remote Directories</span>
              </button>
            </>
          )}

          <div className="nav-dropdown-divider" />
          <div className="nav-dropdown-header">ATTACH TO ACTIVE SSH SESSION</div>
          {attachableSessions.length === 0 ? (
            <div className="exec-context-empty">
              Connect to a Linux/Kali SSH host first, then attach the ephemeral agent here.
            </div>
          ) : (
            attachableSessions.map((sess) => {
              const isBusy = busySessionId === sess.sessionId;
              return (
                <button
                  key={sess.sessionId}
                  type="button"
                  className="nav-dropdown-item"
                  role="menuitem"
                  disabled={Boolean(busySessionId)}
                  onClick={() => {
                    onAttachAgent(sess.sessionId, sess.label);
                  }}
                >
                  <CyberIcon name="rocket" size={13} />
                  <span>{isBusy ? `Deploying agent to ${sess.label}...` : `Attach Agent → ${sess.label}`}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
