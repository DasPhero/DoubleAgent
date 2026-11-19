package core

// RemoteSocketEntry describes a single listening/open socket discovered via SSH (F-45).
type RemoteSocketEntry struct {
	Proto         string `json:"proto"`                   // "tcp" | "tcp6" | "udp" | "udp6"
	State         string `json:"state"`                   // "LISTEN" etc.
	LocalAddress  string `json:"localAddress"`            // e.g. "127.0.0.1", "::1", "0.0.0.0"
	LocalPort     uint16 `json:"localPort"`               // parsed port number
	RemoteAddress string `json:"remoteAddress,omitempty"` // peer/mask e.g. "0.0.0.0:*"
	Process       string `json:"process,omitempty"`       // process name if visible
	PID           string `json:"pid,omitempty"`           // PID if visible
	IsLoopback    bool   `json:"isLoopback"`              // true when bound only to 127.0.0.0/8 or ::1
	Platform      string `json:"platform,omitempty"`      // "linux" | "windows"
}

// RemoteSocketScanResult holds the parsed listener inventory for an active SSH session (F-45).
type RemoteSocketScanResult struct {
	SessionID   string              `json:"sessionId"`
	Platform    string              `json:"platform"`    // "linux" | "windows" | "unknown"
	CommandUsed string              `json:"commandUsed"` // actual discovery command run
	Entries     []RemoteSocketEntry `json:"entries"`
	RawOutput   string              `json:"rawOutput,omitempty"`
	Error       string              `json:"error,omitempty"`
}

// QuickForwardResult returns details of a 1-click -L tunnel launched from Remote Socket Discovery (F-45).
type QuickForwardResult struct {
	TunnelID   string `json:"tunnelId"`
	RuleID     string `json:"ruleId,omitempty"`
	LocalAddr  string `json:"localAddr"`
	LocalPort  uint16 `json:"localPort"`
	TargetHost string `json:"targetHost"`
	TargetPort uint16 `json:"targetPort"`
	SavedRule  bool   `json:"savedRule"`
}
