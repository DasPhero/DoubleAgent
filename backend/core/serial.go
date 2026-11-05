package core

import (
	"errors"
	"fmt"
	"strings"
)

// SerialParity represents parity bit settings (None, Odd, Even, Mark, Space).
type SerialParity string

const (
	ParityNone  SerialParity = "none"
	ParityOdd   SerialParity = "odd"
	ParityEven  SerialParity = "even"
	ParityMark  SerialParity = "mark"
	ParitySpace SerialParity = "space"
)

// SerialStopBits represents stop bit settings (1, 1.5, 2).
type SerialStopBits string

const (
	StopBits1   SerialStopBits = "1"
	StopBits15  SerialStopBits = "1.5"
	StopBits2   SerialStopBits = "2"
)

// SerialFlowControl represents serial flow control modes (None, Hardware RTS/CTS, Software XON/XOFF).
type SerialFlowControl string

const (
	FlowNone     SerialFlowControl = "none"
	FlowHardware SerialFlowControl = "hardware"
	FlowSoftware SerialFlowControl = "software"
)

// SerialConfig contains all parameters to open and configure a Serial/UART/RS232 connection.
type SerialConfig struct {
	Port        string            `json:"port"`        // e.g. "COM1", "COM3", "/dev/ttyUSB0"
	BaudRate    uint32            `json:"baudRate"`    // 9600, 115200, 921600, etc.
	DataBits    uint8             `json:"dataBits"`    // 5, 6, 7, 8 (default 8)
	Parity      SerialParity      `json:"parity"`      // none, odd, even, mark, space
	StopBits    SerialStopBits    `json:"stopBits"`    // 1, 1.5, 2
	FlowControl SerialFlowControl `json:"flowControl"` // none, hardware, software
	DTR         bool              `json:"dtr"`
	RTS         bool              `json:"rts"`
	LocalEcho   bool              `json:"localEcho"`
	LineEnding  string            `json:"lineEnding"`  // "crlf", "lf", "cr"
}

// SerialPortInfo describes a detected serial/COM port on the operating system.
type SerialPortInfo struct {
	Port        string `json:"port"`        // e.g. "COM3"
	Description string `json:"description"` // e.g. "USB Serial Device" or "Silicon Labs CP210x"
}

// DefaultSerialConfig returns standard 115200 8N1 serial configuration defaults.
func DefaultSerialConfig() SerialConfig {
	return SerialConfig{
		Port:        "COM1",
		BaudRate:    115200,
		DataBits:    8,
		Parity:      ParityNone,
		StopBits:    StopBits1,
		FlowControl: FlowNone,
		DTR:         true,
		RTS:         true,
		LocalEcho:   false,
		LineEnding:  "crlf",
	}
}

// ValidateSerialConfig verifies serial parameters before opening the device.
func ValidateSerialConfig(cfg SerialConfig) error {
	if strings.TrimSpace(cfg.Port) == "" {
		return errors.New("serial port name cannot be empty")
	}
	if cfg.BaudRate == 0 {
		return errors.New("baud rate must be greater than 0")
	}
	if cfg.DataBits < 5 || cfg.DataBits > 8 {
		return fmt.Errorf("invalid data bits %d (must be 5, 6, 7, or 8)", cfg.DataBits)
	}
	switch cfg.Parity {
	case ParityNone, ParityOdd, ParityEven, ParityMark, ParitySpace, "":
	default:
		return fmt.Errorf("invalid parity setting %q", cfg.Parity)
	}
	switch cfg.StopBits {
	case StopBits1, StopBits15, StopBits2, "":
	default:
		return fmt.Errorf("invalid stop bits setting %q", cfg.StopBits)
	}
	switch cfg.FlowControl {
	case FlowNone, FlowHardware, FlowSoftware, "":
	default:
		return fmt.Errorf("invalid flow control setting %q", cfg.FlowControl)
	}
	return nil
}
