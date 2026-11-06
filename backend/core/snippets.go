package core

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

var (
	// snippetVarRegex matches {{VAR}}, {{VAR=default}}, {{VAR:hint}}, {{VAR=default:hint}}
	snippetVarRegex = regexp.MustCompile(`\{\{([^{}]+)\}\}`)
)

// IsBuiltinSnippetVariable returns true if varName is one of the standard auto-injected context variables (F-15).
func IsBuiltinSnippetVariable(varName string) bool {
	upper := strings.ToUpper(strings.TrimSpace(varName))
	switch upper {
	case "HOST", "IP", "HOSTNAME", "USER", "USERNAME", "PORT", "CWD", "DIR", "TIMESTAMP", "DATE", "TIME", "LOCAL_IP", "PASSWORD":
		return true
	default:
		return strings.HasPrefix(upper, "SECRET:")
	}
}

// ExtractSnippetVariables inspects the snippet body and returns a list of unique variables (F-15).
func ExtractSnippetVariables(body string) []SnippetVariable {
	matches := snippetVarRegex.FindAllStringSubmatch(body, -1)
	if len(matches) == 0 {
		return []SnippetVariable{}
	}

	seen := make(map[string]bool)
	var vars []SnippetVariable

	for _, match := range matches {
		rawInside := strings.TrimSpace(match[1])
		name, defaultVal, desc, secretRef := parseSnippetVariableSpec(rawInside)
		if name == "" {
			continue
		}

		key := strings.ToUpper(name)
		if seen[key] {
			continue
		}
		seen[key] = true

		// If description is empty and it's a built-in, provide standard user-friendly description
		if desc == "" {
			desc = getBuiltinVariableDescription(name)
		}

		vars = append(vars, SnippetVariable{
			Name:         name,
			DefaultValue: defaultVal,
			Description:  desc,
			SecretRef:    secretRef,
		})
	}

	return vars
}

// parseSnippetVariableSpec parses strings like:
// "PORT=8080:Target service port" or "PORT=8080 | Target service port"
// "IMAGE=nginx:alpine"
// "TARGET_IP:IP address of host"
// "SECRET:identity_1"
func parseSnippetVariableSpec(spec string) (name, defaultValue, description, secretRef string) {
	upper := strings.ToUpper(spec)
	if strings.HasPrefix(upper, "SECRET:") {
		parts := strings.SplitN(spec, ":", 2)
		if len(parts) == 2 {
			return spec, "", "Vault Secret Credential", parts[1]
		}
		return spec, "", "Vault Secret Credential", ""
	}

	// 1. Check for pipe separator for explicit description (e.g. "VAR=default | description")
	if pipeIdx := strings.Index(spec, "|"); pipeIdx != -1 {
		description = strings.TrimSpace(spec[pipeIdx+1:])
		spec = strings.TrimSpace(spec[:pipeIdx])
	}

	// 2. Check for default value separator '='
	eqIdx := strings.Index(spec, "=")
	if eqIdx != -1 {
		name = strings.TrimSpace(spec[:eqIdx])
		rest := strings.TrimSpace(spec[eqIdx+1:])

		// If description was not already extracted via pipe, check if rest has ":description"
		if description == "" {
			if colonIdx := strings.Index(rest, ":"); colonIdx != -1 {
				afterColon := strings.TrimSpace(rest[colonIdx+1:])
				// Treat as description if afterColon has spaces or description hint
				if strings.Contains(afterColon, " ") {
					defaultValue = strings.TrimSpace(rest[:colonIdx])
					description = afterColon
					return name, defaultValue, description, ""
				}
			}
		}
		defaultValue = rest
		return name, defaultValue, description, ""
	}

	// 3. No '=': check if there is a colon separator (e.g. "VAR:description" or "VAR:/path/default")
	colonIdx := strings.Index(spec, ":")
	if colonIdx != -1 {
		name = strings.TrimSpace(spec[:colonIdx])
		afterColon := strings.TrimSpace(spec[colonIdx+1:])
		if description == "" {
			description = afterColon
		}
		return name, defaultValue, description, ""
	}

	name = strings.TrimSpace(spec)
	return name, defaultValue, description, ""
}

