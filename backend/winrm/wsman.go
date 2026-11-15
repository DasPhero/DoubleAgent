package winrm

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
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
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"doubleagent/backend/core"
)

const (
	wsmanActionCreate  = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Create"
	wsmanActionDelete  = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete"
	wsmanActionCommand = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Command"
	wsmanActionReceive = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Receive"
	wsmanActionSignal  = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Signal"
	wsmanShellResource = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd"
	wsmanCmdStateDone  = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/CommandState/Done"
	wsmanSignalTerm    = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/signal/terminate"
)

// ClientConfig holds resolved WinRM connection parameters (including secrets strictly in Go memory).
type ClientConfig struct {
	Host               string
	Port               uint16
	UseTLS             bool
	InsecureSkipVerify bool
	AuthType           string // "ntlm", "pth", "kerberos", "basic"
	Domain             string
	Username           string
	Password           string
	NtHash             []byte
	SocksProxyAddr     string
	Timeout            time.Duration
	DialContext        func(ctx context.Context, network, addr string) (net.Conn, error)
}

// Client speaks WS-Management SOAP over HTTP/HTTPS (5985/5986) with NTLMv2, PtH, Basic, or Negotiate.
type Client struct {
	cfg        ClientConfig
	endpoint   string
	httpClient *http.Client
	transport  *http.Transport
}

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("uuid:%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func xmlEscape(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// NewClient constructs an HTTP/HTTPS WS-Man WinRM client.
func NewClient(cfg ClientConfig) (*Client, error) {
	if strings.TrimSpace(cfg.Host) == "" {
		return nil, errors.New("WinRM host is empty")
	}
	if cfg.Port == 0 {
		if cfg.UseTLS {
			cfg.Port = core.DefaultWinrmHTTPSPort
		} else {
			cfg.Port = core.DefaultWinrmHTTPPort
		}
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 20 * time.Second
	}

	scheme := "http"
	if cfg.UseTLS {
		scheme = "https"
	}
	endpoint := fmt.Sprintf("%s://%s/wsman", scheme, net.JoinHostPort(cfg.Host, strconv.Itoa(int(cfg.Port))))

	dialFn := cfg.DialContext
	if dialFn == nil {
		if strings.TrimSpace(cfg.SocksProxyAddr) != "" {
			proxyAddr := strings.TrimSpace(cfg.SocksProxyAddr)
			dialFn = func(ctx context.Context, network, addr string) (net.Conn, error) {
				return dialViaSocks5(ctx, proxyAddr, addr, cfg.Timeout)
			}
		} else {
			d := &net.Dialer{Timeout: cfg.Timeout}
			dialFn = d.DialContext
		}
	}

	baseTransport := &http.Transport{
		DialContext:         dialFn,
		MaxIdleConns:        1,
		MaxIdleConnsPerHost: 1,
		IdleConnTimeout:     90 * time.Second,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: cfg.InsecureSkipVerify, //nolint:gosec // Explicitly opt-in per profile for self-signed lab hosts
			MinVersion:         tls.VersionTLS12,
		},
	}

	var rt http.RoundTripper = baseTransport
	auth := core.NormalizeWinrmAuthType(cfg.AuthType)
	switch auth {
	case core.WinrmAuthNTLM, core.WinrmAuthPtH, core.WinrmAuthKerberos:
		// NTLM / Negotiate handshake preserves keep-alive HTTP connection across 401 exchanges.
		rt = &ntlmTransport{
			base:     baseTransport,
			domain:   cfg.Domain,
			username: cfg.Username,
			password: cfg.Password,
			ntHash:   cfg.NtHash,
		}
	case core.WinrmAuthBasic:
		user := cfg.Username
		if cfg.Domain != "" {
			user = cfg.Domain + `\` + user
		}
		tok := base64.StdEncoding.EncodeToString([]byte(user + ":" + cfg.Password))
		rt = &basicTransport{base: baseTransport, token: tok}
	}

	return &Client{
		cfg:        cfg,
		endpoint:   endpoint,
		transport:  baseTransport,
		httpClient: &http.Client{Transport: rt, Timeout: cfg.Timeout},
	}, nil
}

// CloseIdle closes underlying HTTP keep-alive sockets.
func (c *Client) CloseIdle() {
	if c.transport != nil {
		c.transport.CloseIdleConnections()
	}
}

type basicTransport struct {
	base  http.RoundTripper
	token string
}

func (b *basicTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	r := req.Clone(req.Context())
	r.Header.Set("Authorization", "Basic "+b.token)
	return b.base.RoundTrip(r)
}

func (c *Client) postSOAP(ctx context.Context, envelope string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, strings.NewReader(envelope))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/soap+xml;charset=UTF-8")
	req.Header.Set("User-Agent", "DoubleAgent-WinRM/1.0")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 16*1024*1024))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("WinRM authentication failed (HTTP 401 Unauthorized)")
	}
	if resp.StatusCode >= 400 {
		fault := extractSOAPFault(body)
		if fault != "" {
			return nil, fmt.Errorf("WinRM SOAP fault (HTTP %d): %s", resp.StatusCode, fault)
		}
		return nil, fmt.Errorf("WinRM HTTP error %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}

func (c *Client) soapHeader(action, shellID string) string {
	sel := ""
	if shellID != "" {
		sel = fmt.Sprintf(`<w:SelectorSet><w:Selector Name="ShellId">%s</w:Selector></w:SelectorSet>`, xmlEscape(shellID))
	}
	return fmt.Sprintf(`<s:Header>
  <a:To>%s</a:To>
  <a:ReplyTo><a:Address s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>
  <w:MaxEnvelopeSize s:mustUnderstand="true">153600</w:MaxEnvelopeSize>
  <a:MessageID>%s</a:MessageID>
  <w:Locale xml:lang="en-US" s:mustUnderstand="false"/>
  <p:DataLocale xml:lang="en-US" s:mustUnderstand="false"/>
  <w:OperationTimeout>PT60S</w:OperationTimeout>
  <w:ResourceURI s:mustUnderstand="true">%s</w:ResourceURI>
  <a:Action s:mustUnderstand="true">%s</a:Action>
  %s
</s:Header>`, xmlEscape(c.endpoint), newUUID(), wsmanShellResource, action, sel)
}

func wrapEnvelope(header, body string) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:w="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"
  xmlns:p="http://schemas.microsoft.com/wbem/wsman/1/wsman.xsd"
  xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
%s
<s:Body>%s</s:Body>
</s:Envelope>`, header, body)
}

// OpenShell allocates a remote WinRM cmd shell and returns its ShellId.
func (c *Client) OpenShell(ctx context.Context) (string, error) {
	body := `<rsp:Shell><rsp:InputStreams>stdin</rsp:InputStreams><rsp:OutputStreams>stdout stderr</rsp:OutputStreams></rsp:Shell>`
	hdr := c.soapHeader(wsmanActionCreate, "")
	env := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:w="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"
  xmlns:p="http://schemas.microsoft.com/wbem/wsman/1/wsman.xsd"
  xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
%s
<s:Body>%s</s:Body>
</s:Envelope>`, strings.Replace(hdr, "</w:OperationTimeout>", "</w:OperationTimeout><w:OptionSet><w:Option Name=\"WINRS_NOPROFILE\">TRUE</w:Option><w:Option Name=\"WINRS_CODEPAGE\">65001</w:Option></w:OptionSet>", 1), body)

	resp, err := c.postSOAP(ctx, env)
	if err != nil {
		return "", err
	}
	shellID := extractSelectorShellID(resp)
	if shellID == "" {
		return "", errors.New("WinRM Create Shell response did not include a ShellId")
	}
	return shellID, nil
}

// CloseShell deletes a remote WinRM ShellId.
func (c *Client) CloseShell(ctx context.Context, shellID string) error {
	if strings.TrimSpace(shellID) == "" {
		return nil
	}
	env := wrapEnvelope(c.soapHeader(wsmanActionDelete, shellID), "")
	_, err := c.postSOAP(ctx, env)
	return err
}

// ExecuteCommand executes a command line inside an open WinRM shell and drains stdout/stderr.
func (c *Client) ExecuteCommand(ctx context.Context, shellID string, cmdLine string, args []string) (*core.WinrmExecResult, error) {
	start := time.Now()
	var argsXML strings.Builder
	for _, a := range args {
		argsXML.WriteString("<rsp:Arguments>")
		argsXML.WriteString(xmlEscape(a))
		argsXML.WriteString("</rsp:Arguments>")
	}
	body := fmt.Sprintf(`<rsp:CommandLine><rsp:Command>%s</rsp:Command>%s</rsp:CommandLine>`, xmlEscape(cmdLine), argsXML.String())
	resp, err := c.postSOAP(ctx, wrapEnvelope(c.soapHeader(wsmanActionCommand, shellID), body))
	if err != nil {
		return nil, err
	}

	commandID := extractElementText(resp, "CommandId")
	if commandID == "" {
		return nil, errors.New("WinRM Command response missing CommandId")
	}

	defer func() {
		sigBody := fmt.Sprintf(`<rsp:Signal CommandId="%s"><rsp:Code>%s</rsp:Code></rsp:Signal>`, xmlEscape(commandID), wsmanSignalTerm)
		sigCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _ = c.postSOAP(sigCtx, wrapEnvelope(c.soapHeader(wsmanActionSignal, shellID), sigBody))
	}()

	var stdoutBuf, stderrBuf bytes.Buffer
	exitCode := 0
	for {
		recBody := fmt.Sprintf(`<rsp:Receive><rsp:DesiredStream CommandId="%s">stdout stderr</rsp:DesiredStream></rsp:Receive>`, xmlEscape(commandID))
		recResp, err := c.postSOAP(ctx, wrapEnvelope(c.soapHeader(wsmanActionReceive, shellID), recBody))
		if err != nil {
			return nil, err
		}

		outChunk, errChunk, done, code := parseReceiveResponse(recResp)
		stdoutBuf.Write(outChunk)
		stderrBuf.Write(errChunk)
		if done {
			exitCode = code
			break
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}

	return &core.WinrmExecResult{
		ShellID:    shellID,
		Command:    strings.TrimSpace(cmdLine + " " + strings.Join(args, " ")),
		Stdout:     strings.TrimRight(stdoutBuf.String(), "\r\n"),
		Stderr:     cleanCLIXML(strings.TrimRight(stderrBuf.String(), "\r\n")),
		ExitCode:   exitCode,
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

// ExecutePowerShell encodes script as UTF-16LE Base64 and runs powershell.exe inside the open shell.
func (c *Client) ExecutePowerShell(ctx context.Context, shellID string, script string) (*core.WinrmExecResult, error) {
	b64 := core.EncodePowerShellUTF16Base64(script)
	res, err := c.ExecuteCommand(ctx, shellID, "powershell.exe", []string{"-NoProfile", "-NonInteractive", "-EncodedCommand", b64})
	if res != nil {
		res.Command = script
	}
	return res, err
}

// UploadFile streams a local file to remotePath in chunked Base64 slices over WS-Man PowerShell.
func (c *Client) UploadFile(ctx context.Context, shellID string, localPath string, remotePath string) (*core.WinrmTransferResult, error) {
	start := time.Now()
	data, err := os.ReadFile(localPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read local file: %w", err)
	}
	sum := sha256.Sum256(data)
	expectedHash := hex.EncodeToString(sum[:])

	if strings.TrimSpace(remotePath) == "" {
		remotePath = filepath.Base(localPath)
	}
	escapedRemote := strings.ReplaceAll(remotePath, "'", "''")

	// Truncate/create destination first
	initScript := fmt.Sprintf(`$p='%s'; $d=[IO.Path]::GetDirectoryName($p); if($d -and !(Test-Path $d)){New-Item -ItemType Directory -Force -Path $d|Out-Null}; [IO.File]::WriteAllBytes($p, @())`, escapedRemote)
	initRes, err := c.ExecutePowerShell(ctx, shellID, initScript)
	if err != nil {
		return nil, err
	}
	if initRes.ExitCode != 0 {
		return nil, fmt.Errorf("failed to initialize remote file %q: %s", remotePath, initRes.Stderr)
	}

	const chunkBytes = 12288 // ~16KB base64, well below 64KB WinRM envelope limits
	for offset := 0; offset < len(data); offset += chunkBytes {
		end := offset + chunkBytes
		if end > len(data) {
			end = len(data)
		}
		chunkB64 := base64.StdEncoding.EncodeToString(data[offset:end])
		appendScript := fmt.Sprintf(
			`$fs=[IO.File]::Open('%s',[IO.FileMode]::Append); $b=[Convert]::FromBase64String('%s'); $fs.Write($b,0,$b.Length); $fs.Close()`,
			escapedRemote, chunkB64,
		)
		res, err := c.ExecutePowerShell(ctx, shellID, appendScript)
		if err != nil {
			return nil, fmt.Errorf("upload chunk at offset %d failed: %w", offset, err)
		}
		if res.ExitCode != 0 {
			return nil, fmt.Errorf("upload chunk write error: %s", res.Stderr)
		}
	}

	// Verify remote SHA-256 checksum
	verifyScript := fmt.Sprintf(`(Get-FileHash -Path '%s' -Algorithm SHA256).Hash.ToLower()`, escapedRemote)
	vRes, err := c.ExecutePowerShell(ctx, shellID, verifyScript)
	if err == nil && vRes.ExitCode == 0 {
		remoteHash := strings.TrimSpace(strings.ToLower(vRes.Stdout))
		if remoteHash != "" && remoteHash != expectedHash {
			return nil, fmt.Errorf("upload hash verification mismatch: local=%s remote=%s", expectedHash, remoteHash)
		}
	}

	return &core.WinrmTransferResult{
		Direction:  "upload",
		LocalPath:  localPath,
		RemotePath: remotePath,
		Bytes:      int64(len(data)),
		SHA256:     expectedHash,
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

// DownloadFile retrieves remotePath over WS-Man PowerShell Base64 streaming and writes it atomically to localPath.
func (c *Client) DownloadFile(ctx context.Context, shellID string, remotePath string, localPath string) (*core.WinrmTransferResult, error) {
	start := time.Now()
	if strings.TrimSpace(remotePath) == "" {
		return nil, errors.New("remote file path is required")
	}
	escapedRemote := strings.ReplaceAll(remotePath, "'", "''")
	script := fmt.Sprintf(`[Convert]::ToBase64String([IO.File]::ReadAllBytes('%s'))`, escapedRemote)
	res, err := c.ExecutePowerShell(ctx, shellID, script)
	if err != nil {
		return nil, err
	}
	if res.ExitCode != 0 {
		return nil, fmt.Errorf("remote read failed: %s", res.Stderr)
	}

	cleanB64 := strings.Join(strings.Fields(res.Stdout), "")
	decoded, err := base64.StdEncoding.DecodeString(cleanB64)
	if err != nil {
		return nil, fmt.Errorf("invalid base64 payload returned from remote host: %w", err)
	}

	if strings.TrimSpace(localPath) == "" {
		localPath = filepath.Base(strings.ReplaceAll(remotePath, `\`, "/"))
	}
	if dir := filepath.Dir(localPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	if err := os.WriteFile(localPath, decoded, 0o600); err != nil {
		return nil, err
	}

	sum := sha256.Sum256(decoded)
	return &core.WinrmTransferResult{
		Direction:  "download",
		LocalPath:  localPath,
		RemotePath: remotePath,
		Bytes:      int64(len(decoded)),
		SHA256:     hex.EncodeToString(sum[:]),
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

// DetectTools checks PATH for evil-winrm / PowerShell CLI helpers.
func DetectTools() []core.WinrmToolStatus {
	candidates := []string{"evil-winrm", "pwsh", "powershell"}
	out := make([]core.WinrmToolStatus, 0, len(candidates))
	for _, name := range candidates {
		st := core.WinrmToolStatus{Tool: name}
		if p, err := exec.LookPath(name); err == nil && p != "" {
			st.Found = true
			st.Path = p
		}
		out = append(out, st)
	}
	return out
}

// dialViaSocks5 establishes a TCP stream to targetAddr through a SOCKS5 proxy (no external package).
func dialViaSocks5(ctx context.Context, proxyAddr string, targetAddr string, timeout time.Duration) (net.Conn, error) {
	host, portStr, err := net.SplitHostPort(targetAddr)
	if err != nil {
		return nil, err
	}
	portNum, err := strconv.Atoi(portStr)
	if err != nil {
		return nil, err
	}
	d := net.Dialer{Timeout: timeout}
	conn, err := d.DialContext(ctx, "tcp", proxyAddr)
	if err != nil {
		return nil, err
	}
	_ = conn.SetDeadline(time.Now().Add(timeout))
	if _, err := conn.Write([]byte{0x05, 0x01, 0x00}); err != nil {
		_ = conn.Close()
		return nil, err
	}
	auth := make([]byte, 2)
	if _, err := io.ReadFull(conn, auth); err != nil || auth[0] != 0x05 || auth[1] != 0x00 {
		_ = conn.Close()
		return nil, errors.New("SOCKS5 proxy auth negotiation failed")
	}

	pkt := []byte{0x05, 0x01, 0x00}
	if ip := net.ParseIP(host); ip != nil {
		if v4 := ip.To4(); v4 != nil {
			pkt = append(pkt, 0x01)
			pkt = append(pkt, v4...)
		} else {
			pkt = append(pkt, 0x04)
			pkt = append(pkt, ip.To16()...)
		}
	} else {
		pkt = append(pkt, 0x03, byte(len(host)))
		pkt = append(pkt, []byte(host)...)
	}
	var pb [2]byte
	binary.BigEndian.PutUint16(pb[:], uint16(portNum))
	pkt = append(pkt, pb[:]...)

	if _, err := conn.Write(pkt); err != nil {
		_ = conn.Close()
		return nil, err
	}
	hdr := make([]byte, 4)
	if _, err := io.ReadFull(conn, hdr); err != nil || hdr[1] != 0x00 {
		_ = conn.Close()
		return nil, errors.New("SOCKS5 CONNECT rejected")
	}
	var skip int64
	switch hdr[3] {
	case 0x01:
		skip = 4 + 2
	case 0x04:
		skip = 16 + 2
	case 0x03:
		l := make([]byte, 1)
		if _, err := io.ReadFull(conn, l); err == nil {
			skip = int64(l[0]) + 2
		}
	}
	if skip > 0 {
		_, _ = io.CopyN(io.Discard, conn, skip)
	}
	_ = conn.SetDeadline(time.Time{})
	return conn, nil
}

// XML helpers for WS-Management responses

func extractSelectorShellID(xmlBytes []byte) string {
	dec := xml.NewDecoder(bytes.NewReader(xmlBytes))
	inShellSel := false
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "Selector" {
				for _, a := range t.Attr {
					if a.Name.Local == "Name" && a.Value == "ShellId" {
						inShellSel = true
					}
				}
			} else if t.Name.Local == "ShellId" {
				var v string
				if err := dec.DecodeElement(&v, &t); err == nil && strings.TrimSpace(v) != "" {
					return strings.TrimSpace(v)
				}
			}
		case xml.CharData:
			if inShellSel {
				val := strings.TrimSpace(string(t))
				if val != "" {
					return val
				}
			}
		case xml.EndElement:
			if t.Name.Local == "Selector" {
				inShellSel = false
			}
		}
	}
	return ""
}

func extractElementText(xmlBytes []byte, localName string) string {
	dec := xml.NewDecoder(bytes.NewReader(xmlBytes))
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		if se, ok := tok.(xml.StartElement); ok && se.Name.Local == localName {
			var txt string
			if err := dec.DecodeElement(&txt, &se); err == nil {
				return strings.TrimSpace(txt)
			}
		}
	}
	return ""
}

func extractSOAPFault(xmlBytes []byte) string {
	if txt := extractElementText(xmlBytes, "Text"); txt != "" {
		return txt
	}
	return extractElementText(xmlBytes, "Reason")
}

func parseReceiveResponse(xmlBytes []byte) (stdout []byte, stderr []byte, done bool, exitCode int) {
	dec := xml.NewDecoder(bytes.NewReader(xmlBytes))
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "Stream":
				streamName := ""
				for _, a := range t.Attr {
					if a.Name.Local == "Name" {
						streamName = strings.ToLower(a.Value)
					}
				}
				var b64 string
				if err := dec.DecodeElement(&b64, &t); err == nil && b64 != "" {
					if raw, decErr := base64.StdEncoding.DecodeString(strings.TrimSpace(b64)); decErr == nil {
						if streamName == "stderr" {
							stderr = append(stderr, raw...)
						} else {
							stdout = append(stdout, raw...)
						}
					}
				}
			case "CommandState":
				for _, a := range t.Attr {
					if a.Name.Local == "State" && strings.EqualFold(a.Value, wsmanCmdStateDone) {
						done = true
					}
				}
			case "ExitCode":
				var codeStr string
				if err := dec.DecodeElement(&codeStr, &t); err == nil {
					if parsed, err := strconv.Atoi(strings.TrimSpace(codeStr)); err == nil {
						exitCode = parsed
					}
				}
			}
		}
	}
	return stdout, stderr, done, exitCode
}

var clixmlTagRe = regexp.MustCompile(`<[^>]+>`)

func cleanCLIXML(raw string) string {
	if !strings.Contains(raw, "#< CLIXML") {
		return raw
	}
	stripped := strings.TrimPrefix(raw, "#< CLIXML")
	stripped = strings.ReplaceAll(stripped, "_x000D__x000A_", "\n")
	stripped = clixmlTagRe.ReplaceAllString(stripped, "")
	return strings.TrimSpace(stripped)
}
