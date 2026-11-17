package core

import "strings"

// ApiKeyValue represents an HTTP query parameter, header, or environment variable entry (F-42).
type ApiKeyValue struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Enabled  bool   `json:"enabled"`
	IsSecret bool   `json:"isSecret,omitempty"`
}

// ApiAuthConfig describes how authentication is applied to an API request in Go (F-42).
// Secrets referenced via CredentialID, IdentityID, or {{SECRET:...}} are resolved exclusively inside Go.
type ApiAuthConfig struct {
	Type         string `json:"type"` // "none" | "bearer" | "basic" | "header" | "vault"
	Token        string `json:"token,omitempty"`
	Username     string `json:"username,omitempty"`
	Password     string `json:"password,omitempty"`
	HeaderName   string `json:"headerName,omitempty"`
	HeaderValue  string `json:"headerValue,omitempty"`
	CredentialID string `json:"credentialId,omitempty"`
	IdentityID   string `json:"identityId,omitempty"`
}

// ApiRequestItem represents a saved or active HTTP request inside an engagement collection (F-42).
type ApiRequestItem struct {
	ID              string        `json:"id"`
	EngagementID    string        `json:"engagementId,omitempty"`
	CollectionName  string        `json:"collectionName,omitempty"`
	Name            string        `json:"name"`
	Method          string        `json:"method"`
	URL             string        `json:"url"`
	Params          []ApiKeyValue `json:"params,omitempty"`
	Headers         []ApiKeyValue `json:"headers,omitempty"`
	Auth            ApiAuthConfig `json:"auth"`
	BodyType        string        `json:"bodyType"` // "none" | "json" | "form" | "raw"
	Body            string        `json:"body,omitempty"`
	RawMode         bool          `json:"rawMode,omitempty"`
	RawRequest      string        `json:"rawRequest,omitempty"`
	RouteID         string        `json:"routeId,omitempty"` // "" | "direct" | "socks5://..." | "proxy:<id>" | "tunnel:<id>"
	TimeoutSec      int           `json:"timeoutSec,omitempty"`
	FollowRedirects bool          `json:"followRedirects"`
	UseCookieJar    bool          `json:"useCookieJar"`
	TlsSkipVerify   bool          `json:"tlsSkipVerify,omitempty"`
	Tags            []string      `json:"tags,omitempty"`
	UpdatedAt       string        `json:"updatedAt,omitempty"`
}

// ApiEnvironment stores reusable {{VAR}} substitution variables scoped to an engagement (F-42).
type ApiEnvironment struct {
	ID           string        `json:"id"`
	EngagementID string        `json:"engagementId,omitempty"`
	Name         string        `json:"name"`
	Variables    []ApiKeyValue `json:"variables,omitempty"`
	UpdatedAt    string        `json:"updatedAt,omitempty"`
}

// ApiRouteOption describes an available outbound path (Direct, active SOCKS5 tunnel, or ProxyProfile) for F-42.
type ApiRouteOption struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Kind     string `json:"kind"` // "direct" | "tunnel-socks5" | "proxy-socks5" | "route"
	Endpoint string `json:"endpoint,omitempty"`
	Active   bool   `json:"active"`
}

// ApiExecuteRequest carries a one-shot HTTP repeater request plus optional runtime env overrides (F-42).
type ApiExecuteRequest struct {
	ExecutionID string         `json:"executionId,omitempty"`
	SessionID   string         `json:"sessionId,omitempty"`
	EnvID       string         `json:"envId,omitempty"`
	Request     ApiRequestItem `json:"request"`
	Variables   []ApiKeyValue  `json:"variables,omitempty"`
}

// ApiTlsInfo captures TLS handshake and certificate metadata for target reconnaissance (F-42).
type ApiTlsInfo struct {
	Version     string   `json:"version,omitempty"`
	CipherSuite string   `json:"cipherSuite,omitempty"`
	ServerName  string   `json:"serverName,omitempty"`
	Subject     string   `json:"subject,omitempty"`
	Issuer      string   `json:"issuer,omitempty"`
	DNSNames    []string `json:"dnsNames,omitempty"`
	NotAfter    string   `json:"notAfter,omitempty"`
	Verified    bool     `json:"verified"`
}

