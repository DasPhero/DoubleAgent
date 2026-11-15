package transfer

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"doubleagent/backend/core"
)

const (
	maxUploadBytes  = 512 << 20 // 512 MiB cap for target exfil uploads
	maxEventHistory = 50
)

func generateServerID(port uint16) string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return fmt.Sprintf("ftsrv-%d-%s", port, hex.EncodeToString(b))
}

// ManagedServer hosts a native Go HTTP staging & upload catcher server rooted at a specific folder (F-31).
type ManagedServer struct {
	id         string
	cfg        core.FileTransferServerConfig
	absRoot    string
	listener   net.Listener
	httpServer *http.Server
	startedAt  time.Time
	onEvent    func(serverID string, evt core.FileTransferEvent)

	mu           sync.RWMutex
	running      bool
	servedCount  int
	uploadCount  int
	recentEvents []core.FileTransferEvent
}

// StartServer validates cfg and starts a native HTTP staging server on BindAddress:Port (F-31).
func StartServer(cfg core.FileTransferServerConfig, onEvent func(serverID string, evt core.FileTransferEvent)) (*ManagedServer, error) {
	if err := core.ValidateFileTransferConfig(cfg); err != nil {
		return nil, err
	}

	absRoot, err := filepath.Abs(strings.TrimSpace(cfg.Directory))
	if err != nil {
		return nil, fmt.Errorf("failed to resolve directory: %w", err)
	}
	// Resolve symlinks on root so containment checks are reliable on Windows & Linux
	if evalRoot, evalErr := filepath.EvalSymlinks(absRoot); evalErr == nil {
		absRoot = evalRoot
	}

	bindAddr := strings.TrimSpace(cfg.BindAddress)
	if bindAddr == "" {
		bindAddr = "0.0.0.0"
	}

	addr := net.JoinHostPort(bindAddr, fmt.Sprintf("%d", cfg.Port))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("failed to bind staging server to %s: %w", addr, err)
	}

	actualPort := cfg.Port
	if tcpAddr, ok := ln.Addr().(*net.TCPAddr); ok && tcpAddr.Port > 0 {
		actualPort = uint16(tcpAddr.Port)
	}
	cfg.Port = actualPort
	cfg.BindAddress = bindAddr
	if strings.TrimSpace(cfg.Name) == "" {
		cfg.Name = fmt.Sprintf("Staging :%d", actualPort)
	}
	cfg.Kind = core.FileServerKindBuiltin

	srvID := strings.TrimSpace(cfg.ID)
	if srvID == "" {
		srvID = generateServerID(actualPort)
	}
	cfg.ID = srvID

	ms := &ManagedServer{
		id:           srvID,
		cfg:          cfg,
		absRoot:      absRoot,
		listener:     ln,
		startedAt:    time.Now(),
		onEvent:      onEvent,
		running:      true,
		recentEvents: make([]core.FileTransferEvent, 0, 16),
	}

	ms.httpServer = &http.Server{
		Handler:           ms.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		err := ms.httpServer.Serve(ln)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			ms.recordEvent(core.FileTransferEvent{
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Method:    "SYS",
				Path:      "/",
				Status:    500,
				Note:      err.Error(),
			})
		}
		ms.mu.Lock()
		ms.running = false
		ms.mu.Unlock()
	}()

	return ms, nil
}

// ID returns the unique server instance ID.
func (ms *ManagedServer) ID() string {
	return ms.id
}

// Port returns the actual bound TCP port.
func (ms *ManagedServer) Port() uint16 {
	return ms.cfg.Port
}

// Stop gracefully shuts down the HTTP staging server and releases its socket (F-31).
func (ms *ManagedServer) Stop(ctx context.Context) error {
	ms.mu.Lock()
	if !ms.running && ms.httpServer == nil {
		ms.mu.Unlock()
		return nil
	}
	ms.running = false
	ms.mu.Unlock()

	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
	}

	err := ms.httpServer.Shutdown(ctx)
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		_ = ms.listener.Close()
		return err
	}
	return nil
}

