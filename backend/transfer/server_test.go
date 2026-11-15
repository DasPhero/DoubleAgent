package transfer

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"doubleagent/backend/core"
)

func TestComputeFileHashes_F31(t *testing.T) {
	tmpDir := t.TempDir()
	sampleFile := filepath.Join(tmpDir, "linpeas.sh")
	content := "#!/bin/bash\nid\n"
	if err := os.WriteFile(sampleFile, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	sha, md5Hex, size, err := ComputeFileHashes(sampleFile)
	if err != nil {
		t.Fatalf("ComputeFileHashes failed: %v", err)
	}
	if size != int64(len(content)) {
		t.Fatalf("unexpected size: %d", size)
	}
	if len(sha) != 64 || len(md5Hex) != 32 {
		t.Fatalf("expected valid sha256 (64) and md5 (32), got sha=%q md5=%q", sha, md5Hex)
	}
}

func TestManagedServer_DownloadUploadTraversalAndAuth_F31(t *testing.T) {
	tmpDir := t.TempDir()
	stagedFile := filepath.Join(tmpDir, "linpeas.sh")
	stagedContent := "#!/bin/sh\necho pwn\n"
	if err := os.WriteFile(stagedFile, []byte(stagedContent), 0o600); err != nil {
		t.Fatal(err)
	}

	// Verify port 0 is rejected cleanly
	if _, err := StartServer(core.FileTransferServerConfig{
		Name:         "Invalid Port",
		Kind:         core.FileServerKindBuiltin,
		Directory:    tmpDir,
		BindAddress:  "127.0.0.1",
		Port:         0,
		EnableUpload: true,
	}, nil); err == nil {
		t.Fatal("expected error for port 0")
	}

	srv, err := StartServer(core.FileTransferServerConfig{
		Name:         "Test Staging",
		Kind:         core.FileServerKindBuiltin,
		Directory:    tmpDir,
		BindAddress:  "127.0.0.1",
		Port:         19841,
		EnableUpload: true,
	}, nil)
	if err != nil {
		t.Fatalf("failed to start staging server: %v", err)
	}
	defer func() { _ = srv.Stop(context.Background()) }()

	handler := srv.routes()

	// 1. Download staged file
	req := httptest.NewRequest(http.MethodGet, "/linpeas.sh", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != stagedContent {
		t.Fatalf("unexpected GET response: status=%d body=%q", rec.Code, rec.Body.String())
	}

	// 2. Traversal attack blocked
	travReq := httptest.NewRequest(http.MethodGet, "/..%2f..%2fetc/passwd", nil)
	travRec := httptest.NewRecorder()
	handler.ServeHTTP(travRec, travReq)
	if travRec.Code != http.StatusForbidden && travRec.Code != http.StatusNotFound {
		t.Fatalf("expected 403/404 for traversal request, got %d", travRec.Code)
	}

	// 3. Multipart Upload (exfil)
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", "../loot_shadow.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fw.Write([]byte("root:*:19000:0:99999:7:::\n"))
	_ = mw.Close()

	upReq := httptest.NewRequest(http.MethodPost, "/upload", &buf)
	upReq.Header.Set("Content-Type", mw.FormDataContentType())
	upRec := httptest.NewRecorder()
	handler.ServeHTTP(upRec, upReq)
	if upRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for upload, got %d (%s)", upRec.Code, upRec.Body.String())
	}

	// Verify file was safely stripped of ../ and stored inside tmpDir
	savedContent, err := os.ReadFile(filepath.Join(tmpDir, "loot_shadow.txt"))
	if err != nil {
		t.Fatalf("expected sanitized upload inside staging dir, got err: %v", err)
	}
	if !strings.Contains(string(savedContent), "root:*:") {
		t.Fatalf("unexpected uploaded content: %q", string(savedContent))
	}

	info := srv.Info()
	if info.ServedCount < 1 || info.UploadCount < 1 {
		t.Fatalf("expected ServedCount >= 1 and UploadCount >= 1, got %+v", info)
	}
}

func TestManagedServer_UploadDisabledAndBasicAuth_F31(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "secret.ps1"), []byte("whoami"), 0o600); err != nil {
		t.Fatal(err)
	}

	srv, err := StartServer(core.FileTransferServerConfig{
		Name:              "Auth Staging",
		Kind:              core.FileServerKindBuiltin,
		Directory:         tmpDir,
		BindAddress:       "127.0.0.1",
		Port:              19842,
		EnableUpload:      false,
		BasicAuthUser:     "operator",
		BasicAuthPassword: "s3cr3t-password",
	}, nil)
	if err != nil {
		t.Fatalf("failed to start staging server: %v", err)
	}
	defer func() { _ = srv.Stop(context.Background()) }()

	handler := srv.routes()

	// Unauthenticated request -> 401
	unauthReq := httptest.NewRequest(http.MethodGet, "/secret.ps1", nil)
	unauthRec := httptest.NewRecorder()
	handler.ServeHTTP(unauthRec, unauthReq)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized without credentials, got %d", unauthRec.Code)
	}

	// Authenticated GET -> 200
	authReq := httptest.NewRequest(http.MethodGet, "/secret.ps1", nil)
	authReq.SetBasicAuth("operator", "s3cr3t-password")
	authRec := httptest.NewRecorder()
	handler.ServeHTTP(authRec, authReq)
	if authRec.Code != http.StatusOK || authRec.Body.String() != "whoami" {
		t.Fatalf("expected 200 with basic auth, got %d %q", authRec.Code, authRec.Body.String())
	}

	// Authenticated PUT while uploads disabled -> 403
	putReq := httptest.NewRequest(http.MethodPut, "/upload/test.bin", io.NopCloser(strings.NewReader("abc")))
	putReq.SetBasicAuth("operator", "s3cr3t-password")
	putRec := httptest.NewRecorder()
	handler.ServeHTTP(putRec, putReq)
	if putRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when upload receiver disabled, got %d", putRec.Code)
	}
}
