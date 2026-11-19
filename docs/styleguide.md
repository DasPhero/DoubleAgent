# DoubleAgent Styleguide — Cyberpunk Tactical HUD

The single reference for how DoubleAgent UI is styled. Read it before building or
touching any UI, and run the [PR checklist](#13-pr-checklist-new-feature-realignment) before
you call a UI slice done. All rules here are derived from the shipped code on `main`
([`frontend/src/styles.css`](../frontend/src/styles.css),
[`TerminalView.tsx`](../frontend/src/components/TerminalView.tsx),
[`CyberIcon.tsx`](../frontend/src/components/CyberIcon.tsx),
[`TotpManagerModal.tsx`](../frontend/src/components/TotpManagerModal.tsx)) and the
theming work in `dfe972c`.

**Golden rule:** new UI never brings its own look. Compose it from the existing tokens and
`cyber-*` classes. If something is missing, add a reusable class to `styles.css` (tokenized),
not a one-off inline style.

---

## 1. The aesthetic in one paragraph

A dark, layered **tactical HUD**: near-black navy/obsidian surfaces, **one glowing theme
accent** used for lines, titles and focus, and a few **fixed semantic hues** (crimson / amber /
emerald) that always mean the same thing. Geometry is **angular**: chamfered (cut) corners,
2px radii, corner brackets (reticles), thin 1px hairlines, no soft pill-shaped consumer UI.
Text is **monospace and uppercase** wherever it is telemetry or chrome. Decoration is
purposeful and sparse: hazard stripes `///`, telemetry chips, segment bars, ring gauges and a
faint 36px grid. Glow comes from `box-shadow` / `text-shadow`, never from gradients that
wash out the whole surface.

### Motif vocabulary (what to reach for)

| Motif | Use it for | Implementation |
| --- | --- | --- |
| Chamfered frame | Modals, dialogs, cards, buttons, inputs | `clip-path: polygon(...)` (see §4) |
| Corner reticles | Framing important windows and cards | `.cyber-corner-reticle` (modal) / `.card-reticle` (card) |
| Hazard tag line | Header kicker above a title | `/// TAG-CODE // SUBTAG` (see §6.2) |
| Telemetry chips | Counts, states and specs in a header | `.cyber-telemetry-chip.chip-cyan/green/amber` |
| Backlit LED dot | Status and severity | `.status-led.led-*` |
| Segment bar / ring gauge | Progress, countdown, capacity | `.cyber-segment-bar`, `.cyber-hud-gauge` |
| Footer strip | Protocol/info line at the bottom of a tool window | `.cyber-totp-footer` |
| Grid + corner glow | App shell background | Built into each theme block (§2) |

### Don'ts

- No rounded "SaaS" cards (`border-radius` ≥ 6px), no soft drop shadows on light surfaces, no
  light backgrounds, no native grey browser chrome.
- No emojis or Unicode glyph icons (see §8).
- No multi-color rainbow chrome. Chrome uses **one** theme accent and its second accent; other
  hues are reserved for meaning (§3).
- Don't glow everything. Glow marks focus, hover, active and primary items only.

---

## 2. The theming system

### How it works

The root element gets a class pair from the vault state
([`App.tsx`](../frontend/src/App.tsx), the `app-shell` className):

```tsx
className={`app-shell ${vaultLocked ? 'theme-locked' : `theme-unlocked theme-${globalSettings.colorTheme}`}`}
```

- `:root` defines default tokens ([`styles.css:1-24`](../frontend/src/styles.css#L1-L24)).
- `.app-shell.theme-locked` forces the **armed crimson** palette while the vault is locked.
- `.app-shell.theme-unlocked.theme-<id>` overrides the accent and surface tokens per theme
  ([`styles.css:54-182`](../frontend/src/styles.css#L54-L182)) and paints the shell
  background (corner radial glow + optional 36px grid).

**Consequence:** anything styled with tokens re-themes for free, including the locked state.
Anything hardcoded stays teal-cyan in every theme, which is the most common bug in new
features.

### Token contract (the only variables that exist)

| Token | Role | Default (`teal`) |
| --- | --- | --- |
| `--bg-base` | Outer shell canvas | `#060913` |
| `--bg-main` | Workspace / pane background | `#080d1a` |
| `--bg-panel` | Sidebars, docked panels | `#0b1224` |
| `--bg-dropdown` | Dropdown menus | `#060b16` |
| `--bg-glass` | Translucent HUD chrome | `rgba(8,14,26,.96)` |
| `--bg-card` | Cards, list containers | `#091020` |
| `--border-accent` | Accent borders (focused / active / modal) | `rgba(0,240,255,.35)` |
| `--border-subtle` | Passive dividers and outlines | `rgba(148,163,184,.16)` |
| `--accent-bright` | **The** theme accent: glow lines, titles, focus, active | `#00f0ff` |
| `--accent-primary` | Solid fill anchor (filled buttons, bars) | `#0d9488` |
| `--accent-glow` | Hover / active glow color | `rgba(0,240,255,.28)` |
| `--accent-text` | **Second accent**: tinted labels, telemetry values | `#5eead4` |
| `--text-main` | Body copy | `#e2e8f0` |
| `--text-muted` | Secondary labels, metadata | `#94a3b8` |
| `--hud-crimson` / `--hud-amber` / `--hud-magenta` / `--hud-cyan` | Fixed hues (not themed) | `#ff003c` / `#ffaa00` / `#ec4899` / `#00f0ff` |
| `--font-mono` | HUD / telemetry font stack | `'JetBrains Mono', Consolas, monospace` |
| `--font-sans` | Prose font stack | `'Segoe UI', system-ui, -apple-system, sans-serif` |

> **Never invent a token name.** An undefined `var(--x)` silently resolves to nothing
> (transparent background, inherited color). Names that were used by mistake in the past,
> and what to use instead:
>
> | Wrong | Use |
> | --- | --- |
> | `--text-bright`, `--text-primary` | `--text-main` |
> | `--text-secondary`, `--color-text-secondary` | `--text-muted` |
> | `--accent`, `--color-primary-cyan` | `--accent-bright` |
> | `--accent-soft` | `--accent-text` |
> | `--border-color` | `--border-subtle` |
> | `--bg-primary`, `--bg-terminal` | `--bg-base` |
> | `--bg-secondary` | `--bg-panel` |
> | `--bg-tertiary`, `--bg-surface` | `--bg-card` |
> | `--font-family-mono` | `--font-mono` |
>
> `--term-surface` is the one non-contract variable: it is set inline by `App.tsx` for the
> glass terminal.
>
> **Surfaces:** themes override only `--bg-base`, `--bg-glass` and `--bg-card`. `--bg-main`,
> `--bg-panel` and `--bg-dropdown` stay navy in every theme, so use them only for neutral
> workspace chrome. Modal and dialog shells use `--bg-base` (body), `--bg-glass`
> (header) and `color-mix(in srgb, var(--bg-base) 95%, transparent)` (footer).

### Translucent accents: the `color-mix` rule

Don't write the accent as `rgba(0, 240, 255, A)`. Write:

```css
color-mix(in srgb, var(--accent-bright) 25%, transparent)   /* == rgba(accent, .25) */
```

Standard alpha steps already in use: **8%** button fill · **15–18%** hover/active fill ·
**22–30%** idle borders · **35–45%** focus glow / strong borders · **100%** (`var()` itself)
for focused or active borders and titles.

### Color roles: which accent where

| Element | Token |
| --- | --- |
| Titles, hazard stripes, focus borders, active tab/pill, reticles, gauge arc | `--accent-bright` |
| Solid primary fills, progress fills | `--accent-primary` (or the `.cyber-btn-primary` gradient) |
| Secondary highlighted text: values in chips, tinted labels, inline `code` | `--accent-text` |
| Body copy / labels / disabled-ish metadata | `--text-main` / `--text-muted` / `#64748b` |

---

## 3. Semantic colors (theme-independent)

These keep their meaning in every theme, so operators' muscle memory never breaks. Never
use them for decoration, and never tokenize them to the theme accent.

| Meaning | Colors | Used by |
| --- | --- | --- |
| **Destructive / cancel** | border `rgba(239,68,68,.48)`, bg `rgba(239,68,68,.14)`, text `#fca5a5`, hover `#ef4444` | `.cyber-btn-danger`, `.cyber-hud-btn.btn-danger/.btn-cancel`, `.cyber-btn-close:hover`, `.cyber-btn-icon.btn-delete`, `.cyber-banner-error` |
| **Armed / locked** | `#ff003c` (`--hud-crimson`) | `.theme-locked`, `.cyber-hazard-badge`, `.led-conflict`. Reserved: no other UI may use this exact scarlet |
| **Urgent / expiring** | `#ff2a5f` | TOTP urgent card / digits / gauge / segments |
| **Warning / OPSEC / inject** | `#f59e0b`, `#fbbf24`, `#ffaa00` (`--hud-amber`) | `.cyber-btn-accent`, `.cyber-btn-inject`, `.dialog-warning-banner`, `.chip-amber`, hazard delimiter `//` |
| **Success / live / on-disk** | `#10b981`, `#34d399`, `#6ee7b7`, `#00ff88` (chip) | `.cyber-btn-success`, `.cyber-btn-copy.is-copied`, `.cyber-banner-success`, `.chip-green`, `.file-backed-badge` |
| **Required field marker** | `#ff3366` | `.cyber-label .req` |

**Status LEDs** ([`styles.css:3282`](../frontend/src/styles.css#L3282)). Use these, not ad-hoc dots:

| Modifier | Color | Meaning |
| --- | --- | --- |
| `led-critical` / `led-red` | `#ff2d4b` | critical severity, failure |
| `led-high` / `led-orange` | `#ff7a1a` | high severity |
| `led-medium` / `led-amber` | `#ffc21a` | medium severity |
| `led-low` / `led-blue` | `#3b82f6` | low severity |
| `led-info` | `#38bdf8` | informational |
| `led-active` / `led-green` | `#19e68c` | connected, running, synced |
| `led-warn` | `#ffaa00` | degraded, external change |
| `led-offline` / `led-grey` | `#64748b` | idle, offline |
| `led-conflict` | `#ff003c` | conflict |
| `+ led-sm`, `+ led-pulse` | — | smaller dot; pulsing (honours reduced motion) |

**Legitimate literals that must stay literal:** per-host / per-tab **data** colors
(`TabItem.color`, host color coding), the ANSI palettes in `getThemeColors()`, and the theme
**swatch** hexes in `SettingsView.tsx`. These are stored values or previews, not chrome.

---

## 4. Shape language

**Chamfers, not curves.** Cut-corner `clip-path` sizes scale with the element:

| Element | Chamfer | Polygon |
| --- | --- | --- |
| Tool-window modal (`.cyber-totp-container.is-modal-view`) | 16px | TR + BR cut |
| HUD modal card (`.cyber-modal-card`) | 16px | TR + BL cut |
| Dialog card (`.cyber-dialog-card`) | 14px | TR + BR cut |
| Content card (`.cyber-totp-card`) | 12px | TR + BR cut |
| Section panel (`.cyber-hud-card`) | 10px | TR + BL cut |
| Buttons (`.cyber-btn`, `.cyber-hud-btn`) | 6px | TR + BL cut |
| Inputs (`.cyber-hud-input/select`) | 5px | TR + BL cut |

```css
/* TR + BL diagonal cut, N = chamfer */
clip-path: polygon(0 0, calc(100% - Npx) 0, 100% Npx, 100% 100%, Npx 100%, 0 calc(100% - Npx));
```

`clip-path` clips `box-shadow` and absolutely positioned children that overflow. Put outer
glow on a wrapper if it must show, and keep reticles inside the box.

**Radius:** `2px` default (`0`–`3px` allowed). `50%` only for LEDs, dots and ring gauges.
Avoid `6px+` and `9999px` pills in new code: they read as consumer UI.

**Borders:** always `1px` hairlines; `2px` only for reticle corners and critical framing.

**Spacing:** rem-based, compact. Typical values: header padding `0.85rem 1.25rem`, body
padding `1.25rem`, gaps `0.35–0.85rem`, form grid gap `0.85rem`. Dense is fine; this is an
operator tool.

---

## 5. Typography

| Context | Font |
| --- | --- |
| Prose, navigation, long descriptions | `var(--font-sans)` (inherited from `:root`) |
| Everything HUD: titles, buttons, labels, inputs, chips, badges, IPs, ports, paths, hashes, keybindings, code | `var(--font-mono)` |
| Terminal (xterm default) | `'Cascadia Code', 'JetBrains Mono', Consolas, monospace` at 14px / line-height 1.2 |

New code uses `var(--font-mono)`. Older rules spell the stack out literally; they are
equivalent.

**Type scale (in use):**

| Role | Size / weight / tracking |
| --- | --- |
| Tool-window title `.cyber-hud-title` | 1.15rem / 800 / 0.08em, `#fff` |
| Dialog title `.dialog-title h3` | 0.95rem / 700 / 0.06–0.08em, `--accent-bright` |
| Hazard tag line | 0.7rem / 700 / 0.1em |
| Buttons | 0.75–0.78rem / 700 / 0.04–0.06em (`sm`: 0.71–0.72rem) |
| Inputs | 0.78–0.82rem |
| Labels `.cyber-label` | 0.68–0.72rem / 700 / 0.05–0.06em, uppercase, `#94a3b8` |
| Chips / footer / meta | 0.68rem |
| Badges | 0.59rem / 700 / 0.05em |

**Casing:** HUD chrome (titles, tag lines, button labels, labels, chips) is **UPPERCASE**.
Body text, descriptions, hints and user data keep their natural case. Never uppercase user
data (hostnames, paths, usernames).

---

## 6. Component patterns

### 6.1 Modal shells: pick one of two

`main` currently has five overlapping modal systems. **New work uses only these two:**

**A. Dialog** (forms, confirmations, import/export, pickers). The most widely used shell.

```tsx
<div className="cyber-modal-overlay" onClick={onClose}>
  <div className="cyber-dialog-card" role="dialog" aria-modal="true" aria-label="Export Backup"
       onClick={(e) => e.stopPropagation()}>
    <div className="dialog-header">
      <div className="dialog-title">
        <span className="cyber-hazard-stripes">///</span>
        <h3>EXPORT BACKUP</h3>
      </div>
      <button type="button" className="cyber-btn-close" aria-label="Close" onClick={onClose}>
        <CyberIcon name="close" size={14} />
      </button>
    </div>
    <div className="dialog-body">{/* scrolls; flex column, gap .85rem */}</div>
    <div className="dialog-footer">
      <button type="button" className="cyber-btn cyber-btn-danger" onClick={onClose}>CANCEL</button>
      <button type="button" className="cyber-btn cyber-btn-primary">EXPORT</button>
    </div>
  </div>
</div>
```

Width: default 650px / `max-width: 95vw`. Override width only, via a modifier class.

**B. Tool window** (large managers that can also dock into a split pane: TOTP, Listener,
Pivot, Route Health, File Transfer). Reference: `TotpManagerModal.tsx`.

```tsx
<div className="modal-backdrop cyber-modal-backdrop" onClick={onClose}>
  <div className={`cyber-totp-container ${isDocked ? 'is-docked-view' : 'is-modal-view'}`}
       role="dialog" aria-label="..." onClick={(e) => e.stopPropagation()}>
    <div className="cyber-corner-reticle cyber-corner-tl" />
    <div className="cyber-corner-reticle cyber-corner-tr" />
    <div className="cyber-corner-reticle cyber-corner-bl" />
    <div className="cyber-corner-reticle cyber-corner-br" />
    <div className="cyber-totp-hud-header">{/* §6.2 */}</div>
    <div className="cyber-totp-toolbar">{/* search + filter pills */}</div>
    {/* scrolling content, e.g. .cyber-totp-card-grid */}
    <div className="cyber-totp-footer">
      <span className="footer-hazard">///</span>
      <span className="footer-text">ONE-LINE PROTOCOL / INFO STRIP</span>
    </div>
  </div>
</div>
```

The `cyber-totp-*` names are historical; they are the generic tool-window classes. When
docked (`is-docked-view`), skip the backdrop and the close button.

**Do not use for new work:** `.modal-card` (legacy, 10px radius, pre-HUD), `.cyber-modal-card`
(only Snippet Chains), and hand-rolled `.xyz-modal` shells with their own header/border/radius.

Rules for every modal:
- Click on the backdrop closes it; `stopPropagation` on the card.
- `role="dialog"`, `aria-modal="true"`, `aria-label`.
- Close button is always `.cyber-btn-close` + `<CyberIcon name="close" />`, top right.
- The body scrolls (`min-height: 0; overflow-y: auto`), never the whole card.
- Nested dialogs inside a tool window use shell A (overlay z-index 25000 sits above 20000).

### 6.2 HUD header

```tsx
<div className="cyber-totp-hud-header">
  <div className="cyber-hud-title-block">
    <div className="cyber-hud-tag-line">
      <span className="cyber-hazard-stripes">///</span>
      <span className="cyber-hud-tag">SEC-02FA</span>     {/* accent */}
      <span className="cyber-hud-delim">//</span>         {/* amber */}
      <span className="cyber-hud-subtag">QUANTUM VAULT</span> {/* muted */}
    </div>
    <h2 className="cyber-hud-title">TOTP AUTHENTICATOR</h2>
    <div className="cyber-telemetry-strip">
      <span className="cyber-telemetry-chip chip-cyan"><span className="chip-dot" /> KEYS: <strong>4</strong></span>
    </div>
  </div>
  <div className="cyber-hud-actions-block">{/* buttons + close */}</div>
</div>
```

The tag code is a short codename (`AREA-CODE`), not a spec F-ID. **Never show `F-xx` IDs
in the UI**; they belong in commits and tests only.

### 6.3 Buttons

Two families, both chamfered, mono and bold. Pick by context, don't mix within one button row.

| Class | Use |
| --- | --- |
| `.cyber-btn.cyber-btn-primary` | The one main action of a dialog / window (Save, Connect, Execute) |
| `.cyber-btn.cyber-btn-secondary` | Other actions (Import, Export, Browse) |
| `.cyber-btn.cyber-btn-danger` | Cancel, Delete, Disconnect, Stop, Reset |
| `.cyber-btn.cyber-btn-accent` | Amber: OPSEC-relevant or "dock" style side actions |
| `.cyber-btn.cyber-btn-success` | Rare: a confirmed / done state |
| `+ .cyber-btn-sm` | Compact |
| `.cyber-hud-btn` (`+ .btn-sm`, `.btn-primary`, `.btn-danger`, `.btn-cancel`) | Toolbars, card rows, inline in forms, pane chrome |
| `.cyber-btn-icon` (`+ .btn-delete`) | 30×30 icon-only square |
| `.cyber-btn-close` | Window close only |
| `.cyber-btn-copy` / `.cyber-btn-inject` | Copy-to-clipboard (green flash `.is-copied`) / inject-into-terminal (amber) |
| `.cyber-pill-btn` (`.active`) | Filter toggles |
| `.cyber-tab-btn` (`.active`) | Segmented mode switch (2–4 options) |

Rules:
- **One primary per surface.** Order in footers: secondary/cancel left, primary right.
- Disabled = `:disabled` (opacity .45, `not-allowed`). Hover styles use `:hover:not(:disabled)`.
- Icon + label: `<CyberIcon name="..." size={14} /> LABEL` (size 12 for `btn-sm`).
- **Single plus rule:** with `<CyberIcon name="plus" />`, don't also write `+` in the label.
- There is no ghost variant. For low-emphasis actions use `.cyber-btn-secondary`, or
  `.cyber-hud-btn` in toolbars.

### 6.4 Forms

| Element | Class |
| --- | --- |
| Section wrapper | `.cyber-hud-card` (chamfered panel) or `.cyber-form-panel` |
| Grid | `.cyber-form-grid-2`, `.cyber-form-grid-3` |
| Field | `.cyber-field-group` > `.cyber-label` + control |
| Text input / select | **`.cyber-hud-input` / `.cyber-hud-select`** (chamfered; preferred) or `.cyber-input` / `.cyber-select` |
| Code / command editor | `.cyber-textarea` (mono, mint text) |
| Search | `.cyber-search-reticle` > `.search-prefix` + `.cyber-search-input` |
| Hint | `.cyber-form-hint` (inline `code` gets accent) |
| Required | `<span className="req">*</span>` inside the label |
| Secret field | `.cyber-secret-wrapper` + eye toggle with `CyberIcon eye / eye-off` |
| Actions | `.cyber-dialog-actions` / `.cyber-form-actions` |

Inputs are always dark (`#03060c` / `rgba(5,9,16,.9)`), have a 1px accent border at ~28–30%,
and on focus get a full `--accent-bright` border plus glow. Never `outline` focus rings.
Selects set `color-scheme: dark` so native popups stay dark.

When inserting a variable pill (`.btn-var-pill`) into an editor, restore focus and caret
(`el.focus()` + `setSelectionRange`).

### 6.5 Feedback and data display

| Need | Class |
| --- | --- |
| Error / success strip under a header | `.cyber-banner.cyber-banner-error` / `-success` |
| Warning box in a dialog | `.dialog-warning-banner` (amber) |
| File / store backed indicator | `.file-backed-badge` (`JSON`, `XML`, `DIR`, `FILE`, `VAULT`) |
| Status | `.status-led.led-*` |
| Header telemetry | `.cyber-telemetry-chip.chip-cyan/green/amber` |
| Empty list | `.cyber-empty-state` > `.cyber-empty-icon` (a `CyberIcon`), `.cyber-empty-title`, `.cyber-empty-desc`, `.cyber-empty-actions` |
| Card grid | `.cyber-totp-card-grid` + `.cyber-totp-card` (+ `.card-reticle-*`, `.card-urgent`, `.card-warning`) |
| Monospace value display | `.card-code-terminal` |
| Countdown / capacity | `.cyber-hud-gauge` (+ `.warning` / `.urgent`), `.cyber-segment-bar` > `.seg-cell.seg-active` |

Every async surface needs four states: loading, empty (`.cyber-empty-state`), error
(`.cyber-banner-error`) and data. Don't ship a blank panel.

### 6.6 Workspace chrome

The top bar, tabs, sidebar host cards, the pane header and the status bar are established
(see the numbered sections from [`styles.css:6362`](../frontend/src/styles.css#L6362)). New
features **plug into** them; they don't add parallel bars:

- Pane header (`.split-pane-header`): fixed 27px, never collapses the grip and title.
- Terminal command strip (`.hud-command-strip`): add segments, not new toolbars.
- Docked widgets go into split panes (§6.1 B `is-docked-view`).
- Menus: `.nav-dropdown-menu` rows; popovers `.cyber-glass-popover`.

---

## 7. Layering (z-index scale)

| Layer | z-index |
| --- | --- |
| Pane-internal overlays, reticles | 1–100 |
| Terminal toolbar / command strip | 1000 |
| Floating in-pane overlays | 9999 |
| Top menu bar / its dropdowns | 10000 / 10001 |
| Popovers ("Add to view") | 15000 |
| `.modal-backdrop` / `.cyber-modal-backdrop` (tool windows) | 20000 |
| `.cyber-modal-overlay` / `.cyber-dialog-card` (dialogs, nested dialogs) | 25000 / 25001 |
| Host-key verification (security prompt, must win) | 100050 / 100051 |

Don't invent new numbers. Pick the layer your element belongs to.

---

## 8. Icons (AGENTS.md rule 9)

- **All** icons come from [`CyberIcon.tsx`](../frontend/src/components/CyberIcon.tsx):
  24×24 viewBox, `stroke="currentColor"`, stroke-width 2, round caps, no fill. They inherit
  color from text, so they re-theme automatically.
- `<CyberIcon name="..." size={14} />`. Sizes: **12** (small buttons, chips), **14** (default),
  **16** (titles), **24–40** (empty states).
- **No emojis and no Unicode glyphs used as icons**, including `● ○ ▲ ▼ ▾ ► ▶ ■ ↵ ⇄ ⇢ ──▶ ✓ ✗`.
  ASCII decorations that are typography, not icons (`///`, `//`, `[ ]`, `->` in data
  strings), are fine.
- Need a new icon? Add it to the `CyberIconName` union and the switch in the same geometric
  style. Don't inline a one-off `<svg>` in a component.
- Replacing a glyph depends on context:
  - **JSX text:** `<CyberIcon name="bolt" size={14} /> LABEL`.
  - **Ternary labels:** return a fragment `<><CyberIcon name="clipboard" size={14} /> Copy</>`.
  - **`<option>`, `aria-label`, `title`:** strip the glyph (can't hold elements). Status
    circles become text plus semantic color or a `.status-led`.
  - **Persisted strings** (`TabItem.title`, status messages, react-flow labels): strip, or use ASCII.

Available names (69): `key gear shield note folder terminal bolt search split-h split-v grid
pin totp broadcast record undock close plus minus chevron-down chevron-left chevron-right
chevron-up play stop more tunnel serial wave grip home lock unlock swap next-pane network map
edit save stabilize trash calculator target radar upload chain skip copy warning check
download file clipboard keyboard desktop clock eye eye-off rocket star chart refresh flag
globe arrow-right arrow-left arrow-left-right return pivot-hop`.

---

## 9. Terminal

- **Settings** live in `AppGlobalSettings` / `DEFAULT_SETTINGS`
  ([`TerminalView.tsx:11-56`](../frontend/src/components/TerminalView.tsx#L11-L56)).
- **Palette:** `getThemeColors(theme)` returns the xterm theme (background, foreground,
  cursor, selection, ANSI) per `colorTheme`. Every app theme **must** have a matching
  palette whose `background` equals the theme's `--bg-base` family and whose `cursor` is
  the theme accent. Keep ANSI red / green / yellow readable: they carry tool output meaning.
- **Glass mode:** `getTerminalTheme()` makes the xterm background fully transparent when a
  background treatment is on. The tint comes from CSS (`--term-surface`, set inline by
  `App.tsx`) over a **single shared** art layer
  ([`TerminalBackground.tsx`](../frontend/src/components/TerminalBackground.tsx),
  [`styles.css:1394`](../frontend/src/styles.css#L1394)). Treatments: `none`, `minimal`,
  `grid`, `pulse`, `watermark`, `matrix`. Art draws in `currentColor` / theme tokens so it
  re-tints.
- **Never** render terminal output or notes as HTML (AGENTS.md rule 2): write to xterm or
  to text nodes only.
- Overlays on a terminal (search, offline prompt, context menu) use the same tokens and
  chamfered style as modals, and must not cover the cursor line unless they are modal.

---

## 10. Motion and performance

- Transitions: `0.15s ease` for hover and focus, `0.2–0.3s` for state color changes.
  Hover lift max `translateY(-1px)` for buttons and `-2px` for cards.
- Animations are short and functional (fade-in 0.18s, LED pulse 1.4s). Wrap any continuous
  animation in `@media (prefers-reduced-motion: reduce)`.
- **Low-latency / RDP mode** (`body.perf-low-latency`,
  [`styles.css:10476`](../frontend/src/styles.css#L10476)) globally removes `backdrop-filter`,
  `animation`, `transition`, `box-shadow`, `text-shadow` and `filter`, and hides the
  terminal art. So:
  - Glow and blur must be **pure decoration**. The UI must stay legible and usable with all
    shadows removed (borders carry structure, not glow).
  - Any **JS-driven** animation (`requestAnimationFrame`, intervals, canvas such as the matrix
    rain) must check `globalSettings.lowLatencyMode` and stop. CSS can't kill it.
  - New translucent surfaces that rely on blur need an opaque fallback in the low-latency
    block (as done for `.cyber-dialog-card`, `.modal-card`, etc.).

---

## 11. Inline styles

Inline `style={{}}` is common in the codebase. Allowed: **layout** (flex, gap, widths,
margins, grid templates) and per-item **data** colors. Not allowed: hardcoded chrome colors,
borders, shadows, fonts or radii. If you need any of those twice, it's a class in
`styles.css`. If you use a color inline, use a token or `color-mix` on a token.

---

## 12. Adding a new color theme

1. Add the ID to the `colorTheme` union in `AppGlobalSettings`
   ([`TerminalView.tsx:18`](../frontend/src/components/TerminalView.tsx#L18)). This is the
   source of truth.
2. Add `.app-shell.theme-unlocked.theme-<id>` in `styles.css` next to the others. Define
   `--bg-base`, `--bg-glass`, `--bg-card`, `--border-accent`, `--accent-primary`,
   `--accent-bright`, `--accent-glow`, `--accent-text` and the shell `background` (radial
   corner glow, optional 36px grid).
3. Add the xterm palette case in `getThemeColors()`.
4. Add the swatch card in `SettingsView.tsx`.
5. Check: `--accent-bright` is distinguishable from the locked scarlet `#ff003c`, and
   `--accent-text` is distinguishable from warning amber `#ffaa00`, success green and danger
   red. Check contrast on modals, terminal selection and `.btn-danger`. Lock the vault and
   confirm `.theme-locked` still wins.

| ID | Label | `--accent-bright` | `--accent-text` | Vibe |
| --- | --- | --- | --- | --- |
| `teal` | Teal (Cyber) | `#00f0ff` | `#5eead4` | Default obsidian + cyan |
| `one-dark` | One Dark | `#61afef` | `#98c379` | Editor blue / green |
| `crimson` | Crimson | `#ff2e2e` | `#ff9a9a` | Black + blood red (deeper than locked scarlet) |
| `neon` | Neon | `#ff2bd6` | `#ff9e4d` | Synthwave violet, hot pink, orange |
| `vice` | Vice | `#2dd4bf` | `#ff6ec7` | Teal × hot pink |
| `viper` | Viper | `#aaff00` | `#bef264` | Acid green on near-black |
| `voltage` | Voltage | `#2f9bff` | `#ffe014` | Electric blue, gold fills, lemon text |
| `plasma` | Plasma | `#ff2b4e` | `#22d3ee` | Red chrome / teal content duotone |

---

## 13. PR checklist (new feature realignment)

Run this on every UI change before calling the slice done:

- [ ] Shell is §6.1 **A** or **B**: no hand-rolled modal frame, header, border or radius.
- [ ] Header follows §6.2 (hazard stripes + uppercase title + `.cyber-btn-close`).
- [ ] Only tokens from §2. Grep your diff for `var(--`: every name must be in the token table.
- [ ] No hardcoded accent: grep for `#00f0ff`, `0, 240, 255`, `20, 184, 166`, `45, 212, 191`,
      `#2dd4bf`, `#0099cc`, `#00ffff`. Use `var(--accent-*)` / `color-mix`. Outside the theme
      blocks at the top of `styles.css`, these should only appear as tab/host data colors,
      ANSI palettes, settings swatches and react-flow marker colors (§14).
- [ ] Semantic colors only for their meaning (§3); destructive actions are crimson; one primary.
- [ ] Every class you use exists in `styles.css`. Grep it; no phantom classes.
- [ ] Radius ≤ 3px (except LEDs and gauges); chamfer per §4.
- [ ] Mono + uppercase for chrome; natural case for user data; no `F-xx` in the UI.
- [ ] Icons only via `CyberIcon`; no emojis or glyphs; no duplicate `+`.
- [ ] Loading, empty, error and data states all styled.
- [ ] Switch through at least `teal`, `plasma` and `viper`, and lock the vault: everything
      re-tints, nothing stays cyan.
- [ ] Toggle low-latency mode: still legible, no JS animation running.
- [ ] Narrow window: no horizontal overflow, headers don't crush (`min-width: 0` + ellipsis).

---

## 14. Known drift and accepted exceptions

**Fixed on 2026-11-19 (F-08 theme sweep):** all undefined tokens were mapped to the contract
(§2) and `--font-mono` / `--font-sans` were added. Every teal/cyan `rgba()` outside the theme
blocks now uses `color-mix` on `--accent-bright`. Primary buttons (`.cyber-btn-primary`,
`.cyber-hud-btn.btn-primary`) now derive their gradient and hover from the accent. The
tool-window and dialog shells use `--bg-base` / `--bg-glass`. The class-less
`.cyber-btn-ghost` became `.cyber-btn-secondary`, and the TOTP "ADD KEY" `+` became
`CyberIcon plus`.

**Accepted literals** (deliberate, don't "fix"):
- Tab `color` values in `App.tsx` (`#2dd4bf`, `#00f0ff`). These are stored per-tab data.
- ANSI palettes in `getThemeColors()` and swatches in `SettingsView.tsx`.
- react-flow `markerEnd.color` in `NetworkMapView.tsx`. react-flow builds the marker element
  ID from the color string, so a `color-mix(...)` value would break the `url(#…)` reference.
  The dot background is tinted through `.network-map-flow-bg circle` in CSS instead, because
  react-flow writes `fill` as an SVG attribute, which can't resolve `var()`.

**Still open:**
- **Five modal systems** coexist (`.modal-card`, `.cyber-dialog-card`, `.cyber-modal-card`,
  `.cyber-totp-container`, ad-hoc). Converge on §6.1 A/B when touching a modal.
- Some dark surfaces inside panels are still navy literals (e.g. `rgba(13,33,40,…)` in the active
  pane header, `#03060c` input wells). They read fine in all current themes, but tokenize them
  when you touch those rules.
