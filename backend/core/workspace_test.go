package core

import (
	"testing"
)

func TestM1_4_ReorderTabsAndKeyboardCycle_F08(t *testing.T) {
	tabs := []TabItem{
		{ID: "t1", Title: "web-01"},
		{ID: "t2", Title: "db-01"},
		{ID: "t3", Title: "cache-01"},
	}

	// Drag tab 0 ("web-01") to index 2 (after "cache-01")
	reordered := ReorderTabs(tabs, 0, 2)
	if reordered[0].ID != "t2" || reordered[1].ID != "t3" || reordered[2].ID != "t1" {
		t.Fatalf("unexpected tab order after moving 0->2: %+v", reordered)
	}

	// Drag tab 2 ("t1") back to index 0
	restored := ReorderTabs(reordered, 2, 0)
	if restored[0].ID != "t1" || restored[1].ID != "t2" || restored[2].ID != "t3" {
		t.Fatalf("unexpected tab order after moving 2->0: %+v", restored)
	}

	// Keyboard focus cycle forward & backward with wraparound
	if got := CycleIndex(0, 3, -1); got != 2 {
		t.Fatalf("CycleIndex(0, 3, -1) = %d, want 2", got)
	}
	if got := CycleIndex(2, 3, 1); got != 0 {
		t.Fatalf("CycleIndex(2, 3, 1) = %d, want 0", got)
	}
}

func TestM1_4_MixedNestedSplitPanesAndRemoval_F08(t *testing.T) {
	// Start with a single leaf pane
	root := &WorkspaceNode{
		Type:      NodeTypePane,
		ID:        "pane-1",
		SessionID: "sess-1",
		Title:     "web-01",
	}

	// 1. Split horizontally: pane-1 on the left, pane-2 on the right
	pane2 := &WorkspaceNode{Type: NodeTypePane, ID: "pane-2", SessionID: "sess-2", Title: "web-02"}
	root = SplitPaneInTree(root, "pane-1", pane2, SplitHorizontal)
	if root.Type != NodeTypeSplit || root.Direction != SplitHorizontal || len(root.Children) != 2 {
		t.Fatalf("expected horizontal split with 2 children, got: %+v", root)
	}

	// 2. While in pane-1 (left), split vertically with pane-3
	// Result: left half has pane-1 (top) and pane-3 (bottom); right half has pane-2 (full height)
	pane3 := &WorkspaceNode{Type: NodeTypePane, ID: "pane-3", SessionID: "sess-3", Title: "db-01"}
	root = SplitPaneInTree(root, "pane-1", pane3, SplitVertical)

	panes := CollectPanes(root)
	if len(panes) != 3 {
		t.Fatalf("expected 3 leaf panes in tree, got %d", len(panes))
	}
	if panes[0].ID != "pane-1" || panes[1].ID != "pane-3" || panes[2].ID != "pane-2" {
		t.Fatalf("unexpected leaf pane order: %+v", panes)
	}

	// Verify nested tree structure: root is horizontal, child 0 is vertical with [pane-1, pane-3]
	leftSplit := root.Children[0]
	if leftSplit.Type != NodeTypeSplit || leftSplit.Direction != SplitVertical || len(leftSplit.Children) != 2 {
		t.Fatalf("expected left child to be a vertical split with 2 panes, got: %+v", leftSplit)
	}
	if root.Children[1].ID != "pane-2" {
		t.Fatalf("expected right child to be pane-2, got: %+v", root.Children[1])
	}

	// 3. Close pane-3: the vertical split collapses back into just pane-1
	root = RemovePaneFromTree(root, "pane-3")
	if len(root.Children) != 2 || root.Children[0].ID != "pane-1" || root.Children[1].ID != "pane-2" {
		t.Fatalf("expected collapsed horizontal split with pane-1 and pane-2, got: %+v", root)
	}

	// 4. Close pane-2: the horizontal split collapses back into root being a single leaf pane (pane-1)
	root = RemovePaneFromTree(root, "pane-2")
	if root.Type != NodeTypePane || root.ID != "pane-1" {
		t.Fatalf("expected root to collapse into single leaf pane-1, got: %+v", root)
	}

	// 5. Close pane-1: root becomes nil
	root = RemovePaneFromTree(root, "pane-1")
	if root != nil {
		t.Fatalf("expected nil root after removing last pane, got: %+v", root)
	}
}

