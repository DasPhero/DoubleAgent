package core

import (
	"errors"
	"fmt"
)

// ErrHostNotFound is returned when a requested HostID does not exist in the VaultPayload.
var ErrHostNotFound = errors.New("host not found in vault")

// ResolvedHost contains the effective connection settings for a host after applying
// hierarchical group inheritance (root group -> child group -> host override) per F-01, F-14.
type ResolvedHost struct {
	HostID         string        `json:"hostId"`
	Label          string        `json:"label"`
	Address        string        `json:"address"`
	Port           uint16        `json:"port"`
	Username       string        `json:"username"`
	IdentityID     string        `json:"identityId"`
	InitialDir     string        `json:"initialDir,omitempty"`
	KeepaliveSecs  uint16        `json:"keepaliveSecs"`
	ProxyProfileID string        `json:"proxyProfileId,omitempty"`
	ProxyCommand   string        `json:"proxyCommand,omitempty"`
	JumpChain      []string      `json:"jumpChain,omitempty"`
	SessionLogging bool          `json:"sessionLogging"`
	Auth           SshAuthConfig `json:"-"`
}

// HostSummary is a non-secret view of a saved host exposed to the frontend UI (Golden Rule 2, F-14, F-21).
type HostSummary struct {
	ID             string   `json:"id"`
	Label          string   `json:"label"`
	Address        string   `json:"address"`
	EffectivePort  uint16   `json:"effectivePort"`
	EffectiveUser  string   `json:"effectiveUser"`
	InitialDir     string   `json:"initialDir,omitempty"`
	KeepaliveSecs  uint16   `json:"keepaliveSecs"`
	GroupID        string   `json:"groupId"`
	IdentityID     string   `json:"identityId"`
	Tags           []string `json:"tags"`
	JumpChain      []string `json:"jumpChain"`
	ProxyProfileID string   `json:"proxyProfileId,omitempty"`
	ProxyCommand   string   `json:"proxyCommand,omitempty"`
	Color          string   `json:"color"`
	Favorite       bool     `json:"favorite"`
	SessionLogging bool     `json:"sessionLogging"`
	EngagementID   string   `json:"engagementId,omitempty"`
}

// IdentitySummary is a non-secret view of a saved identity exposed to the frontend UI (Golden Rule 2).
type IdentitySummary struct {
	ID         string         `json:"id"`
	Label      string         `json:"label"`
	Username   string         `json:"username"`
	AuthMethod AuthMethodType `json:"authMethod"`
	KeyID      string         `json:"keyId,omitempty"`
	TotpID     string         `json:"totpId,omitempty"`
}

// SshKeySummary is a non-secret view of a saved SSH keypair exposed to the frontend UI (F-04, Golden Rule 2).
// PrivateKey and Passphrase never leave the Go process.
type SshKeySummary struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Type        string `json:"type"`
	PublicKey   string `json:"publicKey"`
	Fingerprint string `json:"fingerprint"`
}

// VaultSummary aggregates non-secret groups, hosts (with inherited values resolved), identities, public keys, proxy profiles, snippets, and totp authenticators for the UI.
type VaultSummary struct {
	Groups        []GroupRecord         `json:"groups"`
	Hosts         []HostSummary         `json:"hosts"`
	Identities    []IdentitySummary     `json:"identities"`
	Keys          []SshKeySummary       `json:"keys"`
	ProxyProfiles []ProxyProfileSummary `json:"proxyProfiles"`
	Snippets      []Snippet             `json:"snippets"`
	SnippetChains []SnippetChain        `json:"snippetChains"`
	TotpRecords   []TotpSummary         `json:"totpRecords"`
	Notes         []NotePageSummary     `json:"notes"`
	Listeners     []ListenerProfile     `json:"listeners"`
}

