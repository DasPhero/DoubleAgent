//go:build !windows
// +build !windows

package serial

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"doubleagent/backend/core"
)

type unixSerialPort struct {
	id     string
	cfg    core.SerialConfig
	file   *os.File
	mu     sync.Mutex
	closed bool
}

func (p *unixSerialPort) ID() string               { return p.id }
func (p *unixSerialPort) Config() core.SerialConfig { return p.cfg }

func (p *unixSerialPort) Read(b []byte) (int, error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return 0, errors.New("serial port closed")
	}
	f := p.file
	p.mu.Unlock()
	return f.Read(b)
}

func (p *unixSerialPort) Write(b []byte) (int, error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return 0, errors.New("serial port closed")
	}
	f := p.file
	p.mu.Unlock()
	return f.Write(b)
}

func (p *unixSerialPort) SetDTR(_ bool) error { return nil }
func (p *unixSerialPort) SetRTS(_ bool) error { return nil }
func (p *unixSerialPort) SendBreak() error    { return nil }

func (p *unixSerialPort) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil
	}
	p.closed = true
	if p.file != nil {
		return p.file.Close()
	}
	return nil
}

func listPlatformPorts() ([]core.SerialPortInfo, error) {
	patterns := []struct {
		glob       string
		isUSB      bool
		deviceType string
	}{
		{"/dev/ttyUSB*", true, "USB-UART Adapter"},
		{"/dev/ttyACM*", true, "USB CDC Modem/ACM"},
		{"/dev/ttyS*", false, "Serial Port"},
		{"/dev/cu.*", true, "Serial Device"},
	}

	var ports []core.SerialPortInfo
	for _, p := range patterns {
		matches, err := filepath.Glob(p.glob)
		if err == nil {
			for _, m := range matches {
				base := filepath.Base(m)
				desc := fmt.Sprintf("Serial Port (%s)", base)
				if p.isUSB {
					desc = fmt.Sprintf("USB-Serial Device (%s)", base)
				}
				ports = append(ports, core.SerialPortInfo{
					Port:         m,
					Description:  desc,
					Manufacturer: "System Device",
					HardwareID:   m,
					DeviceType:   p.deviceType,
					IsUSB:        p.isUSB,
					IsConnected:  true,
				})
			}
		}
	}

	sort.Slice(ports, func(i, j int) bool {
		return ports[i].Port < ports[j].Port
	})

	return ports, nil
}

func openPlatformPort(_ context.Context, cfg core.SerialConfig) (Port, error) {
	f, err := os.OpenFile(cfg.Port, os.O_RDWR, 0)
	if err != nil {
		return nil, fmt.Errorf("open serial port %s: %w", cfg.Port, err)
	}

	randBytes := make([]byte, 8)
	_, _ = rand.Read(randBytes)
	sessionID := "serial-" + hex.EncodeToString(randBytes)

	return &unixSerialPort{
		id:   sessionID,
		cfg:  cfg,
		file: f,
	}, nil
}

