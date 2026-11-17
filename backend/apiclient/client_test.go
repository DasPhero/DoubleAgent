package apiclient_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"doubleagent/backend/apiclient"
	"doubleagent/backend/core"
)

type pipeListener struct {
	mu     sync.Mutex
	ch     chan net.Conn
	closed bool
}

func newPipeListener() *pipeListener {
	return &pipeListener{ch: make(chan net.Conn, 16)}
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
	return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 8443}
}

func (l *pipeListener) DialContext(ctx context.Context, _, _ string) (net.Conn, error) {
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

func newPipeClientAndServer(handler http.Handler, tlsMode bool) (*apiclient.Client, *httptest.Server) {
	pl := newPipeListener()
	srv := httptest.NewUnstartedServer(handler)
	srv.Listener = pl
	if tlsMode {
		srv.StartTLS()
	} else {
		srv.Start()
	}
	client := apiclient.NewClient()
	client.DialContext = pl.DialContext
	return client, srv
}

func TestExecuteStructuredAndSecretResolution_F42(t *testing.T) {
	var seenAuth, seenHost, seenBody, seenQuery string
	client, srv := newPipeClientAndServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenAuth = r.Header.Get("Authorization")
		seenHost = r.Header.Get("X-Target-Env")
		seenQuery = r.URL.Query().Get("page")
		b, _ := io.ReadAll(r.Body)
		seenBody = string(b)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"role":"admin"}`))
	}), false)
	defer srv.Close()

	resolveSecret := func(ref string) (string, error) {
		if ref == "api-key-1" {
			return "super-secret-token", nil
		}
		return "", nil
	}

	resp, err := client.Execute(context.Background(), core.ApiExecuteRequest{
		Request: core.ApiRequestItem{
			ID:     "req-1",
			Method: "POST",
			URL:    "{{BASE_URL}}/v1/users",
			Params: []core.ApiKeyValue{{Key: "page", Value: "2", Enabled: true}},
			Headers: []core.ApiKeyValue{
				{Key: "X-Target-Env", Value: "{{ENV_NAME}}", Enabled: true},
			},
			Auth: core.ApiAuthConfig{
				Type:  "bearer",
				Token: "{{SECRET:api-key-1}}",
			},
			BodyType: "json",
			Body:     `{"action":"probe","secret":"{{SECRET:api-key-1}}"}`,
		},
		Variables: []core.ApiKeyValue{
			{Key: "BASE_URL", Value: srv.URL, Enabled: true},
			{Key: "ENV_NAME", Value: "staging", Enabled: true},
		},
	}, resolveSecret, nil, nil)
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	if resp.StatusCode != 200 || resp.Error != "" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if seenAuth != "Bearer super-secret-token" {
		t.Errorf("expected resolved bearer auth, got %q", seenAuth)
	}
	if seenHost != "staging" || seenQuery != "2" {
		t.Errorf("expected env & query resolution, got env=%q page=%q", seenHost, seenQuery)
	}
	if !strings.Contains(seenBody, "super-secret-token") {
		t.Errorf("expected resolved secret in request body, got %q", seenBody)
	}
	if !strings.Contains(resp.Body, `"ok":true`) {
		t.Errorf("expected JSON response body, got %q", resp.Body)
	}
}

func TestExecuteRawModeCookieJarRedirectAndTLS_F42(t *testing.T) {
	client, srv := newPipeClientAndServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/login":
			http.SetCookie(w, &http.Cookie{Name: "sid", Value: "abc123", Path: "/"})
			w.Header().Set("Location", "/me")
			w.WriteHeader(http.StatusFound)
		case "/me":
			ck, err := r.Cookie("sid")
			if err != nil {
				http.Error(w, "missing cookie", http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte("hello:" + ck.Value + ":" + r.Header.Get("X-Custom")))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}), true)
	defer srv.Close()

	// 1. Login without following redirects preserves 302 and stores cookie in session jar
	loginResp, err := client.Execute(context.Background(), core.ApiExecuteRequest{
		SessionID: "eng-session-1",
		Request: core.ApiRequestItem{
			Method:          "POST",
			URL:             srv.URL + "/login",
			FollowRedirects: false,
			UseCookieJar:    true,
			TlsSkipVerify:   true,
		},
	}, nil, nil, nil)
	if err != nil {
		t.Fatalf("login Execute error: %v", err)
	}
	if loginResp.StatusCode != http.StatusFound {
		t.Fatalf("expected 302 when FollowRedirects=false, got %d (err=%q)", loginResp.StatusCode, loginResp.Error)
	}
	if loginResp.Tls == nil || loginResp.Tls.Version == "" {
		t.Fatalf("expected TLS metadata on HTTPS response, got nil")
	}

	// 2. Raw HTTP request reuses stored cookie from session jar
	rawReq := "GET /me HTTP/1.1\r\nHost: " + strings.TrimPrefix(srv.URL, "https://") + "\r\nX-Custom: repeater\r\n\r\n"
	meResp, err := client.Execute(context.Background(), core.ApiExecuteRequest{
		SessionID: "eng-session-1",
		Request: core.ApiRequestItem{
			URL:           srv.URL,
			RawMode:       true,
			RawRequest:    rawReq,
			UseCookieJar:  true,
			TlsSkipVerify: true,
		},
	}, nil, nil, nil)
	if err != nil {
		t.Fatalf("raw /me Execute error: %v", err)
	}
	if meResp.StatusCode != 200 || meResp.Body != "hello:abc123:repeater" {
		t.Fatalf("expected cookie+header echo from raw mode, got status=%d body=%q err=%q", meResp.StatusCode, meResp.Body, meResp.Error)
	}
}

func TestInspectCurlOpenAPIAndDiffTools_F42(t *testing.T) {
	// 1. JWT Inspector
	hdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	claims := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"pentester","exp":1700000000}`))
	jwtDecoded := apiclient.InspectPayload(hdr+"."+claims+".sig", "auto")
	if jwtDecoded.Format != "jwt" || jwtDecoded.JwtAlg != "HS256" || !jwtDecoded.JwtExpired {
		t.Fatalf("unexpected JWT inspect result: %+v", jwtDecoded)
	}

	// 2. cURL import + code generation (masked secrets)
	parsed, err := apiclient.ParseCurlCommand(`curl -k -X POST -H "X-Api-Key: abc" -d '{"id":1}' https://api.internal.local/v1/items`)
	if err != nil {
		t.Fatalf("ParseCurlCommand error: %v", err)
	}
	if parsed.Method != "POST" || !parsed.TlsSkipVerify || parsed.BodyType != "json" {
		t.Fatalf("unexpected parsed cURL item: %+v", parsed)
	}
	parsed.Auth = core.ApiAuthConfig{Type: "bearer", Token: "live-secret"}
	ps, err := apiclient.GenerateCodeSnippet(*parsed, "powershell", nil, nil)
	if err != nil {
		t.Fatalf("GenerateCodeSnippet powershell error: %v", err)
	}
	if strings.Contains(ps, "live-secret") {
		t.Errorf("expected inline secret to stay redacted when resolveSecret=nil, got: %s", ps)
	}

	// 3. OpenAPI v3 import
	spec := `{
		"openapi": "3.0.0",
		"info": {"title": "Target Billing API"},
		"servers": [{"url": "https://billing.internal"}],
		"paths": {
			"/invoices": {
				"get": {"summary": "List invoices", "parameters": [{"name": "limit", "in": "query"}]},
				"post": {"summary": "Create invoice", "requestBody": {"required": true}}
			}
		}
	}`
	items, err := apiclient.ParseOpenAPISpec(spec, "eng-1", "")
	if err != nil || len(items) != 2 {
		t.Fatalf("expected 2 OpenAPI items, got len=%d err=%v", len(items), err)
	}

	// 4. Response Diff
	diff := apiclient.DiffResponses(
		core.ApiResponse{StatusCode: 200, SizeBytes: 12, RawHeaders: "X: 1", Body: "line1\nuser=guest"},
		core.ApiResponse{StatusCode: 200, SizeBytes: 12, RawHeaders: "X: 1", Body: "line1\nuser=admin"},
	)
	if len(diff.BodyLines) < 3 || diff.StatusDelta != "200 -> 200" {
		t.Fatalf("unexpected diff result: %+v", diff)
	}
}

