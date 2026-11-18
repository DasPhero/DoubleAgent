package apiclient

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptrace"
	"net/textproto"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"doubleagent/backend/core"
	"doubleagent/backend/hexrunner"
	"golang.org/x/net/proxy"
)

const (
	defaultTimeoutSec = 20
	maxResponseBytes  = 4 * 1024 * 1024 // 4 MiB body cap to keep WebView2 responsive
	minReplayDelayMs  = 50
	maxReplayPayloads = 250
)

var (
	envPlaceholderRe    = regexp.MustCompile(`\{\{([A-Za-z0-9_.-]+)\}\}`)
	secretPlaceholderRe = regexp.MustCompile(`\{\{SECRET:([^}]+)\}\}`)
)

// ProxyTarget describes the resolved outbound proxy or tunnel dial configuration (F-42).
type ProxyTarget struct {
	Label    string
	Kind     string // "" | "direct" | "socks5" | "http"
	Address  string
	Username string
	Password string
}

// SecretResolver resolves {{SECRET:<ref>}} tokens exclusively inside Go (Golden Rule 2).
type SecretResolver func(ref string) (string, error)

// AuthLookup resolves Vault CredentialID / IdentityID references into usable username/secret values in Go.
type AuthLookup func(auth core.ApiAuthConfig) (username string, secret string, err error)

// RouteResolver maps a UI RouteID to a direct or proxied dial target.
type RouteResolver func(routeID string) (ProxyTarget, error)

// Client executes HTTP repeater requests, throttled parameter replays, and streaming AI chats in Go (F-42).
type Client struct {
	// DialContext optionally overrides network dialing (nil uses standard net.Dialer; used in sandboxed tests).
	DialContext func(ctx context.Context, network, addr string) (net.Conn, error)
	mu          sync.Mutex
	jars        map[string]*cookiejar.Jar
	cancels     map[string]context.CancelFunc
}

// NewClient initializes an API client with per-session cookie jars and cancellation tracking.
func NewClient() *Client {
	return &Client{
		jars:    make(map[string]*cookiejar.Jar),
		cancels: make(map[string]context.CancelFunc),
	}
}

// Cancel aborts an active request, replay batch, or AI stream matching executionID.
func (c *Client) Cancel(executionID string) bool {
	c.mu.Lock()
	cancel, ok := c.cancels[executionID]
	c.mu.Unlock()
	if ok && cancel != nil {
		cancel()
		return true
	}
	return false
}

func (c *Client) registerCancel(executionID string, cancel context.CancelFunc) func() {
	if strings.TrimSpace(executionID) == "" {
		return cancel
	}
	c.mu.Lock()
	c.cancels[executionID] = cancel
	c.mu.Unlock()
	return func() {
		cancel()
		c.mu.Lock()
		delete(c.cancels, executionID)
		c.mu.Unlock()
	}
}

