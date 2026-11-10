package core

import (
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"time"
)

// RawTcpConfig defines client connection parameters for opening a raw TCP socket (F-31).
type RawTcpConfig struct {
	Host       string `json:"host"`
	Port       uint16 `json:"port"`
	LineMode   bool   `json:"lineMode"`
	LineEnding string `json:"lineEnding"` // "crlf", "lf", "cr"
	TimeoutSec int    `json:"timeoutSec"` // default 10 seconds if 0
}

// RawTcpSessionStats tracks real-time traffic telemetry and connection metadata (F-31).
type RawTcpSessionStats struct {
	ID            string    `json:"id"`
	RemoteAddr    string    `json:"remoteAddr"`
	LocalAddr     string    `json:"localAddr"`
	IsListener    bool      `json:"isListener"`
	ListenerPort  uint16    `json:"listenerPort,omitempty"`
	BytesSent     uint64    `json:"bytesSent"`
	BytesReceived uint64    `json:"bytesReceived"`
	ConnectedAt   time.Time `json:"connectedAt"`
	LineMode      bool      `json:"lineMode"`
	LineEnding    string    `json:"lineEnding"`
}

// RawTcpListenerConfig defines binding parameters for an incoming TCP listener / reverse shell handler (F-31).
type RawTcpListenerConfig struct {
	Port         uint16 `json:"port"`
	BindAddress  string `json:"bindAddress"`  // e.g. "0.0.0.0", "127.0.0.1"
	AutoSpawnTab bool   `json:"autoSpawnTab"` // true to automatically open a terminal tab on incoming connection
}

// RawTcpListenerInfo describes an active TCP listener instance (F-31).
type RawTcpListenerInfo struct {
	ID           string    `json:"id"`
	Port         uint16    `json:"port"`
	BindAddress  string    `json:"bindAddress"`
	Status       string    `json:"status"` // "listening", "stopped"
	StartedAt    time.Time `json:"startedAt"`
	TotalCatches int       `json:"totalCatches"`
}

// RawTcpIncomingEvent is emitted when an external client connects to an active listener (F-31).
type RawTcpIncomingEvent struct {
	SessionID    string `json:"sessionId"`
	ListenerID   string `json:"listenerId"`
	ListenerPort uint16 `json:"listenerPort"`
	RemoteAddr   string `json:"remoteAddr"`
}

// RawTcpSession represents an active bidirectional raw TCP terminal session (F-31).
type RawTcpSession interface {
	io.ReadWriteCloser
	ID() string
	RemoteAddr() string
	LocalAddr() string
	BytesSent() uint64
	BytesReceived() uint64
	Stats() RawTcpSessionStats
	SetLineMode(enabled bool)
	SetLineEnding(ending string)
}

// RawTcpListener manages a listening server port waiting for incoming connections (F-31).
type RawTcpListener interface {
	ID() string
	Port() uint16
	BindAddress() string
	Close() error
	Info() RawTcpListenerInfo
}

// DefaultRawTcpConfig returns sensible defaults for raw TCP client connection.
func DefaultRawTcpConfig() RawTcpConfig {
	return RawTcpConfig{
		Host:       "127.0.0.1",
		Port:       8080,
		LineMode:   true,
		LineEnding: "crlf",
		TimeoutSec: 10,
	}
}

// ValidateRawTcpConfig validates outgoing raw TCP parameters before dialing.
func ValidateRawTcpConfig(cfg RawTcpConfig) error {
	host := strings.TrimSpace(cfg.Host)
	if host == "" {
		return errors.New("host address cannot be empty")
	}
	if cfg.Port == 0 {
		return errors.New("port must be between 1 and 65535")
	}
	ending := strings.ToLower(strings.TrimSpace(cfg.LineEnding))
	if ending != "" && ending != "crlf" && ending != "lf" && ending != "cr" {
		return fmt.Errorf("invalid line ending '%s' (supported: crlf, lf, cr)", cfg.LineEnding)
	}
	return nil
}

// ValidateRawTcpListenerConfig validates listener binding configuration.
func ValidateRawTcpListenerConfig(cfg RawTcpListenerConfig) error {
	addr := strings.TrimSpace(cfg.BindAddress)
	if addr != "" && addr != "0.0.0.0" && addr != "127.0.0.1" && addr != "::" && addr != "::1" {
		if net.ParseIP(addr) == nil {
			return fmt.Errorf("invalid bind IP address '%s'", cfg.BindAddress)
		}
	}
	return nil
}
