package core_test

import (
	"testing"
	"time"

	"doubleagent/backend/core"
)

func TestNotes_BuildSummaryAndFilter_F17(t *testing.T) {
	now := time.Now().UTC()
	notes := []core.NotePage{
		{
			ID:        "note-1",
			HostID:    "host-prod",
			ParentID:  "",
			IsFolder:  false,
			Title:     "Production Architecture",
			Type:      "markdown",
			Body:      "# Production Deployment\n\nNginx reverse proxy in front of Go services.\nDatabase: PostgreSQL 16 on port 5432.",
			Order:     1,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:        "folder-1",
			HostID:    "host-prod",
			ParentID:  "",
			IsFolder:  true,
			Title:     "Runbooks",
			Type:      "markdown",
			Body:      "",
			Order:     0,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:        "note-2",
			HostID:    "host-stage",
			ParentID:  "",
			IsFolder:  false,
			Title:     "Staging Credentials & Endpoints",
			Type:      "markdown",
			Body:      "Internal testing endpoints for staging cluster.",
			Order:     1,
			CreatedAt: now,
			UpdatedAt: now,
		},
	}

	// 1. Test FilterNotesByHost
	prodNotes := core.FilterNotesByHost(notes, "host-prod")
	if len(prodNotes) != 2 {
		t.Fatalf("expected 2 prod notes, got %d", len(prodNotes))
	}

	stageNotes := core.FilterNotesByHost(notes, "host-stage")
	if len(stageNotes) != 1 {
		t.Fatalf("expected 1 stage note, got %d", len(stageNotes))
	}

	// 2. Test BuildNoteSummary
	sum := core.BuildNoteSummary(notes[0])
	if sum.ID != "note-1" || sum.Title != "Production Architecture" {
		t.Errorf("unexpected summary fields: %+v", sum)
	}
	if sum.Snippet == "" {
		t.Errorf("expected non-empty snippet, got empty")
	}
}

func TestNotes_SearchNotes_F17(t *testing.T) {
	notes := []core.NotePage{
		{
			ID:       "note-1",
			HostID:   "host-prod",
			Title:    "Nginx Configuration & SSL",
			Type:     "markdown",
			Body:     "SSL certificates renewed via Let's Encrypt certbot. Main conf is at /etc/nginx/nginx.conf.",
			IsFolder: false,
		},
		{
			ID:       "note-2",
			HostID:   "host-db",
			Title:    "PostgreSQL Backups",
			Type:     "markdown",
			Body:     "Nightly pg_dump runs at 02:00 UTC and archives to S3 bucket.",
			IsFolder: false,
		},
	}

	// Case-insensitive search in title or body
	res := core.SearchNotes(notes, "nginx")
	if len(res) != 1 {
		t.Fatalf("expected 1 match for 'nginx', got %d", len(res))
	}
	if res[0].Note.ID != "note-1" {
		t.Errorf("expected note-1, got %s", res[0].Note.ID)
	}

	resS3 := core.SearchNotes(notes, "s3")
	if len(resS3) != 1 || resS3[0].Note.ID != "note-2" {
		t.Fatalf("expected 1 match for 's3' on note-2, got %+v", resS3)
	}

	// Search non-existent
	resNone := core.SearchNotes(notes, "nonexistentquery123")
	if len(resNone) != 0 {
		t.Fatalf("expected 0 matches, got %d", len(resNone))
	}
}

