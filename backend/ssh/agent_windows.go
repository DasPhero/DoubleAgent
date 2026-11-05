//go:build windows

package ssh

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"syscall"
	"time"
	"unsafe"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

const (
	openSSHAgentPipe   = `\\.\pipe\openssh-ssh-agent`
	pageantCopyDataID  = 0x804e50ba
	pageantMaxMsgLen   = 8192
	wmCopyData         = 0x004A
	pageReadWrite      = 0x04
	fileMapWrite       = 0x0002
	invalidHandleValue = ^uintptr(0)
)

var (
	user32DLL              = syscall.NewLazyDLL("user32.dll")
	kernel32DLL            = syscall.NewLazyDLL("kernel32.dll")
	procFindWindow         = user32DLL.NewProc("FindWindowW")
	procSendMessage        = user32DLL.NewProc("SendMessageW")
	procCreateFileMappingW = kernel32DLL.NewProc("CreateFileMappingW")
	procMapViewOfFile      = kernel32DLL.NewProc("MapViewOfFile")
	procUnmapViewOfFile    = kernel32DLL.NewProc("UnmapViewOfFile")
	procRtlMoveMemory      = kernel32DLL.NewProc("RtlMoveMemory")
)

type copyDataStruct struct {
	dwData uintptr
	cbData uint32
	lpData uintptr
}

// DefaultAgentSigners queries both the Windows OpenSSH Agent named pipe (\\.\pipe\openssh-ssh-agent)
// and PuTTY Pageant (shared memory WM_COPYDATA), returning all available SSH agent signers (F-05).
func DefaultAgentSigners() ([]gossh.Signer, error) {
	var allSigners []gossh.Signer
	var lastErr error

	// 1. Try Windows OpenSSH Agent named pipe
	if f, err := os.OpenFile(openSSHAgentPipe, os.O_RDWR, 0); err == nil {
		ag := agent.NewClient(f)
		signers, err := ag.Signers()
		if err == nil && len(signers) > 0 {
			// Wrap signers so the pipe stays open for signing operations during handshake
			allSigners = append(allSigners, signers...)
		} else {
			_ = f.Close()
			if err != nil {
				lastErr = err
			}
		}
	} else {
		lastErr = err
	}

	// 2. Try PuTTY Pageant if running
	if pageantAvailable() {
		ag := agent.NewClient(&pageantConn{})
		if signers, err := ag.Signers(); err == nil && len(signers) > 0 {
			allSigners = append(allSigners, signers...)
		} else if err != nil {
			lastErr = err
		}
	}

	if len(allSigners) == 0 {
		if lastErr != nil {
			return nil, fmt.Errorf("no keys available from Windows OpenSSH Agent or Pageant: %w", lastErr)
		}
		return nil, errors.New("no keys available in Windows OpenSSH Agent or Pageant")
	}
	return allSigners, nil
}

func pageantAvailable() bool {
	cls, _ := syscall.UTF16PtrFromString("Pageant")
	hwnd, _, _ := procFindWindow.Call(uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(cls)))
	return hwnd != 0
}

type pageantConn struct {
	respBuf bytes.Buffer
}

func (p *pageantConn) Read(b []byte) (int, error) {
	return p.respBuf.Read(b)
}

func (p *pageantConn) Write(b []byte) (int, error) {
	if len(b) > pageantMaxMsgLen {
		return 0, errors.New("pageant message too large")
	}
	cls, _ := syscall.UTF16PtrFromString("Pageant")
	hwnd, _, _ := procFindWindow.Call(uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(cls)))
	if hwnd == 0 {
		return 0, errors.New("Pageant window not found")
	}

	mapName := fmt.Sprintf("PageantRequest%08x%08x", os.Getpid(), time.Now().UnixNano()&0xffffffff)
	mapNameUTF16, err := syscall.UTF16PtrFromString(mapName)
	if err != nil {
		return 0, err
	}

	fileMap, _, err := procCreateFileMappingW.Call(
		invalidHandleValue,
		0,
		pageReadWrite,
		0,
		pageantMaxMsgLen,
		uintptr(unsafe.Pointer(mapNameUTF16)),
	)
	if fileMap == 0 {
		return 0, fmt.Errorf("CreateFileMappingW: %w", err)
	}
	defer func() { _ = syscall.CloseHandle(syscall.Handle(fileMap)) }()

	sharedMem, _, err := procMapViewOfFile.Call(fileMap, fileMapWrite, 0, 0, 0)
	if sharedMem == 0 {
		return 0, fmt.Errorf("MapViewOfFile: %w", err)
	}
	defer func() { _, _, _ = procUnmapViewOfFile.Call(sharedMem) }()

	_, _, _ = procRtlMoveMemory.Call(sharedMem, uintptr(unsafe.Pointer(&b[0])), uintptr(len(b)))

	mapNameASCII := append([]byte(mapName), 0)
	cds := copyDataStruct{
		dwData: pageantCopyDataID,
		cbData: uint32(len(mapNameASCII)),
		lpData: uintptr(unsafe.Pointer(&mapNameASCII[0])),
	}

	rc, _, _ := procSendMessage.Call(hwnd, wmCopyData, 0, uintptr(unsafe.Pointer(&cds)))
	if rc == 0 {
		return 0, errors.New("Pageant rejected WM_COPYDATA request")
	}

	var lenBytes [4]byte
	_, _, _ = procRtlMoveMemory.Call(uintptr(unsafe.Pointer(&lenBytes[0])), sharedMem, 4)
	respLen := binary.BigEndian.Uint32(lenBytes[:])
	if respLen+4 > pageantMaxMsgLen {
		return 0, errors.New("Pageant response exceeds buffer")
	}
	respSlice := make([]byte, respLen+4)
	_, _, _ = procRtlMoveMemory.Call(uintptr(unsafe.Pointer(&respSlice[0])), sharedMem, uintptr(respLen+4))
	p.respBuf.Reset()
	_, _ = p.respBuf.Write(respSlice)
	return len(b), nil
}
