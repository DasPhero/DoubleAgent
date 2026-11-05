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