func TestExecuteParameterReplayWithLockoutWarning_F42(t *testing.T) {
	client, srv := newPipeClientAndServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		if id == "42" {
			_, _ = w.Write([]byte("SECRET_ADMIN_RECORD"))
			return
		}
		_, _ = w.Write([]byte("denied"))
	}), false)
	defer srv.Close()

	progressCount := 0
	batchRes, err := client.ExecuteParameterReplay(
		context.Background(),
		core.ApiReplayBatchRequest{
			ExecutionID: "batch-1",
			Request: core.ApiRequestItem{
				Method: "GET",
				URL:    srv.URL + "/profile?id={{PAYLOAD}}",
			},
			Payloads: []string{"1", "42", "99"},
			DelayMs:  50,
		},
		3, // Lockout policy threshold
		nil,
		nil,
		nil,
		func(done, total int, entry core.ApiReplayEntryResult) {
			progressCount++
		},
	)
	if err != nil {
		t.Fatalf("ExecuteParameterReplay error: %v", err)
	}
	if batchRes.Completed != 3 || progressCount != 3 {
		t.Fatalf("expected 3 completed payloads, got completed=%d progress=%d", batchRes.Completed, progressCount)
	}
	if !strings.Contains(batchRes.LockoutWarning, "F-40") {
		t.Errorf("expected lockout policy warning when payload count hits threshold, got %q", batchRes.LockoutWarning)
	}
	if batchRes.Results[1].SizeBytes <= batchRes.Results[0].SizeBytes {
		t.Errorf("expected outlier length on payload 42, got sizes %d vs %d", batchRes.Results[1].SizeBytes, batchRes.Results[0].SizeBytes)
	}
}