func getBuiltinVariableDescription(name string) string {
	switch strings.ToUpper(name) {
	case "HOST", "IP":
		return "Target IP address or host (auto-injected)"
	case "HOSTNAME":
		return "Target host label or system hostname (auto-injected)"
	case "USER", "USERNAME":
		return "SSH / session login username (auto-injected)"
	case "PORT":
		return "Target SSH / service port (auto-injected)"
	case "CWD", "DIR":
		return "Active terminal working directory (auto-injected)"
	case "TIMESTAMP":
		return "Current timestamp YYYY-MM-DD HH:MM:SS (auto-injected)"
	case "DATE":
		return "Current date YYYY-MM-DD (auto-injected)"
	case "TIME":
		return "Current time HH:MM:SS (auto-injected)"
	case "LOCAL_IP":
		return "Local client loopback / IP address"
	case "PASSWORD":
		return "Session password from Vault (auto-injected)"
	default:
		return ""
	}
}

// ResolveSnippet parses and resolves all variable placeholders in body with context and user values (F-15).
func ResolveSnippet(
	body string,
	ctx SnippetContext,
	userValues map[string]string,
	secretResolver func(secretRef string) (string, error),
) (string, error) {
	var resolveErr error

	resolved := snippetVarRegex.ReplaceAllStringFunc(body, func(match string) string {
		if resolveErr != nil {
			return match
		}

		rawInside := strings.TrimSpace(match[2 : len(match)-2])
		name, defaultVal, _, secretRef := parseSnippetVariableSpec(rawInside)
		if name == "" {
			return match
		}

		// 1. Check if user explicitly provided a value in userValues (case-insensitive lookup)
		if val, ok := lookupUserValue(userValues, name); ok && val != "" {
			return val
		}

		// 2. Secret reference (e.g. {{SECRET:id}} or {{PASSWORD}})
		upper := strings.ToUpper(name)
		if secretRef != "" || upper == "PASSWORD" {
			if secretResolver != nil {
				targetRef := secretRef
				if targetRef == "" && upper == "PASSWORD" {
					targetRef = "session_password"
				}
				secVal, err := secretResolver(targetRef)
				if err != nil {
					resolveErr = fmt.Errorf("failed to resolve secret variable {{%s}}: %w", name, err)
					return match
				}
				return secVal
			}
		}

		// 3. Auto-injected context variables
		switch upper {
		case "HOST", "IP":
			if ctx.IP != "" {
				return ctx.IP
			}
			if ctx.Address != "" {
				return ctx.Address
			}
		case "HOSTNAME":
			if ctx.Hostname != "" {
				return ctx.Hostname
			}
			if ctx.HostLabel != "" {
				return ctx.HostLabel
			}
			if ctx.Address != "" {
				return ctx.Address
			}
		case "USER", "USERNAME":
			if ctx.Username != "" {
				return ctx.Username
			}
		case "PORT":
			if ctx.Port != 0 {
				return fmt.Sprintf("%d", ctx.Port)
			}
			if defaultVal != "" {
				return defaultVal
			}
			return "22"
		case "CWD", "DIR":
			if ctx.WorkingDir != "" {
				return ctx.WorkingDir
			}
			return "~"
		case "TIMESTAMP":
			if ctx.Timestamp != "" {
				return ctx.Timestamp
			}
			return time.Now().Format("2006-01-02 15:04:05")
		case "DATE":
			if ctx.Date != "" {
				return ctx.Date
			}
			return time.Now().Format("2006-01-02")
		case "TIME":
			if ctx.Time != "" {
				return ctx.Time
			}
			return time.Now().Format("15:04:05")
		case "LOCAL_IP":
			return "127.0.0.1"
		}

		// 4. Custom context variables (from SnippetContext.CustomVars)
		if ctx.CustomVars != nil {
			if val, ok := lookupUserValue(ctx.CustomVars, name); ok && val != "" {
				return val
			}
		}

		// 5. Default fallback value if defined (e.g. {{COUNT=5}})
		if defaultVal != "" {
			return defaultVal
		}

		// 6. If variable is unfulfilled, return error
		resolveErr = fmt.Errorf("missing value for variable {{%s}}", name)
		return match
	})

	if resolveErr != nil {
		return "", resolveErr
	}
	return resolved, nil
}

func lookupUserValue(m map[string]string, key string) (string, bool) {
	if m == nil {
		return "", false
	}
	if v, ok := m[key]; ok {
		return v, true
	}
	// Case-insensitive fallback
	lowerKey := strings.ToLower(key)
	for k, v := range m {
		if strings.ToLower(k) == lowerKey {
			return v, true
		}
	}
	return "", false
}
