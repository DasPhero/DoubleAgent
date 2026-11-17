package apiclient

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/url"
	"sort"
	"strings"
	"time"

	"doubleagent/backend/core"
)

// InspectPayload decodes Base64, Base64URL, URL, Hex, HTML, or JWT tokens (auto-detecting if format == "auto") (F-42).
func InspectPayload(input string, format string) core.ApiDecodedPayload {
	trimmed := strings.TrimSpace(input)
	fmtName := strings.ToLower(strings.TrimSpace(format))
	if fmtName == "" {
		fmtName = "auto"
	}

	if fmtName == "auto" {
		if strings.Count(trimmed, ".") == 2 && len(trimmed) > 12 {
			fmtName = "jwt"
		} else if strings.Contains(trimmed, "%") {
			fmtName = "url"
		} else {
			fmtName = "base64"
		}
	}

	res := core.ApiDecodedPayload{
		Input:  input,
		Format: fmtName,
	}

	switch fmtName {
	case "jwt":
		parts := strings.Split(trimmed, ".")
		if len(parts) < 2 {
			res.Error = "invalid JWT: expected header.payload[.signature]"
			return res
		}
		hBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
		if err != nil {
			res.Error = fmt.Sprintf("JWT header decode error: %v", err)
			return res
		}
		cBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
		if err != nil {
			res.Error = fmt.Sprintf("JWT payload decode error: %v", err)
			return res
		}
		res.JwtHeader = prettyJSONOrRaw(hBytes)
		res.JwtClaims = prettyJSONOrRaw(cBytes)
		res.Decoded = fmt.Sprintf("// HEADER\n%s\n\n// CLAIMS\n%s", res.JwtHeader, res.JwtClaims)

		var hdr map[string]any
		if json.Unmarshal(hBytes, &hdr) == nil {
			if alg, ok := hdr["alg"].(string); ok {
				res.JwtAlg = alg
			}
		}
		var claims map[string]any
		if json.Unmarshal(cBytes, &claims) == nil {
			if exp, ok := claims["exp"].(float64); ok {
				res.JwtExpired = time.Now().Unix() > int64(exp)
			}
		}
		return res

	case "base64":
		decoded, err := base64.StdEncoding.DecodeString(trimmed)
		if err != nil {
			decoded, err = base64.RawStdEncoding.DecodeString(trimmed)
		}
		if err != nil {
			decoded, err = base64.RawURLEncoding.DecodeString(trimmed)
		}
		if err != nil {
			res.Error = fmt.Sprintf("base64 decode error: %v", err)
			return res
		}
		res.Decoded = string(decoded)
		return res

	case "base64-encode":
		res.Decoded = base64.StdEncoding.EncodeToString([]byte(input))
		return res

	case "url":
		decoded, err := url.QueryUnescape(trimmed)
		if err != nil {
			res.Error = fmt.Sprintf("URL decode error: %v", err)
			return res
		}
		res.Decoded = decoded
		return res

	case "url-encode":
		res.Decoded = url.QueryEscape(input)
		return res

	case "hex":
		cleaned := strings.ReplaceAll(strings.ReplaceAll(trimmed, " ", ""), "\n", "")
		decoded, err := hex.DecodeString(cleaned)
		if err != nil {
			res.Error = fmt.Sprintf("hex decode error: %v", err)
			return res
		}
		res.Decoded = string(decoded)
		return res

	case "html":
		res.Decoded = html.UnescapeString(input)
		return res

	default:
		res.Error = fmt.Sprintf("unsupported inspector format %q", fmtName)
		return res
	}
}

func prettyJSONOrRaw(b []byte) string {
	var v any
	if json.Unmarshal(b, &v) == nil {
		if pretty, err := json.MarshalIndent(v, "", "  "); err == nil {
			return string(pretty)
		}
	}
	return string(b)
}

