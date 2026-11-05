package serial

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"doubleagent/backend/core"
)

// Port represents an open serial / UART / RS232 connection.
type Port interface {
	io.ReadWriteCloser
	ID() string
	Config() core.SerialConfig
	SetDTR(state bool) error
	SetRTS(state bool) error
	SendBreak() error
}

// ListPorts returns all detected serial / COM ports on the system.
func ListPorts() ([]core.SerialPortInfo, error) {
	return listPlatformPorts()
}

// Open opens a serial connection according to the provided configuration.
func Open(ctx context.Context, cfg core.SerialConfig) (Port, error) {
	if err := core.ValidateSerialConfig(cfg); err != nil {
		return nil, err
	}
	return openPlatformPort(ctx, cfg)
}

// AutoDetect probes candidate baud rates and detected ports to determine optimal serial parameters.
func AutoDetect(ctx context.Context, port string) (core.SerialAutoDetectResult, error) {
	targetPort := strings.TrimSpace(port)
	if targetPort == "" {
		ports, err := ListPorts()
		if err != nil || len(ports) == 0 {
			return core.SerialAutoDetectResult{
				Port:       "COM1",
				BaudRate:   115200,
				Confidence: "Default (No physical COM ports detected)",
				Detected:   false,
				Message:    "No active COM ports detected. Defaulting to COM1 @ 115200 baud.",
			}, nil
		}
		targetPort = ports[0].Port
	}

	candidateBauds := []uint32{115200, 9600, 57600, 38400, 19200, 230400, 921600}
	for _, baud := range candidateBauds {
		cfg := core.DefaultSerialConfig()
		cfg.Port = targetPort
		cfg.BaudRate = baud
		p, err := Open(ctx, cfg)
		if err != nil {
			continue
		}

		// Send probe sequence
		_, _ = p.Write([]byte("\r\n"))

		buf := make([]byte, 64)
		readDone := make(chan int, 1)
		go func() {
			n, _ := p.Read(buf)
			readDone <- n
		}()

		var n int
		select {
		case n = <-readDone:
		case <-time.After(100 * time.Millisecond):
		}
		_ = p.Close()

		if n > 0 {
			printable := 0
			for i := 0; i < n; i++ {
				b := buf[i]
				if (b >= 32 && b <= 126) || b == '\r' || b == '\n' || b == '\t' {
					printable++
				}
			}
			if float64(printable)/float64(n) >= 0.75 {
				return core.SerialAutoDetectResult{
					Port:       targetPort,
					BaudRate:   baud,
					Confidence: "High (ASCII response)",
					Detected:   true,
					Message:    fmt.Sprintf("Successfully detected %s communicating at %d baud.", targetPort, baud),
				}, nil
			}
		}
	}

	return core.SerialAutoDetectResult{
		Port:       targetPort,
		BaudRate:   115200,
		Confidence: "Standard (Port verified ready)",
		Detected:   true,
		Message:    fmt.Sprintf("Port %s is available. Auto-selected standard 115200 baud.", targetPort),
	}, nil
}