func (c *Client) jarForSession(sessionID string) *cookiejar.Jar {
	key := strings.TrimSpace(sessionID)
	if key == "" {
		key = "default"
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if j, ok := c.jars[key]; ok {
		return j
	}
	j, _ := cookiejar.New(nil)
	c.jars[key] = j
	return j
}

// ResetCookieJar clears stored session cookies for the given session key.
func (c *Client) ResetCookieJar(sessionID string) {
	key := strings.TrimSpace(sessionID)
	if key == "" {
		key = "default"
	}
	c.mu.Lock()
	delete(c.jars, key)
	c.mu.Unlock()
}

// ResolveTemplateString expands {{VAR}} environment variables and {{SECRET:ref}} Vault secrets inside Go.
func ResolveTemplateString(input string, vars map[string]string, resolveSecret SecretResolver) (string, error) {
	out := input
	if len(vars) > 0 {
		out = envPlaceholderRe.ReplaceAllStringFunc(out, func(match string) string {
			name := match[2 : len(match)-2]
			if v, ok := vars[name]; ok {
				return v
			}
			return match
		})
	}
	if resolveSecret != nil && strings.Contains(out, "{{SECRET:") {
		var resolveErr error
		out = secretPlaceholderRe.ReplaceAllStringFunc(out, func(match string) string {
			if resolveErr != nil {
				return match
			}
			ref := strings.TrimSpace(match[len("{{SECRET:") : len(match)-2])
			val, err := resolveSecret(ref)
			if err != nil {
				resolveErr = err
				return match
			}
			return val
		})
		if resolveErr != nil {
			return "", resolveErr
		}
	}
	return out, nil
}

func buildVarsMap(pairs []core.ApiKeyValue) map[string]string {
	m := make(map[string]string, len(pairs))
	for _, p := range pairs {
		if !p.Enabled || strings.TrimSpace(p.Key) == "" {
			continue
		}
		m[strings.TrimSpace(p.Key)] = p.Value
	}
	return m
}

// Execute runs a single HTTP request (structured or raw wire mode) with proxy routing and telemetry (F-42).
func (c *Client) Execute(
	ctx context.Context,
	execReq core.ApiExecuteRequest,
	resolveSecret SecretResolver,
	lookupAuth AuthLookup,
	resolveRoute RouteResolver,
) (*core.ApiResponse, error) {
	reqItem := execReq.Request
	timeoutSec := reqItem.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = defaultTimeoutSec
	}
	runCtx, rawCancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	cleanup := c.registerCancel(execReq.ExecutionID, rawCancel)
	defer cleanup()

	vars := buildVarsMap(execReq.Variables)

	httpReq, effectiveURL, err := buildHTTPRequest(runCtx, reqItem, vars, resolveSecret, lookupAuth)
	if err != nil {
		return &core.ApiResponse{
			RequestID: reqItem.ID,
			Error:     err.Error(),
		}, nil
	}

	routeTarget := ProxyTarget{Label: "Direct", Kind: "direct"}
	if resolveRoute != nil && strings.TrimSpace(reqItem.RouteID) != "" {
		rt, rErr := resolveRoute(reqItem.RouteID)
		if rErr != nil {
			return &core.ApiResponse{
				RequestID:    reqItem.ID,
				EffectiveURL: effectiveURL,
				Error:        fmt.Sprintf("route error: %v", rErr),
			}, nil
		}
		routeTarget = rt
	} else if strings.HasPrefix(strings.ToLower(strings.TrimSpace(reqItem.RouteID)), "socks5://") {
		addr := strings.TrimPrefix(strings.TrimSpace(reqItem.RouteID), "socks5://")
		routeTarget = ProxyTarget{Label: "socks5://" + addr, Kind: "socks5", Address: addr}
	}

	transport, timingCollector, cleanupTransport := buildTransport(routeTarget, reqItem.TlsSkipVerify, c.DialContext)
	defer cleanupTransport()

	var redirects []string
	client := &http.Client{
		Transport: transport,
		Timeout:   time.Duration(timeoutSec) * time.Second,
	}
	if reqItem.UseCookieJar {
		client.Jar = c.jarForSession(execReq.SessionID)
	}
	client.CheckRedirect = func(nextReq *http.Request, via []*http.Request) error {
		redirects = append(redirects, fmt.Sprintf("%s %s", nextReq.Method, nextReq.URL.String()))
		if !reqItem.FollowRedirects {
			return http.ErrUseLastResponse
		}
		if len(via) >= 10 {
			return errors.New("stopped after 10 redirects")
		}
		return nil
	}

	traceCtx := httptrace.WithClientTrace(httpReq.Context(), timingCollector.clientTrace())
	httpReq = httpReq.WithContext(traceCtx)

	start := time.Now()
	resp, err := client.Do(httpReq)
	if err != nil {
		return &core.ApiResponse{
			RequestID:     reqItem.ID,
			EffectiveURL:  effectiveURL,
			RouteUsed:     routeTarget.Label,
			RedirectChain: redirects,
			Timing:        timingCollector.finalize(start),
			Error:         err.Error(),
		}, nil
	}
	defer resp.Body.Close()

	limited := io.LimitReader(resp.Body, maxResponseBytes+1)
	bodyBytes, readErr := io.ReadAll(limited)
	timing := timingCollector.finalize(start)
	if readErr != nil {
		return &core.ApiResponse{
			RequestID:     reqItem.ID,
			StatusCode:    resp.StatusCode,
			Status:        resp.Status,
			Proto:         resp.Proto,
			EffectiveURL:  resp.Request.URL.String(),
			RouteUsed:     routeTarget.Label,
			RedirectChain: redirects,
			Timing:        timing,
			Error:         fmt.Sprintf("read body error: %v", readErr),
		}, nil
	}

	truncated := false
	if len(bodyBytes) > maxResponseBytes {
		truncated = true
		bodyBytes = bodyBytes[:maxResponseBytes]
	}

	isBinary := !utf8.Valid(bodyBytes) || bytes.IndexByte(bodyBytes, 0) >= 0
	bodyText := ""
	bodyB64 := ""
	if isBinary {
		bodyB64 = base64.StdEncoding.EncodeToString(bodyBytes)
		bodyText = fmt.Sprintf("[binary payload: %d bytes, base64 available]", len(bodyBytes))
	} else {
		bodyText = string(bodyBytes)
	}

	rawHeaders := formatHeadersCanonical(resp.Header)
	cookies := make([]string, 0, len(resp.Cookies()))
	for _, ck := range resp.Cookies() {
		cookies = append(cookies, ck.String())
	}

	var tlsInfo *core.ApiTlsInfo
	if resp.TLS != nil {
		tlsInfo = extractTLSInfo(resp.TLS, !reqItem.TlsSkipVerify)
	}

	finalURL := effectiveURL
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL = resp.Request.URL.String()
	}

	return &core.ApiResponse{
		RequestID:     reqItem.ID,
		StatusCode:    resp.StatusCode,
		Status:        resp.Status,
		Proto:         resp.Proto,
		Headers:       resp.Header,
		RawHeaders:    rawHeaders,
		Body:          bodyText,
		BodyBase64:    bodyB64,
		IsBinary:      isBinary,
		SizeBytes:     int64(len(bodyBytes)),
		Truncated:     truncated,
		ContentType:   resp.Header.Get("Content-Type"),
		EffectiveURL:  finalURL,
		RouteUsed:     routeTarget.Label,
		Tls:           tlsInfo,
		Timing:        timing,
		RedirectChain: redirects,
		Cookies:       cookies,
	}, nil
}

