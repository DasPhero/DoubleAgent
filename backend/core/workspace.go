package core

import "time"

// SplitDirection specifies how panes within a tab are arranged (F-08).
type SplitDirection string

const (
	SplitNone       SplitDirection = "none"
	SplitHorizontal SplitDirection = "horizontal" // Side-by-side columns (row)
	SplitVertical   SplitDirection = "vertical"   // Stacked rows (column)
)

// WorkspaceNodeType defines whether a node is a leaf terminal pane or an internal split container.
type WorkspaceNodeType string

const (
	NodeTypePane  WorkspaceNodeType = "pane"
	NodeTypeSplit WorkspaceNodeType = "split"
)

// WorkspaceNode represents either a single leaf terminal pane or a nested split container (F-08, F-27).
type WorkspaceNode struct {
	Type          WorkspaceNodeType `json:"type"`
	ID            string            `json:"id"`
	SessionID     string            `json:"sessionId,omitempty"`
	HostID        string            `json:"hostId,omitempty"`
	Title         string            `json:"title,omitempty"`
	Cwd           string            `json:"cwd,omitempty"`
	PaneType      string            `json:"paneType,omitempty"`
	NotesHostID   string            `json:"notesHostId,omitempty"`
	SftpSessionID string            `json:"sftpSessionId,omitempty"`
	Direction     SplitDirection    `json:"direction,omitempty"`
	Children      []*WorkspaceNode  `json:"children,omitempty"`
	Ratios        []float64         `json:"ratios,omitempty"`
}

// PaneItem represents a single terminal pane inside a tab (F-08, F-27).
type PaneItem struct {
	ID            string `json:"id"`
	SessionID     string `json:"sessionId"`
	HostID        string `json:"hostId,omitempty"`
	Title         string `json:"title"`
	Cwd           string `json:"cwd,omitempty"`
	PaneType      string `json:"paneType,omitempty"`
	NotesHostID   string `json:"notesHostId,omitempty"`
	SftpSessionID string `json:"sftpSessionId,omitempty"`
}

// TabItem represents an open terminal tab containing an arbitrary nested split tree of panes (F-08, F-27).
type TabItem struct {
	ID           string         `json:"id"`
	Title        string         `json:"title"`
	HostID       string         `json:"hostId,omitempty"`
	Color        string         `json:"color,omitempty"`
	SplitDir     SplitDirection `json:"splitDir,omitempty"`
	Panes        []PaneItem     `json:"panes,omitempty"`
	RootNode     *WorkspaceNode `json:"rootNode,omitempty"`
	ActivePaneID string         `json:"activePaneId"`
	TabType      string         `json:"tabType,omitempty"`
	NotesHostID  string         `json:"notesHostId,omitempty"`
}

// WorkspaceState represents the serialized workspace layout persisted in workspace.json (F-27).
type WorkspaceState struct {
	Version     int       `json:"version"`
	ActiveTabID string    `json:"activeTabId"`
	Tabs        []TabItem `json:"tabs"`
	AutoRestore bool      `json:"autoRestore"`
	SavedAt     time.Time `json:"savedAt"`
}

// SplitPaneInTree splits targetPaneID inside root by adding newPane in direction dir.
// If root or a child split already shares the same direction, newPane is appended as a sibling;
// otherwise, the target pane is replaced by a new split container holding both panes.
func SplitPaneInTree(root *WorkspaceNode, targetPaneID string, newPane *WorkspaceNode, dir SplitDirection) *WorkspaceNode {
	if root == nil || newPane == nil {
		return root
	}
	if root.Type == NodeTypePane {
		if root.ID == targetPaneID {
			return &WorkspaceNode{
				Type:      NodeTypeSplit,
				ID:        "split-" + newPane.ID,
				Direction: dir,
				Children:  []*WorkspaceNode{root, newPane},
			}
		}
		return root
	}

	// Internal split container: inspect direct children first
	var newChildren []*WorkspaceNode
	for _, child := range root.Children {
		if child.Type == NodeTypePane && child.ID == targetPaneID {
			if root.Direction == dir {
				newChildren = append(newChildren, child, newPane)
			} else {
				newChildren = append(newChildren, &WorkspaceNode{
					Type:      NodeTypeSplit,
					ID:        "split-" + newPane.ID,
					Direction: dir,
					Children:  []*WorkspaceNode{child, newPane},
				})
			}
		} else {
			newChildren = append(newChildren, SplitPaneInTree(child, targetPaneID, newPane, dir))
		}
	}
	root.Children = newChildren
	return root
}

