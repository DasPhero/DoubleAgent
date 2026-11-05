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

func TestSerial_HardwareIdentification_F23(t *testing.T) {
	testCases := []struct {
		hwID         string
		expectedChip string
		expectedType string
	}{
		{"USB\\VID_303A&PID_1001&REV_0102", "ESP32-S3/C3 (USB JTAG / Serial CDC)", "Microcontroller"},
		{"USB\\VID_1A86&PID_7523", "WCH CH340 USB-to-Serial", "USB-UART Adapter"},
		{"USB\\VID_1A86&PID_55D3", "WCH CH343 High-Speed USB-Serial", "USB-UART Adapter"},
		{"USB\\VID_1A86&PID_55D4", "WCH CH347 High-Speed USB UART/SPI/I2C/JTAG", "Multi-Protocol Bridge"},
		{"USB\\VID_10C4&PID_EA60", "Silicon Labs CP2102/CP2104 USB-to-UART Bridge", "USB-UART Adapter"},
		{"USB\\VID_0403&PID_6001", "FTDI FT232R USB-to-UART", "USB-UART Adapter"},
		{"USB\\VID_0403&PID_6014", "FTDI FT232H Single High-Speed USB UART/SPI/I2C (MPSSE)", "Multi-Protocol Bridge"},
		{"USB\\VID_2341&PID_0043", "Arduino Uno (CDC-ACM)", "Microcontroller"},
		{"USB\\VID_2E8A&PID_0003", "Raspberry Pi Pico (RP2040 CDC)", "Microcontroller"},
		{"USB\\VID_0483&PID_5740", "STM32 Virtual COM Port", "Microcontroller"},
		{"UNKNOWN_DEVICE_ID", "", "Serial Device"},
	}

	for _, tc := range testCases {
		chip, devType, _ := identifyDeviceByHardwareID(tc.hwID)
		if chip != tc.expectedChip {
			t.Errorf("for hwID %s: expected chip %q, got %q", tc.hwID, tc.expectedChip, chip)
		}
		if devType != tc.expectedType {
			t.Errorf("for hwID %s: expected type %q, got %q", tc.hwID, tc.expectedType, devType)
		}
	}

	// Test stripInfPrefix
	infTest := "@oem179.inf,%ch343ser.devicedesc%;USB-Enhanced-SERIAL CH343"
	stripped := stripInfPrefix(infTest)
	if stripped != "USB-Enhanced-SERIAL CH343" {
		t.Errorf("expected 'USB-Enhanced-SERIAL CH343', got %q", stripped)
	}

	normal := "Silicon Labs CP210x"
	if stripInfPrefix(normal) != normal {
		t.Errorf("expected unchaged string for normal name, got %q", stripInfPrefix(normal))
	}
}