// ExecuteParameterReplay runs single-parameter {{PAYLOAD}} replay with mandatory throttling and lock checks (F-42, F-40).
func (c *Client) ExecuteParameterReplay(
	ctx context.Context,
	batch core.ApiReplayBatchRequest,
	lockoutMaxAttempts int,
	resolveSecret SecretResolver,
	lookupAuth AuthLookup,
	resolveRoute RouteResolver,
	onProgress func(done int, total int, entry core.ApiReplayEntryResult),
) (*core.ApiReplayBatchResult, error) {
	payloads := make([]string, 0, len(batch.Payloads))
	for _, p := range batch.Payloads {
		if len(payloads) >= maxReplayPayloads {
			break
		}
		payloads = append(payloads, p)
	}
	if len(payloads) == 0 {
		return nil, errors.New("at least one payload value is required for parameter replay")
	}

	delayMs := batch.DelayMs
	if delayMs < minReplayDelayMs {
		delayMs = minReplayDelayMs
	}

	runCtx, rawCancel := context.WithCancel(ctx)
	cleanup := c.registerCancel(batch.ExecutionID, rawCancel)
	defer cleanup()

	var lockoutWarn string
	if lockoutMaxAttempts > 0 && len(payloads) >= lockoutMaxAttempts {
		lockoutWarn = fmt.Sprintf(
			"Engagement lockout guard (F-40): %d payloads reaches/exceeds threshold %d — verify scope & rate limits.",
			len(payloads), lockoutMaxAttempts,
		)
	}

	result := &core.ApiReplayBatchResult{
		ExecutionID:    batch.ExecutionID,
		Total:          len(payloads),
		LockoutWarning: lockoutWarn,
		Results:        make([]core.ApiReplayEntryResult, 0, len(payloads)),
	}

	for idx, val := range payloads {
		select {
		case <-runCtx.Done():
			result.Aborted = true
			return result, nil
		default:
		}

		// Merge PAYLOAD variable cleanly without mutating caller slice.
		vars := make([]core.ApiKeyValue, 0, len(batch.Variables)+1)
		vars = append(vars, batch.Variables...)
		vars = append(vars, core.ApiKeyValue{Key: "PAYLOAD", Value: val, Enabled: true})

		resp, err := c.Execute(runCtx, core.ApiExecuteRequest{
			SessionID: batch.SessionID,
			EnvID:     batch.EnvID,
			Request:   batch.Request,
			Variables: vars,
		}, resolveSecret, lookupAuth, resolveRoute)
		if err != nil {
			resp = &core.ApiResponse{Error: err.Error()}
		}

		entry := core.ApiReplayEntryResult{
			Index:      idx,
			Payload:    val,
			StatusCode: resp.StatusCode,
			Status:     resp.Status,
			SizeBytes:  resp.SizeBytes,
			TotalMs:    resp.Timing.TotalMs,
			RouteUsed:  resp.RouteUsed,
			Error:      resp.Error,
			Response:   resp,
		}
		result.Results = append(result.Results, entry)
		result.Completed++
		if onProgress != nil {
			onProgress(result.Completed, result.Total, entry)
		}

		if idx < len(payloads)-1 {
			timer := time.NewTimer(time.Duration(delayMs) * time.Millisecond)
			select {
			case <-runCtx.Done():
				timer.Stop()
				result.Aborted = true
				return result, nil
			case <-timer.C:
			}
		}
	}

	return result, nil
}