// Info returns a snapshot of telemetry, config, OPSEC warnings, and recent events (F-31).
func (ms *ManagedServer) Info() core.FileTransferServerInfo {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	eventsCopy := make([]core.FileTransferEvent, len(ms.recentEvents))
	copy(eventsCopy, ms.recentEvents)

	hasAuth := strings.TrimSpace(ms.cfg.BasicAuthUser) != "" || ms.cfg.BasicAuthPassword != ""
	status := "running"
	if !ms.running {
		status = "stopped"
	}

	return core.FileTransferServerInfo{
		ID:             ms.id,
		Name:           ms.cfg.Name,
		Kind:           ms.cfg.Kind,
		Directory:      ms.cfg.Directory,
		BindAddress:    ms.cfg.BindAddress,
		Port:           ms.cfg.Port,
		EnableUpload:   ms.cfg.EnableUpload,
		UseTLS:         ms.cfg.UseTLS,
		ShareName:      ms.cfg.ShareName,
		HasBasicAuth:   hasAuth,
		Status:         status,
		StartedAt:      ms.startedAt.UTC().Format(time.RFC3339),
		ServedCount:    ms.servedCount,
		UploadCount:    ms.uploadCount,
		CommandPreview: core.BuildFileServerCommand(ms.cfg),
		OpsecWarnings:  core.AnalyzeFileTransferOpsec(ms.cfg.BindAddress, ms.cfg.Port, ms.cfg.UseTLS, hasAuth, ms.cfg.Kind),
		RecentEvents:   eventsCopy,
	}
}

func (ms *ManagedServer) recordEvent(evt core.FileTransferEvent) {
	ms.mu.Lock()
	if evt.Method == "GET" && evt.Status >= 200 && evt.Status < 400 {
		ms.servedCount++
	} else if (evt.Method == "POST" || evt.Method == "PUT") && evt.Status >= 200 && evt.Status < 300 {
		ms.uploadCount++
	}
	ms.recentEvents = append(ms.recentEvents, evt)
	if len(ms.recentEvents) > maxEventHistory {
		ms.recentEvents = ms.recentEvents[len(ms.recentEvents)-maxEventHistory:]
	}
	cb := ms.onEvent
	srvID := ms.id
	ms.mu.Unlock()

	if cb != nil {
		cb(srvID, evt)
	}
}

func (ms *ManagedServer) checkBasicAuth(r *http.Request) bool {
	expectedUser := ms.cfg.BasicAuthUser
	expectedPass := ms.cfg.BasicAuthPassword
	if expectedUser == "" && expectedPass == "" {
		return true
	}

	user, pass, ok := r.BasicAuth()
	if !ok {
		return false
	}

	userMatch := subtle.ConstantTimeCompare([]byte(user), []byte(expectedUser)) == 1
	passMatch := subtle.ConstantTimeCompare([]byte(pass), []byte(expectedPass)) == 1
	return userMatch && passMatch
}

func (ms *ManagedServer) routes() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !ms.checkBasicAuth(r) {
			w.Header().Set("WWW-Authenticate", `Basic realm="DoubleAgent Staging"`)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			ms.recordEvent(core.FileTransferEvent{
				Timestamp:  time.Now().UTC().Format(time.RFC3339),
				Method:     r.Method,
				Path:       r.URL.Path,
				RemoteAddr: r.RemoteAddr,
				Status:     http.StatusUnauthorized,
				Note:       "Basic Auth failed",
			})
			return
		}

		if r.URL.Path == "/upload" || strings.HasPrefix(r.URL.Path, "/upload/") {
			ms.handleUpload(w, r)
			return
		}

		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		ms.handleDownload(w, r)
	})
}

func (ms *ManagedServer) handleDownload(w http.ResponseWriter, r *http.Request) {
	relPath := strings.TrimPrefix(r.URL.Path, "/")
	targetPath, err := core.ResolveSafeHostedPath(ms.absRoot, relPath)
	if err != nil {
		http.Error(w, "Forbidden", http.StatusForbidden)
		ms.recordEvent(core.FileTransferEvent{
			Timestamp:  time.Now().UTC().Format(time.RFC3339),
			Method:     r.Method,
			Path:       r.URL.Path,
			RemoteAddr: r.RemoteAddr,
			Status:     http.StatusForbidden,
			Note:       "Traversal blocked",
		})
		return
	}

	// Verify symlink targets cannot escape ms.absRoot
	if evalTarget, evalErr := filepath.EvalSymlinks(targetPath); evalErr == nil {
		relCheck, relErr := filepath.Rel(ms.absRoot, evalTarget)
		if relErr != nil || relCheck == ".." || strings.HasPrefix(relCheck, ".."+string(filepath.Separator)) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		targetPath = evalTarget
	}

	fi, statErr := os.Stat(targetPath)
	if statErr != nil {
		http.NotFound(w, r)
		ms.recordEvent(core.FileTransferEvent{
			Timestamp:  time.Now().UTC().Format(time.RFC3339),
			Method:     r.Method,
			Path:       r.URL.Path,
			RemoteAddr: r.RemoteAddr,
			Status:     http.StatusNotFound,
		})
		return
	}

	if fi.IsDir() {
		ms.serveDirectoryListing(w, r, targetPath)
		return
	}

	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, targetPath)

	ms.recordEvent(core.FileTransferEvent{
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		Method:     r.Method,
		Path:       r.URL.Path,
		RemoteAddr: r.RemoteAddr,
		Status:     http.StatusOK,
		Bytes:      fi.Size(),
	})
}