// ParseCurlCommand imports a standard cURL command (or raw HTTP request) into an ApiRequestItem (F-42).
func ParseCurlCommand(input string) (*core.ApiRequestItem, error) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return nil, errors.New("cURL or HTTP input is empty")
	}

	// Support pasting raw HTTP wire text directly into the importer as well
	upper := strings.ToUpper(trimmed)
	for _, verb := range []string{"GET ", "POST ", "PUT ", "PATCH ", "DELETE ", "HEAD ", "OPTIONS "} {
		if strings.HasPrefix(upper, verb) {
			return &core.ApiRequestItem{
				Name:            "Imported Raw HTTP",
				Method:          strings.TrimSpace(verb),
				URL:             "https://target.local/",
				RawMode:         true,
				RawRequest:      trimmed,
				FollowRedirects: true,
			}, nil
		}
	}

	tokens := splitShellArgs(trimmed)
	if len(tokens) == 0 {
		return nil, errors.New("unable to parse cURL command")
	}

	item := &core.ApiRequestItem{
		Name:            "Imported cURL Request",
		Method:          "",
		BodyType:        "none",
		FollowRedirects: true,
	}

	for i := 0; i < len(tokens); i++ {
		tok := tokens[i]
		if i == 0 && strings.EqualFold(tok, "curl") {
			continue
		}
		switch tok {
		case "-X", "--request":
			if i+1 < len(tokens) {
				i++
				item.Method = strings.ToUpper(tokens[i])
			}
		case "-H", "--header":
			if i+1 < len(tokens) {
				i++
				k, v, ok := strings.Cut(tokens[i], ":")
				if ok {
					item.Headers = append(item.Headers, core.ApiKeyValue{
						Key:     strings.TrimSpace(k),
						Value:   strings.TrimSpace(v),
						Enabled: true,
					})
				}
			}
		case "-d", "--data", "--data-raw", "--data-binary", "--data-urlencode":
			if i+1 < len(tokens) {
				i++
				item.Body = tokens[i]
				if strings.HasPrefix(strings.TrimSpace(item.Body), "{") || strings.HasPrefix(strings.TrimSpace(item.Body), "[") {
					item.BodyType = "json"
				} else {
					item.BodyType = "raw"
				}
				if item.Method == "" {
					item.Method = "POST"
				}
			}
		case "-u", "--user":
			if i+1 < len(tokens) {
				i++
				u, p, _ := strings.Cut(tokens[i], ":")
				item.Auth = core.ApiAuthConfig{
					Type:     "basic",
					Username: u,
					Password: p,
				}
			}
		case "-k", "--insecure":
			item.TlsSkipVerify = true
		case "-L", "--location":
			item.FollowRedirects = true
		case "-x", "--proxy":
			if i+1 < len(tokens) {
				i++
				if strings.HasPrefix(strings.ToLower(tokens[i]), "socks5") {
					addr := strings.TrimPrefix(strings.TrimPrefix(tokens[i], "socks5h://"), "socks5://")
					item.RouteID = "socks5://" + addr
				}
			}
		default:
			if !strings.HasPrefix(tok, "-") && item.URL == "" {
				item.URL = tok
			}
		}
	}

	if item.URL == "" {
		return nil, errors.New("no URL found in cURL command")
	}
	if item.Method == "" {
		item.Method = "GET"
	}
	if u, err := url.Parse(item.URL); err == nil && u.Path != "" {
		item.Name = fmt.Sprintf("%s %s", item.Method, u.Path)
	} else {
		item.Name = fmt.Sprintf("%s %s", item.Method, item.URL)
	}
	return item, nil
}

func splitShellArgs(s string) []string {
	var args []string
	var cur strings.Builder
	inSingle := false
	inDouble := false
	escaped := false

	// Join backslash line continuations before tokenizing
	clean := strings.ReplaceAll(s, "\\\r\n", " ")
	clean = strings.ReplaceAll(clean, "\\\n", " ")

	for i := 0; i < len(clean); i++ {
		ch := clean[i]
		if escaped {
			cur.WriteByte(ch)
			escaped = false
			continue
		}
		if ch == '\\' && !inSingle {
			escaped = true
			continue
		}
		if ch == '\'' && !inDouble {
			inSingle = !inSingle
			continue
		}
		if ch == '"' && !inSingle {
			inDouble = !inDouble
			continue
		}
		if (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r') && !inSingle && !inDouble {
			if cur.Len() > 0 {
				args = append(args, cur.String())
				cur.Reset()
			}
			continue
		}
		cur.WriteByte(ch)
	}
	if cur.Len() > 0 {
		args = append(args, cur.String())
	}
	return args
}