func TestExecuteAiChatStreamingSSEAndOllama_F42(t *testing.T) {
	// 1. OpenAI SSE endpoint mock
	openaiClient, openaiSrv := newPipeClientAndServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-vault-test" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"model\":\"gpt-4o-mini\",\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"model\":\"gpt-4o-mini\",\"choices\":[{\"delta\":{\"content\":\"World\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}), false)
	defer openaiSrv.Close()

	var deltas []string
	res, err := openaiClient.ExecuteAiChat(
		context.Background(),
		core.ApiAiChatRequest{
			StreamID:    "stream-1",
			Provider:    "openai",
			EndpointURL: openaiSrv.URL,
			Model:       "gpt-4o-mini",
			Auth:        core.ApiAuthConfig{Type: "bearer", Token: "{{SECRET:ai-key}}"},
			Messages:    []core.ApiAiChatMessage{{Role: "user", Content: "hi"}},
			Stream:      true,
			TimeoutSec:  10,
		},
		nil,
		func(ref string) (string, error) {
			if ref == "ai-key" {
				return "sk-vault-test", nil
			}
			return "", nil
		},
		nil,
		nil,
		func(ev core.ApiAiStreamChunkEvent) {
			if ev.Delta != "" {
				deltas = append(deltas, ev.Delta)
			}
		},
	)
	if err != nil {
		t.Fatalf("ExecuteAiChat OpenAI error: %v", err)
	}
	if res.Reply != "Hello World" || len(deltas) != 2 {
		t.Fatalf("expected streamed 'Hello World' in 2 deltas, got reply=%q deltas=%v err=%q", res.Reply, deltas, res.Error)
	}

	// 2. Ollama NDJSON mock
	ollamaClient, ollamaSrv := newPipeClientAndServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		enc := json.NewEncoder(w)
		_ = enc.Encode(map[string]any{"model": "llama3.1", "message": map[string]string{"content": "Local "}, "done": false})
		_ = enc.Encode(map[string]any{"model": "llama3.1", "message": map[string]string{"content": "LLM"}, "done": true, "eval_count": 7})
	}), false)
	defer ollamaSrv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	olRes, err := ollamaClient.ExecuteAiChat(ctx, core.ApiAiChatRequest{
		StreamID:    "stream-2",
		Provider:    "ollama",
		EndpointURL: ollamaSrv.URL,
		Model:       "llama3.1",
		Messages:    []core.ApiAiChatMessage{{Role: "user", Content: "ping"}},
		Stream:      true,
	}, nil, nil, nil, nil, nil)
	if err != nil {
		t.Fatalf("ExecuteAiChat Ollama error: %v", err)
	}
	if olRes.Reply != "Local LLM" || olRes.CompletionTokens != 7 {
		t.Fatalf("unexpected Ollama response: %+v", olRes)
	}
}
