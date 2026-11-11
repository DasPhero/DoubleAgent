package vault

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"doubleagent/backend/core"
)

// DetectSyncConflictFiles scans vaultDir for conflict copies created by Syncthing, Google Drive,
// Dropbox, or Nextcloud (F-29, Spec Line 138).
func DetectSyncConflictFiles(vaultDir, baseVaultName string) []string {
	if vaultDir == "" {
		return nil
	}
	entries, err := os.ReadDir(vaultDir)
	if err != nil {
		return nil
	}

	cleanBase := filepath.Base(baseVaultName)
	var conflictFiles []string

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if name == cleanBase {
			continue
		}

		lower := strings.ToLower(name)
		// Check standard conflict file patterns:
		// Syncthing: *.sync-conflict-*.vault
		// Google Drive: * (1).vault, * - Conflict*.vault
		// Dropbox: * (Conflicted Copy *).vault
		// Generic: *conflict*.vault
		isConflict := strings.Contains(lower, ".sync-conflict-") ||
			strings.Contains(lower, "conflict") ||
			strings.Contains(lower, "(1)") ||
			strings.Contains(lower, "(2)") ||
			strings.Contains(lower, "conflicted copy")

		if isConflict && (strings.HasSuffix(lower, ".vault") || strings.HasSuffix(lower, ".json")) {
			conflictFiles = append(conflictFiles, filepath.Join(vaultDir, name))
		}
	}

	return conflictFiles
}

func jsonEqual(a, b any) bool {
	b1, err1 := json.Marshal(a)
	b2, err2 := json.Marshal(b)
	if err1 != nil || err2 != nil {
		return false
	}
	return bytes.Equal(b1, b2)
}