// ExecuteAiChat formats an AI endpoint request (OpenAI/Anthropic/Ollama/Custom) and streams SSE/NDJSON deltas (F-42).
func (c *Client) ExecuteAiChat(
	ctx context.Context,
	chatReq core.ApiAiChatRequest,
	varsMap map[string]string,
	resolveSecret SecretResolver,
	lookupAuth AuthLookup,
	resolveRoute RouteResolver,
	onChunk func(ev core.ApiAiStreamChunkEvent),
) (*core.ApiAiChatResult, error) {
	endpoint, err := ResolveTemplateString(strings.TrimSpace(chatReq.EndpointURL), varsMap, resolveSecret)
	if err != nil {
		return nil, err
	}
	if endpoint == "" {
		return nil, errors.New("AI endpoint URL is required")
	}

	timeoutSec := chatReq.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = 90
	}
	runCtx, rawCancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	cleanup := c.registerCancel(chatReq.StreamID, rawCancel)
	defer cleanup()

	provider := strings.ToLower(strings.TrimSpace(chatReq.Provider))
	if provider == "" {
		provider = "openai"
	}

	payloadObj, headers, err := buildAiPayloadAndHeaders(provider, chatReq)
	if err != nil {
		return nil, err
	}
	rawReqPrettyBytes, _ := json.MarshalIndent(payloadObj, "", "  ")
	rawReqBody, err := json.Marshal(payloadObj)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(runCtx, http.MethodPost, endpoint, bytes.NewReader(rawReqBody))
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}
	if err := applyAuth(httpReq, chatReq.Auth, varsMap, resolveSecret, lookupAuth); err != nil {
		return nil, err
	}

	routeTarget := ProxyTarget{Label: "Direct", Kind: "direct"}
	if resolveRoute != nil && strings.TrimSpace(chatReq.RouteID) != "" {
		rt, rErr := resolveRoute(chatReq.RouteID)
		if rErr != nil {
			return &core.ApiAiChatResult{
				StreamID:       chatReq.StreamID,
				RawRequestJSON: string(rawReqPrettyBytes),
				Error:          rErr.Error(),
			}, nil
		}
		routeTarget = rt
	} else if strings.HasPrefix(strings.ToLower(strings.TrimSpace(chatReq.RouteID)), "socks5://") {
		addr := strings.TrimPrefix(strings.TrimSpace(chatReq.RouteID), "socks5://")
		routeTarget = ProxyTarget{Label: "socks5://" + addr, Kind: "socks5", Address: addr}
	}

	transport, _, cleanupTransport := buildTransport(routeTarget, chatReq.TlsSkipVerify, c.DialContext)
	defer cleanupTransport()
	httpClient := &http.Client{
		Transport: transport,
		Timeout:   time.Duration(timeoutSec) * time.Second,
	}

	start := time.Now()
	resp, err := httpClient.Do(httpReq)
	if err != nil {
		return &core.ApiAiChatResult{
			StreamID:       chatReq.StreamID,
			RawRequestJSON: string(rawReqPrettyBytes),
			DurationMs:     time.Since(start).Milliseconds(),
			RouteUsed:      routeTarget.Label,
			Error:          err.Error(),
		}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
		errMsg := fmt.Sprintf("HTTP %s: %s", resp.Status, strings.TrimSpace(string(errBody)))
		if onChunk != nil {
			onChunk(core.ApiAiStreamChunkEvent{StreamID: chatReq.StreamID, Done: true, Error: errMsg})
		}
		return &core.ApiAiChatResult{
			StreamID:       chatReq.StreamID,
			StatusCode:     resp.StatusCode,
			RawRequestJSON: string(rawReqPrettyBytes),
			RawResponse:    string(errBody),
			DurationMs:     time.Since(start).Milliseconds(),
			RouteUsed:      routeTarget.Label,
			Error:          errMsg,
		}, nil
	}

	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	isSSE := strings.Contains(contentType, "text/event-stream")
	isNDJSON := strings.Contains(contentType, "application/x-ndjson") || (provider == "ollama" && chatReq.Stream)

	var fullReply strings.Builder
	var rawRespBuf bytes.Buffer
	var promptTokens, completionTokens int
	modelUsed := chatReq.Model

	if chatReq.Stream && (isSSE || isNDJSON) {
		scanner := bufio.NewScanner(io.LimitReader(resp.Body, maxResponseBytes))
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			rawRespBuf.WriteString(line)
			rawRespBuf.WriteByte('\n')

			trimmed := strings.TrimSpace(line)
			if trimmed == "" || strings.HasPrefix(trimmed, "event:") || strings.HasPrefix(trimmed, ":") {
				continue
			}
			if strings.HasPrefix(trimmed, "data:") {
				trimmed = strings.TrimSpace(strings.TrimPrefix(trimmed, "data:"))
			}
			if trimmed == "[DONE]" {
				break
			}
			delta, pTok, cTok, mName := extractAiDelta(provider, trimmed)
			if mName != "" {
				modelUsed = mName
			}
			if pTok > 0 {
				promptTokens = pTok
			}
			if cTok > 0 {
				completionTokens = cTok
			}
			if delta != "" {
				fullReply.WriteString(delta)
				if onChunk != nil {
					onChunk(core.ApiAiStreamChunkEvent{
						StreamID: chatReq.StreamID,
						Delta:    delta,
					})
				}
			}
		}
		if err := scanner.Err(); err != nil {
			if onChunk != nil {
				onChunk(core.ApiAiStreamChunkEvent{StreamID: chatReq.StreamID, Done: true, Error: err.Error()})
			}
			return &core.ApiAiChatResult{
				StreamID:       chatReq.StreamID,
				Reply:          fullReply.String(),
				Model:          modelUsed,
				StatusCode:     resp.StatusCode,
				RawRequestJSON: string(rawReqPrettyBytes),
				RawResponse:    rawRespBuf.String(),
				DurationMs:     time.Since(start).Milliseconds(),
				RouteUsed:      routeTarget.Label,
				Error:          err.Error(),
			}, nil
		}
		if onChunk != nil {
			onChunk(core.ApiAiStreamChunkEvent{StreamID: chatReq.StreamID, Done: true})
		}
	} else {
		bodyBytes, rErr := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
		if rErr != nil {
			return nil, rErr
		}
		rawRespBuf.Write(bodyBytes)
		reply, pTok, cTok, mName := extractAiFullReply(provider, bodyBytes)
		fullReply.WriteString(reply)
		promptTokens = pTok
		completionTokens = cTok
		if mName != "" {
			modelUsed = mName
		}
		if onChunk != nil {
			onChunk(core.ApiAiStreamChunkEvent{StreamID: chatReq.StreamID, Delta: reply, Done: true})
		}
	}

	return &core.ApiAiChatResult{
		StreamID:         chatReq.StreamID,
		Reply:            fullReply.String(),
		Model:            modelUsed,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		RawRequestJSON:   string(rawReqPrettyBytes),
		RawResponse:      rawRespBuf.String(),
		StatusCode:       resp.StatusCode,
		DurationMs:       time.Since(start).Milliseconds(),
		RouteUsed:        routeTarget.Label,
	}, nil
}