// ResolveEffectiveHost computes the effective Port, Username, IdentityID, KeepaliveSecs, and SshAuthConfig
// for a given hostID by walking the Group hierarchy from root to leaf and overriding with explicit Host values (F-01).
func ResolveEffectiveHost(hostID string, payload VaultPayload) (ResolvedHost, error) {
	var target *HostRecord
	for i := range payload.Hosts {
		if payload.Hosts[i].ID == hostID {
			target = &payload.Hosts[i]
			break
		}
	}
	if target == nil {
		return ResolvedHost{}, fmt.Errorf("%w: %s", ErrHostNotFound, hostID)
	}

	groupByID := make(map[string]GroupRecord, len(payload.Groups))
	for _, g := range payload.Groups {
		groupByID[g.ID] = g
	}

	// Build ancestor chain from root group down to immediate group (preventing cycles).
	var chain []GroupRecord
	visited := make(map[string]bool)
	currID := target.GroupID
	for currID != "" && !visited[currID] {
		visited[currID] = true
		g, ok := groupByID[currID]
		if !ok {
			break
		}
		chain = append([]GroupRecord{g}, chain...)
		currID = g.ParentID
	}

	effectivePort := uint16(22)
	effectiveUser := "root"
	effectiveIdentityID := ""
	effectiveKeepalive := uint16(30)
	effectiveInitialDir := ""
	effectiveProxyProfileID := ""
	effectiveProxyCommand := ""
	effectiveSessionLogging := false
	jumpChain := append([]string(nil), target.JumpChain...)

	// 1. Apply inherited group settings from top-most ancestor down to immediate group
	for _, g := range chain {
		if g.DefaultSettings.Port != 0 {
			effectivePort = g.DefaultSettings.Port
		}
		if g.DefaultSettings.Username != "" {
			effectiveUser = g.DefaultSettings.Username
		}
		if g.DefaultSettings.IdentityID != "" {
			effectiveIdentityID = g.DefaultSettings.IdentityID
		}
		if g.DefaultSettings.KeepaliveSecs != 0 {
			effectiveKeepalive = g.DefaultSettings.KeepaliveSecs
		}
		if g.DefaultSettings.InitialDir != "" {
			effectiveInitialDir = g.DefaultSettings.InitialDir
		}
		if g.DefaultSettings.ProxyProfileID != "" {
			effectiveProxyProfileID = g.DefaultSettings.ProxyProfileID
		}
		if g.DefaultSettings.SessionLogging != nil {
			effectiveSessionLogging = *g.DefaultSettings.SessionLogging
		}
	}

	// 2. Host value overrides group value (F-01, F-14, F-21 acceptance criteria)
	if target.Port != 0 {
		effectivePort = target.Port
	}
	if target.IdentityID != "" {
		effectiveIdentityID = target.IdentityID
	}
	if target.InitialDir != "" {
		effectiveInitialDir = target.InitialDir
	}
	if target.ProxyProfileID != "" {
		effectiveProxyProfileID = target.ProxyProfileID
	}
	if target.ProxyCommand != "" {
		effectiveProxyCommand = target.ProxyCommand
	}
	if target.SessionLogging != nil {
		effectiveSessionLogging = *target.SessionLogging
	}

	var authCfg SshAuthConfig
	if effectiveIdentityID != "" {
		for _, id := range payload.Identities {
			if id.ID == effectiveIdentityID {
				if id.Username != "" {
					effectiveUser = id.Username
				}
				authCfg.Method = id.AuthMethod
				authCfg.Password = id.Password
				if id.KeyID != "" {
					for _, k := range payload.Keys {
						if k.ID == id.KeyID {
							authCfg.PrivateKey = []byte(k.PrivateKey)
							authCfg.Passphrase = k.Passphrase
							break
						}
					}
				}
				break
			}
		}
	}

	return ResolvedHost{
		HostID:         target.ID,
		Label:          target.Label,
		Address:        target.Address,
		Port:           effectivePort,
		Username:       effectiveUser,
		IdentityID:     effectiveIdentityID,
		InitialDir:     effectiveInitialDir,
		KeepaliveSecs:  effectiveKeepalive,
		ProxyProfileID: effectiveProxyProfileID,
		ProxyCommand:   effectiveProxyCommand,
		JumpChain:      jumpChain,
		SessionLogging: effectiveSessionLogging,
		Auth:           authCfg,
	}, nil
}

