package apiclient

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gorilla/websocket"

	"doubleagent/backend/core"
	"doubleagent/backend/hexrunner"
)

const maxWsMessageBytes = 4 * 1024 * 1024 // 4 MiB frame cap

type activeWsSession struct {
	id         string
	conn       *websocket.Conn
	writeMu    sync.Mutex
	closeOnce  sync.Once
	cancelRead context.CancelFunc
	onFrame    func(core.ApiWsFrameEvent)
}

func (s *activeWsSession) close(reason string) {
	s.closeOnce.Do(func() {
		if s.cancelRead != nil {
			s.cancelRead()
		}
		if s.conn != nil {
			s.writeMu.Lock()
			_ = s.conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, reason),
				time.Now().Add(2*time.Second),
			)
			_ = s.conn.Close()
			s.writeMu.Unlock()
		}
		if s.onFrame != nil {
			s.onFrame(core.ApiWsFrameEvent{
				SessionID: s.id,
				Direction: "system",
				FrameType: "close",
				Payload:   reason,
				Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			})
		}
	})
}

func (c *Client) ensureWsMap() {
	if c.wsSessions == nil {
		c.wsSessions = make(map[string]*activeWsSession)
	}
}

// ConnectWebSocket dials a ws:// or wss:// endpoint inside Go (supporting SOCKS5/Pivot routes and Vault secrets) (F-44).
func (c *Client) ConnectWebSocket(
	ctx context.Context,
	req core.ApiWsConnectRequest,
	resolveSecret SecretResolver,
	lookupAuth AuthLookup,
	resolveRoute RouteResolver,
	onFrame func(core.ApiWsFrameEvent),
) (*core.ApiWsConnectResult, error) {
	sessionID := strings.TrimSpace(req.SessionID)
	if sessionID == "" {
		sessionID = fmt.Sprintf("ws-%d", time.Now().UnixNano())
	}

	vars := buildVarsMap(req.Variables)
	rawURL, err := ResolveTemplateString(strings.TrimSpace(req.URL), vars, resolveSecret)
	if err != nil {
		return &core.ApiWsConnectResult{SessionID: sessionID, Error: err.Error()}, nil
	}
	if rawURL == "" {
		return &core.ApiWsConnectResult{SessionID: sessionID, Error: "WebSocket URL must not be empty"}, nil
	}
	if strings.HasPrefix(strings.ToLower(rawURL), "http://") {
		rawURL = "ws://" + rawURL[len("http://"):]
	} else if strings.HasPrefix(strings.ToLower(rawURL), "https://") {
		rawURL = "wss://" + rawURL[len("https://"):]
	} else if !strings.Contains(rawURL, "://") {
		rawURL = "ws://" + rawURL
	}

	// Build dummy http.Request so header, {{VAR}}/{{SECRET:...}}, and Auth resolution reuse F-42 logic identically.
	hdrReq, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://placeholder.local", nil)
	if err != nil {
		return nil, err
	}
	for _, h := range req.Headers {
		if !h.Enabled || strings.TrimSpace(h.Key) == "" {
			continue
		}
		hk, kErr := ResolveTemplateString(strings.TrimSpace(h.Key), vars, resolveSecret)
		if kErr != nil {
			return &core.ApiWsConnectResult{SessionID: sessionID, EffectiveURL: rawURL, Error: kErr.Error()}, nil
		}
		hv, vErr := ResolveTemplateString(h.Value, vars, resolveSecret)
		if vErr != nil {
			return &core.ApiWsConnectResult{SessionID: sessionID, EffectiveURL: rawURL, Error: vErr.Error()}, nil
		}
		hdrReq.Header.Add(hk, hv)
	}
	if err := applyAuth(hdrReq, req.Auth, vars, resolveSecret, lookupAuth); err != nil {
		return &core.ApiWsConnectResult{SessionID: sessionID, EffectiveURL: rawURL, Error: err.Error()}, nil
	}

	routeTarget := ProxyTarget{Label: "Direct", Kind: "direct"}
	if resolveRoute != nil && strings.TrimSpace(req.RouteID) != "" {
		rt, rErr := resolveRoute(req.RouteID)
		if rErr != nil {
			return &core.ApiWsConnectResult{
				SessionID:    sessionID,
				EffectiveURL: rawURL,
				Error:        fmt.Sprintf("route error: %v", rErr),
			}, nil
		}
		routeTarget = rt
	} else if strings.HasPrefix(strings.ToLower(strings.TrimSpace(req.RouteID)), "socks5://") {
		addr := strings.TrimPrefix(strings.TrimSpace(req.RouteID), "socks5://")
		routeTarget = ProxyTarget{Label: "socks5://" + addr, Kind: "socks5", Address: addr}
	}

	timeoutSec := req.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = 15
	}
	tr, _, cleanupTransport := buildTransport(routeTarget, req.TlsSkipVerify, c.DialContext)
	defer cleanupTransport()

	dialer := websocket.Dialer{
		NetDialContext:   tr.DialContext,
		TLSClientConfig:  tr.TLSClientConfig,
		HandshakeTimeout: time.Duration(timeoutSec) * time.Second,
		Subprotocols:     req.Subprotocols,
	}

	dialCtx, cancelDial := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	defer cancelDial()

	start := time.Now()
	conn, httpResp, dialErr := dialer.DialContext(dialCtx, rawURL, hdrReq.Header)
	durationMs := time.Since(start).Milliseconds()

	statusCode := 0
	respHeaders := ""
	if httpResp != nil {
		statusCode = httpResp.StatusCode
		respHeaders = formatHeadersCanonical(httpResp.Header)
		_ = httpResp.Body.Close()
	}
	if dialErr != nil {
		return &core.ApiWsConnectResult{
			SessionID:       sessionID,
			EffectiveURL:    rawURL,
			StatusCode:      statusCode,
			ResponseHeaders: respHeaders,
			RouteUsed:       routeTarget.Label,
			DurationMs:      durationMs,
			Error:           dialErr.Error(),
		}, nil
	}

	conn.SetReadLimit(maxWsMessageBytes)

	readCtx, cancelRead := context.WithCancel(context.Background())
	sess := &activeWsSession{
		id:         sessionID,
		conn:       conn,
		cancelRead: cancelRead,
		onFrame:    onFrame,
	}

	conn.SetPongHandler(func(appData string) error {
		if onFrame != nil {
			onFrame(core.ApiWsFrameEvent{
				SessionID: sessionID,
				Direction: "in",
				FrameType: "pong",
				Payload:   appData,
				SizeBytes: len(appData),
				Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			})
		}
		return nil
	})
	conn.SetPingHandler(func(appData string) error {
		if onFrame != nil {
			onFrame(core.ApiWsFrameEvent{
				SessionID: sessionID,
				Direction: "in",
				FrameType: "ping",
				Payload:   appData,
				SizeBytes: len(appData),
				Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			})
		}
		sess.writeMu.Lock()
		defer sess.writeMu.Unlock()
		return conn.WriteControl(websocket.PongMessage, []byte(appData), time.Now().Add(2*time.Second))
	})

	// Replace any existing WebSocket session sharing this ID
	c.mu.Lock()
	c.ensureWsMap()
	prev := c.wsSessions[sessionID]
	c.wsSessions[sessionID] = sess
	c.mu.Unlock()
	if prev != nil {
		prev.close("replaced by new session")
	}

	if onFrame != nil {
		onFrame(core.ApiWsFrameEvent{
			SessionID: sessionID,
			Direction: "system",
			FrameType: "connected",
			Payload:   fmt.Sprintf("Connected to %s (%s)", rawURL, routeTarget.Label),
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		})
	}

	go c.runWsReadLoop(readCtx, sess)

	return &core.ApiWsConnectResult{
		SessionID:       sessionID,
		EffectiveURL:    rawURL,
		Subprotocol:     conn.Subprotocol(),
		StatusCode:      statusCode,
		ResponseHeaders: respHeaders,
		RouteUsed:       routeTarget.Label,
		DurationMs:      durationMs,
	}, nil
}

