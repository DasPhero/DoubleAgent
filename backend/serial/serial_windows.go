//go:build windows
// +build windows

package serial

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"

	"doubleagent/backend/core"
)

const (
	setRTS = 3
	clrRTS = 4
	setDTR = 5
	clrDTR = 6
)

type winSerialPort struct {
	id     string
	cfg    core.SerialConfig
	handle windows.Handle
	file   *os.File
	mu     sync.Mutex
	closed bool
}

func (p *winSerialPort) ID() string               { return p.id }
func (p *winSerialPort) Config() core.SerialConfig { return p.cfg }

func (p *winSerialPort) Read(b []byte) (int, error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return 0, errors.New("serial port closed")
	}
	h := p.handle
	p.mu.Unlock()

	var done uint32
	err := windows.ReadFile(h, b, &done, nil)
	if err != nil {
		return int(done), err
	}
	return int(done), nil
}

func (p *winSerialPort) Write(b []byte) (int, error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return 0, errors.New("serial port closed")
	}
	h := p.handle
	p.mu.Unlock()

	var done uint32
	err := windows.WriteFile(h, b, &done, nil)
	if err != nil {
		return int(done), err
	}
	return int(done), nil
}

func (p *winSerialPort) SetDTR(state bool) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return errors.New("serial port closed")
	}
	var code uint32 = clrDTR
	if state {
		code = setDTR
	}
	return windows.EscapeCommFunction(p.handle, code)
}

func (p *winSerialPort) SetRTS(state bool) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return errors.New("serial port closed")
	}
	var code uint32 = clrRTS
	if state {
		code = setRTS
	}
	return windows.EscapeCommFunction(p.handle, code)
}

func (p *winSerialPort) SendBreak() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return errors.New("serial port closed")
	}
	// Windows SetCommBreak / ClearCommBreak
	k32 := windows.NewLazySystemDLL("kernel32.dll")
	setBreak := k32.NewProc("SetCommBreak")
	clearBreak := k32.NewProc("ClearCommBreak")

	r1, _, err := setBreak.Call(uintptr(p.handle))
	if r1 == 0 {
		return err
	}
	time.Sleep(250 * time.Millisecond)
	r2, _, err := clearBreak.Call(uintptr(p.handle))
	if r2 == 0 {
		return err
	}
	return nil
}

func (p *winSerialPort) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil
	}
	p.closed = true
	if p.file != nil {
		_ = p.file.Close()
	}
	if p.handle != 0 {
		_ = windows.CloseHandle(p.handle)
	}
	return nil
}

func listPlatformPorts() ([]core.SerialPortInfo, error) {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `HARDWARE\DEVICEMAP\SERIALCOMM`, registry.QUERY_VALUE)
	if err != nil {
		// No SERIALCOMM key means no COM ports registered on this machine
		return []core.SerialPortInfo{}, nil
	}
	defer k.Close()

	names, err := k.ReadValueNames(-1)
	if err != nil {
		return []core.SerialPortInfo{}, nil
	}

	ports := make([]core.SerialPortInfo, 0, len(names))
	for _, name := range names {
		val, _, err := k.GetStringValue(name)
		if err == nil && strings.TrimSpace(val) != "" {
			portName := strings.TrimSpace(val)
			desc := fmt.Sprintf("Serial Port (%s)", portName)
			if strings.Contains(strings.ToLower(name), "usb") {
				desc = fmt.Sprintf("USB-Serial Adapter (%s)", portName)
			}
			ports = append(ports, core.SerialPortInfo{
				Port:        portName,
				Description: desc,
			})
		}
	}

	sort.Slice(ports, func(i, j int) bool {
		return ports[i].Port < ports[j].Port
	})

	return ports, nil
}

