package serial

import (
	"context"
	"testing"
	"time"

	"doubleagent/backend/core"
)

func TestSerial_ConfigValidation_F23(t *testing.T) {
	// Valid default config
	def := core.DefaultSerialConfig()
	if err := core.ValidateSerialConfig(def); err != nil {
		t.Errorf("default config should be valid, got: %v", err)
	}

	// Empty port
	bad := def
	bad.Port = ""
	if err := core.ValidateSerialConfig(bad); err == nil {
		t.Errorf("expected error for empty port")
	}

	// Zero baud rate
	bad = def
	bad.BaudRate = 0
	if err := core.ValidateSerialConfig(bad); err == nil {
		t.Errorf("expected error for zero baud rate")
	}

	// Invalid data bits
	bad = def
	bad.DataBits = 4
	if err := core.ValidateSerialConfig(bad); err == nil {
		t.Errorf("expected error for data bits 4")
	}

	bad.DataBits = 9
	if err := core.ValidateSerialConfig(bad); err == nil {
		t.Errorf("expected error for data bits 9")
	}

	// Invalid parity
	bad = def
	bad.Parity = "invalid"
	if err := core.ValidateSerialConfig(bad); err == nil {
		t.Errorf("expected error for invalid parity")
	}

	// Invalid stop bits
	bad = def
	bad.StopBits = "3"
	if err := core.ValidateSerialConfig(bad); err == nil {
		t.Errorf("expected error for invalid stop bits")
	}

	// Invalid flow control
	bad = def
	bad.FlowControl = "invalid"
	if err := core.ValidateSerialConfig(bad); err == nil {
		t.Errorf("expected error for invalid flow control")
	}
}

func TestSerial_ListPorts_F23(t *testing.T) {
	ports, err := ListPorts()
	if err != nil {
		t.Fatalf("ListPorts returned error: %v", err)
	}
	// On many dev machines there may or may not be active hardware COM ports.
	// The function should return a slice without error.
	t.Logf("Detected %d COM ports: %+v", len(ports), ports)
}

func TestSerial_OpenInvalidPort_F23(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cfg := core.DefaultSerialConfig()
	cfg.Port = "COM999" // Non-existent port

	_, err := Open(ctx, cfg)
	if err == nil {
		t.Errorf("expected error when opening non-existent port COM999, got nil")
	}
}

func TestSerial_AutoDetect_F23(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// Probing non-existent port should return gracefully without crashing
	res, err := AutoDetect(ctx, "COM999")
	if err != nil {
		t.Fatalf("AutoDetect COM999 returned unexpected error: %v", err)
	}
	if res.Port != "COM999" {
		t.Errorf("expected port COM999, got %s", res.Port)
	}
	if res.BaudRate != 115200 {
		t.Errorf("expected default baud 115200, got %d", res.BaudRate)
	}

	// Probing empty port (auto-detects from detected ports or defaults)
	resEmpty, err := AutoDetect(ctx, "")
	if err != nil {
		t.Fatalf("AutoDetect empty returned error: %v", err)
	}
	t.Logf("AutoDetect result: %+v", resEmpty)
}

