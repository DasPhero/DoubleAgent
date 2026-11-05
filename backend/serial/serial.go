package serial

import (
	"context"
	"io"

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
