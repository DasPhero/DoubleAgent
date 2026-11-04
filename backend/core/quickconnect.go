package core

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// QuickConnectTarget represents a parsed ad-hoc SSH target from the Command Palette (F-02),
// such as "user@host:port", "user@host", or "ssh -p 2222 user@host".
type QuickConnectTarget struct {
	User    string `json:"user"`
	Address string `json:"address"`
	Port    int    `json:"port"`
	Display string `json:"display"`
}

// HostSearchResult pairs a HostSummary with its fuzzy match score and matched fields (F-02).
type HostSearchResult struct {
	Host          HostSummary `json:"host"`
	Score         int         `json:"score"`
	MatchedFields []string    `json:"matchedFields"`
}

// CommandPaletteResponse is returned by the backend for a Command Palette query (F-02).
type CommandPaletteResponse struct {
	Query        string              `json:"query"`
	HostResults  []HostSearchResult  `json:"hostResults"`
	QuickConnect *QuickConnectTarget `json:"quickConnect,omitempty"`
}

// ParseQuickConnectTarget parses ad-hoc connection strings like "user@host:port", "user@host",
// "host:port", or "ssh user@host -p 2222" (F-02).
func ParseQuickConnectTarget(raw string) (QuickConnectTarget, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return QuickConnectTarget{}, false
	}

	// Support optional leading "ssh " prefix and "-p <port>" flag
	fields := strings.Fields(trimmed)
	var targetToken string
	explicitPort := 0

	if len(fields) > 1 {
		startIdx := 0
		if strings.EqualFold(fields[0], "ssh") {
			startIdx = 1
		}
		for i := startIdx; i < len(fields); i++ {
			tok := fields[i]
			if tok == "-p" && i+1 < len(fields) {
				p, err := strconv.Atoi(fields[i+1])
				if err != nil || p < 1 || p > 65535 {
					return QuickConnectTarget{}, false
				}
				explicitPort = p
				i++
				continue
			}
			if strings.HasPrefix(tok, "-p") && len(tok) > 2 {
				p, err := strconv.Atoi(tok[2:])
				if err != nil || p < 1 || p > 65535 {
					return QuickConnectTarget{}, false
				}
				explicitPort = p
				continue
			}
			if strings.HasPrefix(tok, "-") {
				// Reject unsupported flags in quick connect
				return QuickConnectTarget{}, false
			}
			if targetToken == "" {
				targetToken = tok
			} else {
				// Multiple positional arguments -> not a clean quick-connect target
				return QuickConnectTarget{}, false
			}
		}
	} else {
		targetToken = fields[0]
	}

	if targetToken == "" {
		return QuickConnectTarget{}, false
	}

	user := ""
	hostPort := targetToken
	if atIdx := strings.IndexByte(targetToken, '@'); atIdx != -1 {
		user = strings.TrimSpace(targetToken[:atIdx])
		hostPort = strings.TrimSpace(targetToken[atIdx+1:])
		if user == "" || hostPort == "" || strings.ContainsAny(user, " /\\:@") {
			return QuickConnectTarget{}, false
		}
	}

	host := hostPort
	port := explicitPort
	if colonIdx := strings.LastIndexByte(hostPort, ':'); colonIdx != -1 {
		// Make sure it's host:port (not an unbracketed IPv6 without port)
		possibleHost := strings.TrimSpace(hostPort[:colonIdx])
		possiblePort := strings.TrimSpace(hostPort[colonIdx+1:])
		if possibleHost == "" || possiblePort == "" {
			return QuickConnectTarget{}, false
		}
		p, err := strconv.Atoi(possiblePort)
		if err != nil || p < 1 || p > 65535 {
			return QuickConnectTarget{}, false
		}
		host = strings.TrimPrefix(strings.TrimSuffix(possibleHost, "]"), "[")
		port = p
	}

	// Only treat bare input without '@' and without ':port' and without 'ssh ' prefix as quick-connect
	// if it explicitly contains '@' or ':port' or started with 'ssh '.
	hasExplicitQuickSyntax := strings.Contains(targetToken, "@") || strings.Contains(targetToken, ":") || (len(fields) > 1 && strings.EqualFold(fields[0], "ssh"))
	if !hasExplicitQuickSyntax {
		return QuickConnectTarget{}, false
	}

	if !isValidHostAddress(host) {
		return QuickConnectTarget{}, false
	}

	if user == "" {
		user = "root"
	}
	if port == 0 {
		port = 22
	}

	return QuickConnectTarget{
		User:    user,
		Address: host,
		Port:    port,
		Display: fmt.Sprintf("%s@%s:%d", user, host, port),
	}, true
}

