package hexrunner_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"

	"doubleagent/backend/core"
	"doubleagent/backend/hexrunner"
)

// TestHexHelperProcess acts as a real child executable spawned by TestRunLocalBinaryExactBytes_F43
// so the test exercises real os/exec pipes without PTY/shell mangling.
func TestHexHelperProcess(t *testing.T) {
	if os.Getenv("DOUBLEAGENT_HEX_HELPER") != "1" {
		return
	}
	stdinBytes, err := io.ReadAll(os.Stdin)
	if err != nil {
		os.Exit(2)
	}
	// Echo exact bytes back with an inverted checksum byte appended to prove binary fidelity.
	_, _ = os.Stdout.Write(stdinBytes)
	_, _ = os.Stdout.Write([]byte{0x00, 0xff, 0x03, 0x1b})
	_, _ = fmt.Fprintf(os.Stderr, "LEN=%d", len(stdinBytes))
	os.Exit(0)
}

func TestCompilePayloadExpressionsAndCyclic_F43(t *testing.T) {
	expr := `
# mixed hex formats
41 42 00 ff // NUL + non-UTF8
\x90\x03\x1b
"HI\n"
A*4
u32le(0xdeadbeef)
u32be(0x01020304)
`
	got, err := hexrunner.CompilePayload(expr)
	if err != nil {
		t.Fatalf("CompilePayload failed: %v", err)
	}
	wantHex := "414200ff" + "90031b" + "48490a" + "41414141" + "efbeadde" + "01020304"
	want, _ := hex.DecodeString(wantHex)
	if !bytes.Equal(got, want) {
		t.Fatalf("compiled bytes mismatch:\ngot:  %x\nwant: %x", got, want)
	}

	// Cyclic generation + offset lookup (little endian hex & ASCII)
	pat := hexrunner.CyclicPattern(64)
	if len(pat) != 64 {
		t.Fatalf("expected 64-byte cyclic pattern, got %d", len(pat))
	}
	sub := string(pat[16:20])
	offset, err := hexrunner.CyclicOffset(sub)
	if err != nil || offset != 16 {
		t.Fatalf("CyclicOffset(%q) = %d, err=%v; want 16", sub, offset, err)
	}
	// Little endian uint32 lookup for bytes pat[24:28]
	leHex := fmt.Sprintf("0x%02x%02x%02x%02x", pat[27], pat[26], pat[25], pat[24])
	offsetHex, err := hexrunner.CyclicOffset(leHex)
	if err != nil || offsetHex != 24 {
		t.Fatalf("CyclicOffset(%q) = %d, err=%v; want 24", leHex, offsetHex, err)
	}
}

func TestRunLocalBinaryExactBytes_F43(t *testing.T) {
	t.Setenv("DOUBLEAGENT_HEX_HELPER", "1")
	runner := hexrunner.NewRunner()

	res, err := runner.RunLocal(context.Background(), core.HexRunRequest{
		ExecutionID: "hex-exec-1",
		TargetType:  "local",
		Executable:  os.Args[0],
		Args:        []string{"-test.run=TestHexHelperProcess"},
		Chunks: []core.HexExecChunk{
			{PayloadExpr: `00 03 1b 7f 80 ff 41 42`, DelayMs: 0},
			{PayloadExpr: `\xfe\xed\x0a`, DelayMs: 10},
		},
		TimeoutSec: 10,
	})
	if err != nil {
		t.Fatalf("RunLocal error: %v", err)
	}
	if res.ExitCode != 0 || res.Error != "" {
		t.Fatalf("unexpected binary result: exit=%d err=%q stderr=%q", res.ExitCode, res.Error, res.StderrASCII)
	}
	if res.InputByteCount != 11 {
		t.Fatalf("expected 11 input bytes, got %d", res.InputByteCount)
	}
	if res.StdoutBytes != 15 {
		t.Fatalf("expected 15 stdout bytes (11 echoed + 4 trailer), got %d", res.StdoutBytes)
	}
	decodedOut, err := base64.StdEncoding.DecodeString(res.StdoutBase64)
	if err != nil {
		t.Fatalf("decode StdoutBase64: %v", err)
	}
	wantHex := "00031b7f80ff4142feed0a00ff031b"
	if hex.EncodeToString(decodedOut) != wantHex {
		t.Fatalf("exact binary output corrupted!\ngot:  %x\nwant: %s", decodedOut, wantHex)
	}
	if !strings.Contains(res.StdoutHexDump, "00000000: 0003 1b7f 80ff 4142") {
		t.Errorf("unexpected hex dump output:\n%s", res.StdoutHexDump)
	}
	if res.StderrASCII != "LEN=11" {
		t.Errorf("expected stderr LEN=11, got %q", res.StderrASCII)
	}
}

type mockSshRunner struct {
	gotCmd   string
	gotStdin []byte
}

func (m *mockSshRunner) ExecRaw(_ context.Context, _ string, command string, stdin []byte, _ int) ([]byte, []byte, int, error) {
	m.gotCmd = command
	m.gotStdin = append([]byte(nil), stdin...)
	return []byte{0xca, 0xfe, 0x00, 0xba, 0xbe}, []byte{}, 0, nil
}

func TestRunSSHBinaryExactBytes_F43(t *testing.T) {
	runner := hexrunner.NewRunner()
	mock := &mockSshRunner{}

	res, err := runner.RunSSH(context.Background(), mock, core.HexRunRequest{
		TargetType: "ssh",
		SessionID:  "ssh-sess-1",
		Executable: "/opt/vuln/server",
		Args:       []string{"--stdin"},
		Chunks: []core.HexExecChunk{
			{PayloadExpr: `u32le(0x11223344) 00 ff`},
		},
	})
	if err != nil {
		t.Fatalf("RunSSH error: %v", err)
	}
	if mock.gotCmd != "/opt/vuln/server --stdin" {
		t.Errorf("unexpected ssh command %q", mock.gotCmd)
	}
	if hex.EncodeToString(mock.gotStdin) != "4433221100ff" {
		t.Errorf("expected raw ssh stdin 4433221100ff, got %x", mock.gotStdin)
	}
	if !strings.Contains(res.StdoutHexDump, "cafe 00ba be") {
		t.Errorf("unexpected ssh stdout hex dump:\n%s", res.StdoutHexDump)
	}
}