func (ms *ManagedServer) serveDirectoryListing(w http.ResponseWriter, r *http.Request, dirPath string) {
	entries, err := core.ListHostedFiles(dirPath)
	if err != nil {
		http.Error(w, "Failed to read directory", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = fmt.Fprintf(w, "DoubleAgent File Staging Index (%s)\n", r.URL.Path)
	_, _ = fmt.Fprintf(w, "--------------------------------------------------\n")
	for _, e := range entries {
		kind := "FILE"
		if e.IsDir {
			kind = "DIR "
		}
		_, _ = fmt.Fprintf(w, "[%s] %-36s (%d bytes)\n", kind, e.Name, e.Size)
	}

	ms.recordEvent(core.FileTransferEvent{
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		Method:     r.Method,
		Path:       r.URL.Path,
		RemoteAddr: r.RemoteAddr,
		Status:     http.StatusOK,
		Note:       "Directory index",
	})
}

func (ms *ManagedServer) handleUpload(w http.ResponseWriter, r *http.Request) {
	if !ms.cfg.EnableUpload {
		http.Error(w, "Upload receiver is disabled", http.StatusForbidden)
		ms.recordEvent(core.FileTransferEvent{
			Timestamp:  time.Now().UTC().Format(time.RFC3339),
			Method:     r.Method,
			Path:       r.URL.Path,
			RemoteAddr: r.RemoteAddr,
			Status:     http.StatusForbidden,
			Note:       "Upload rejected (disabled)",
		})
		return
	}

	if r.Method != http.MethodPost && r.Method != http.MethodPut {
		http.Error(w, "Method Not Allowed (use POST multipart or PUT)", http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)

	var src io.Reader
	var rawName string

	if r.Method == http.MethodPost && strings.Contains(strings.ToLower(r.Header.Get("Content-Type")), "multipart/form-data") {
		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, fmt.Sprintf("Invalid multipart upload field 'file': %v", err), http.StatusBadRequest)
			return
		}
		defer func() { _ = file.Close() }()
		src = file
		rawName = header.Filename
	} else {
		src = r.Body
		rawName = strings.TrimPrefix(r.URL.Path, "/upload")
		rawName = strings.TrimPrefix(rawName, "/")
		if rawName == "" {
			rawName = r.URL.Query().Get("name")
		}
		if rawName == "" {
			rawName = r.Header.Get("X-Filename")
		}
	}

	safeName := sanitizeUploadedFilename(rawName)
	destPath, err := ms.uniqueUploadPath(safeName)
	if err != nil {
		http.Error(w, "Invalid destination filename", http.StatusBadRequest)
		return
	}

	out, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o600)
	if err != nil {
		http.Error(w, "Failed to allocate uploaded file", http.StatusInternalServerError)
		return
	}

	written, copyErr := io.Copy(out, src)
	closeErr := out.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(destPath)
		http.Error(w, "Upload write error", http.StatusBadRequest)
		return
	}

	savedName := filepath.Base(destPath)
	ms.recordEvent(core.FileTransferEvent{
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		Method:     r.Method,
		Path:       "/upload/" + savedName,
		RemoteAddr: r.RemoteAddr,
		Status:     http.StatusCreated,
		Bytes:      written,
		Note:       fmt.Sprintf("Saved as %s", savedName),
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = fmt.Fprintf(w, `{"saved":%q,"bytes":%d}`, savedName, written)
}

func sanitizeUploadedFilename(raw string) string {
	normalized := strings.ReplaceAll(strings.TrimSpace(raw), "\\", "/")
	base := filepath.Base(normalized)
	if base == "" || base == "." || base == "/" || base == ".." {
		base = fmt.Sprintf("exfil-%d.bin", time.Now().Unix())
	}
	replacer := strings.NewReplacer("\x00", "", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	base = replacer.Replace(base)
	base = strings.TrimLeft(base, ".")
	if base == "" {
		base = fmt.Sprintf("exfil-%d.bin", time.Now().Unix())
	}
	return base
}

func (ms *ManagedServer) uniqueUploadPath(base string) (string, error) {
	candidate, err := core.ResolveSafeHostedPath(ms.absRoot, base)
	if err != nil {
		return "", err
	}
	if _, statErr := os.Stat(candidate); errors.Is(statErr, os.ErrNotExist) {
		return candidate, nil
	}

	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	for i := 1; i <= 999; i++ {
		alt := fmt.Sprintf("%s-%d%s", stem, i, ext)
		altPath, err := core.ResolveSafeHostedPath(ms.absRoot, alt)
		if err != nil {
			return "", err
		}
		if _, statErr := os.Stat(altPath); errors.Is(statErr, os.ErrNotExist) {
			return altPath, nil
		}
	}
	return "", errors.New("too many colliding upload filenames")
}
