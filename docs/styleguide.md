# DoubleAgent HUD & Cyberpunk Styleguide

This document defines the visual design principles, CSS token contract, component patterns, and consistency rules for DoubleAgent's UI ([`frontend/src/styles.css`](../frontend/src/styles.css)). Follow this guide whenever building new components, auditing existing modals, or adding new color themes.

---

## 1. Core Design Philosophy

DoubleAgent is an operator-focused SSH & penetration testing workstation built around **dark obsidian tactical HUDs**, **high signal-to-noise typography**, and **security-state clarity**:

1. **Layered Obsidian Surfaces (Never Flat Black):** Depth comes from dark slate/navy surface steps (`--bg-base` → `--bg-main` → `--bg-panel` → `--bg-card` + translucent `--bg-glass`), accented by subtle `1px` borders, faint top-right radial ambient glow, and hairline `36px` grid lines on core unlocked/locked shells.
2. **State-Driven Security Semiotics (`theme-locked` vs. `theme-unlocked`):**
   - **Locked Vault (`.app-shell.theme-locked`):** Forces the entire UI into a high-alert crimson lockdown theme (`--bg-base: #0f0609`, `--accent-bright: #ff003c`, `--border-accent: rgba(255, 0, 60, 0.45)`), making sealed credentials unmistakable.
   - **Unlocked Vault (`.app-shell.theme-unlocked.theme-<id>`):** Applies the operator's chosen palette seamlessly across chrome, dialogs, badges, and embedded `xterm.js` terminals.
3. **Strict Separation of Theme Accent vs. Semantic Action Colors:**
   - **Theme-Driven Accent Tokens** carry interactive focus, active tabs, headers, borders, primary actions, and telemetry highlights.
   - **Semantic Fixed Accents** keep constant meaning regardless of the active theme so safety cues and muscle memory never break.
4. **Zero Native Grey Chrome & Zero Emojis:** Every button, input, select, header, and badge follows the HUD CSS classes below, and every icon uses monochrome geometric SVGs via [`CyberIcon.tsx`](../frontend/src/components/CyberIcon.tsx).

---

## 2. CSS Custom Property Contract