// ApiTimingInfo reports millisecond phase latencies for an executed request (F-42).
type ApiTimingInfo struct {
	DialMs  int64 `json:"dialMs"`
	TlsMs   int64 `json:"tlsMs"`
	TtfbMs  int64 `json:"ttfbMs"`
	TotalMs int64 `json:"totalMs"`
}

// ApiResponse contains the HTTP response, telemetry, and headers returned from Go (F-42).
type ApiResponse struct {
	RequestID     string              `json:"requestId,omitempty"`
	StatusCode    int                 `json:"statusCode"`
	Status        string              `json:"status"`
	Proto         string              `json:"proto,omitempty"`
	Headers       map[string][]string `json:"headers,omitempty"`
	RawHeaders    string              `json:"rawHeaders,omitempty"`
	Body          string              `json:"body"`
	BodyBase64    string              `json:"bodyBase64,omitempty"`
	IsBinary      bool                `json:"isBinary,omitempty"`
	SizeBytes     int64               `json:"sizeBytes"`
	Truncated     bool                `json:"truncated,omitempty"`
	ContentType   string              `json:"contentType,omitempty"`
	EffectiveURL  string              `json:"effectiveUrl,omitempty"`
	RouteUsed     string              `json:"routeUsed,omitempty"`
	Tls           *ApiTlsInfo         `json:"tls,omitempty"`
	Timing        ApiTimingInfo       `json:"timing"`
	RedirectChain []string            `json:"redirectChain,omitempty"`
	Cookies       []string            `json:"cookies,omitempty"`
	Error         string              `json:"error,omitempty"`
}

// ApiReplayBatchRequest configures a throttled single-parameter Intruder-Lite replay batch (F-42, OPSEC-guarded).
type ApiReplayBatchRequest struct {
	ExecutionID  string         `json:"executionId,omitempty"`
	SessionID    string         `json:"sessionId,omitempty"`
	EngagementID string         `json:"engagementId,omitempty"`
	EnvID        string         `json:"envId,omitempty"`
	Request      ApiRequestItem `json:"request"`
	Variables    []ApiKeyValue  `json:"variables,omitempty"`
	Payloads     []string       `json:"payloads"`
	DelayMs      int            `json:"delayMs,omitempty"`
}

// ApiReplayEntryResult holds one payload iteration result from ExecuteParameterReplay (F-42).
type ApiReplayEntryResult struct {
	Index      int          `json:"index"`
	Payload    string       `json:"payload"`
	StatusCode int          `json:"statusCode"`
	Status     string       `json:"status"`
	SizeBytes  int64        `json:"sizeBytes"`
	TotalMs    int64        `json:"totalMs"`
	RouteUsed  string       `json:"routeUsed,omitempty"`
	Error      string       `json:"error,omitempty"`
	Response   *ApiResponse `json:"response,omitempty"`
}

// ApiReplayBatchResult summarizes all completed iterations and any lockout/OPSEC warnings (F-42, F-40).
type ApiReplayBatchResult struct {
	ExecutionID    string                 `json:"executionId"`
	Total          int                    `json:"total"`
	Completed      int                    `json:"completed"`
	Aborted        bool                   `json:"aborted,omitempty"`
	LockoutWarning string                 `json:"lockoutWarning,omitempty"`
	Results        []ApiReplayEntryResult `json:"results"`
}

// ApiResponseDiffLine represents a single header or body diff line between two HTTP responses (F-42).
type ApiResponseDiffLine struct {
	Kind string `json:"kind"` // "same" | "add" | "del"
	Text string `json:"text"`
}

