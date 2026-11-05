package core

// SplitDirection specifies how panes within a tab are arranged (F-08).
type SplitDirection string

const (
	SplitNone       SplitDirection = "none"
	SplitHorizontal SplitDirection = "horizontal" // Side-by-side columns
	SplitVertical   SplitDirection = "vertical"   // Stacked rows
)

// PaneItem represents a single terminal pane inside a tab (F-08).
type PaneItem struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId"`
	HostID    string `json:"hostId,omitempty"`
	Title     string `json:"title"`
}

// TabItem represents an open terminal tab containing one or more split panes (F-08, Spec Section 8).
type TabItem struct {
	ID           string         `json:"id"`
	Title        string         `json:"title"`
	HostID       string         `json:"hostId,omitempty"`
	Color        string         `json:"color,omitempty"`
	SplitDir     SplitDirection `json:"splitDir"`
	Panes        []PaneItem     `json:"panes"`
	ActivePaneID string         `json:"activePaneId"`
}

// ReorderTabs moves a tab from fromIndex to toIndex (used for drag-and-drop tab reordering per F-08).
func ReorderTabs(tabs []TabItem, fromIndex, toIndex int) []TabItem {
	n := len(tabs)
	out := make([]TabItem, n)
	copy(out, tabs)
	if n <= 1 || fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n || fromIndex == toIndex {
		return out
	}
	moved := out[fromIndex]
	without := append(out[:fromIndex], out[fromIndex+1:]...)
	result := make([]TabItem, 0, n)
	result = append(result, without[:toIndex]...)
	result = append(result, moved)
	result = append(result, without[toIndex:]...)
	return result
}

// CycleIndex computes the next wrapped index when navigating tabs or split panes via keyboard shortcuts (F-08).
func CycleIndex(current, count, delta int) int {
	if count <= 0 {
		return 0
	}
	next := (current + delta) % count
	if next < 0 {
		next += count
	}
	return next
}