func (c *Client) runWsReadLoop(ctx context.Context, sess *activeWsSession) {
	defer func() {
		c.mu.Lock()
		if cur, ok := c.wsSessions[sess.id]; ok && cur == sess {
			delete(c.wsSessions, sess.id)
		}
		c.mu.Unlock()
	}()

	for {
		if ctx.Err() != nil {
			return
		}
		msgType, data, err := sess.conn.ReadMessage()
		if err != nil {
			var closeErr *websocket.CloseError
			if errors.As(err, &closeErr) {
				sess.close(fmt.Sprintf("closed (%d): %s", closeErr.Code, closeErr.Text))
			} else if ctx.Err() == nil {
				if sess.onFrame != nil {
					sess.onFrame(core.ApiWsFrameEvent{
						SessionID: sess.id,
						Direction: "system",
						FrameType: "error",
						Error:     err.Error(),
						Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
					})
				}
				sess.close("connection terminated")
			}
			return
		}

		isBin := msgType == websocket.BinaryMessage || !utf8.Valid(data) || strings.ContainsRune(string(data), '\x00')
		frameKind := "text"
		payloadStr := string(data)
		if msgType == websocket.BinaryMessage {
			frameKind = "binary"
		}
		if isBin {
			payloadStr = fmt.Sprintf("[%d binary bytes]", len(data))
		}
		if sess.onFrame != nil {
			sess.onFrame(core.ApiWsFrameEvent{
				SessionID:      sess.id,
				Direction:      "in",
				FrameType:      frameKind,
				Payload:        payloadStr,
				PayloadHexDump: hexrunner.FormatHexDump(data),
				PayloadASCII:   hexrunner.FormatEscapedASCII(data),
				PayloadBase64:  base64.StdEncoding.EncodeToString(data),
				SizeBytes:      len(data),
				IsBinary:       isBin,
				Timestamp:      time.Now().UTC().Format(time.RFC3339Nano),
			})
		}
	}
}

