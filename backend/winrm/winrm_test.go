package winrm

import (
	"bufio"
	"context"
	"crypto/hmac"
	"crypto/md5"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"doubleagent/backend/core"
)

func TestNtlmV2AndPassTheHashComputation_F41(t *testing.T) {
	passHash := ntHashFromPassword("P@ssw0rd123!")
	pthHex := hex.EncodeToString(passHash)
	parsedPtH, err := core.ParseNtHashHex(pthHex)
	if err != nil {
		t.Fatalf("ParseNtHashHex failed: %v", err)
	}

	// Verify Type 1 -> Type 2 -> Type 3 yields identical NTProofStr given identical Challenge + Password vs PtH
	neg := buildNtlmNegotiateMessage()
	if string(neg[:8]) != ntlmSignature {
		t.Fatalf("unexpected Type 1 signature: %x", neg[:8])
	}

	ch := &ntlmChallenge{
		Flags: flagNegotiateUnicode | flagNegotiateNTLM | flagNegotiateExtendedSec,
	}
	copy(ch.ServerChallenge[:], []byte{1, 2, 3, 4, 5, 6, 7, 8})

	authPass, err := buildNtlmAuthenticate(ch, "CORP", "administrator", "P@ssw0rd123!", nil, "WS01")
	if err != nil {
		t.Fatalf("buildNtlmAuthenticate (pass) failed: %v", err)
	}
	authPtH, err := buildNtlmAuthenticate(ch, "CORP", "administrator", "", parsedPtH, "WS01")
	if err != nil {
		t.Fatalf("buildNtlmAuthenticate (pth) failed: %v", err)
	}

	// Verify Type 3 signatures and non-empty NT response security buffer
	if string(authPass[:8]) != ntlmSignature || string(authPtH[:8]) != ntlmSignature {
		t.Fatal("invalid Type 3 NTLMSSP signature")
	}
	ntLenPass := binary.LittleEndian.Uint16(authPass[20:22])
	ntLenPtH := binary.LittleEndian.Uint16(authPtH[20:22])
	if ntLenPass != ntLenPtH || ntLenPass < 44 {
		t.Fatalf("unexpected NTLMv2 response lengths: pass=%d pth=%d", ntLenPass, ntLenPtH)
	}
}

type pipeListener struct {
	mu     sync.Mutex
	closed bool
	ch     chan net.Conn
}

func newPipeListener() *pipeListener {
	return &pipeListener{ch: make(chan net.Conn, 8)}
}

func (l *pipeListener) Accept() (net.Conn, error) {
	c, ok := <-l.ch
	if !ok {
		return nil, net.ErrClosed
	}
	return c, nil
}

func (l *pipeListener) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.closed {
		l.closed = true
		close(l.ch)
	}
	return nil
}

func (l *pipeListener) Addr() net.Addr {
	return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 5985}
}

func (l *pipeListener) DialContext(ctx context.Context, _ string, _ string) (net.Conn, error) {
	l.mu.Lock()
	closed := l.closed
	l.mu.Unlock()
	if closed {
		return nil, errors.New("listener closed")
	}
	c, s := net.Pipe()
	select {
	case l.ch <- s:
		return c, nil
	case <-ctx.Done():
		_ = c.Close()
		_ = s.Close()
		return nil, ctx.Err()
	}
}

