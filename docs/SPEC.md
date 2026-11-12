# DoubleAgent — Core-Spezifikation v0.6

Oct 29, 2026 · @Big Beans

**v0.7 (2026-11-04):** Stack auf **Wails (Go) + React/xterm.js** umgestellt statt Electron — kompiliert zu einer einzigen nativen Binary, kein Node-Runtime, kein Native-Modul-Gebastel, deutlich einfacheres Packaging. Visuals bleiben voll web-basiert (React, Tailwind, Animationen). Vision auf den allgemeinen SSH-Client zugespitzt.

**v0.6 (2026-11-02):** Spec aufgeteilt. Diese Datei ist die **Core-Spezifikation** (allgemeiner SSH-Client, komplette Infrastruktur, lauffähiges Executable). Spezialisierte Zusatzfunktionen liegen in einem separaten [Zusatzmodul](https://claude.ai/artifact/LjwimF4gRBxm7oi19EGTi3) mit eigener Spec, gebaut erst wenn der Core steht. Modell-Phasen sind AI-modell-agnostisch (schnelles vs. Flagship-Modell).

**v0.5 (2026-10-30):** Architekturfragen entschieden: Electron + TypeScript + React, greenfield (Tabby nur als Referenz), xterm.js, verschlüsselter Vault. Kern-Funktionen festgelegt (Hosts, Terminal, Tabs, SFTP, Tunnel, Vault, Notizen, TOTP); spezialisierte Zusatzfunktionen in ein separates Modul ausgelagert. Name und erster Logo-Entwurf: DoubleAgent.

## 1. Vision und Zielbild

DoubleAgent ist ein moderner, nativer SSH-Client für Entwickler, Admins und Power-User: der Komfort von Termius, aber als schlanke, eigenständige App ohne Account-Zwang und ohne vorab installierte Runtime — läuft auf Windows und Linux.

**Zielgruppe:** alle, die täglich über viele Hosts, Schlüssel, Tunnel und Sprungserver arbeiten. Keyboard-first, aufgeräumt, schnell.

**Was es ausmacht:**

- Lokal zuerst: Hosts, Schlüssel und Notizen liegen verschlüsselt auf dem eigenen Gerät; Sync nur optional über einen Dateidienst
- Native Performance als Ziel: schneller Start, wenig RAM pro Tab
- Security by default: strikte Host-Key-Prüfung, moderne Algorithmen, Vault immer verschlüsselt
- Pro Host zusammengeführt: Credentials, Keys, Notizen und Snippets an einem Ort
- Komfort eingebaut: Tab-Gruppen nach Host, Command Palette, Snippets, Port-Forwarding, TOTP

**Leitprinzipien:**

1. Keyboard first: alles über die Command Palette (Ctrl+K) erreichbar
2. Sichere Defaults, Vault immer verschlüsselt, kein Account-Zwang, keine Telemetrie
3. Häufige Handgriffe (verbinden, pivoten, Beweis sichern, Notiz anlegen) in höchstens zwei Schritten
4. Lokal zuerst, Sync nur optional über einen Dateidienst

Erweiterbar: spezialisierte Zusatzfunktionen kommen als optionale Module obendrauf, ohne den schlanken Kern zu belasten.

## 2. Scope

Der Core ist ein vollwertiger, moderner SSH-Client für Kali und Windows — allgemein nutzbar wie Termius/Tabby. Die gesamte Oberfläche ist Englisch. Das offensive Pentest-Modul ist eine eigene Spec und wird erst nach dem Core gebaut.

**MVP**

- Hosts, Gruppen, Tags, Suche, Favoriten; pro Host Credentials, Keys und Notizen
- Terminal mit xterm.js: Tabs, Split Panes, Truecolor, Scrollback mit Regex-Suche
- Tab-Gruppen nach Host, farbcodiert
- Neues Terminal: Default-Verzeichnis, aktuelles Verzeichnis, als root im aktuellen
- Auth: Passwort, Key, Keyboard-Interactive (2FA), ssh-agent und Pageant; TOTP-Generator
- Known-Hosts mit strikter Prüfung; SFTP-Browser mit Drag and Drop
- Proxying: SOCKS (-D), -L, -R, ProxyJump, ProxyCommand; proxychains-Export
- Snippets mit Variablen; Notizen je Host (Ordner, Unterseiten, Markdown)
- Verschlüsselter Vault mit Master-Passwort; Session-Logging mit Zeitstempeln
- Import aus \~/.ssh/config; lokale Terminals (PowerShell, cmd, WSL bzw. bash/zsh)
- Lauffähiges, eigenständiges Executable (portable .exe / AppImage) ab dem ersten Schritt

**v1**

- Jump-Ketten über mehrere Hops; Broadcast Input an mehrere Sessions
- Auto-Reconnect und Session-Restore
- Remote-Datei im lokalen Editor bearbeiten mit Auto-Upload
- Datei-Sync über Google Drive oder Syncthing mit Konflikt-Merge
- Netzwerkkarte: Hosts, Subnetze und konfigurierte Tunnel/Jumps als Graph (react-flow)
- Import aus PuTTY und Termius

**Später**

- macOS; optionaler E2EE-Sync-Server
- Serial, Telnet, Mosh; KI-gestützte Befehlsvorschläge

**Nicht-Ziele**

- Kein RDP/VNC; keine Mobile-App, kein Pflicht-Cloud-Account
- Kein C2-Framework, kein Metasploit-Ersatz
- Offensive Pentest-Werkzeuge gehören ins separate Pentest-Modul, nicht in den Core

## 3. Technologie-Stack und Architekturentscheidungen

Empfehlung: **Wails v2** (Go-Backend) + **React/TypeScript** im System-WebView + **xterm.js**. Das reife Web-Terminal bleibt, aber die App kompiliert zu einer einzigen nativen Binary — kein Electron, kein Node-Runtime, kein Native-Modul-Neubau.

**"Einfach bauen und benutzen":** `wails build` erzeugt eine eigenständige Datei (.exe unter Windows, Binary/AppImage unter Linux), die man doppelklickt. `wails dev` öffnet im Betrieb ein App-Fenster mit Hot-Reload — kein Server, den man von Hand betreut.

**Warum Wails statt Electron:** Packaging war mit Electron der ständige Schmerz (native Module gegen die ABI neu bauen). Wails umgeht das: Go kompiliert statisch zu einem Binary, der WebView kommt vom Betriebssystem. Terminal und gesamte UI bleiben Web (xterm.js, React, Tailwind, Animationen) — schöne Visuals sind voll möglich, nur das Backend ist Go.

| Baustein | Wahl | Hinweis |
| --- | --- | --- |
| Shell / Packaging | Wails v2 | eine native Binary; `wails build`; kein Node, kein Native-Modul-Gebastel |
| Backend | Go | statisch gelinkt, einfache Cross-Compilation |
| Frontend | React + TypeScript im System-WebView | volle Web-UI: Tailwind/CSS, Animationen, schöne Visuals |
| Terminal | xterm.js + Addons (fit, webgl, search, unicode11) | unverändert das reife Web-Terminal |
| SSH | golang.org/x/crypto/ssh + pkg/sftp | Auth, -L/-R/-D, Agent, SFTP; ProxyJump über Dial-Ketten |
| PTY (lokal) | creack/pty (Unix), ConPTY (Windows) | für lokale Terminals; später |
| Krypto / Vault | Go stdlib: argon2 (x/crypto/argon2) + XChaCha20-Poly1305 (x/crypto/chacha20poly1305) | keine eigene Krypto |
| Persistenz | verschlüsselte Vault-Datei (JSON) + optional SQLite (modernc.org/sqlite, pure Go) | pure-Go SQLite = kein CGo, einfaches Cross-Build |
| Netzwerkkarte | react-flow | im Frontend |
| Bindings / IPC | Wails-Bindings (Go-Methoden ↔ JS, auto-generiert) + Events | kein manuelles IPC-Verdrahten |
| Tests | Go `go test`; Frontend Vitest; Integration gegen Docker-OpenSSH |  |

**Abstraktionen trotzdem:** SSH, PTY, Terminal und Vault hinter Go-Interfaces (`SshTransport`, `TerminalEngine`, `SecretStore`) kapseln, damit ein späterer Wechsel kein Umbau wird.

**Greenfield:** von Grund auf neu, kein Fork. Der KI-Agent arbeitet in sauberem, selbst erzeugtem Go/TS besser als in einer großen Fremdbasis. Tabby (Electron) dient höchstens als Referenz für UI-Muster, Code wird nicht übernommen.

**Sicherheit (Wails):** Der WebView lädt nur lokale, gebündelte Assets; nur explizit gebundene Go-Methoden sind aus dem Frontend erreichbar; Terminal-Output wird nie als HTML interpretiert; der Vault-Schlüssel bleibt im Go-Prozess, das Frontend sieht ihn nie. Details in Kapitel 6.

## 4. Architektur und Projektstruktur

Wails trennt sauber: ein **Frontend** im System-WebView (React + xterm.js) und ein **Go-Backend** mit allen Services. Dazwischen die auto-generierten Wails-Bindings — das Frontend ruft Go-Methoden auf, das Backend sendet Events zurück. Alles Sicherheitsrelevante (SSH, Keys, Vault) lebt im Go-Prozess.

&#91;embedded content: Wails-Architektur · Frontend, Bindings, Go-Backend, externe Systeme\]

Projektstruktur: `frontend/` (React-UI, xterm.js, react-flow) und `backend/` mit Paketen `ssh`, `pty`, `vault`, `data` sowie den Interfaces `SshTransport`, `TerminalEngine`, `SecretStore` in einem `core`-Paket, dazu Tests. Das Frontend hält keine Secrets und öffnet keine Netzwerkverbindungen selbst — es ruft nur gebundene Go-Methoden. So bleibt eine XSS aus bösartigem Terminal-Output im WebView gefangen und erreicht weder Keys noch Sockets.

## 5. Feature-Spezifikation

Jedes Feature hat ein prüfbares Akzeptanzkriterium; der Coding Agent darf ein Feature erst als fertig melden, wenn das Kriterium als Test oder dokumentierter manueller Check erfüllt ist.

| ID | Feature | Phase | Akzeptanzkriterium |
| --- | --- | --- | --- |
| F-01 | Hosts und Gruppen | MVP | Host mit Adresse, Port, Identität; Gruppen vererben Port, User, Keepalive; Host-Wert überschreibt Gruppe |
| F-02 | Command Palette / Quick Connect | MVP | Ctrl+K; Fuzzy-Suche über Name, Adresse, Tags; user@host:port direkt verbindbar |
| F-03 | Verschlüsselter Vault | MVP | Alles Geheime verschlüsselt auf Platte; App startet gesperrt; Auto-Lock nach X Minuten |
| F-04 | Keychain | MVP | Ed25519/RSA generieren; Import OpenSSH und PuTTY .ppk; Public Key per Klick kopieren |
| F-05 | Agent-Integration | MVP | Anmeldung über Windows-OpenSSH-Agent und Pageant ohne Key im Vault |
| F-06 | Known Hosts | MVP | Erstverbindung zeigt SHA256-Fingerprint; geänderter Host Key blockiert mit klarer Warnung |
| F-07 | Terminal (xterm.js) | MVP | vim, tmux, htop, mc fehlerfrei; Truecolor; Resize ohne Fehler; 50-MB-cat friert UI nicht ein |
| F-08 | Tabs und Split Panes | MVP | Horizontal/vertikal teilen; Tabs per Drag umsortieren; Fokus per Tastatur |
| F-09 | Tab-Gruppen nach Host | MVP | Sessions eines Hosts in einer farbcodierten Gruppe; ein-/ausklappbar |
| F-10 | Neues Terminal (Verzeichnis) | MVP | Je ein Befehl: Default-Verzeichnis, aktuelles, als root im aktuellen |
| F-11 | Scrollback und Suche | MVP | ≥ 10.000 Zeilen konfigurierbar; Suche mit Regex und Hervorhebung |
| F-12 | SFTP-Browser | MVP | Zweispaltig lokal/remote; Drag and Drop; Transfer-Queue mit Fortschritt und Abbruch |
| F-13 | Port Forwarding | MVP | Regeln -L, -R, -D speichern; Status sichtbar; optional mit Host starten |
| F-14 | Proxy-Profile | MVP | ProxyJump und ProxyCommand pro Host; Export einer proxychains-Konfiguration |
| F-15 | Snippets | MVP | Snippet mit Variablen wie {{VAR}}; Werteabfrage vor dem Senden |
| F-17 | Notizen je Host | MVP | Ordner und Unterseiten je Host; Markdown; durchsuchbar |
| F-20 | TOTP-Generator | MVP | TOTP-Secret je Host/Dienst; Code mit Countdown; Einfügen bei 2FA-Prompt |
| F-21 | Session-Logging | MVP | Mitschnitt pro Session mit Zeitstempeln; ein/aus pro Host; Passwort-Echo nie mitschneiden |
| F-22 | Import ssh\_config | MVP | Host, HostName, User, Port, IdentityFile, ProxyJump übernommen; Unbekanntes gemeldet |
| F-23 | Lokale Terminals | MVP | PowerShell, cmd, WSL bzw. bash/zsh als Tab über PTY |
| F-25 | Jump-Ketten | v1 | Kette über ≥ 3 Hops; jeder Hop mit eigener Identität |
| F-26 | Broadcast Input | v1 | Eingabe gleichzeitig an ausgewählte Sessions; deutliche Markierung |
| F-27 | Auto-Reconnect / Restore | v1 | Wiederverbindung mit Backoff; Tabs und Split-Layout nach Neustart wiederhergestellt |
| F-28 | Remote-Edit | v1 | Remote-Datei im lokalen Editor; Speichern lädt hoch; paralleler Konflikt erkannt |
| F-29 | Datei-Sync | v1 | Vault über Google Drive/Syncthing; Konflikt wird erkannt und gemerged |
| F-30 | Import PuTTY / Termius | v1 | Import von PuTTY (Registry / .reg / Sessions) und Termius (JSON / CSV); Hosts, Keys, Gruppen, Tunnel übernommen |
| F-31 | Raw TCP Socket & Listener | v1 | Raw-TCP-Client mit Line-Buffering & Local-Echo (HTTP/Redis/SMTP); Inbound-TCP-Listener zum Fangen von Reverse Shells mit automatischem Terminal-Tab |
| F-37 | Netzwerkkarte | v1 | Hosts, Subnetze und konfigurierte Tunnel/Jumps als Graph (react-flow); Visualisierung |
| F-41 | WinRM Client (PowerShell Remoting) | v1 | WinRM Management für Windows Hosts (Port 5985/5986, NTLM/Kerberos/Pass-the-Hash, Evil-WinRM Parität) |

Spezialisierte Zusatzfunktionen stehen in einem separaten [Zusatzmodul](https://claude.ai/artifact/LjwimF4gRBxm7oi19EGTi3) mit eigener Spec.

## 6. Sicherheitsanforderungen und Threat Model

Dieser Client bündelt Zugangsdaten zu vielen Servern; Vault und Host-Key-Prüfung sind damit die wichtigsten Sicherheitsfunktionen, und der sandboxed Renderer ist die zweite Verteidigungslinie.

| Bedrohung | Szenario | Gegenmaßnahme (Anforderung) |
| --- | --- | --- |
| Diebstahl der Vault-Datei | Malware oder Backup-Leak kopiert die Datei | Master-Passwort mit Argon2id; Verschlüsselung XChaCha20-Poly1305 oder AES-256-GCM; Entsperrkomfort (OS-Keychain, Windows Hello) nie als einziger Schutz |
| Renderer-Kompromittierung | Bösartiger Terminal-Output oder Finding-Text schleust Skript ein | contextIsolation an, nodeIntegration aus, Sandbox an, strenge CSP; Output und Notizen nie als HTML interpretieren |
| Man-in-the-Middle | Angreifer präsentiert falschen Host Key | Trust on First Use mit Fingerprint-Anzeige; Key-Änderung blockiert hart, kein Standard-Button zum Trotzdem-Verbinden |
| Schwache Kryptografie | Server oder Angreifer erzwingt alte Algorithmen | Nur moderne KEX/Cipher/MAC; Legacy pro Host bewusst zuschaltbar mit Warnung; Strict KEX gegen Terrapin |
| Geheimnisse im Klartext | Passwörter in Logs, Session-Mitschnitten, Crash-Dumps | Logging mit Redaction; Passwort-Eingaben (Echo aus) nie mitschneiden; Crash-Reports ohne Speicherinhalt |
| Secrets im Snippet | Credentials fest in Snippet-Ketten | Snippets referenzieren Vault-Einträge per ID, speichern Geheimnisse nicht im Klartext |
| TOTP-Secret-Diebstahl | Gestohlenes Seed erzeugt beliebig Codes | TOTP-Seeds liegen im Vault, nie im Klartext; Export nur nach erneuter Entsperrung |
| Terminal-Escape-Injection | Server sendet Escape-Sequenzen | OSC 52 (Clipboard schreiben) aus oder mit Nachfrage; OSC 8 Hyperlinks nur bestätigt öffnen; Fenstertitel bereinigen |
| Paste-Angriffe | Kopierter Befehl enthält versteckte Umbrüche | Bracketed Paste; Warnung bei mehrzeiligem Einfügen |
| Agent Forwarding | Kompromittierter Server nutzt den weitergeleiteten Agent | Standardmäßig aus; pro Host aktivierbar mit Hinweis |
| Zwischenablage | Passwort bleibt in der Zwischenablage | Kopierte Geheimnisse nach 30 s löschen und aus der Windows-Zwischenablage-History ausnehmen |
| Supply Chain | Kompromittiertes npm-Paket (großer Electron-Baum) | Lockfile, wenige Abhängigkeiten, SBOM pro Release, `npm audit` und Dependency-Pinning in CI |
| Manipulierte Updates | Gefälschtes Update-Paket | Code-Signing; Updates nur signiert über HTTPS; Signatur vor Installation prüfen |
| Sync-Dienst | Google Drive sieht die Vault-Datei | Es wird nur die bereits verschlüsselte Vault-Datei synchronisiert; der Dienst sieht nur Ciphertext |

**Regeln für den Coding Agent:** Keine eigene Kryptografie, nur libsodium oder Plattform-APIs. Jede Änderung an Vault, Auth, TOTP oder Host-Key-Prüfung bekommt einen eigenen Test und wird manuell reviewed. Die App ist für autorisierte Tests; Session-Logs und Evidence sind Nachweise, kein Freibrief.

## 7. UI/UX und Design-Richtlinien

Die gesamte Oberfläche ist auf Englisch. Das Layout folgt dem bewährten Termius/Tabby-Muster (Sidebar links, Tabs oben), der Unterschied liegt in Host-Gruppierung, Notizen und ruhigem Design im Stil von Windows Terminal.

**Layout**

- Linke Sidebar: Hosts, Keychain, Snippets, Tunnels und Proxy, SFTP, Notes, Evidence, Credentials, Attack-Ops, Settings
- Hostliste als Karten oder kompakte Liste (umschaltbar), Gruppen als Ordner
- Terminal-Tabs oben, pro Host in einer farbcodierten Tab-Gruppe; Statuspunkt je Session (verbunden, verbindet, getrennt)
- Rechts einklappbares Notes-Panel zum aktuellen Host; Statusleiste unten mit aktiven Tunneln, Transfers und Latenz

**Design-Sprache**

- Dunkles Theme als Standard im Geist von Windows Terminal (gedeckt, modern, nicht neon-"hacker"); helles Theme gleichwertig; wählbare Akzentfarbe
- Mitgelieferte Terminal-Farbschemata (z. B. One Half Dark, Campbell, Dracula, Catppuccin-artig); Import von Schemata im gängigen JSON-Format
- Eigene, themebare Fensterdekoration; unter Windows 11 optional Mica/Acrylic
- Schriften mit Ligaturen (Cascadia Code, JetBrains Mono); Zoom per Ctrl+Mausrad
- Dezente Animationen (Tab-Öffnen, Panel-Wechsel), abschaltbar

**Bedienung**

- Command Palette (Ctrl+K) für alles: verbinden, Snippet/Kette starten, Tunnel öffnen, Beweis sichern, Einstellung ändern
- Split-Button "Neues Terminal" mit den drei Verzeichnis-Optionen (Default, aktuell, root im aktuellen)
- Kontextmenü auf Terminalauswahl: "Save as credential", "Save as evidence", "New snippet from selection"
- Alle Shortcuts konfigurierbar; Konflikte mit Terminal-Programmen (Ctrl+W, Ctrl+T) über ein Präfix lösbar
- Copy on Select optional; Rechtsklick-Verhalten wählbar (PuTTY-Stil oder Kontextmenü); optionaler Quake-Modus

**Barrierefreiheit:** Vollständige Tastaturbedienung, Kontraste nach WCAG AA, Screenreader-Labels für alle Bedienelemente außerhalb des Terminals.

## 8. Datenmodell

Alles liegt im verschlüsselten Vault; unverschlüsselt bleiben nur App-Einstellungen und die abschaltbare History. Auch Hostliste, Adressen und Usernamen liegen im Vault, denn eine Hostliste ist bereits wertvolle Aufklärung. Die Entitäten des separaten Zusatzmoduls stehen in dessen eigener Spec.

| Entität | Wichtige Felder | Speicherort |
| --- | --- | --- |
| Host | Id, Label, Address, Port, GroupId, IdentityId, Tags, Color, JumpChain, ForwardRuleIds, Overrides | Vault |
| Group | Id, Name, ParentId, DefaultSettings (vererbbar) | Vault |
| Identity | Id, Label, Username, AuthMethod (Password, Key, Agent, Interactive), SecretRef, KeyId, TotpId | Vault |
| SshKey | Id, Label, Type, PublicKey, PrivateKey (verschlüsselt), Passphrase, Fingerprint | Vault |
| KnownHost | HostPattern, Port, KeyType, Fingerprint (SHA256), FirstSeen, LastSeen | Eigene Datei, OpenSSH-kompatibel |
| Snippet | Id, Name, Body, Variables, Tags, ConfirmBeforeRun | Vault |
| ForwardRule | Id, Type (L, R, D), BindAddress, BindPort, TargetHost, TargetPort, AutoStart | Vault |
| ProxyProfile | Id, Name, Chain (ProxyJump/ProxyCommand/SOCKS), ProxychainsExport | Vault |
| TotpSecret | Id, Label, Secret (verschlüsselt), Algorithm, Digits, Period, HostId | Vault |
| NotePage | Id, HostId, ParentId, Title, Type (Markdown oder Tabelle), Body, Order | Vault |
| Settings | Theme, Fonts, Shortcuts, Terminal-Optionen, Security-Defaults | settings.json (nicht geheim) |
| History | HostId, ConnectedAt, Dauer, Ergebnis | SQLite (nicht geheim, abschaltbar) |
| Workspace | Offene Tabs, Tab-Gruppen, Split-Layout, zugehörige HostIds | workspace.json für Session-Restore |

**Vault-Format:** Header (Version, KDF-Parameter, Salt) plus Ciphertext eines JSON-Dokuments. Schreiben atomar (temp-Datei und Rename), automatisches Backup der letzten N Versionen, Versionsfeld für Migrationen ab Tag 1. Diese eine verschlüsselte Datei ist auch die Einheit für den optionalen Datei-Sync.

## 9. Roadmap und Meilensteine

M0 (Gerüst und Spikes) kommt vor jeder Feature-Arbeit: Electron-Skelett, portable Builds für beide Plattformen und die zwei riskanten PoCs (ssh2-Verbindung, Vault-Krypto) legen das Fundament fest.

&#91;embedded content: Roadmap · M0 Gerüst/Spikes bis M4 Release, 5 Gates\]

Die Gates sind Qualitätskriterien, keine Termine. Nach dem MVP folgt v1 in derselben Logik: Attack-Ops-Konsole (Listener, Payloads), ligolo-ng und chisel, Jump-Ketten, Broadcast Input, Auto-Reconnect und Session-Restore, Remote-Edit, Datei-Sync, die interaktive Netzwerkkarte mit Pivot-Health-Check sowie der nmap-Import.

## 10. Leitlinien für den Coding Agent

Der Agent arbeitet in kleinen, vertikalen Slices; jeder Slice endet mit grünem Build, grünen Tests und einem erfolgreichen portablen Build für Windows und Linux.

**Repo-Setup (zuerst anzulegen)**

- `docs/SPEC.md`: dieses Dokument als Markdown-Export, einzige Quelle der Wahrheit
- `docs/adr/`: eine Architecture Decision Record pro Entscheidung aus Kapitel 3 (Electron vs. Tauri, Fork vs. Greenfield, SSH-Lib, KDF)
- `AGENTS.md` bzw. `CLAUDE.md`: Build-Befehle, Konventionen, die Regeln unten
- CI (GitHub Actions): Lint, Typecheck, Tests, `electron-builder` für portable Win- und Linux-Artefakte

**Harte Regeln**

1. TypeScript strict; ESLint als Fehler; kein `any` ohne ADR.
2. Electron-Sicherheit ist nicht verhandelbar: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strenge CSP, jede IPC nur typisiert über das Preload-Skript; Terminal-Output nie als HTML interpretieren.
3. Keine eigene Kryptografie; nur libsodium oder Node crypto. Vault, Auth und TOTP nur mit Tests.
4. ssh2, node-pty, Terminal und Vault nur über die Interfaces `ISshTransport`, `ITerminalEngine`, `ISecretStore`.
5. Neue npm-Pakete nur nach Rückfrage und nur, wenn sie gepflegt und schlank sind; `npm audit`, Lockfile und SBOM in CI.
6. Jedes Feature referenziert seine F-ID aus Kapitel 5 im Commit und im Test.
7. Integrationstests laufen gegen einen OpenSSH-Server im Docker-Container (Passwort, Key, 2FA, Jump Host).
8. Die gesamte UI ist Englisch; keine deutschen Strings im Produkt. Die App orchestriert Standardwerkzeuge (Payload-Vorlagen, Tunnel), liefert aber keine zielspezifischen Exploits.

**Arbeitsweise mit dem Agent**

- Pro Sitzung genau ein Meilenstein-Teilziel; vorher Plan zeigen lassen, dann umsetzen
- Spikes (Terminal, SSH-Lib, KDF, Electron-vs-Tauri) als eigene Wegwerf-Projekte mit Ergebnisbericht in `docs/spikes/`
- UI erst gegen Mock-Services bauen, dann echte Services anbinden
- Nach jedem Meilenstein testest du manuell gegen deine Lab-Hosts; Findings gehen als Issues zurück

**Lauffähiges Executable zuerst — und nach jeder Phase.** Bevor irgendein Feature gebaut wird, erstellt der Agent einen lauffähigen Prototyp: ein gepacktes, eigenständiges Executable (zunächst nur ein Fenster) in einem Ordner, der alles zum Starten enthält — portable .exe für Windows, .AppImage für Linux, ohne Vorinstallation. Das Packaging wird als Erstes zum Laufen gebracht und festgenagelt (Gerüst via electron-vite, nicht handgeschrieben). Danach endet JEDE Phase wieder mit einem aktualisierten, lauffähigen Executable im selben Ordner; läuft es nicht eigenständig, gilt die Phase als nicht fertig. Gegen genau den Packaging-Schmerz: die Kern-SSH-App braucht keine nativen Module — Remote-Terminals laufen über ssh2 (reines JS), Krypto über libsodium-wrappers (WASM); node-pty (lokale Terminals) und SQLite kommen erst später, bewusst, wenn das Packaging schon steht.

**Zwei Specs.** Diese Datei ist die Core-Spec. Das separate Zusatzmodul hat eine eigene Spec und wird erst gebaut und gefüttert, wenn der Core inkl. lauffähigem Executable steht. Bis dahin kommen Features nur aus dieser Core-Spec.

**Modell-Phasen (AI-modell-agnostisch).** Es werden zwei Modell-Stufen genutzt, unabhängig vom Anbieter: ein **schnelles Modell** (günstig, flott) und ein **Flagship-Modell** (stärkstes verfügbares). Du mappst deine konkreten Modelle auf diese zwei Stufen. Jeder Meilenstein läuft in zwei Stufen in fester Reihenfolge, schnelles Modell zuerst, Flagship zuletzt — so endet jede Phase sicher und schlank:

1. **Schnelles Modell** — Gerüst, Boilerplate, mechanische Verdrahtung, offensichtliche CRUD/UI nach Muster, Test-Stubs. Kein sicherheitskritischer Code.
2. **Flagship-Modell** — Feature-Logik und Abschluss: Mock- auf echte Services, Edge-Cases, dann Security-Review (Electron-Defaults, Preload-IPC, Vault/Krypto, Auth, Host-Key), Code straffen (concise), Akzeptanzkriterien prüfen, Doku aktualisieren, Gate schließen. Der Meilenstein ist erst fertig, wenn diese Stufe grün ist. Sicherheitskritischer Code entsteht oder wird nur hier geprüft.

Kann die IDE das Modell nicht automatisch wechseln (z. B. Antigravity), stoppt der Agent an der Stufengrenze und zeigt einen deutlichen Wechsel-Marker (⚡ schnelles Modell / 🔶 Flagship); du wechselst mit `/model`, bevor es weitergeht. Die aktuelle Stufe steht in `docs/tech/STATE.md`. Vollständige Regeln und Banner in der AGENTS.md.

## 11. Offene Fragen zum Brainstorming

Entschieden: Windows und Linux (Kali), Web-UI mit xterm.js (Electron), dateibasierter Sync über Google Drive, Pentest als Zielgruppe, englische UI, Name DoubleAgent; Stack greenfield (Electron + React), Ketten mit Bestätigung je Schritt, aktive Pivot-Steuerung aus der UI mit Netzwerkkarte als Steuerpult. Alle acht Punkte unten sind entschieden; offen bleibt nur der Logo-Feinschliff (H).

- [ ] **A. Electron oder Tauri?** Electron ist reifer und hat mit Tabby eine Referenz; das Terminal-Rendering (xterm.js + WebGL) ist auf allen Plattformen erprobt. Tauri wäre deutlich kleiner und sparsamer, aber das Linux-Rendering (WebKitGTK) müsste vorab getestet werden. Entschieden: Electron.
- [ ] **B. Fork von Tabby oder Greenfield?** Tabby bringt SSH, SFTP, Jumps, Proxy und einen Secret-Container fertig mit; ein Fork spart Monate, bindet aber an Angular. Greenfield gibt freie Wahl, kostet aber den SSH-Unterbau. Entschieden: Greenfield (Electron + React), Tabby als Referenz. Grund: der Pentest-Layer ist ohnehin Eigenbau, ein KI-Agent arbeitet in sauberem, selbst erzeugtem Code besser als in Tabbys großer Angular-Basis, und der Merge-Aufwand entfällt.
- [ ] **C. UI-Framework:** React (frei) oder Angular (falls Tabby-Fork). Entschieden: React (react-flow für die Netzwerkkarte, meiste KI-Trainingsdaten).
- [ ] **D. Wie weit automatisieren Snippet-Ketten?** Ein-Klick bis root ist mächtig, aber riskant (falscher Host). Entschieden: Bestätigung je Schritt als Default; "ohne Nachfrage" nur bewusst pro Kette freischaltbar.
- [ ] **E. Pivoting-Tiefe:** Nur Profile verwalten und Startkommandos generieren (ligolo-ng, chisel, proxychains-Export), oder auch Sessions/Routen/Listener aktiv steuern? Entschieden: aus der UI steuern — Sessions, Routen und Listener aktiv aus DoubleAgent heraus; die Netzwerkkarte ist Steuerpult und Statusanzeige zugleich. Großer Aufwand, daher v1 als eigenes Subsystem.
- [ ] **F. ligolo-ng/chisel-Binaries:** bündeln oder nur verwalten? Entschieden: aus der UI steuern (ligolo-Proxy und -Agent starten/stoppen, Routen und Listener anlegen, Session-Status lesen); Binaries werden lokalisiert oder optional gebündelt.
- [ ] **G. Lizenz und Vertrieb:** Verkauf unwahrscheinlich, aber offenhalten. Entschieden: Repo vorerst proprietär und konsequent copyleft (GPL/AGPL) vermeiden; der Stack (xterm.js, node-pty, ssh2, React, react-flow, libsodium) ist durchweg permissiv und damit verkaufsoffen.
- [ ] **H. Name:** DoubleAgent — entschieden; erster Logo-Entwurf steht, Feinschliff später.
