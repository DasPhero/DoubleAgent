import React from 'react';

export function App(): React.JSX.Element {
  return (
    <main className="app-shell" aria-label="DoubleAgent Workspace">
      <header className="app-header">
        <h1>DoubleAgent</h1>
        <span className="status-badge">Vault Locked</span>
      </header>
      <section className="empty-state">
        <p>Walking skeleton ready (M0-0). Select or add a host to begin.</p>
      </section>
    </main>
  );
}

