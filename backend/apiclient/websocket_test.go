package apiclient_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"doubleagent/backend/core"
)

func TestWebSocketConnectAndFrames_F44(t *testing.T) {
	upgrader := websocket.Upgrader{
		CheckOrigin:  func(_ *http.Request) bool { return true },
		Subprotocols: []string{"json.v1"},
	}

	var seenAuth string
	var seenBinary []byte
	var mu sync.Mutex

	client, srv := newPipeClientAndServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenAuth = r.Header.Get("Authorization")
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			mt, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if mt == websocket.BinaryMessage {
				mu.Lock()
				seenBinary = append([]byte{}, msg...)
				mu.Unlock()
			}
			if err := conn.WriteMessage(mt, msg); err != nil {
				return
			}
		}
	}), false)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/socket"

	var framesMu sync.Mutex
	var frames []core.ApiWsFrameEvent
	onFrame := func(ev core.ApiWsFrameEvent) {
		framesMu.Lock()
		frames = append(frames, ev)
		framesMu.Unlock()
	}

	resolveSecret := func(ref string) (string, error) {
		if ref == "ws-tok" {
			return "secret-ws-key", nil
		}
		return "", nil
	}

	res, err := client.ConnectWebSocket(context.Background(), core.ApiWsConnectRequest{
		SessionID:    "ws-test-1",
		URL:          wsURL,
		Subprotocols: []string{"json.v1"},
		Auth:         core.ApiAuthConfig{Type: "bearer", Token: "{{SECRET:ws-tok}}"},
		TimeoutSec:   5,
	}, resolveSecret, nil, nil, onFrame)
	if err != nil {
		t.Fatalf("ConnectWebSocket error: %v", err)
	}
	if res.Error != "" {
		t.Fatalf("ConnectWebSocket returned error field: %s", res.Error)
	}
	if seenAuth != "Bearer secret-ws-key" {
		t.Fatalf("expected vault token on WS handshake, got %q", seenAuth)
	}
	if res.Subprotocol != "json.v1" {
		t.Fatalf("expected negotiated subprotocol json.v1, got %q", res.Subprotocol)
	}

	// Send text frame
	if err := client.SendWebSocketFrame(core.ApiWsSendRequest{
		SessionID: "ws-test-1",
		FrameType: "text",
		Payload:   `{"ping":1}`,
	}, resolveSecret, onFrame); err != nil {
		t.Fatalf("SendWebSocketFrame text error: %v", err)
	}

	// Send binary hex/DSL frame
	expectedBin := []byte{0x00, 0x01, 0xfe, 0xff, 0xef, 0xbe, 0xad, 0xde}
	if err := client.SendWebSocketFrame(core.ApiWsSendRequest{
		SessionID: "ws-test-1",
		FrameType: "binary",
		Payload:   `00 01 fe ff u32le(0xdeadbeef)`,
	}, resolveSecret, onFrame); err != nil {
		t.Fatalf("SendWebSocketFrame binary error: %v", err)
	}

	// Wait briefly for echoed inbound frames
	deadline := time.Now().Add(2 * time.Second)
	var gotInText, gotInBin bool
	for time.Now().Before(deadline) {
		framesMu.Lock()
		for _, f := range frames {
			if f.Direction == "in" && f.FrameType == "text" && f.Payload == `{"ping":1}` {
				gotInText = true
			}
			if f.Direction == "in" && f.FrameType == "binary" {
				raw, decErr := base64.StdEncoding.DecodeString(f.PayloadBase64)
				if decErr == nil && bytes.Equal(raw, expectedBin) {
					gotInBin = true
				}
			}
		}
		framesMu.Unlock()
		if gotInText && gotInBin {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}

	if !gotInText || !gotInBin {
		t.Fatalf("missing echoed frames: gotInText=%v gotInBin=%v frames=%+v", gotInText, gotInBin, frames)
	}
	mu.Lock()
	if !bytes.Equal(seenBinary, expectedBin) {
		mu.Unlock()
		t.Fatalf("server received wrong binary bytes: got %x want %x", seenBinary, expectedBin)
	}
	mu.Unlock()

	if !client.DisconnectWebSocket("ws-test-1") {
		t.Fatalf("expected DisconnectWebSocket to return true")
	}
}