func openPlatformPort(_ context.Context, cfg core.SerialConfig) (Port, error) {
	portPath := cfg.Port
	if !strings.HasPrefix(strings.ToUpper(portPath), `\\.\`) {
		portPath = `\\.\` + portPath
	}

	pathPtr, err := windows.UTF16PtrFromString(portPath)
	if err != nil {
		return nil, fmt.Errorf("invalid port path: %w", err)
	}

	h, err := windows.CreateFile(
		pathPtr,
		windows.GENERIC_READ|windows.GENERIC_WRITE,
		0,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		return nil, fmt.Errorf("open serial port %s: %w", cfg.Port, err)
	}

	// 1. Configure DCB
	var dcb windows.DCB
	dcb.DCBlength = uint32(unsafe.Sizeof(dcb))

	// Get current comm state as baseline
	k32 := windows.NewLazySystemDLL("kernel32.dll")
	getCommState := k32.NewProc("GetCommState")
	r1, _, err := getCommState.Call(uintptr(h), uintptr(unsafe.Pointer(&dcb)))
	if r1 == 0 {
		_ = windows.CloseHandle(h)
		return nil, fmt.Errorf("get comm state: %w", err)
	}

	dcb.BaudRate = cfg.BaudRate
	dcb.ByteSize = cfg.DataBits
	if dcb.ByteSize == 0 {
		dcb.ByteSize = 8
	}

	// Parity: None=0, Odd=1, Even=2, Mark=3, Space=4
	switch cfg.Parity {
	case core.ParityOdd:
		dcb.Parity = 1
	case core.ParityEven:
		dcb.Parity = 2
	case core.ParityMark:
		dcb.Parity = 3
	case core.ParitySpace:
		dcb.Parity = 4
	default:
		dcb.Parity = 0
	}

	// StopBits: 1=0, 1.5=1, 2=2
	switch cfg.StopBits {
	case core.StopBits15:
		dcb.StopBits = 1
	case core.StopBits2:
		dcb.StopBits = 2
	default:
		dcb.StopBits = 0
	}

	// Flow control flags in DCB
	// Bit 0: fBinary (must be 1 on Windows)
	// Bit 1: fParity
	// Bit 2: fOutxCtsFlow (hardware flow control)
	// Bit 4-5: fDtrControl
	// Bit 8: fOutX (software flow control)
	// Bit 9: fInX
	// Bit 12-13: fRtsControl
	dcb.Flags = 1 // fBinary = 1
	if dcb.Parity != 0 {
		dcb.Flags |= (1 << 1) // fParity = 1
	}

	switch cfg.FlowControl {
	case core.FlowHardware:
		dcb.Flags |= (1 << 2) // fOutxCtsFlow = 1
		dcb.Flags |= (2 << 12) // fRtsControl = HANDSHAKE (2)
	case core.FlowSoftware:
		dcb.Flags |= (1 << 8) // fOutX = 1
		dcb.Flags |= (1 << 9) // fInX = 1
		dcb.XonChar = 0x11
		dcb.XoffChar = 0x13
	}

	if err := windows.SetCommState(h, &dcb); err != nil {
		_ = windows.CloseHandle(h)
		return nil, fmt.Errorf("set comm state: %w", err)
	}

	// 2. Configure timeouts
	timeouts := windows.CommTimeouts{
		ReadIntervalTimeout:         0xFFFFFFFF,
		ReadTotalTimeoutMultiplier:  0,
		ReadTotalTimeoutConstant:    100, // 100ms
		WriteTotalTimeoutMultiplier: 0,
		WriteTotalTimeoutConstant:   500, // 500ms
	}
	if err := windows.SetCommTimeouts(h, &timeouts); err != nil {
		_ = windows.CloseHandle(h)
		return nil, fmt.Errorf("set comm timeouts: %w", err)
	}

	// 3. Set initial DTR and RTS states
	if cfg.DTR {
		_ = windows.EscapeCommFunction(h, setDTR)
	} else {
		_ = windows.EscapeCommFunction(h, clrDTR)
	}
	if cfg.RTS {
		_ = windows.EscapeCommFunction(h, setRTS)
	} else {
		_ = windows.EscapeCommFunction(h, clrRTS)
	}

	randBytes := make([]byte, 8)
	_, _ = rand.Read(randBytes)
	sessionID := "serial-" + hex.EncodeToString(randBytes)

	return &winSerialPort{
		id:     sessionID,
		cfg:    cfg,
		handle: h,
	}, nil
}