// GenerateCodeSnippet exports an ApiRequestItem as curl, powershell, or python code (F-42).
func GenerateCodeSnippet(item core.ApiRequestItem, lang string, vars map[string]string, resolveSecret SecretResolver) (string, error) {
	method := strings.ToUpper(strings.TrimSpace(item.Method))
	if method == "" {
		method = "GET"
	}
	rawURL := item.URL
	if len(vars) > 0 || resolveSecret != nil {
		var err error
		rawURL, err = ResolveTemplateString(item.URL, vars, resolveSecret)
		if err != nil {
			return "", err
		}
	}

	headers := make([]core.ApiKeyValue, 0, len(item.Headers)+1)
	for _, h := range item.Headers {
		if !h.Enabled || strings.TrimSpace(h.Key) == "" {
			continue
		}
		val := h.Value
		if len(vars) > 0 || resolveSecret != nil {
			val, _ = ResolveTemplateString(val, vars, resolveSecret)
		}
		headers = append(headers, core.ApiKeyValue{Key: h.Key, Value: val, Enabled: true})
	}

	auth := item.Auth
	if resolveSecret == nil {
		auth = core.SanitizeApiAuthForDisplay(auth)
	}
	if strings.EqualFold(auth.Type, "bearer") && auth.Token != "" {
		headers = append(headers, core.ApiKeyValue{Key: "Authorization", Value: "Bearer " + auth.Token, Enabled: true})
	} else if strings.EqualFold(auth.Type, "header") && auth.HeaderName != "" {
		headers = append(headers, core.ApiKeyValue{Key: auth.HeaderName, Value: auth.HeaderValue, Enabled: true})
	}

	body := item.Body
	if len(vars) > 0 || resolveSecret != nil {
		body, _ = ResolveTemplateString(body, vars, resolveSecret)
	}

	switch strings.ToLower(strings.TrimSpace(lang)) {
	case "powershell", "ps", "pwsh":
		var sb strings.Builder
		if len(headers) > 0 {
			sb.WriteString("$headers = @{\n")
			for _, h := range headers {
				sb.WriteString(fmt.Sprintf("  '%s' = '%s'\n", strings.ReplaceAll(h.Key, "'", "''"), strings.ReplaceAll(h.Value, "'", "''")))
			}
			sb.WriteString("}\n")
		}
		sb.WriteString(fmt.Sprintf("Invoke-RestMethod -Method %s -Uri '%s'", method, strings.ReplaceAll(rawURL, "'", "''")))
		if len(headers) > 0 {
			sb.WriteString(" -Headers $headers")
		}
		if body != "" && item.BodyType != "none" {
			sb.WriteString(fmt.Sprintf(" -Body '%s'", strings.ReplaceAll(body, "'", "''")))
		}
		if item.TlsSkipVerify {
			sb.WriteString(" -SkipCertificateCheck")
		}
		return sb.String(), nil

	case "python":
		var sb strings.Builder
		sb.WriteString("import requests\n\n")
		sb.WriteString(fmt.Sprintf("url = %q\n", rawURL))
		sb.WriteString("headers = {\n")
		for _, h := range headers {
			sb.WriteString(fmt.Sprintf("    %q: %q,\n", h.Key, h.Value))
		}
		sb.WriteString("}\n")
		if body != "" && item.BodyType != "none" {
			sb.WriteString(fmt.Sprintf("data = %q\n", body))
			sb.WriteString(fmt.Sprintf("resp = requests.request(%q, url, headers=headers, data=data, verify=%s)\n", method, boolPy(!item.TlsSkipVerify)))
		} else {
			sb.WriteString(fmt.Sprintf("resp = requests.request(%q, url, headers=headers, verify=%s)\n", method, boolPy(!item.TlsSkipVerify)))
		}
		sb.WriteString("print(resp.status_code, resp.text)")
		return sb.String(), nil

	default: // "curl"
		var parts []string
		parts = append(parts, fmt.Sprintf("curl -X %s", method))
		if item.TlsSkipVerify {
			parts = append(parts, "-k")
		}
		if !item.FollowRedirects {
			// explicit
		} else {
			parts = append(parts, "-L")
		}
		if strings.HasPrefix(strings.ToLower(item.RouteID), "socks5://") {
			parts = append(parts, fmt.Sprintf("--socks5-hostname '%s'", strings.TrimPrefix(item.RouteID, "socks5://")))
		}
		for _, h := range headers {
			parts = append(parts, fmt.Sprintf("-H '%s: %s'", h.Key, strings.ReplaceAll(h.Value, "'", `'\''`)))
		}
		if strings.EqualFold(auth.Type, "basic") && auth.Username != "" {
			parts = append(parts, fmt.Sprintf("-u '%s:%s'", auth.Username, auth.Password))
		}
		if body != "" && item.BodyType != "none" {
			parts = append(parts, fmt.Sprintf("-d '%s'", strings.ReplaceAll(body, "'", `'\''`)))
		}
		parts = append(parts, fmt.Sprintf("'%s'", rawURL))
		return strings.Join(parts, " \\\n  "), nil
	}
}