func buildAiPayloadAndHeaders(provider string, req core.ApiAiChatRequest) (map[string]any, map[string]string, error) {
	headers := map[string]string{
		"Content-Type": "application/json",
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		switch provider {
		case "anthropic":
			model = "claude-sonnet-4-20250514"
		case "ollama":
			model = "llama3.1"
		default:
			model = "gpt-4o-mini"
		}
	}

	switch provider {
	case "anthropic":
		headers["anthropic-version"] = "2023-06-01"
		var sysParts []string
		msgs := make([]map[string]string, 0, len(req.Messages))
		for _, m := range req.Messages {
			if strings.EqualFold(m.Role, "system") {
				if strings.TrimSpace(m.Content) != "" {
					sysParts = append(sysParts, m.Content)
				}
				continue
			}
			msgs = append(msgs, map[string]string{"role": m.Role, "content": m.Content})
		}
		maxTok := req.MaxTokens
		if maxTok <= 0 {
			maxTok = 1024
		}
		payload := map[string]any{
			"model":      model,
			"max_tokens": maxTok,
			"messages":   msgs,
			"stream":     req.Stream,
		}
		if len(sysParts) > 0 {
			payload["system"] = strings.Join(sysParts, "\n\n")
		}
		if req.Temperature > 0 {
			payload["temperature"] = req.Temperature
		}
		return payload, headers, nil

	case "ollama":
		msgs := make([]map[string]string, 0, len(req.Messages))
		for _, m := range req.Messages {
			msgs = append(msgs, map[string]string{"role": m.Role, "content": m.Content})
		}
		payload := map[string]any{
			"model":    model,
			"messages": msgs,
			"stream":   req.Stream,
		}
		if req.Temperature > 0 {
			payload["options"] = map[string]any{"temperature": req.Temperature}
		}
		return payload, headers, nil

	default: // "openai" / OpenAI-compatible / "custom"
		msgs := make([]map[string]string, 0, len(req.Messages))
		for _, m := range req.Messages {
			msgs = append(msgs, map[string]string{"role": m.Role, "content": m.Content})
		}
		payload := map[string]any{
			"model":    model,
			"messages": msgs,
			"stream":   req.Stream,
		}
		if req.Temperature > 0 {
			payload["temperature"] = req.Temperature
		}
		if req.MaxTokens > 0 {
			payload["max_tokens"] = req.MaxTokens
		}
		return payload, headers, nil
	}
}

func extractAiDelta(provider string, jsonLine string) (delta string, promptTok int, completionTok int, model string) {
	var raw map[string]any
	if err := json.Unmarshal([]byte(jsonLine), &raw); err != nil {
		return "", 0, 0, ""
	}
	if m, ok := raw["model"].(string); ok {
		model = m
	}

	switch provider {
	case "anthropic":
		evType, _ := raw["type"].(string)
		if evType == "content_block_delta" {
			if d, ok := raw["delta"].(map[string]any); ok {
				if txt, ok := d["text"].(string); ok {
					delta = txt
				}
			}
		} else if evType == "message_delta" {
			if u, ok := raw["usage"].(map[string]any); ok {
				if out, ok := u["output_tokens"].(float64); ok {
					completionTok = int(out)
				}
			}
		} else if evType == "message_start" {
			if msg, ok := raw["message"].(map[string]any); ok {
				if m, ok := msg["model"].(string); ok {
					model = m
				}
				if u, ok := msg["usage"].(map[string]any); ok {
					if in, ok := u["input_tokens"].(float64); ok {
						promptTok = int(in)
					}
				}
			}
		}
	case "ollama":
		if msg, ok := raw["message"].(map[string]any); ok {
			if txt, ok := msg["content"].(string); ok {
				delta = txt
			}
		}
		if respTxt, ok := raw["response"].(string); ok && delta == "" {
			delta = respTxt
		}
		if p, ok := raw["prompt_eval_count"].(float64); ok {
			promptTok = int(p)
		}
		if c, ok := raw["eval_count"].(float64); ok {
			completionTok = int(c)
		}
	default:
		if choices, ok := raw["choices"].([]any); ok && len(choices) > 0 {
			if first, ok := choices[0].(map[string]any); ok {
				if d, ok := first["delta"].(map[string]any); ok {
					if c, ok := d["content"].(string); ok {
						delta = c
					}
				}
			}
		}
		if u, ok := raw["usage"].(map[string]any); ok {
			if p, ok := u["prompt_tokens"].(float64); ok {
				promptTok = int(p)
			}
			if c, ok := u["completion_tokens"].(float64); ok {
				completionTok = int(c)
			}
		}
	}
	return delta, promptTok, completionTok, model
}