// RemovePaneFromTree removes targetPaneID from the tree.
// If an internal split is left with only 1 child, it collapses into that child.
// If no panes remain, nil is returned.
func RemovePaneFromTree(root *WorkspaceNode, targetPaneID string) *WorkspaceNode {
	if root == nil {
		return nil
	}
	if root.Type == NodeTypePane {
		if root.ID == targetPaneID {
			return nil
		}
		return root
	}

	var remaining []*WorkspaceNode
	for _, child := range root.Children {
		updated := RemovePaneFromTree(child, targetPaneID)
		if updated != nil {
			remaining = append(remaining, updated)
		}
	}

	if len(remaining) == 0 {
		return nil
	}
	if len(remaining) == 1 {
		return remaining[0]
	}
	root.Children = remaining
	return root
}

// CollectPanes traverses a workspace tree and returns all leaf panes in visual order.
func CollectPanes(root *WorkspaceNode) []PaneItem {
	if root == nil {
		return nil
	}
	if root.Type == NodeTypePane {
		return []PaneItem{{
			ID:            root.ID,
			SessionID:     root.SessionID,
			HostID:        root.HostID,
			Title:         root.Title,
			Cwd:           root.Cwd,
			PaneType:      root.PaneType,
			NotesHostID:   root.NotesHostID,
			SftpSessionID: root.SftpSessionID,
		}}
	}
	var out []PaneItem
	for _, child := range root.Children {
		out = append(out, CollectPanes(child)...)
	}
	return out
}

// FindPane searches the tree for a specific pane by ID.
func FindPane(root *WorkspaceNode, paneID string) *PaneItem {
	if root == nil {
		return nil
	}
	if root.Type == NodeTypePane && root.ID == paneID {
		return &PaneItem{
			ID:            root.ID,
			SessionID:     root.SessionID,
			HostID:        root.HostID,
			Title:         root.Title,
			Cwd:           root.Cwd,
			PaneType:      root.PaneType,
			NotesHostID:   root.NotesHostID,
			SftpSessionID: root.SftpSessionID,
		}
	}
	for _, child := range root.Children {
		if found := FindPane(child, paneID); found != nil {
			return found
		}
	}
	return nil
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

// HostTabGroup aggregates open tabs that belong to the same host (F-09).
type HostTabGroup struct {
	HostID    string    `json:"hostId"`
	HostLabel string    `json:"hostLabel"`
	Color     string    `json:"color"`
	Tabs      []TabItem `json:"tabs"`
}

// GroupTabsByHost partitions a slice of TabItem into HostTabGroup clusters (F-09).
// Tabs sharing the same HostID (or Title if HostID is empty) are clustered together.
func GroupTabsByHost(tabs []TabItem) []HostTabGroup {
	if len(tabs) == 0 {
		return []HostTabGroup{}
	}
	groupMap := make(map[string]int)
	var groups []HostTabGroup

	for _, tab := range tabs {
		key := tab.HostID
		if key == "" {
			key = tab.Title
		}
		idx, exists := groupMap[key]
		if !exists {
			groupMap[key] = len(groups)
			groups = append(groups, HostTabGroup{
				HostID:    key,
				HostLabel: tab.Title,
				Color:     tab.Color,
				Tabs:      []TabItem{tab},
			})
		} else {
			groups[idx].Tabs = append(groups[idx].Tabs, tab)
		}
	}
	return groups
}