func boolPy(v bool) string {
	if v {
		return "True"
	}
	return "False"
}

// ParseOpenAPISpec converts an OpenAPI v3 or Swagger v2 JSON document into saved ApiRequestItems (F-42).
func ParseOpenAPISpec(specJSON string, engagementID string, collectionName string) ([]core.ApiRequestItem, error) {
	var doc map[string]any
	if err := json.Unmarshal([]byte(specJSON), &doc); err != nil {
		return nil, fmt.Errorf("invalid OpenAPI JSON: %w", err)
	}

	baseURL := "{{BASE_URL}}"
	if servers, ok := doc["servers"].([]any); ok && len(servers) > 0 {
		if first, ok := servers[0].(map[string]any); ok {
			if u, ok := first["url"].(string); ok && strings.TrimSpace(u) != "" {
				baseURL = strings.TrimRight(strings.TrimSpace(u), "/")
			}
		}
	} else if host, ok := doc["host"].(string); ok && strings.TrimSpace(host) != "" {
		scheme := "https"
		if schemes, ok := doc["schemes"].([]any); ok && len(schemes) > 0 {
			if s, ok := schemes[0].(string); ok && s != "" {
				scheme = s
			}
		}
		basePath, _ := doc["basePath"].(string)
		baseURL = strings.TrimRight(fmt.Sprintf("%s://%s%s", scheme, host, basePath), "/")
	}

	if strings.TrimSpace(collectionName) == "" {
		collectionName = "OpenAPI Import"
		if info, ok := doc["info"].(map[string]any); ok {
			if title, ok := info["title"].(string); ok && strings.TrimSpace(title) != "" {
				collectionName = title
			}
		}
	}

	pathsMap, ok := doc["paths"].(map[string]any)
	if !ok || len(pathsMap) == 0 {
		return nil, errors.New("no paths object found in OpenAPI/Swagger specification")
	}

	pathKeys := make([]string, 0, len(pathsMap))
	for p := range pathsMap {
		pathKeys = append(pathKeys, p)
	}
	sort.Strings(pathKeys)

	httpMethods := []string{"get", "post", "put", "patch", "delete", "head", "options"}
	var items []core.ApiRequestItem
	seq := 0

	for _, p := range pathKeys {
		opGroup, ok := pathsMap[p].(map[string]any)
		if !ok {
			continue
		}
		for _, m := range httpMethods {
			op, ok := opGroup[m].(map[string]any)
			if !ok {
				continue
			}
			seq++
			name, _ := op["summary"].(string)
			if strings.TrimSpace(name) == "" {
				name, _ = op["operationId"].(string)
			}
			if strings.TrimSpace(name) == "" {
				name = fmt.Sprintf("%s %s", strings.ToUpper(m), p)
			}

			var params []core.ApiKeyValue
			if rawParams, ok := op["parameters"].([]any); ok {
				for _, rp := range rawParams {
					pm, ok := rp.(map[string]any)
					if !ok {
						continue
					}
					inType, _ := pm["in"].(string)
					pName, _ := pm["name"].(string)
					if inType == "query" && pName != "" {
						params = append(params, core.ApiKeyValue{Key: pName, Value: "", Enabled: true})
					}
				}
			}

			bodyType := "none"
			body := ""
			if _, hasBody := op["requestBody"]; hasBody {
				bodyType = "json"
				body = "{\n  \n}"
			}

			items = append(items, core.ApiRequestItem{
				ID:              fmt.Sprintf("api-oa-%d-%d", time.Now().UnixNano(), seq),
				EngagementID:    engagementID,
				CollectionName:  collectionName,
				Name:            name,
				Method:          strings.ToUpper(m),
				URL:             baseURL + p,
				Params:          params,
				BodyType:        bodyType,
				Body:            body,
				FollowRedirects: true,
				TimeoutSec:      20,
			})
		}
	}

	if len(items) == 0 {
		return nil, errors.New("no HTTP operations found in OpenAPI paths")
	}
	return items, nil
}

