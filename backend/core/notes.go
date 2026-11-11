package core

import (
	"strings"
	"time"
)

// BuildNoteSummary creates a NotePageSummary from a NotePage with a preview snippet (F-17).
func BuildNoteSummary(note NotePage) NotePageSummary {
	snippet := cleanSnippet(note.Body, 120)
	return NotePageSummary{
		ID:           note.ID,
		HostID:       note.HostID,
		EngagementID: note.EngagementID,
		ParentID:     note.ParentID,
		IsFolder:  note.IsFolder,
		Title:     note.Title,
		Type:      note.Type,
		Order:     note.Order,
		Snippet:   snippet,
		CreatedAt: note.CreatedAt,
		UpdatedAt: note.UpdatedAt,
	}
}

// cleanSnippet extracts the first non-empty lines up to maxLen characters without Markdown formatting headers.
func cleanSnippet(body string, maxLen int) string {
	if body == "" {
		return ""
	}
	lines := strings.Split(body, "\n")
	var parts []string
	for _, l := range lines {
		trimmed := strings.TrimSpace(l)
		if trimmed == "" {
			continue
		}
		// Strip markdown heading hashes
		trimmed = strings.TrimLeft(trimmed, "#*-_`~> ")
		if trimmed != "" {
			parts = append(parts, trimmed)
		}
		if len(strings.Join(parts, " ")) >= maxLen {
			break
		}
	}
	joined := strings.Join(parts, " ")
	if len(joined) > maxLen {
		return joined[:maxLen] + "..."
	}
	return joined
}

// FilterNotesByHost filters notes matching a specific hostID (or empty hostID for global notes).
func FilterNotesByHost(notes []NotePage, hostID string) []NotePage {
	var result []NotePage
	for _, n := range notes {
		if n.HostID == hostID {
			result = append(result, n)
		}
	}
	return result
}

// FilterNoteSummariesByHost filters note summaries matching a specific hostID.
func FilterNoteSummariesByHost(notes []NotePageSummary, hostID string) []NotePageSummary {
	var result []NotePageSummary
	for _, n := range notes {
		if n.HostID == hostID {
			result = append(result, n)
		}
	}
	return result
}

// SearchNotes performs case-insensitive full-text search over note titles and bodies (F-17, F-02).
func SearchNotes(notes []NotePage, query string) []NoteSearchResult {
	q := strings.TrimSpace(strings.ToLower(query))
	if q == "" {
		return nil
	}

	var results []NoteSearchResult
	for _, n := range notes {
		titleLower := strings.ToLower(n.Title)
		bodyLower := strings.ToLower(n.Body)

		titleMatches := strings.Count(titleLower, q)
		bodyMatches := strings.Count(bodyLower, q)
		totalMatches := titleMatches + bodyMatches

		if totalMatches > 0 {
			var matchSnippet string
			if idx := strings.Index(bodyLower, q); idx != -1 {
				start := idx - 40
				if start < 0 {
					start = 0
				}
				end := idx + len(q) + 60
				if end > len(n.Body) {
					end = len(n.Body)
				}
				matchSnippet = "..." + strings.TrimSpace(n.Body[start:end]) + "..."
			} else {
				matchSnippet = cleanSnippet(n.Body, 100)
			}

			results = append(results, NoteSearchResult{
				Note:         BuildNoteSummary(n),
				MatchSnippet: matchSnippet,
				MatchCount:   totalMatches,
			})
		}
	}
	return results
}

// NewNotePage constructs a initialized NotePage with timestamps (F-17).
func NewNotePage(id, hostID, parentID, title, noteType, body string, isFolder bool, order int) NotePage {
	now := time.Now().UTC()
	if noteType == "" {
		noteType = "markdown"
	}
	return NotePage{
		ID:        id,
		HostID:    hostID,
		ParentID:  parentID,
		IsFolder:  isFolder,
		Title:     title,
		Type:      noteType,
		Body:      body,
		Order:     order,
		CreatedAt: now,
		UpdatedAt: now,
	}
}