// MergeVaultPayloads performs an ID-based merge of two decrypted VaultPayload structures (F-29).
// Non-conflicting additions on either side are automatically merged into the result.
// Items with matching IDs but differing content are flagged in the VaultConflictReport.
func MergeVaultPayloads(local, remote core.VaultPayload) (core.VaultPayload, core.VaultConflictReport) {
	merged := core.VaultPayload{
		SchemaVersion: currentSchemaVersion,
	}
	report := core.VaultConflictReport{}

	// 1. Hosts
	localHosts := make(map[string]core.HostRecord, len(local.Hosts))
	for _, h := range local.Hosts {
		localHosts[h.ID] = h
	}
	remoteHosts := make(map[string]core.HostRecord, len(remote.Hosts))
	for _, h := range remote.Hosts {
		remoteHosts[h.ID] = h
	}

	for _, lh := range local.Hosts {
		if rh, exists := remoteHosts[lh.ID]; exists {
			if jsonEqual(lh, rh) {
				merged.Hosts = append(merged.Hosts, lh)
			} else {
				report.HasConflicts = true
				report.Conflicts = append(report.Conflicts, core.VaultConflictItem{
					ID:            lh.ID,
					Type:          "host",
					Label:         lh.Label,
					LocalSummary:  fmt.Sprintf("%s (%s:%d)", lh.Label, lh.Address, lh.Port),
					RemoteSummary: fmt.Sprintf("%s (%s:%d)", rh.Label, rh.Address, rh.Port),
				})
				merged.Hosts = append(merged.Hosts, lh) // default to local until resolved
			}
		} else {
			merged.Hosts = append(merged.Hosts, lh)
		}
	}
	for _, rh := range remote.Hosts {
		if _, exists := localHosts[rh.ID]; !exists {
			merged.Hosts = append(merged.Hosts, rh)
			report.AutoMerged++
		}
	}

	// 2. Groups
	localGroups := make(map[string]core.GroupRecord, len(local.Groups))
	for _, g := range local.Groups {
		localGroups[g.ID] = g
	}
	remoteGroups := make(map[string]core.GroupRecord, len(remote.Groups))
	for _, g := range remote.Groups {
		remoteGroups[g.ID] = g
	}

	for _, lg := range local.Groups {
		if rg, exists := remoteGroups[lg.ID]; exists {
			if jsonEqual(lg, rg) {
				merged.Groups = append(merged.Groups, lg)
			} else {
				report.HasConflicts = true
				report.Conflicts = append(report.Conflicts, core.VaultConflictItem{
					ID:            lg.ID,
					Type:          "group",
					Label:         lg.Name,
					LocalSummary:  fmt.Sprintf("%s (id: %s)", lg.Name, lg.ID),
					RemoteSummary: fmt.Sprintf("%s (id: %s)", rg.Name, rg.ID),
				})
				merged.Groups = append(merged.Groups, lg)
			}
		} else {
			merged.Groups = append(merged.Groups, lg)
		}
	}
	for _, rg := range remote.Groups {
		if _, exists := localGroups[rg.ID]; !exists {
			merged.Groups = append(merged.Groups, rg)
			report.AutoMerged++
		}
	}

	// 3. Identities
	localIdentities := make(map[string]core.IdentityRecord, len(local.Identities))
	for _, id := range local.Identities {
		localIdentities[id.ID] = id
	}
	remoteIdentities := make(map[string]core.IdentityRecord, len(remote.Identities))
	for _, id := range remote.Identities {
		remoteIdentities[id.ID] = id
	}

	for _, lid := range local.Identities {
		if rid, exists := remoteIdentities[lid.ID]; exists {
			if jsonEqual(lid, rid) {
				merged.Identities = append(merged.Identities, lid)
			} else {
				report.HasConflicts = true
				report.Conflicts = append(report.Conflicts, core.VaultConflictItem{
					ID:            lid.ID,
					Type:          "identity",
					Label:         lid.Label,
					LocalSummary:  fmt.Sprintf("%s (%s / %s)", lid.Label, lid.Username, lid.AuthMethod),
					RemoteSummary: fmt.Sprintf("%s (%s / %s)", rid.Label, rid.Username, rid.AuthMethod),
				})
				merged.Identities = append(merged.Identities, lid)
			}
		} else {
			merged.Identities = append(merged.Identities, lid)
		}
	}
	for _, rid := range remote.Identities {
		if _, exists := localIdentities[rid.ID]; !exists {
			merged.Identities = append(merged.Identities, rid)
			report.AutoMerged++
		}
	}

	// 4. SSH Keys
	localKeys := make(map[string]core.SshKeyRecord, len(local.Keys))
	for _, k := range local.Keys {
		localKeys[k.ID] = k
	}
	remoteKeys := make(map[string]core.SshKeyRecord, len(remote.Keys))
	for _, k := range remote.Keys {
		remoteKeys[k.ID] = k
	}

	for _, lk := range local.Keys {
		if rk, exists := remoteKeys[lk.ID]; exists {
			if jsonEqual(lk, rk) {
				merged.Keys = append(merged.Keys, lk)
			} else {
				report.HasConflicts = true
				report.Conflicts = append(report.Conflicts, core.VaultConflictItem{
					ID:            lk.ID,
					Type:          "key",
					Label:         lk.Label,
					LocalSummary:  fmt.Sprintf("%s (%s)", lk.Label, lk.Type),
					RemoteSummary: fmt.Sprintf("%s (%s)", rk.Label, rk.Type),
				})
				merged.Keys = append(merged.Keys, lk)
			}
		} else {
			merged.Keys = append(merged.Keys, lk)
		}
	}
	for _, rk := range remote.Keys {
		if _, exists := localKeys[rk.ID]; !exists {
			merged.Keys = append(merged.Keys, rk)
			report.AutoMerged++
		}
	}

	// 5. Port Forwarding Rules
	localRules := make(map[string]core.ForwardRule, len(local.ForwardRules))
	for _, r := range local.ForwardRules {
		localRules[r.ID] = r
	}
	remoteRules := make(map[string]core.ForwardRule, len(remote.ForwardRules))
	for _, r := range remote.ForwardRules {
		remoteRules[r.ID] = r
	}

	for _, lr := range local.ForwardRules {
		if rr, exists := remoteRules[lr.ID]; exists {
			if jsonEqual(lr, rr) {
				merged.ForwardRules = append(merged.ForwardRules, lr)
			} else {
				report.HasConflicts = true
				report.Conflicts = append(report.Conflicts, core.VaultConflictItem{
					ID:            lr.ID,
					Type:          "forward_rule",
					Label:         lr.Label,
					LocalSummary:  fmt.Sprintf("%s (%s %s:%d -> %s:%d)", lr.Label, lr.Type, lr.BindAddress, lr.BindPort, lr.TargetHost, lr.TargetPort),
					RemoteSummary: fmt.Sprintf("%s (%s %s:%d -> %s:%d)", rr.Label, rr.Type, rr.BindAddress, rr.BindPort, rr.TargetHost, rr.TargetPort),
				})
				merged.ForwardRules = append(merged.ForwardRules, lr)
			}
		} else {
			merged.ForwardRules = append(merged.ForwardRules, lr)
		}
	}
	for _, rr := range remote.ForwardRules {
		if _, exists := localRules[rr.ID]; !exists {
			merged.ForwardRules = append(merged.ForwardRules, rr)
			report.AutoMerged++
		}
	}

	// 6. Proxy Profiles
	localProfiles := make(map[string]core.ProxyProfile, len(local.ProxyProfiles))
	for _, p := range local.ProxyProfiles {
		localProfiles[p.ID] = p
	}
	remoteProfiles := make(map[string]core.ProxyProfile, len(remote.ProxyProfiles))
	for _, p := range remote.ProxyProfiles {
		remoteProfiles[p.ID] = p
	}

	for _, lp := range local.ProxyProfiles {
		if rp, exists := remoteProfiles[lp.ID]; exists {
			if jsonEqual(lp, rp) {
				merged.ProxyProfiles = append(merged.ProxyProfiles, lp)
			} else {
				report.HasConflicts = true
				report.Conflicts = append(report.Conflicts, core.VaultConflictItem{
					ID:            lp.ID,
					Type:          "proxy_profile",
					Label:         lp.Name,
					LocalSummary:  fmt.Sprintf("%s (%s)", lp.Name, lp.Type),
					RemoteSummary: fmt.Sprintf("%s (%s)", rp.Name, rp.Type),
				})
				merged.ProxyProfiles = append(merged.ProxyProfiles, lp)
			}
		} else {
			merged.ProxyProfiles = append(merged.ProxyProfiles, lp)
		}
	}
	for _, rp := range remote.ProxyProfiles {
		if _, exists := localProfiles[rp.ID]; !exists {
			merged.ProxyProfiles = append(merged.ProxyProfiles, rp)
			report.AutoMerged++
		}
	}

	// 7. Snippets
	localSnippets := make(map[string]core.Snippet, len(local.Snippets))
	for _, s := range local.Snippets {
		localSnippets[s.ID] = s
	}
	remoteSnippets := make(map[string]core.Snippet, len(remote.Snippets))
	for _, s := range remote.Snippets {
		remoteSnippets[s.ID] = s
	}

	for _, ls := range local.Snippets {
		if rs, exists := remoteSnippets[ls.ID]; exists {
			if jsonEqual(ls, rs) {
				merged.Snippets = append(merged.Snippets, ls)
			} else {
				report.HasConflicts = true
				report.Conflicts = append(report.Conflicts, core.VaultConflictItem{
					ID:            ls.ID,
					Type:          "snippet",
					Label:         ls.Name,
					LocalSummary:  fmt.Sprintf("%s (%s)", ls.Name, ls.Description),
					RemoteSummary: fmt.Sprintf("%s (%s)", rs.Name, rs.Description),
				})
				merged.Snippets = append(merged.Snippets, ls)
			}
		} else {
			merged.Snippets = append(merged.Snippets, ls)
		}
	}
	for _, rs := range remote.Snippets {
		if _, exists := localSnippets[rs.ID]; !exists {
			merged.Snippets = append(merged.Snippets, rs)
			report.AutoMerged++
		}
	}

	// 8. Notes
	localNotes := make(map[string]core.NotePage, len(local.Notes))
	for _, n := range local.Notes {
		localNotes[n.ID] = n
	}
	remoteNotes := make(map[string]core.NotePage, len(remote.Notes))
	for _, n := range remote.Notes {
		remoteNotes[n.ID] = n
	}

	for _, ln := range local.Notes {
		if rn, exists := remoteNotes[ln.ID]; exists {
			if jsonEqual(ln, rn) {
				merged.Notes = append(merged.Notes, ln)
			} else {
				report.HasConflicts = true
				report.Conflicts = append(report.Conflicts, core.VaultConflictItem{
					ID:            ln.ID,
					Type:          "note",
					Label:         ln.Title,
					LocalSummary:  fmt.Sprintf("%s (len %d chars)", ln.Title, len(ln.Body)),
					RemoteSummary: fmt.Sprintf("%s (len %d chars)", rn.Title, len(rn.Body)),
				})
				merged.Notes = append(merged.Notes, ln)
			}
		} else {
			merged.Notes = append(merged.Notes, ln)
		}
	}
	for _, rn := range remote.Notes {
		if _, exists := localNotes[rn.ID]; !exists {
			merged.Notes = append(merged.Notes, rn)
			report.AutoMerged++
		}
	}

	// 9. TOTP Records
	localTotp := make(map[string]core.TotpRecord, len(local.TotpRecords))
	for _, t := range local.TotpRecords {
		localTotp[t.ID] = t
	}
	remoteTotp := make(map[string]core.TotpRecord, len(remote.TotpRecords))
	for _, t := range remote.TotpRecords {
		remoteTotp[t.ID] = t
	}

	for _, lt := range local.TotpRecords {
		if rt, exists := remoteTotp[lt.ID]; exists {
			if jsonEqual(lt, rt) {
				merged.TotpRecords = append(merged.TotpRecords, lt)
			} else {
				report.HasConflicts = true
				report.Conflicts = append(report.Conflicts, core.VaultConflictItem{
					ID:            lt.ID,
					Type:          "totp",
					Label:         lt.Label,
					LocalSummary:  fmt.Sprintf("%s / %s", lt.Label, lt.Issuer),
					RemoteSummary: fmt.Sprintf("%s / %s", rt.Label, rt.Issuer),
				})
				merged.TotpRecords = append(merged.TotpRecords, lt)
			}
		} else {
			merged.TotpRecords = append(merged.TotpRecords, lt)
		}
	}
	for _, rt := range remote.TotpRecords {
		if _, exists := localTotp[rt.ID]; !exists {
			merged.TotpRecords = append(merged.TotpRecords, rt)
			report.AutoMerged++
		}
	}

	// 10. Engagements (F-36)
	localEngagements := make(map[string]core.Engagement, len(local.Engagements))
	for _, e := range local.Engagements {
		localEngagements[e.ID] = e
	}
	remoteEngagements := make(map[string]core.Engagement, len(remote.Engagements))
	for _, e := range remote.Engagements {
		remoteEngagements[e.ID] = e
	}

	for _, le := range local.Engagements {
		if re, exists := remoteEngagements[le.ID]; exists {
			if jsonEqual(le, re) {
				merged.Engagements = append(merged.Engagements, le)
			} else {
				report.HasConflicts = true
				report.Conflicts = append(report.Conflicts, core.VaultConflictItem{
					ID:            le.ID,
					Type:          "engagement",
					Label:         le.Name,
					LocalSummary:  fmt.Sprintf("%s (%s)", le.Name, le.Timeframe),
					RemoteSummary: fmt.Sprintf("%s (%s)", re.Name, re.Timeframe),
				})
				merged.Engagements = append(merged.Engagements, le)
			}
		} else {
			merged.Engagements = append(merged.Engagements, le)
		}
	}
	for _, re := range remote.Engagements {
		if _, exists := localEngagements[re.ID]; !exists {
			merged.Engagements = append(merged.Engagements, re)
			report.AutoMerged++
		}
	}

	// 11. Credentials (F-36)
	localCreds := make(map[string]core.CredentialEntry, len(local.Credentials))
	for _, c := range local.Credentials {
		localCreds[c.ID] = c
	}
	remoteCreds := make(map[string]core.CredentialEntry, len(remote.Credentials))
	for _, c := range remote.Credentials {
		remoteCreds[c.ID] = c
	}

	for _, lc := range local.Credentials {
		if rc, exists := remoteCreds[lc.ID]; exists {
			if jsonEqual(lc, rc) {
				merged.Credentials = append(merged.Credentials, lc)
			} else {
				report.HasConflicts = true
				report.Conflicts = append(report.Conflicts, core.VaultConflictItem{
					ID:            lc.ID,
					Type:          "credential",
					Label:         lc.Label,
					LocalSummary:  fmt.Sprintf("%s (%s:%s)", lc.Label, lc.Username, lc.Category),
					RemoteSummary: fmt.Sprintf("%s (%s:%s)", rc.Label, rc.Username, rc.Category),
				})
				merged.Credentials = append(merged.Credentials, lc)
			}
		} else {
			merged.Credentials = append(merged.Credentials, lc)
		}
	}
	for _, rc := range remote.Credentials {
		if _, exists := localCreds[rc.ID]; !exists {
			merged.Credentials = append(merged.Credentials, rc)
			report.AutoMerged++
		}
	}

	// 12. Evidence (F-18)
	localEvidence := make(map[string]core.EvidenceItem, len(local.Evidence))
	for _, e := range local.Evidence {
		localEvidence[e.ID] = e
	}
	remoteEvidence := make(map[string]core.EvidenceItem, len(remote.Evidence))
	for _, e := range remote.Evidence {
		remoteEvidence[e.ID] = e
	}

	for _, le := range local.Evidence {
		if re, exists := remoteEvidence[le.ID]; exists {
			if jsonEqual(le, re) {
				merged.Evidence = append(merged.Evidence, le)
			} else {
				report.HasConflicts = true
				report.Conflicts = append(report.Conflicts, core.VaultConflictItem{
					ID:            le.ID,
					Type:          "evidence",
					Label:         le.Title,
					LocalSummary:  fmt.Sprintf("[%s] %s (%s)", le.Category, le.Title, le.Severity),
					RemoteSummary: fmt.Sprintf("[%s] %s (%s)", re.Category, re.Title, re.Severity),
				})
				merged.Evidence = append(merged.Evidence, le)
			}
		} else {
			merged.Evidence = append(merged.Evidence, le)
		}
	}
	for _, re := range remote.Evidence {
		if _, exists := localEvidence[re.ID]; !exists {
			merged.Evidence = append(merged.Evidence, re)
			report.AutoMerged++
		}
	}

	// 13. Findings (F-18 / Pentest Reporting)
	localFindings := make(map[string]core.FindingItem, len(local.Findings))
	for _, f := range local.Findings {
		localFindings[f.ID] = f
	}
	remoteFindings := make(map[string]core.FindingItem, len(remote.Findings))
	for _, f := range remote.Findings {
		remoteFindings[f.ID] = f
	}

	for _, lf := range local.Findings {
		if rf, exists := remoteFindings[lf.ID]; exists {
			if jsonEqual(lf, rf) {
				merged.Findings = append(merged.Findings, lf)
			} else {
				report.HasConflicts = true
				report.Conflicts = append(report.Conflicts, core.VaultConflictItem{
					ID:            lf.ID,
					Type:          "finding",
					Label:         lf.Title,
					LocalSummary:  fmt.Sprintf("[%s] %s (%s)", lf.Category, lf.Title, lf.Severity),
					RemoteSummary: fmt.Sprintf("[%s] %s (%s)", rf.Category, rf.Title, rf.Severity),
				})
				merged.Findings = append(merged.Findings, lf)
			}
		} else {
			merged.Findings = append(merged.Findings, lf)
		}
	}
	for _, rf := range remote.Findings {
		if _, exists := localFindings[rf.ID]; !exists {
			merged.Findings = append(merged.Findings, rf)
			report.AutoMerged++
		}
	}

	return ensureNonNilSlices(merged), report
}