func extractAiFullReply(provider string, body []byte) (reply string, promptTok int, completionTok int, model string) {
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		return string(body), 0, 0, ""
	}
	if m, ok := raw["model"].(string); ok {
		model = m
	}

	switch provider {
	case "anthropic":
		if content, ok := raw["content"].([]any); ok {
			var sb strings.Builder
			for _, part := range content {
				if pMap, ok := part.(map[string]any); ok {
					if txt, ok := pMap["text"].(string); ok {
						sb.WriteString(txt)
					}
				}
			}
			reply = sb.String()
		}
		if u, ok := raw["usage"].(map[string]any); ok {
			if in, ok := u["input_tokens"].(float64); ok {
				promptTok = int(in)
			}
			if out, ok := u["output_tokens"].(float64); ok {
				completionTok = int(out)
			}
		}
	case "ollama":
		if msg, ok := raw["message"].(map[string]any); ok {
			if c, ok := msg["content"].(string); ok {
				reply = c
			}
		}
		if reply == "" {
			if r, ok := raw["response"].(string); ok {
				reply = r
			}
		}
		if p, ok := raw["prompt_eval_count"].(float64); ok {
			promptTok = int(p)
		}
		if c, ok := raw["eval_count"].(float64); ok {
			completionTok = int(c)
		}
	default:
		if choices, ok := raw["choices"].([]any); ok && len(choices) > 0 {
			if first, ok := choices[0].(map[string]any); ok {
				if msg, ok := first["message"].(map[string]any); ok {
					if c, ok := msg["content"].(string); ok {
						reply = c
					}
				} else if txt, ok := first["text"].(string); ok {
					reply = txt
				}
			}
		}
		if u, ok := raw["usage"].(map[string]any); ok {
			if p, ok := u["prompt_tokens"].(float64); ok {
				promptTok = int(p)
			}
			if c, ok := u["completion_tokens"].(float64); ok {
				completionTok = int(c)
			}
		}
	}
	if reply == "" {
		reply = string(body)
	}
	return reply, promptTok, completionTok, model
}

func buildHTTPRequest(
	ctx context.Context,
	item core.ApiRequestItem,
	vars map[string]string,
	resolveSecret SecretResolver,
	lookupAuth AuthLookup,
) (*http.Request, string, error) {
	if item.RawMode && strings.TrimSpace(item.RawRequest) != "" {
		return buildFromRawHTTP(ctx, item, vars, resolveSecret, lookupAuth)
	}

	method := strings.ToUpper(strings.TrimSpace(item.Method))
	if method == "" {
		method = http.MethodGet
	}
	rawURL, err := ResolveTemplateString(strings.TrimSpace(item.URL), vars, resolveSecret)
	if err != nil {
		return nil, "", err
	}
	if rawURL == "" {
		return nil, "", errors.New("request URL must not be empty")
	}
	if !strings.Contains(rawURL, "://") {
		rawURL = "http://" + rawURL
	}

	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return nil, "", fmt.Errorf("invalid URL: %w", err)
	}
	query := parsedURL.Query()
	for _, p := range item.Params {
		if !p.Enabled || strings.TrimSpace(p.Key) == "" {
			continue
		}
		k, kErr := ResolveTemplateString(p.Key, vars, resolveSecret)
		if kErr != nil {
			return nil, "", kErr
		}
		v, vErr := ResolveTemplateString(p.Value, vars, resolveSecret)
		if vErr != nil {
			return nil, "", vErr
		}
		query.Add(k, v)
	}
	parsedURL.RawQuery = query.Encode()

	var bodyReader io.Reader
	var defaultContentType string
	switch strings.ToLower(strings.TrimSpace(item.BodyType)) {
	case "", "none":
		bodyReader = nil
	case "json":
		resolvedBody, bErr := ResolveTemplateString(item.Body, vars, resolveSecret)
		if bErr != nil {
			return nil, "", bErr
		}
		bodyReader = strings.NewReader(resolvedBody)
		defaultContentType = "application/json"
	case "form":
		resolvedBody, bErr := ResolveTemplateString(item.Body, vars, resolveSecret)
		if bErr != nil {
			return nil, "", bErr
		}
		bodyReader = strings.NewReader(resolvedBody)
		defaultContentType = "application/x-www-form-urlencoded"
	case "hex":
		resolvedBody, bErr := ResolveTemplateString(item.Body, vars, resolveSecret)
		if bErr != nil {
			return nil, "", bErr
		}
		rawBytes, hErr := hexrunner.CompilePayload(resolvedBody)
		if hErr != nil {
			return nil, "", fmt.Errorf("invalid hex payload body: %w", hErr)
		}
		bodyReader = bytes.NewReader(rawBytes)
		defaultContentType = "application/octet-stream"
	default: // "raw"
		resolvedBody, bErr := ResolveTemplateString(item.Body, vars, resolveSecret)
		if bErr != nil {
			return nil, "", bErr
		}
		bodyReader = strings.NewReader(resolvedBody)
	}

	req, err := http.NewRequestWithContext(ctx, method, parsedURL.String(), bodyReader)
	if err != nil {
		return nil, "", err
	}

	hasContentType := false
	for _, h := range item.Headers {
		if !h.Enabled || strings.TrimSpace(h.Key) == "" {
			continue
		}
		hk, kErr := ResolveTemplateString(strings.TrimSpace(h.Key), vars, resolveSecret)
		if kErr != nil {
			return nil, "", kErr
		}
		hv, vErr := ResolveTemplateString(h.Value, vars, resolveSecret)
		if vErr != nil {
			return nil, "", vErr
		}
		if strings.EqualFold(hk, "Host") {
			req.Host = hv
			continue
		}
		if strings.EqualFold(hk, "Content-Type") {
			hasContentType = true
		}
		req.Header.Add(hk, hv)
	}
	if defaultContentType != "" && !hasContentType {
		req.Header.Set("Content-Type", defaultContentType)
	}

	if err := applyAuth(req, item.Auth, vars, resolveSecret, lookupAuth); err != nil {
		return nil, "", err
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "DoubleAgent-APITester/1.0")
	}

	return req, parsedURL.String(), nil
}