func isValidHostAddress(host string) bool {
	if len(host) == 0 || len(host) > 253 {
		return false
	}
	if strings.HasPrefix(host, ".") || strings.HasSuffix(host, ".") || strings.HasPrefix(host, "-") || strings.HasSuffix(host, "-") {
		return false
	}
	for _, r := range host {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '.' && r != '-' && r != '_' && r != ':' {
			return false
		}
	}
	return true
}

// SearchHostsFuzzy performs fuzzy search across host Label, Address, Tags, and EffectiveUser (F-02).
func SearchHostsFuzzy(hosts []HostSummary, query string) []HostSearchResult {
	q := strings.TrimSpace(strings.ToLower(query))
	if q == "" {
		out := make([]HostSearchResult, 0, len(hosts))
		for _, h := range hosts {
			out = append(out, HostSearchResult{
				Host:          h,
				Score:         1,
				MatchedFields: []string{},
			})
		}
		return out
	}

	tokens := strings.Fields(q)
	results := make([]HostSearchResult, 0, len(hosts))

	for _, h := range hosts {
		totalScore := 0
		matchedSet := make(map[string]bool)
		allTokensMatched := true

		for _, tok := range tokens {
			tokScore := 0

			if s := fuzzyFieldScore(strings.ToLower(h.Label), tok, 120); s > 0 {
				tokScore += s
				matchedSet["name"] = true
			}
			if s := fuzzyFieldScore(strings.ToLower(h.Address), tok, 100); s > 0 {
				tokScore += s
				matchedSet["address"] = true
			}
			for _, tag := range h.Tags {
				if s := fuzzyFieldScore(strings.ToLower(tag), tok, 90); s > 0 {
					tokScore += s
					matchedSet["tag:"+tag] = true
				}
			}
			userHost := fmt.Sprintf("%s@%s:%d", strings.ToLower(h.EffectiveUser), strings.ToLower(h.Address), h.EffectivePort)
			if s := fuzzyFieldScore(userHost, tok, 75); s > 0 {
				tokScore += s
				matchedSet["target"] = true
			}

			if tokScore == 0 {
				allTokensMatched = false
				break
			}
			totalScore += tokScore
		}

		if !allTokensMatched || totalScore <= 0 {
			continue
		}

		fields := make([]string, 0, len(matchedSet))
		for _, f := range []string{"name", "address", "target"} {
			if matchedSet[f] {
				fields = append(fields, f)
			}
		}
		for _, tag := range h.Tags {
			if matchedSet["tag:"+tag] {
				fields = append(fields, "tag:"+tag)
			}
		}

		results = append(results, HostSearchResult{
			Host:          h,
			Score:         totalScore,
			MatchedFields: fields,
		})
	}

	// Sort by Score descending, then Label ascending
	for i := 0; i < len(results); i++ {
		for j := i + 1; j < len(results); j++ {
			if results[j].Score > results[i].Score ||
				(results[j].Score == results[i].Score && strings.ToLower(results[j].Host.Label) < strings.ToLower(results[i].Host.Label)) {
				results[i], results[j] = results[j], results[i]
			}
		}
	}

	return results
}

// fuzzyFieldScore computes a match score for needle inside candidate:
// - exact match: baseWeight * 3
// - prefix match: baseWeight * 2
// - substring match: baseWeight + bonus for early position
// - ordered subsequence match (true fuzzy): baseWeight/2 - gap penalty
func fuzzyFieldScore(candidate, needle string, baseWeight int) int {
	if candidate == "" || needle == "" {
		return 0
	}
	if candidate == needle {
		return baseWeight * 3
	}
	if strings.HasPrefix(candidate, needle) {
		return baseWeight * 2
	}
	if idx := strings.Index(candidate, needle); idx != -1 {
		bonus := 20 - idx
		if bonus < 0 {
			bonus = 0
		}
		return baseWeight + bonus
	}

	// Subsequence fuzzy match (all characters of needle appear in order in candidate)
	cRunes := []rune(candidate)
	nRunes := []rune(needle)
	if len(nRunes) < 2 || len(nRunes) > len(cRunes) {
		return 0
	}

	nIdx := 0
	firstMatch := -1
	lastMatch := -1
	consecutiveBonus := 0

	for cIdx, r := range cRunes {
		if r == nRunes[nIdx] {
			if firstMatch == -1 {
				firstMatch = cIdx
			}
			if lastMatch != -1 && cIdx == lastMatch+1 {
				consecutiveBonus += 8
			}
			lastMatch = cIdx
			nIdx++
			if nIdx == len(nRunes) {
				break
			}
		}
	}

	if nIdx != len(nRunes) {
		return 0
	}

	span := lastMatch - firstMatch + 1
	gaps := span - len(nRunes)
	score := (baseWeight / 2) + consecutiveBonus - (gaps * 3)
	if score < 10 {
		score = 10
	}
	return score
}