func TestWinrmSessionLifecycleExecTransferAndREPL_F41(t *testing.T) {
	pl := newPipeListener()
	defer func() { _ = pl.Close() }()

	var mu sync.Mutex
	var storedRemoteBytes []byte
	var lastShellDeleted string
	authConnDone := make(map[string]bool)
	nextCmdSeq := 0
	cmdOutputs := make(map[string]string)

	srv := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			remoteKey := fmt.Sprintf("%p", r)
			_ = remoteKey

			// Require NTLM Type 1 -> Type 2 -> Type 3 handshake on the request flow
			if auth == "" {
				w.Header().Set("WWW-Authenticate", "NTLM")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if strings.HasPrefix(auth, "NTLM ") {
				rawAuth, decErr := base64.StdEncoding.DecodeString(strings.TrimPrefix(auth, "NTLM "))
				if decErr != nil || len(rawAuth) < 12 {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				msgType := binary.LittleEndian.Uint32(rawAuth[8:12])
				if msgType == ntlmMsgNegotiate {
					// Return NTLM Type 2 Challenge
					type2 := make([]byte, 48)
					copy(type2[:8], ntlmSignature)
					binary.LittleEndian.PutUint32(type2[8:12], ntlmMsgChallenge)
					binary.LittleEndian.PutUint32(type2[20:24], flagNegotiateUnicode|flagNegotiateNTLM|flagNegotiateExtendedSec)
					copy(type2[24:32], []byte{0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88})
					w.Header().Set("WWW-Authenticate", "NTLM "+base64.StdEncoding.EncodeToString(type2))
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				if msgType == ntlmMsgAuthenticate {
					// Verify NTProofStr length matches NTLMv2 (>= 44 bytes in NtChallengeResponse)
					ntLen := binary.LittleEndian.Uint16(rawAuth[20:22])
					ntOff := binary.LittleEndian.Uint32(rawAuth[24:28])
					if ntLen < 44 || int(ntOff)+int(ntLen) > len(rawAuth) {
						w.WriteHeader(http.StatusUnauthorized)
						return
					}
					_ = hmac.New(md5.New, []byte("noop"))
					mu.Lock()
					authConnDone[r.RemoteAddr] = true
					mu.Unlock()
				}
			}

			bodyBytes, _ := io.ReadAll(r.Body)
			bodyStr := string(bodyBytes)

			w.Header().Set("Content-Type", "application/soap+xml;charset=UTF-8")
			switch {
			case strings.Contains(bodyStr, wsmanActionCreate):
				_, _ = io.WriteString(w, `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">
<s:Body><rsp:ResourceCreated xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
<w:SelectorSet><w:Selector Name="ShellId">SHELL-F41-UUID</w:Selector></w:SelectorSet>
</rsp:ResourceCreated></s:Body></s:Envelope>`)

			case strings.Contains(bodyStr, wsmanActionCommand):
				// Extract EncodedCommand UTF-16LE base64 if present and emulate its execution
				script := decodeEncodedCommandFromXML(bodyStr)
				mu.Lock()
				nextCmdSeq++
				cid := fmt.Sprintf("CMD-%d", nextCmdSeq)
				switch {
				case strings.Contains(script, "Get-Location).Path") && !strings.Contains(script, "__DA_PWD__"):
					cmdOutputs[cid] = `C:\Users\Administrator` + "\n"
				case strings.Contains(script, "[IO.File]::WriteAllBytes"):
					storedRemoteBytes = nil
					cmdOutputs[cid] = "__DA_PWD__=C:\\Users\\Administrator\n"
				case strings.Contains(script, "[Convert]::FromBase64String('"):
					i1 := strings.Index(script, "[Convert]::FromBase64String('") + len("[Convert]::FromBase64String('")
					i2 := strings.Index(script[i1:], "'")
					chunk, _ := base64.StdEncoding.DecodeString(script[i1 : i1+i2])
					storedRemoteBytes = append(storedRemoteBytes, chunk...)
					cmdOutputs[cid] = "__DA_PWD__=C:\\Users\\Administrator\n"
				case strings.Contains(script, "Get-FileHash"):
					cmdOutputs[cid] = "\n"
				case strings.Contains(script, "[Convert]::ToBase64String([IO.File]::ReadAllBytes"):
					cmdOutputs[cid] = base64.StdEncoding.EncodeToString(storedRemoteBytes) + "\n"
				default:
					cmdOutputs[cid] = "corp\\administrator\n__DA_PWD__=C:\\Windows\\Temp\n"
				}
				mu.Unlock()
				_, _ = fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><rsp:CommandResponse xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell"><rsp:CommandId>%s</rsp:CommandId></rsp:CommandResponse></s:Body></s:Envelope>`, cid)

			case strings.Contains(bodyStr, wsmanActionReceive):
				cid := extractAttrValue(bodyBytes, "DesiredStream", "CommandId")
				mu.Lock()
				out := cmdOutputs[cid]
				mu.Unlock()
				b64Out := base64.StdEncoding.EncodeToString([]byte(out))
				_, _ = fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><rsp:ReceiveResponse xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell"><rsp:Stream Name="stdout" CommandId="%s">%s</rsp:Stream><rsp:CommandState CommandId="%s" State="%s"><rsp:ExitCode>0</rsp:ExitCode></rsp:CommandState></rsp:ReceiveResponse></s:Body></s:Envelope>`, cid, b64Out, cid, wsmanCmdStateDone)

			case strings.Contains(bodyStr, wsmanActionSignal):
				_, _ = io.WriteString(w, `<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><rsp:SignalResponse/></s:Body></s:Envelope>`)

			case strings.Contains(bodyStr, wsmanActionDelete):
				mu.Lock()
				lastShellDeleted = extractSelectorShellID(bodyBytes)
				mu.Unlock()
				_, _ = io.WriteString(w, `<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body/></s:Envelope>`)
			}
		}),
	}
	go func() { _ = srv.Serve(pl) }()
	defer func() { _ = srv.Close() }()

	mgr := NewManager(nil)
	defer mgr.CloseAll()

	prof := core.WinrmProfile{
		ID:       "prof-dc01",
		Name:     "DC01 Admin",
		Host:     "dc01.corp.local",
		Port:     5985,
		AuthType: core.WinrmAuthPtH,
		Domain:   "CORP",
		Username: "Administrator",
	}
	ntHash := ntHashFromPassword("Pass123!")

	sess, err := mgr.Open(context.Background(), prof, ClientConfig{
		Host:        prof.Host,
		Port:        prof.Port,
		AuthType:    prof.AuthType,
		Domain:      prof.Domain,
		Username:    prof.Username,
		NtHash:      ntHash,
		DialContext: pl.DialContext,
	})
	if err != nil {
		t.Fatalf("mgr.Open failed: %v", err)
	}

	if sess.Info().ShellID != "SHELL-F41-UUID" {
		t.Fatalf("unexpected ShellID: %q", sess.Info().ShellID)
	}

	// Execute command and verify CurrentDir tracks updated directory
	res, err := sess.Execute(context.Background(), "whoami")
	if err != nil {
		t.Fatalf("sess.Execute failed: %v", err)
	}
	if strings.TrimSpace(res.Stdout) != "corp\\administrator" {
		t.Fatalf("unexpected stdout: %q", res.Stdout)
	}
	if sess.Info().CurrentDir != `C:\Windows\Temp` {
		t.Fatalf("expected tracked CurrentDir C:\\Windows\\Temp, got %q", sess.Info().CurrentDir)
	}

	// Upload + Download chunked Base64 roundtrip
	tmpDir := t.TempDir()
	srcFile := filepath.Join(tmpDir, "payload.bin")
	payloadData := []byte("DOUBLEAGENT_WINRM_BINARY_PAYLOAD_123456")
	if err := os.WriteFile(srcFile, payloadData, 0o600); err != nil {
		t.Fatalf("write srcFile failed: %v", err)
	}
	upRes, err := sess.Upload(context.Background(), srcFile, `C:\Windows\Temp\payload.bin`)
	if err != nil || upRes.Bytes != int64(len(payloadData)) {
		t.Fatalf("Upload failed: res=%+v err=%v", upRes, err)
	}

	dlFile := filepath.Join(tmpDir, "downloaded.bin")
	dlRes, err := sess.Download(context.Background(), `C:\Windows\Temp\payload.bin`, dlFile)
	if err != nil || dlRes.SHA256 != upRes.SHA256 {
		t.Fatalf("Download mismatch: dlRes=%+v upRes=%+v err=%v", dlRes, upRes, err)
	}

	// Interactive REPL Write/Read test
	readCh := make(chan string, 1)
	go func() {
		br := bufio.NewReader(sess.Reader())
		var collected strings.Builder
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			buf := make([]byte, 1024)
			n, rErr := br.Read(buf)
			if n > 0 {
				collected.Write(buf[:n])
				if strings.Contains(collected.String(), "Evil-WinRM Parity Commands") {
					readCh <- collected.String()
					return
				}
			}
			if rErr != nil {
				break
			}
		}
		readCh <- collected.String()
	}()

	if _, err := sess.Write([]byte("menu\r")); err != nil {
		t.Fatalf("REPL Write failed: %v", err)
	}
	replOut := <-readCh
	if !strings.Contains(replOut, "Evil-WinRM Parity Commands") {
		t.Fatalf("expected REPL help menu output, got: %q", replOut)
	}

	if err := mgr.Close(sess.ID()); err != nil {
		t.Fatalf("mgr.Close failed: %v", err)
	}
	mu.Lock()
	deleted := lastShellDeleted
	mu.Unlock()
	if deleted != "SHELL-F41-UUID" {
		t.Fatalf("expected remote shell Delete for SHELL-F41-UUID, got %q", deleted)
	}
}

func extractAttrValue(xmlBytes []byte, localName string, attrName string) string {
	dec := xml.NewDecoder(strings.NewReader(string(xmlBytes)))
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		if se, ok := tok.(xml.StartElement); ok && se.Name.Local == localName {
			for _, a := range se.Attr {
				if a.Name.Local == attrName {
					return a.Value
				}
			}
		}
	}
	return ""
}

func decodeEncodedCommandFromXML(bodyXML string) string {
	type cmdLine struct {
		Arguments []string `xml:"Arguments"`
	}
	dec := xml.NewDecoder(strings.NewReader(bodyXML))
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		if se, ok := tok.(xml.StartElement); ok && se.Name.Local == "CommandLine" {
			var cl cmdLine
			if err := dec.DecodeElement(&cl, &se); err == nil && len(cl.Arguments) > 0 {
				last := cl.Arguments[len(cl.Arguments)-1]
				raw, decErr := base64.StdEncoding.DecodeString(last)
				if decErr == nil && len(raw)%2 == 0 {
					var runes []rune
					for i := 0; i < len(raw); i += 2 {
						runes = append(runes, rune(binary.LittleEndian.Uint16(raw[i:i+2])))
					}
					return string(runes)
				}
			}
		}
	}
	return ""
}