// DiffResponses computes telemetry deltas and line-by-line header/body diffs between two responses (F-42).
func DiffResponses(left core.ApiResponse, right core.ApiResponse) core.ApiResponseDiff {
	return core.ApiResponseDiff{
		StatusDelta: fmt.Sprintf("%d -> %d", left.StatusCode, right.StatusCode),
		SizeDelta:   right.SizeBytes - left.SizeBytes,
		TimeDeltaMs: right.Timing.TotalMs - left.Timing.TotalMs,
		HeaderLines: diffLines(left.RawHeaders, right.RawHeaders),
		BodyLines:   diffLines(left.Body, right.Body),
	}
}

func diffLines(leftStr string, rightStr string) []core.ApiResponseDiffLine {
	a := strings.Split(strings.ReplaceAll(leftStr, "\r\n", "\n"), "\n")
	b := strings.Split(strings.ReplaceAll(rightStr, "\r\n", "\n"), "\n")

	// Guard against quadratic DP blowup on huge payloads by capping LCS lines
	const maxDiffLines = 600
	if len(a) > maxDiffLines {
		a = a[:maxDiffLines]
	}
	if len(b) > maxDiffLines {
		b = b[:maxDiffLines]
	}

	m, n := len(a), len(b)
	dp := make([][]int, m+1)
	for i := range dp {
		dp[i] = make([]int, n+1)
	}
	for i := m - 1; i >= 0; i-- {
		for j := n - 1; j >= 0; j-- {
			if a[i] == b[j] {
				dp[i][j] = dp[i+1][j+1] + 1
			} else if dp[i+1][j] >= dp[i][j+1] {
				dp[i][j] = dp[i+1][j]
			} else {
				dp[i][j] = dp[i][j+1]
			}
		}
	}

	var out []core.ApiResponseDiffLine
	i, j := 0, 0
	for i < m && j < n {
		if a[i] == b[j] {
			out = append(out, core.ApiResponseDiffLine{Kind: "same", Text: a[i]})
			i++
			j++
		} else if dp[i+1][j] >= dp[i][j+1] {
			out = append(out, core.ApiResponseDiffLine{Kind: "del", Text: a[i]})
			i++
		} else {
			out = append(out, core.ApiResponseDiffLine{Kind: "add", Text: b[j]})
			j++
		}
	}
	for ; i < m; i++ {
		out = append(out, core.ApiResponseDiffLine{Kind: "del", Text: a[i]})
	}
	for ; j < n; j++ {
		out = append(out, core.ApiResponseDiffLine{Kind: "add", Text: b[j]})
	}
	return out
}
