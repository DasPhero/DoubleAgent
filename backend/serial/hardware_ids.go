package serial

import "strings"

func stripInfPrefix(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "@") {
		if idx := strings.LastIndex(s, ";"); idx != -1 && idx+1 < len(s) {
			return strings.TrimSpace(s[idx+1:])
		}
	}
	return s
}

func identifyDeviceByHardwareID(hwID string) (chipName string, devType string, vendor string) {
	hwUpper := strings.ToUpper(hwID)
	switch {
	// Espressif Systems
	case strings.Contains(hwUpper, "VID_303A&PID_1001"):
		return "ESP32-S3/C3 (USB JTAG / Serial CDC)", "Microcontroller", "Espressif Systems"
	case strings.Contains(hwUpper, "VID_303A&PID_1002"):
		return "ESP32-S2 (USB CDC)", "Microcontroller", "Espressif Systems"
	case strings.Contains(hwUpper, "VID_303A"):
		return "ESP32 USB Device", "Microcontroller", "Espressif Systems"

	// WCH / QinHeng Electronics
	case strings.Contains(hwUpper, "VID_1A86&PID_7523"):
		return "WCH CH340 USB-to-Serial", "USB-UART Adapter", "QinHeng Electronics"
	case strings.Contains(hwUpper, "VID_1A86&PID_5523"):
		return "WCH CH341 USB-Serial / SPI / I2C", "USB-UART Adapter", "QinHeng Electronics"
	case strings.Contains(hwUpper, "VID_1A86&PID_55D3"):
		return "WCH CH343 High-Speed USB-Serial", "USB-UART Adapter", "QinHeng Electronics"
	case strings.Contains(hwUpper, "VID_1A86&PID_55D4"):
		return "WCH CH347 High-Speed USB UART/SPI/I2C/JTAG", "Multi-Protocol Bridge", "QinHeng Electronics"
	case strings.Contains(hwUpper, "VID_1A86&PID_5584"):
		return "WCH CH9102 High-Speed USB-Serial", "USB-UART Adapter", "QinHeng Electronics"
	case strings.Contains(hwUpper, "VID_1A86"):
		return "WCH USB-Serial Adapter", "USB-UART Adapter", "QinHeng Electronics"

	// Silicon Laboratories
	case strings.Contains(hwUpper, "VID_10C4&PID_EA60"):
		return "Silicon Labs CP2102/CP2104 USB-to-UART Bridge", "USB-UART Adapter", "Silicon Laboratories"
	case strings.Contains(hwUpper, "VID_10C4&PID_EA70"):
		return "Silicon Labs CP2105 Dual USB-to-UART Bridge", "USB-UART Adapter", "Silicon Laboratories"
	case strings.Contains(hwUpper, "VID_10C4&PID_EA71"):
		return "Silicon Labs CP2108 Quad USB-to-UART Bridge", "USB-UART Adapter", "Silicon Laboratories"
	case strings.Contains(hwUpper, "VID_10C4&PID_EA90"):
		return "Silicon Labs CP2112 USB-to-I2C/SMBus Bridge", "Multi-Protocol Bridge", "Silicon Laboratories"
	case strings.Contains(hwUpper, "VID_10C4"):
		return "Silicon Labs USB-to-UART Bridge", "USB-UART Adapter", "Silicon Laboratories"

	// FTDI
	case strings.Contains(hwUpper, "VID_0403&PID_6001"):
		return "FTDI FT232R USB-to-UART", "USB-UART Adapter", "FTDI"
	case strings.Contains(hwUpper, "VID_0403&PID_6010"):
		return "FTDI FT2232H Dual High-Speed USB UART/FIFO/SPI/I2C", "Multi-Protocol Bridge", "FTDI"
	case strings.Contains(hwUpper, "VID_0403&PID_6011"):
		return "FTDI FT4232H Quad High-Speed USB-to-UART", "USB-UART Adapter", "FTDI"
	case strings.Contains(hwUpper, "VID_0403&PID_6014"):
		return "FTDI FT232H Single High-Speed USB UART/SPI/I2C (MPSSE)", "Multi-Protocol Bridge", "FTDI"
	case strings.Contains(hwUpper, "VID_0403&PID_6015"):
		return "FTDI FT-X Series (FT230X/FT231X)", "USB-UART Adapter", "FTDI"
	case strings.Contains(hwUpper, "VID_0403"):
		return "FTDI USB Serial Device", "USB-UART Adapter", "FTDI"

	// Arduino
	case strings.Contains(hwUpper, "VID_2341&PID_0043"), strings.Contains(hwUpper, "VID_2341&PID_0001"):
		return "Arduino Uno (CDC-ACM)", "Microcontroller", "Arduino LLC"
	case strings.Contains(hwUpper, "VID_2341&PID_0042"):
		return "Arduino Mega 2560", "Microcontroller", "Arduino LLC"
	case strings.Contains(hwUpper, "VID_2341&PID_0036"):
		return "Arduino Leonardo", "Microcontroller", "Arduino LLC"
	case strings.Contains(hwUpper, "VID_2341&PID_0037"):
		return "Arduino Micro", "Microcontroller", "Arduino LLC"
	case strings.Contains(hwUpper, "VID_2341&PID_0058"):
		return "Arduino Nano Every", "Microcontroller", "Arduino LLC"
	case strings.Contains(hwUpper, "VID_2341"):
		return "Arduino Board", "Microcontroller", "Arduino LLC"

	// Raspberry Pi
	case strings.Contains(hwUpper, "VID_2E8A&PID_0003"):
		return "Raspberry Pi Pico (RP2040 CDC)", "Microcontroller", "Raspberry Pi"
	case strings.Contains(hwUpper, "VID_2E8A&PID_0005"):
		return "Raspberry Pi Debug Probe (Picoprobe)", "Debug Probe", "Raspberry Pi"
	case strings.Contains(hwUpper, "VID_2E8A&PID_000A"):
		return "Raspberry Pi Pico W Serial", "Microcontroller", "Raspberry Pi"
	case strings.Contains(hwUpper, "VID_2E8A"):
		return "Raspberry Pi RP2040/RP2350 Device", "Microcontroller", "Raspberry Pi"

	// Prolific
	case strings.Contains(hwUpper, "VID_067B&PID_2303"):
		return "Prolific PL2303 USB-to-Serial", "USB-UART Adapter", "Prolific Technology"

	// STMicroelectronics
	case strings.Contains(hwUpper, "VID_0483&PID_5740"):
		return "STM32 Virtual COM Port", "Microcontroller", "STMicroelectronics"
	case strings.Contains(hwUpper, "VID_0483&PID_374B"):
		return "ST-LINK/V2-1 Virtual COM Port", "Debug Probe", "STMicroelectronics"
	case strings.Contains(hwUpper, "VID_0483&PID_374E"):
		return "ST-LINK/V3 Virtual COM Port", "Debug Probe", "STMicroelectronics"

	// SEGGER
	case strings.Contains(hwUpper, "VID_1366"):
		return "SEGGER J-Link CDC UART Port", "Debug Probe", "SEGGER"

	// ARM DAPLink
	case strings.Contains(hwUpper, "VID_0D28"):
		return "ARM / DAPLink CMSIS-DAP Serial", "Debug Probe", "ARM"

	// PJRC Teensy
	case strings.Contains(hwUpper, "VID_16C0"):
		return "PJRC Teensy USB Serial", "Microcontroller", "PJRC"

	default:
		return "", "Serial Device", ""
	}
}