// SendWebSocketFrame writes a text, binary (compiled via Hex DSL), or ping frame on an active WebSocket session (F-44).
func (c *Client) SendWebSocketFrame(
	req core.ApiWsSendRequest,
	resolveSecret SecretResolver,
	onFrame func(core.ApiWsFrameEvent),
) error {
	c.mu.Lock()
	sess := c.wsSessions[strings.TrimSpace(req.SessionID)]
	c.mu.Unlock()
	if sess == nil || sess.conn == nil {
		return errors.New("WebSocket session is not connected")
	}

	vars := buildVarsMap(req.Variables)
	resolved, err := ResolveTemplateString(req.Payload, vars, resolveSecret)
	if err != nil {
		return err
	}

	kind := strings.ToLower(strings.TrimSpace(req.FrameType))
	if kind == "" {
		kind = "text"
	}

	var data []byte
	var wsType int
	var isBin bool
	var payloadDisplay string

	switch kind {
	case "binary":
		rawBytes, cErr := hexrunner.CompilePayload(resolved)
		if cErr != nil {
			return fmt.Errorf("invalid hex payload: %w", cErr)
		}
		data = rawBytes
		wsType = websocket.BinaryMessage
		isBin = true
		payloadDisplay = fmt.Sprintf("[%d binary bytes] %s", len(data), strings.TrimSpace(req.Payload))
	case "ping":
		data = []byte(resolved)
		wsType = websocket.PingMessage
		payloadDisplay = resolved
	default: // "text"
		kind = "text"
		data = []byte(resolved)
		wsType = websocket.TextMessage
		payloadDisplay = resolved
	}

	sess.writeMu.Lock()
	_ = sess.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	var wErr error
	if wsType == websocket.PingMessage {
		wErr = sess.conn.WriteControl(websocket.PingMessage, data, time.Now().Add(5*time.Second))
	} else {
		wErr = sess.conn.WriteMessage(wsType, data)
	}
	sess.writeMu.Unlock()
	if wErr != nil {
		return wErr
	}

	cb := onFrame
	if cb == nil {
		cb = sess.onFrame
	}
	if cb != nil {
		cb(core.ApiWsFrameEvent{
			SessionID:      sess.id,
			Direction:      "out",
			FrameType:      kind,
			Payload:        payloadDisplay,
			PayloadHexDump: hexrunner.FormatHexDump(data),
			PayloadASCII:   hexrunner.FormatEscapedASCII(data),
			PayloadBase64:  base64.StdEncoding.EncodeToString(data),
			SizeBytes:      len(data),
			IsBinary:       isBin,
			Timestamp:      time.Now().UTC().Format(time.RFC3339Nano),
		})
	}
	return nil
}

// DisconnectWebSocket cleanly closes an active WebSocket session (F-44).
func (c *Client) DisconnectWebSocket(sessionID string) bool {
	c.mu.Lock()
	sess := c.wsSessions[strings.TrimSpace(sessionID)]
	if sess != nil {
		delete(c.wsSessions, sess.id)
	}
	c.mu.Unlock()
	if sess == nil {
		return false
	}
	sess.close("closed by user")
	return true
}