// ApiResponseDiff captures header, body, and telemetry differences between two responses (F-42).
type ApiResponseDiff struct {
	StatusDelta string                `json:"statusDelta"`
	SizeDelta   int64                 `json:"sizeDelta"`
	TimeDeltaMs int64                 `json:"timeDeltaMs"`
	HeaderLines []ApiResponseDiffLine `json:"headerLines"`
	BodyLines   []ApiResponseDiffLine `json:"bodyLines"`
}

// ApiDecodedPayload holds decoded output for Base64, URL, Hex, HTML, or JWT inspection (F-42).
type ApiDecodedPayload struct {
	Input      string `json:"input"`
	Format     string `json:"format"`
	Decoded    string `json:"decoded"`
	JwtHeader  string `json:"jwtHeader,omitempty"`
	JwtClaims  string `json:"jwtClaims,omitempty"`
	JwtAlg     string `json:"jwtAlg,omitempty"`
	JwtExpired bool   `json:"jwtExpired,omitempty"`
	Error      string `json:"error,omitempty"`
}

// ApiAiChatMessage represents a single turn in AI Chat Mode (F-42).
type ApiAiChatMessage struct {
	Role    string `json:"role"` // "system" | "user" | "assistant"
	Content string `json:"content"`
}

// ApiAiChatRequest configures an LLM endpoint call with optional streaming over Wails events (F-42).
type ApiAiChatRequest struct {
	StreamID      string             `json:"streamId,omitempty"`
	Provider      string             `json:"provider"` // "openai" | "anthropic" | "ollama" | "custom"
	EndpointURL   string             `json:"endpointUrl"`
	Model         string             `json:"model"`
	Auth          ApiAuthConfig      `json:"auth"`
	RouteID       string             `json:"routeId,omitempty"`
	TlsSkipVerify bool               `json:"tlsSkipVerify,omitempty"`
	Temperature   float64            `json:"temperature,omitempty"`
	MaxTokens     int                `json:"maxTokens,omitempty"`
	Messages      []ApiAiChatMessage `json:"messages"`
	Stream        bool               `json:"stream"`
	TimeoutSec    int                `json:"timeoutSec,omitempty"`
}

// ApiAiChatResult contains the final assistant reply, usage stats, and sanitized raw JSON request (F-42).
type ApiAiChatResult struct {
	StreamID         string `json:"streamId"`
	Reply            string `json:"reply"`
	Model            string `json:"model,omitempty"`
	PromptTokens     int    `json:"promptTokens,omitempty"`
	CompletionTokens int    `json:"completionTokens,omitempty"`
	RawRequestJSON   string `json:"rawRequestJson,omitempty"`
	RawResponse      string `json:"rawResponse,omitempty"`
	StatusCode       int    `json:"statusCode"`
	DurationMs       int64  `json:"durationMs"`
	RouteUsed        string `json:"routeUsed,omitempty"`
	Error            string `json:"error,omitempty"`
}

// ApiAiStreamChunkEvent is emitted via Wails runtime events during live AI response streaming (F-42).
type ApiAiStreamChunkEvent struct {
	StreamID string `json:"streamId"`
	Delta    string `json:"delta"`
	Done     bool   `json:"done"`
	Error    string `json:"error,omitempty"`
}

// SanitizeApiAuthForDisplay returns a copy of ApiAuthConfig with inline secret values replaced by placeholders.
func SanitizeApiAuthForDisplay(auth ApiAuthConfig) ApiAuthConfig {
	clean := auth
	if strings.TrimSpace(clean.Token) != "" && !strings.Contains(clean.Token, "{{SECRET:") {
		clean.Token = "[REDACTED]"
	}
	if strings.TrimSpace(clean.Password) != "" && !strings.Contains(clean.Password, "{{SECRET:") {
		clean.Password = "[REDACTED]"
	}
	if strings.TrimSpace(clean.HeaderValue) != "" && !strings.Contains(clean.HeaderValue, "{{SECRET:") {
		clean.HeaderValue = "[REDACTED]"
	}
	return clean
}