// BuildVaultSummary produces a non-secret VaultSummary from a decrypted VaultPayload (F-01, F-14, Golden Rule 2).
func BuildVaultSummary(payload VaultPayload) VaultSummary {
	groups := make([]GroupRecord, len(payload.Groups))
	copy(groups, payload.Groups)

	identities := make([]IdentitySummary, 0, len(payload.Identities))
	for _, id := range payload.Identities {
		identities = append(identities, IdentitySummary{
			ID:         id.ID,
			Label:      id.Label,
			Username:   id.Username,
			AuthMethod: id.AuthMethod,
			KeyID:      id.KeyID,
			TotpID:     id.TotpID,
		})
	}

	keys := make([]SshKeySummary, 0, len(payload.Keys))
	for _, k := range payload.Keys {
		keys = append(keys, SshKeySummary{
			ID:          k.ID,
			Label:       k.Label,
			Type:        k.Type,
			PublicKey:   k.PublicKey,
			Fingerprint: k.Fingerprint,
		})
	}

	proxySummaries := make([]ProxyProfileSummary, 0, len(payload.ProxyProfiles))
	for _, p := range payload.ProxyProfiles {
		jumpIDs := p.JumpHostIDs
		if jumpIDs == nil {
			jumpIDs = []string{}
		}
		proxySummaries = append(proxySummaries, ProxyProfileSummary{
			ID:            p.ID,
			Name:          p.Name,
			EngagementID:  p.EngagementID,
			Type:          p.Type,
			JumpHostIDs:   jumpIDs,
			Command:       p.Command,
			SocksAddress:  p.SocksAddress,
			SocksUsername: p.SocksUsername,
			HasPassword:   p.SocksPassword != "",
		})
	}

	hosts := make([]HostSummary, 0, len(payload.Hosts))
	for _, h := range payload.Hosts {
		resolved, err := ResolveEffectiveHost(h.ID, payload)
		port := h.Port
		user := "root"
		keepalive := uint16(30)
		effIdentity := h.IdentityID
		proxyProfileID := h.ProxyProfileID
		proxyCommand := h.ProxyCommand
		var initialDir string
		var sessionLogging bool
		if h.SessionLogging != nil {
			sessionLogging = *h.SessionLogging
		}
		if err == nil {
			port = resolved.Port
			user = resolved.Username
			keepalive = resolved.KeepaliveSecs
			effIdentity = resolved.IdentityID
			initialDir = resolved.InitialDir
			proxyProfileID = resolved.ProxyProfileID
			proxyCommand = resolved.ProxyCommand
			sessionLogging = resolved.SessionLogging
		}
		tags := h.Tags
		if tags == nil {
			tags = []string{}
		}
		jumpChain := h.JumpChain
		if jumpChain == nil {
			jumpChain = []string{}
		}
		hosts = append(hosts, HostSummary{
			ID:             h.ID,
			Label:          h.Label,
			Address:        h.Address,
			EffectivePort:  port,
			EffectiveUser:  user,
			InitialDir:     initialDir,
			KeepaliveSecs:  keepalive,
			GroupID:        h.GroupID,
			IdentityID:     effIdentity,
			Tags:           tags,
			JumpChain:      jumpChain,
			ProxyProfileID: proxyProfileID,
			ProxyCommand:   proxyCommand,
			Color:          h.Color,
			Favorite:       h.Favorite,
			SessionLogging: sessionLogging,
			EngagementID:   h.EngagementID,
		})
	}

	snippets := payload.Snippets
	if snippets == nil {
		snippets = []Snippet{}
	}

	chains := payload.SnippetChains
	if chains == nil {
		chains = []SnippetChain{}
	}

	totpSummaries := make([]TotpSummary, 0, len(payload.TotpRecords))
	for _, tr := range payload.TotpRecords {
		alg := tr.Algorithm
		if alg == "" {
			alg = "SHA1"
		}
		digits := tr.Digits
		if digits == 0 {
			digits = 6
		}
		period := tr.Period
		if period == 0 {
			period = 30
		}
		totpSummaries = append(totpSummaries, TotpSummary{
			ID:        tr.ID,
			Label:     tr.Label,
			Issuer:    tr.Issuer,
			Algorithm: alg,
			Digits:    digits,
			Period:    period,
			HostID:    tr.HostID,
			CreatedAt: tr.CreatedAt,
		})
	}

	noteSummaries := make([]NotePageSummary, 0, len(payload.Notes))
	for _, np := range payload.Notes {
		noteSummaries = append(noteSummaries, BuildNoteSummary(np))
	}

	listeners := make([]ListenerProfile, len(payload.Listeners))
	copy(listeners, payload.Listeners)

	return VaultSummary{
		Groups:        groups,
		Hosts:         hosts,
		Identities:    identities,
		Keys:          keys,
		ProxyProfiles: proxySummaries,
		Snippets:      snippets,
		SnippetChains: chains,
		TotpRecords:   totpSummaries,
		Notes:         noteSummaries,
		Listeners:     listeners,
	}
}

