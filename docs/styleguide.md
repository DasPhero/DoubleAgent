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
>
> **Translucent accents (the `color-mix` rule):** A hardcoded `rgba(0, 240, 255, A)` encodes a *specific* accent alpha the four tokens above can't all express. Replace it with `color-mix(in srgb, var(--accent-bright) <A×100>%, transparent)` so the tint tracks the active theme while preserving the exact opacity (e.g. `rgba(0, 240, 255, 0.25)` → `color-mix(in srgb, var(--accent-bright) 25%, transparent)`). The whole frontend was swept to this convention; `TotpManagerModal.tsx` (the MFA module) is the zero-hardcoded-color reference component.
>
> **Legitimate cyan literals that must stay:** per-host / per-tab **data** colors (`TabItem.color`, host color coding), the ANSI palette hexes inside `getThemeColors()`, and theme **swatch** hexes in `SettingsView.tsx`. These are stored values or literal previews, not themed chrome — never tokenize them.

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

- **Strict Rule (`AGENTS.md` #9):** **Never use Unicode emojis** anywhere in the UI (no `🛡️`, `🚀`, `🔒`, `✨`, `📋`, etc. in buttons, tabs, dropdowns, badges, dialogs, or select `<option>` text). This also covers geometric/arrow glyphs used as icons — `●`, `○`, `▲`, `▼`, `▾`, `►`, `▶`, `■`, `↵`, `⇄`, `⇢`, `──▶` — which are `CyberIcon`s, not characters.
- Import and render monochrome vector SVGs through [`CyberIcon.tsx`](../frontend/src/components/CyberIcon.tsx) (68 icons) so icons inherit `currentColor` cleanly across themes.
- **Context rules for replacing a glyph:**
  - **JSX text** (`>⚡ LABEL<`): replace the glyph with `<CyberIcon name="bolt" size={14} />` followed by the text.
  - **Ternary label strings** (`{busy ? '...' : '📋 Copy'}`): return a fragment — `{busy ? '...' : <><CyberIcon name="clipboard" size={14} /> Copy</>}`. A string literal cannot hold an icon.
  - **`<option>` / `<optgroup label>` text and `aria-label`/`title` attributes:** strip the glyph (these can't contain an element); rely on the text. Colored status/severity circles (`🔴🟢🟡`) are **stripped**, not iconified — monochrome `currentColor` icons can't carry a status hue; use text plus the surrounding semantic color, or a styled CSS dot.
  - **Persisted data strings** (`TabItem.title`, `setStatusMessage(...)`, react-flow node labels): strip the glyph or use ASCII (`->`); never inject JSX into a string.
- The MFA module ([`TotpManagerModal.tsx`](../frontend/src/components/TotpManagerModal.tsx)) is the reference for icon-in-button usage.

---

## 6. Terminal & Theme Synchronization Checklist

Whenever adding a new color theme `<id>`:
1. Add the theme ID to `AppGlobalSettings['colorTheme']` (or centralized theme registry in `frontend/src/types/`).
2. Define `.app-shell.theme-unlocked.theme-<id>` in [`styles.css`](../frontend/src/styles.css) with `--bg-base`, `--bg-glass`, `--bg-card`, `--border-accent`, `--accent-primary`, `--accent-bright`, `--accent-glow`, and `--accent-text`.
3. Add a matching high-contrast ANSI palette (`background`, `foreground`, `cursor`, `selectionBackground`, ANSI 16 colors) in `getThemeColors()` inside [`TerminalView.tsx`](../frontend/src/components/TerminalView.tsx).
4. Add the theme swatch card in [`SettingsView.tsx`](../frontend/src/components/SettingsView.tsx).
5. Verify `.app-shell.theme-locked` still overrides cleanly to armed crimson when the vault locks, and check contrast ratios across modals, terminal selections, and crimson `.btn-danger` buttons.

### Theme Roster

The single source of truth for valid IDs is the `colorTheme` union in [`TerminalView.tsx`](../frontend/src/components/TerminalView.tsx). Current unlocked themes:

| ID | Label | `--accent-bright` | Second accent (`--accent-text`) | Vibe |
| --- | --- | --- | --- | --- |
| `teal` | Teal (Cyber) | `#00f0ff` | `#5eead4` | Default obsidian + cyan HUD |
| `one-dark` | One Dark | `#61afef` | `#98c379` | Editor blue / green |
| `crimson` | Crimson | `#ff2e2e` | `#ff9a9a` | True black + blood-red (kept warmer/deeper than the locked-vault scarlet `#ff003c` so unlocked never reads as armed) |
| `neon` | Neon | `#ff2bd6` | `#ff9e4d` | Synthwave violet base, hot-pink glow, orange text |
| `vice` | Vice | `#2dd4bf` | `#ff6ec7` | Cyberpunk teal glow × hot pink |
| `viper` | Viper | `#aaff00` | `#bef264` | Acid / matrix green on near-black |
| `voltage` | Voltage | `#2f9bff` | `#ffe014` | Electric-blue arc over navy, gold button fills; yellow text pushed to lemon `#ffe014` to clear the fixed warning amber `#ffaa00` |
| `plasma` | Plasma | `#ff2b4e` | `#22d3ee` | Arasaka red chrome (glowing red borders/headers) over near-black with electric-teal content — red/teal cyberpunk duotone |

> Note: `crimson` deliberately avoids the locked-state scarlet. When adding a red-family theme, keep `--accent-bright` distinguishable from `#ff003c` (the `.theme-locked` armed color) so operators can always tell a locked vault from an unlocked one at a glance.