// ParseRawHTTPRequest converts a Burp/Caido-style HTTP/1.1 wire request into an http.Request (F-42).
func buildFromRawHTTP(
	ctx context.Context,
	item core.ApiRequestItem,
	vars map[string]string,
	resolveSecret SecretResolver,
	lookupAuth AuthLookup,
) (*http.Request, string, error) {
	resolvedRaw, err := ResolveTemplateString(item.RawRequest, vars, resolveSecret)
	if err != nil {
		return nil, "", err
	}
	normalized := strings.ReplaceAll(resolvedRaw, "\r\n", "\n")
	head, body, _ := strings.Cut(normalized, "\n\n")

	lines := strings.Split(head, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) == "" {
		return nil, "", errors.New("raw HTTP request line is empty")
	}
	parts := strings.Fields(lines[0])
	if len(parts) < 2 {
		return nil, "", fmt.Errorf("invalid HTTP request line %q", lines[0])
	}
	method := strings.ToUpper(parts[0])
	target := parts[1]

	headers := make(http.Header)
	hostHeader := ""
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) == "" {
			continue
		}
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key := textproto.CanonicalMIMEHeaderKey(strings.TrimSpace(k))
		val := strings.TrimSpace(v)
		if strings.EqualFold(key, "Host") {
			hostHeader = val
			continue
		}
		if strings.EqualFold(key, "Content-Length") {
			continue
		}
		headers.Add(key, val)
	}

	fullURL := target
	if !strings.HasPrefix(strings.ToLower(fullURL), "http://") && !strings.HasPrefix(strings.ToLower(fullURL), "https://") {
		scheme := "https"
		if parsedBase, pErr := url.Parse(strings.TrimSpace(item.URL)); pErr == nil && parsedBase.Scheme != "" {
			scheme = parsedBase.Scheme
			if hostHeader == "" {
				hostHeader = parsedBase.Host
			}
		}
		if hostHeader == "" {
			return nil, "", errors.New("raw request requires either an absolute URL or a Host header")
		}
		if !strings.HasPrefix(fullURL, "/") {
			fullURL = "/" + fullURL
		}
		fullURL = fmt.Sprintf("%s://%s%s", scheme, hostHeader, fullURL)
	}

	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, fullURL, reader)
	if err != nil {
		return nil, "", err
	}
	for k, vals := range headers {
		for _, v := range vals {
			req.Header.Add(k, v)
		}
	}
	if hostHeader != "" {
		req.Host = hostHeader
	}
	if err := applyAuth(req, item.Auth, vars, resolveSecret, lookupAuth); err != nil {
		return nil, "", err
	}
	return req, fullURL, nil
}

func applyAuth(
	req *http.Request,
	auth core.ApiAuthConfig,
	vars map[string]string,
	resolveSecret SecretResolver,
	lookupAuth AuthLookup,
) error {
	authType := strings.ToLower(strings.TrimSpace(auth.Type))
	switch authType {
	case "", "none":
		return nil
	case "bearer":
		tok, err := ResolveTemplateString(auth.Token, vars, resolveSecret)
		if err != nil {
			return err
		}
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
	case "basic":
		user, err := ResolveTemplateString(auth.Username, vars, resolveSecret)
		if err != nil {
			return err
		}
		pw, err := ResolveTemplateString(auth.Password, vars, resolveSecret)
		if err != nil {
			return err
		}
		req.SetBasicAuth(user, pw)
	case "header":
		name, err := ResolveTemplateString(strings.TrimSpace(auth.HeaderName), vars, resolveSecret)
		if err != nil {
			return err
		}
		val, err := ResolveTemplateString(auth.HeaderValue, vars, resolveSecret)
		if err != nil {
			return err
		}
		if name != "" {
			req.Header.Set(name, val)
		}
	case "vault":
		if lookupAuth == nil {
			return errors.New("vault auth lookup unavailable")
		}
		user, secret, err := lookupAuth(auth)
		if err != nil {
			return err
		}
		if strings.TrimSpace(user) != "" && !strings.EqualFold(user, "bearer") {
			req.SetBasicAuth(user, secret)
		} else if secret != "" {
			req.Header.Set("Authorization", "Bearer "+secret)
		}
	}
	return nil
}