Core tokens defined in `:root` and overridden by `.app-shell.theme-locked` / `.app-shell.theme-unlocked.theme-*` ([`frontend/src/styles.css`](../frontend/src/styles.css#L1-L90)):

| Token | Role | Default (`teal`) |
| --- | --- | --- |
| `--bg-base` | Outer app shell canvas | `#060913` |
| `--bg-main` | Workspace / pane background | `#080d1a` |
| `--bg-panel` | Sidebar drawers & docked panels | `#0b1224` |
| `--bg-dropdown` | Navigation dropdown menus | `#060b16` |
| `--bg-glass` | Translucent modal / HUD chrome | `rgba(8, 14, 26, 0.96)` |
| `--bg-card` | Cards, command decks, list containers | `#091020` |
| `--border-accent` | Focused inputs, active cards, modal borders | `rgba(0, 240, 255, 0.35)` |
| `--border-subtle` | Inactive dividers & passive card outlines | `rgba(148, 163, 184, 0.16)` |
| `--accent-primary` | Solid primary button / fill anchor | `#0d9488` |
| `--accent-bright` | Glowing borders, HUD titles, active indicators | `#00f0ff` |
| `--accent-glow` | Hover / active ambient glow shadow | `rgba(0, 240, 255, 0.28)` |
| `--accent-text` | High-contrast tinted label text | `#5eead4` |
| `--text-main` | Primary body copy | `#e2e8f0` |
| `--text-muted` | Secondary labels & metadata | `#94a3b8` |

### Semantic Fixed Colors (Theme-Independent)

| Semantic Token / Color | Usage |
| --- | --- |
| **Crimson (`--hud-crimson: #ff003c`, `#ef4444`)** | Locked Vault state, **Cancel**, **Delete**, **Disconnect**, **Stop Server/Listener**, **Reset Defaults** |
| **Amber (`--hud-amber: #ffaa00`, `#f59e0b`)** | OPSEC risk warnings, unprompted execution alerts, **Inject** buttons (`.cyber-btn-inject`), sync conflicts |
| **Emerald (`#10b981`, `#34d399`)** | Active/connected sessions, copied confirmation (`.is-copied`), file present on disk |

> **Audit Rule for Theme Consistency:** Components must reference `var(--accent-bright)`, `var(--accent-glow)`, `var(--accent-primary)`, `var(--accent-text)`, and `var(--border-accent)` instead of hardcoding `#00f0ff` or `rgba(0, 240, 255, ...)` in inline `style` props.

---

## 3. Standard HUD Component Patterns

### Modals & Dialogs
- Backdrop: `.modal-backdrop` / `.cyber-modal-overlay`
- Container: `.cyber-totp-container` / `.cyber-dialog-card` / `.cyber-hud-card` with subtle `1px solid var(--border-accent)` and `2px–4px` sharp corners
- Corner reticles on key HUD overlays:
  ```tsx
  <div className="cyber-corner-reticle cyber-corner-tl" />
  <div className="cyber-corner-reticle cyber-corner-tr" />
  <div className="cyber-corner-reticle cyber-corner-bl" />
  <div className="cyber-corner-reticle cyber-corner-br" />
  ```
- Headers: `.cyber-dialog-header` or `.cyber-totp-hud-header` with hazard-stripe subtag (`/// OPS-TAG // SUBTAG`) and `.cyber-btn-close` using `<CyberIcon name="close" />`.

### Buttons
- **HUD Toolbar / Card Buttons (`.cyber-hud-btn`):**
  - Default obsidian/cyan outline button (`Dock`, `Edit`, `Browse File`, `Browse Folder`, `Config Path`)
  - Compact modifier: `.btn-sm`
  - Primary emphasis: `.btn-primary`
  - Crimson cancel/destructive modifier: `.btn-danger` or `.btn-cancel`
- **Action Buttons (`.cyber-btn`):**
  - `.cyber-btn-primary` (save/submit/execute)
  - `.cyber-btn-secondary` (secondary tools, save as template/snippet)
  - `.cyber-btn-danger` (crimson cancel/abort/delete)
  - `.cyber-btn-ghost` (low-emphasis toolbar actions)
- **Single Plus Sign Rule:** When rendering `<CyberIcon name="plus" />`, do **not** prepend a literal `+ ` inside the button text.

### Form Controls & Badges
- Text inputs: `.cyber-input` or `.cyber-hud-input`
- Multi-line command/code editors: `.cyber-textarea` (with `var(--font-mono)` styling)
- Select dropdowns: `.cyber-select` or `.cyber-hud-select`
- Variable insertion pills: `.btn-var-pill` — always restore focus and caret position (`el.focus()` + `setSelectionRange`) after inserting into a command editor.
- External file/folder badges: `.file-backed-badge` (`JSON`, `XML`, `DIR`, `FILE`, `VAULT`) marking features backed by external files on disk.

---

## 4. Typography

- **UI Navigation & Prose:** `'Segoe UI', system-ui, -apple-system, sans-serif`
- **Telemetry, Code, Commands, Paths & Badges:** `'JetBrains Mono', 'Cascadia Code', Consolas, monospace`
  - Always use monospace for: IP addresses, ports, hashes (`SHA-256`/`MD5`), file paths, JSON store banners, CVSS/MITRE chips, keybinding badges, and uppercase tracked HUD headers (`letter-spacing: 0.04em–0.08em`).

---

## 5. Iconography Rules

- **Strict Rule (`AGENTS.md` #9):** **Never use Unicode emojis** anywhere in the UI (no `🛡️`, `🚀`, `🔒`, `✨`, `📋`, etc. in buttons, tabs, dropdowns, badges, dialogs, or select `<option>` text).
- Import and render monochrome vector SVGs through [`CyberIcon.tsx`](../frontend/src/components/CyberIcon.tsx) so icons inherit `currentColor` cleanly across themes.

---

## 6. Terminal & Theme Synchronization Checklist

Whenever adding a new color theme `<id>`:
1. Add the theme ID to `AppGlobalSettings['colorTheme']` (or centralized theme registry in `frontend/src/types/`).
2. Define `.app-shell.theme-unlocked.theme-<id>` in [`styles.css`](../frontend/src/styles.css) with `--bg-base`, `--bg-glass`, `--bg-card`, `--border-accent`, `--accent-primary`, `--accent-bright`, `--accent-glow`, and `--accent-text`.
3. Add a matching high-contrast ANSI palette (`background`, `foreground`, `cursor`, `selectionBackground`, ANSI 16 colors) in `getThemeColors()` inside [`TerminalView.tsx`](../frontend/src/components/TerminalView.tsx).
4. Add the theme swatch card in [`SettingsView.tsx`](../frontend/src/components/SettingsView.tsx).
5. Verify `.app-shell.theme-locked` still overrides cleanly to armed crimson when the vault locks, and check contrast ratios across modals, terminal selections, and crimson `.btn-danger` buttons.
