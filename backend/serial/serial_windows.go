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

type winDevMeta struct {
	friendlyName string
	deviceDesc   string
	mfg          string
	hardwareID   string
	isUSB        bool
}

func scanRegistryEnumForPorts() map[string]winDevMeta {
	result := make(map[string]winDevMeta)
	enumPaths := []struct {
		root  string
		isUSB bool
	}{
		{`SYSTEM\CurrentControlSet\Enum\USB`, true},
		{`SYSTEM\CurrentControlSet\Enum\FTDIBUS`, true},
		{`SYSTEM\CurrentControlSet\Enum\ACPI`, false},
	}

	for _, ep := range enumPaths {
		baseKey, err := registry.OpenKey(registry.LOCAL_MACHINE, ep.root, registry.READ)
		if err != nil {
			continue
		}
		deviceKeys, err := baseKey.ReadSubKeyNames(-1)
		baseKey.Close()
		if err != nil {
			continue
		}

		for _, devName := range deviceKeys {
			devKeyPath := ep.root + `\` + devName
			devKey, err := registry.OpenKey(registry.LOCAL_MACHINE, devKeyPath, registry.READ)
			if err != nil {
				continue
			}
			instKeys, err := devKey.ReadSubKeyNames(-1)
			devKey.Close()
			if err != nil {
				continue
			}

			for _, instName := range instKeys {
				instKeyPath := devKeyPath + `\` + instName
				instKey, err := registry.OpenKey(registry.LOCAL_MACHINE, instKeyPath, registry.READ)
				if err != nil {
					continue
				}

				// Check Device Parameters for PortName
				paramKey, err := registry.OpenKey(instKey, `Device Parameters`, registry.READ)
				var portName string
				if err == nil {
					if pVal, _, pErr := paramKey.GetStringValue("PortName"); pErr == nil {
						portName = strings.TrimSpace(pVal)
					}
					paramKey.Close()
				}

				if portName != "" {
					var meta winDevMeta
					meta.isUSB = ep.isUSB

					if fn, _, fErr := instKey.GetStringValue("FriendlyName"); fErr == nil {
						meta.friendlyName = stripInfPrefix(fn)
					}
					if dd, _, dErr := instKey.GetStringValue("DeviceDesc"); dErr == nil {
						meta.deviceDesc = stripInfPrefix(dd)
					}
					if mfg, _, mErr := instKey.GetStringValue("Mfg"); mErr == nil {
						meta.mfg = stripInfPrefix(mfg)
					}
					if hwIDs, _, hErr := instKey.GetStringsValue("HardwareID"); hErr == nil && len(hwIDs) > 0 {
						meta.hardwareID = hwIDs[0]
					} else if hwID, _, hErr := instKey.GetStringValue("HardwareID"); hErr == nil {
						meta.hardwareID = hwID
					}

					cleanPort := strings.ToUpper(portName)
					result[cleanPort] = meta
				}
				instKey.Close()
			}
		}
	}
	return result
}

func checkPortConnected(port string) bool {
	pPath, err := windows.UTF16PtrFromString(`\\.\` + port)
	if err != nil {
		return false
	}
	h, err := windows.CreateFile(
		pPath,
		windows.GENERIC_READ|windows.GENERIC_WRITE,
		0,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err == nil {
		_ = windows.CloseHandle(h)
		return true
	}
	// ERROR_ACCESS_DENIED means another process currently holds the port open,
	// which confirms the hardware device is physically present and connected.
	if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		return true
	}
	return false
}

func listPlatformPorts() ([]core.SerialPortInfo, error) {
	// 1. Scan registry Enum tree for detailed hardware metadata
	metaMap := scanRegistryEnumForPorts()

	// 2. Query HARDWARE\DEVICEMAP\SERIALCOMM for currently registered active ports
	activeInSerialComm := make(map[string]bool)
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, `HARDWARE\DEVICEMAP\SERIALCOMM`, registry.QUERY_VALUE); err == nil {
		if names, err := k.ReadValueNames(-1); err == nil {
			for _, name := range names {
				if val, _, err := k.GetStringValue(name); err == nil {
					p := strings.ToUpper(strings.TrimSpace(val))
					if p != "" {
						activeInSerialComm[p] = true
					}
				}
			}
		}
		k.Close()
	}

	// 3. Collect unique port names across SERIALCOMM and Enum map
	allPortNames := make(map[string]bool)
	for p := range activeInSerialComm {
		allPortNames[p] = true
	}
	for p := range metaMap {
		allPortNames[p] = true
	}

	ports := make([]core.SerialPortInfo, 0, len(allPortNames))
	for portName := range allPortNames {
		meta, hasMeta := metaMap[portName]
		isConnected := activeInSerialComm[portName] || checkPortConnected(portName)

		chipName, devType, vendor := identifyDeviceByHardwareID(meta.hardwareID)
		if meta.mfg != "" && vendor == "" {
			vendor = meta.mfg
		}

		desc := meta.friendlyName
		if desc == "" {
			desc = meta.deviceDesc
		}
		if chipName != "" {
			desc = chipName
		}
		if desc == "" {
			if meta.isUSB {
				desc = fmt.Sprintf("USB-Serial Port (%s)", portName)
			} else {
				desc = fmt.Sprintf("Serial Port (%s)", portName)
			}
		}

		if devType == "" || devType == "Serial Device" {
			if meta.isUSB {
				devType = "USB-UART Adapter"
			} else {
				devType = "Serial Port"
			}
		}

		ports = append(ports, core.SerialPortInfo{
			Port:         portName,
			Description:  desc,
			Manufacturer: vendor,
			HardwareID:   meta.hardwareID,
			DeviceType:   devType,
			IsUSB:        meta.isUSB || hasMeta && meta.isUSB,
			IsConnected:  isConnected,
		})
	}

	// Sort: Connected ports first, then alphabetically by port name (COM1, COM2...)
	sort.Slice(ports, func(i, j int) bool {
		if ports[i].IsConnected != ports[j].IsConnected {
			return ports[i].IsConnected // connected ports first
		}
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