// ResolveVaultConflicts applies user-specified conflict resolutions to the merged payload (F-29).
// For each conflict ID, ResolutionKeepRemote chooses the remote version, ResolutionKeepBoth keeps
// both by renaming the remote item, and ResolutionKeepLocal retains the local version.
func ResolveVaultConflicts(local, remote core.VaultPayload, resolutions map[string]core.VaultConflictResolution) core.VaultPayload {
	resolved, _ := MergeVaultPayloads(local, remote)
	if len(resolutions) == 0 {
		return resolved
	}

	// Index remote items for resolution
	remoteHosts := make(map[string]core.HostRecord, len(remote.Hosts))
	for _, h := range remote.Hosts {
		remoteHosts[h.ID] = h
	}
	remoteGroups := make(map[string]core.GroupRecord, len(remote.Groups))
	for _, g := range remote.Groups {
		remoteGroups[g.ID] = g
	}
	remoteIdentities := make(map[string]core.IdentityRecord, len(remote.Identities))
	for _, id := range remote.Identities {
		remoteIdentities[id.ID] = id
	}
	remoteKeys := make(map[string]core.SshKeyRecord, len(remote.Keys))
	for _, k := range remote.Keys {
		remoteKeys[k.ID] = k
	}
	remoteRules := make(map[string]core.ForwardRule, len(remote.ForwardRules))
	for _, r := range remote.ForwardRules {
		remoteRules[r.ID] = r
	}
	remoteProfiles := make(map[string]core.ProxyProfile, len(remote.ProxyProfiles))
	for _, p := range remote.ProxyProfiles {
		remoteProfiles[p.ID] = p
	}
	remoteSnippets := make(map[string]core.Snippet, len(remote.Snippets))
	for _, s := range remote.Snippets {
		remoteSnippets[s.ID] = s
	}
	remoteNotes := make(map[string]core.NotePage, len(remote.Notes))
	for _, n := range remote.Notes {
		remoteNotes[n.ID] = n
	}
	remoteTotp := make(map[string]core.TotpRecord, len(remote.TotpRecords))
	for _, t := range remote.TotpRecords {
		remoteTotp[t.ID] = t
	}

	// 1. Hosts
	var finalHosts []core.HostRecord
	for _, h := range resolved.Hosts {
		res, hasRes := resolutions[h.ID]
		if !hasRes {
			finalHosts = append(finalHosts, h)
			continue
		}
		switch res {
		case core.ResolutionKeepRemote:
			if rh, ok := remoteHosts[h.ID]; ok {
				finalHosts = append(finalHosts, rh)
			} else {
				finalHosts = append(finalHosts, h)
			}
		case core.ResolutionKeepBoth:
			finalHosts = append(finalHosts, h)
			if rh, ok := remoteHosts[h.ID]; ok {
				cloned := rh
				cloned.ID = fmt.Sprintf("%s-synced", rh.ID)
				cloned.Label = fmt.Sprintf("%s (Synced)", rh.Label)
				finalHosts = append(finalHosts, cloned)
			}
		default: // ResolutionKeepLocal
			finalHosts = append(finalHosts, h)
		}
	}
	resolved.Hosts = finalHosts

	// 2. Groups
	var finalGroups []core.GroupRecord
	for _, g := range resolved.Groups {
		res, hasRes := resolutions[g.ID]
		if !hasRes {
			finalGroups = append(finalGroups, g)
			continue
		}
		switch res {
		case core.ResolutionKeepRemote:
			if rg, ok := remoteGroups[g.ID]; ok {
				finalGroups = append(finalGroups, rg)
			} else {
				finalGroups = append(finalGroups, g)
			}
		case core.ResolutionKeepBoth:
			finalGroups = append(finalGroups, g)
			if rg, ok := remoteGroups[g.ID]; ok {
				cloned := rg
				cloned.ID = fmt.Sprintf("%s-synced", rg.ID)
				cloned.Name = fmt.Sprintf("%s (Synced)", rg.Name)
				finalGroups = append(finalGroups, cloned)
			}
		default:
			finalGroups = append(finalGroups, g)
		}
	}
	resolved.Groups = finalGroups

	// 3. Notes
	var finalNotes []core.NotePage
	for _, n := range resolved.Notes {
		res, hasRes := resolutions[n.ID]
		if !hasRes {
			finalNotes = append(finalNotes, n)
			continue
		}
		switch res {
		case core.ResolutionKeepRemote:
			if rn, ok := remoteNotes[n.ID]; ok {
				finalNotes = append(finalNotes, rn)
			} else {
				finalNotes = append(finalNotes, n)
			}
		case core.ResolutionKeepBoth:
			finalNotes = append(finalNotes, n)
			if rn, ok := remoteNotes[n.ID]; ok {
				cloned := rn
				cloned.ID = fmt.Sprintf("%s-synced", rn.ID)
				cloned.Title = fmt.Sprintf("%s (Synced)", rn.Title)
				finalNotes = append(finalNotes, cloned)
			}
		default:
			finalNotes = append(finalNotes, n)
		}
	}
	resolved.Notes = finalNotes

	// 4. Snippets
	var finalSnippets []core.Snippet
	for _, s := range resolved.Snippets {
		res, hasRes := resolutions[s.ID]
		if !hasRes {
			finalSnippets = append(finalSnippets, s)
			continue
		}
		switch res {
		case core.ResolutionKeepRemote:
			if rs, ok := remoteSnippets[s.ID]; ok {
				finalSnippets = append(finalSnippets, rs)
			} else {
				finalSnippets = append(finalSnippets, s)
			}
		case core.ResolutionKeepBoth:
			finalSnippets = append(finalSnippets, s)
			if rs, ok := remoteSnippets[s.ID]; ok {
				cloned := rs
				cloned.ID = fmt.Sprintf("%s-synced", rs.ID)
				cloned.Name = fmt.Sprintf("%s (Synced)", rs.Name)
				finalSnippets = append(finalSnippets, cloned)
			}
		default:
			finalSnippets = append(finalSnippets, s)
		}
	}
	resolved.Snippets = finalSnippets

	// 5. TOTP Records
	var finalTotp []core.TotpRecord
	for _, t := range resolved.TotpRecords {
		res, hasRes := resolutions[t.ID]
		if !hasRes {
			finalTotp = append(finalTotp, t)
			continue
		}
		switch res {
		case core.ResolutionKeepRemote:
			if rt, ok := remoteTotp[t.ID]; ok {
				finalTotp = append(finalTotp, rt)
			} else {
				finalTotp = append(finalTotp, t)
			}
		case core.ResolutionKeepBoth:
			finalTotp = append(finalTotp, t)
			if rt, ok := remoteTotp[t.ID]; ok {
				cloned := rt
				cloned.ID = fmt.Sprintf("%s-synced", rt.ID)
				cloned.Label = fmt.Sprintf("%s (Synced)", rt.Label)
				finalTotp = append(finalTotp, cloned)
			}
		default:
			finalTotp = append(finalTotp, t)
		}
	}
	resolved.TotpRecords = finalTotp

	// 6. Engagements (F-36)
	remoteEngagements := make(map[string]core.Engagement, len(remote.Engagements))
	for _, e := range remote.Engagements {
		remoteEngagements[e.ID] = e
	}
	var finalEngagements []core.Engagement
	for _, e := range resolved.Engagements {
		res, hasRes := resolutions[e.ID]
		if !hasRes {
			finalEngagements = append(finalEngagements, e)
			continue
		}
		switch res {
		case core.ResolutionKeepRemote:
			if re, ok := remoteEngagements[e.ID]; ok {
				finalEngagements = append(finalEngagements, re)
			} else {
				finalEngagements = append(finalEngagements, e)
			}
		case core.ResolutionKeepBoth:
			finalEngagements = append(finalEngagements, e)
			if re, ok := remoteEngagements[e.ID]; ok {
				cloned := re
				cloned.ID = fmt.Sprintf("%s-synced", re.ID)
				cloned.Name = fmt.Sprintf("%s (Synced)", re.Name)
				finalEngagements = append(finalEngagements, cloned)
			}
		default:
			finalEngagements = append(finalEngagements, e)
		}
	}
	resolved.Engagements = finalEngagements

	// 7. Credentials (F-36)
	remoteCreds := make(map[string]core.CredentialEntry, len(remote.Credentials))
	for _, c := range remote.Credentials {
		remoteCreds[c.ID] = c
	}
	var finalCreds []core.CredentialEntry
	for _, c := range resolved.Credentials {
		res, hasRes := resolutions[c.ID]
		if !hasRes {
			finalCreds = append(finalCreds, c)
			continue
		}
		switch res {
		case core.ResolutionKeepRemote:
			if rc, ok := remoteCreds[c.ID]; ok {
				finalCreds = append(finalCreds, rc)
			} else {
				finalCreds = append(finalCreds, c)
			}
		case core.ResolutionKeepBoth:
			finalCreds = append(finalCreds, c)
			if rc, ok := remoteCreds[c.ID]; ok {
				cloned := rc
				cloned.ID = fmt.Sprintf("%s-synced", rc.ID)
				cloned.Label = fmt.Sprintf("%s (Synced)", rc.Label)
				finalCreds = append(finalCreds, cloned)
			}
		default:
			finalCreds = append(finalCreds, c)
		}
	}
	resolved.Credentials = finalCreds

	// 8. Evidence (F-18)
	remoteEvidence := make(map[string]core.EvidenceItem, len(remote.Evidence))
	for _, e := range remote.Evidence {
		remoteEvidence[e.ID] = e
	}
	var finalEvidence []core.EvidenceItem
	for _, e := range resolved.Evidence {
		res, hasRes := resolutions[e.ID]
		if !hasRes {
			finalEvidence = append(finalEvidence, e)
			continue
		}
		switch res {
		case core.ResolutionKeepRemote:
			if re, ok := remoteEvidence[e.ID]; ok {
				finalEvidence = append(finalEvidence, re)
			} else {
				finalEvidence = append(finalEvidence, e)
			}
		case core.ResolutionKeepBoth:
			finalEvidence = append(finalEvidence, e)
			if re, ok := remoteEvidence[e.ID]; ok {
				cloned := re
				cloned.ID = fmt.Sprintf("%s-synced", re.ID)
				cloned.Title = fmt.Sprintf("%s (Synced)", re.Title)
				finalEvidence = append(finalEvidence, cloned)
			}
		default:
			finalEvidence = append(finalEvidence, e)
		}
	}
	resolved.Evidence = finalEvidence

	// 9. Findings (F-18 / Pentest Reporting)
	remoteFindings := make(map[string]core.FindingItem, len(remote.Findings))
	for _, f := range remote.Findings {
		remoteFindings[f.ID] = f
	}
	var finalFindings []core.FindingItem
	for _, f := range resolved.Findings {
		res, hasRes := resolutions[f.ID]
		if !hasRes {
			finalFindings = append(finalFindings, f)
			continue
		}
		switch res {
		case core.ResolutionKeepRemote:
			if rf, ok := remoteFindings[f.ID]; ok {
				finalFindings = append(finalFindings, rf)
			} else {
				finalFindings = append(finalFindings, f)
			}
		case core.ResolutionKeepBoth:
			finalFindings = append(finalFindings, f)
			if rf, ok := remoteFindings[f.ID]; ok {
				cloned := rf
				cloned.ID = fmt.Sprintf("%s-synced", rf.ID)
				cloned.Title = fmt.Sprintf("%s (Synced)", rf.Title)
				finalFindings = append(finalFindings, cloned)
			}
		default:
			finalFindings = append(finalFindings, f)
		}
	}
	resolved.Findings = finalFindings

	return ensureNonNilSlices(resolved)
}