type traceTimings struct {
	mu           sync.Mutex
	dialStart    time.Time
	dialMs       int64
	tlsStart     time.Time
	tlsMs        int64
	firstByteAt  time.Time
}

func (t *traceTimings) clientTrace() *httptrace.ClientTrace {
	return &httptrace.ClientTrace{
		ConnectStart: func(_, _ string) {
			t.mu.Lock()
			t.dialStart = time.Now()
			t.mu.Unlock()
		},
		ConnectDone: func(_, _ string, _ error) {
			t.mu.Lock()
			if !t.dialStart.IsZero() {
				t.dialMs = time.Since(t.dialStart).Milliseconds()
			}
			t.mu.Unlock()
		},
		TLSHandshakeStart: func() {
			t.mu.Lock()
			t.tlsStart = time.Now()
			t.mu.Unlock()
		},
		TLSHandshakeDone: func(_ tls.ConnectionState, _ error) {
			t.mu.Lock()
			if !t.tlsStart.IsZero() {
				t.tlsMs = time.Since(t.tlsStart).Milliseconds()
			}
			t.mu.Unlock()
		},
		GotFirstResponseByte: func() {
			t.mu.Lock()
			t.firstByteAt = time.Now()
			t.mu.Unlock()
		},
	}
}

func (t *traceTimings) finalize(reqStart time.Time) core.ApiTimingInfo {
	t.mu.Lock()
	defer t.mu.Unlock()
	totalMs := time.Since(reqStart).Milliseconds()
	ttfb := totalMs
	if !t.firstByteAt.IsZero() {
		ttfb = t.firstByteAt.Sub(reqStart).Milliseconds()
	}
	return core.ApiTimingInfo{
		DialMs:  t.dialMs,
		TlsMs:   t.tlsMs,
		TtfbMs:  ttfb,
		TotalMs: totalMs,
	}
}

func buildTransport(
	target ProxyTarget,
	skipVerify bool,
	customDial func(ctx context.Context, network, addr string) (net.Conn, error),
) (*http.Transport, *traceTimings, func()) {
	timings := &traceTimings{}
	baseDialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}

	tr := &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: skipVerify, // Explicit operator opt-in only for self-signed lab/pentest endpoints
			MinVersion:         tls.VersionTLS12,
		},
		MaxIdleConns:          10,
		IdleConnTimeout:       15 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	if customDial != nil {
		tr.DialContext = customDial
	} else if strings.EqualFold(target.Kind, "socks5") && strings.TrimSpace(target.Address) != "" {
		var socksAuth *proxy.Auth
		if target.Username != "" || target.Password != "" {
			socksAuth = &proxy.Auth{User: target.Username, Password: target.Password}
		}
		if dialer, err := proxy.SOCKS5("tcp", target.Address, socksAuth, baseDialer); err == nil {
			if ctxDialer, ok := dialer.(proxy.ContextDialer); ok {
				tr.DialContext = ctxDialer.DialContext
			} else {
				tr.DialContext = func(_ context.Context, network, addr string) (net.Conn, error) {
					return dialer.Dial(network, addr)
				}
			}
		} else {
			tr.DialContext = baseDialer.DialContext
		}
	} else {
		tr.DialContext = baseDialer.DialContext
	}

	return tr, timings, func() {
		tr.CloseIdleConnections()
	}
}

func extractTLSInfo(state *tls.ConnectionState, verified bool) *core.ApiTlsInfo {
	info := &core.ApiTlsInfo{
		Version:     tlsVersionString(state.Version),
		CipherSuite: tls.CipherSuiteName(state.CipherSuite),
		ServerName:  state.ServerName,
		Verified:    verified,
	}
	if len(state.PeerCertificates) > 0 {
		cert := state.PeerCertificates[0]
		info.Subject = cert.Subject.String()
		info.Issuer = cert.Issuer.String()
		info.DNSNames = append([]string{}, cert.DNSNames...)
		for _, ip := range cert.IPAddresses {
			info.DNSNames = append(info.DNSNames, ip.String())
		}
		info.NotAfter = cert.NotAfter.UTC().Format(time.RFC3339)
	}
	return info
}

func tlsVersionString(v uint16) string {
	switch v {
	case tls.VersionTLS13:
		return "TLS 1.3"
	case tls.VersionTLS12:
		return "TLS 1.2"
	case tls.VersionTLS11:
		return "TLS 1.1"
	case tls.VersionTLS10:
		return "TLS 1.0"
	default:
		return "0x" + strconv.FormatUint(uint64(v), 16)
	}
}

func formatHeadersCanonical(h http.Header) string {
	keys := make([]string, 0, len(h))
	for k := range h {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var sb strings.Builder
	for _, k := range keys {
		for _, v := range h[k] {
			sb.WriteString(k)
			sb.WriteString(": ")
			sb.WriteString(v)
			sb.WriteByte('\n')
		}
	}
	return strings.TrimRight(sb.String(), "\n")
}
