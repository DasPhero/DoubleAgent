package core_test

import (
	"go/parser"
	"go/token"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"doubleagent/backend/core"
)

func TestM0_0_AppStatusDefaults(t *testing.T) {
	status := core.AppStatus{
		Name:      "DoubleAgent",
		Version:   "0.1.0",
		Milestone: "M0-0",
		VaultLock: true,
	}

	if status.Name != "DoubleAgent" {
		t.Fatalf("expected Name DoubleAgent, got %q", status.Name)
	}
	if !status.VaultLock {
		t.Fatal("expected vault to start locked by default (F-03)")
	}
}

// TestM0_0_CoreBoundaryNoForbiddenImports enforces Golden Rule 4:
// backend/core must never import ssh, pty, or crypto packages directly.
func TestM0_0_CoreBoundaryNoForbiddenImports(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("failed to resolve caller path")
	}
	coreDir := filepath.Dir(currentFile)

	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, coreDir, nil, parser.ImportsOnly)
	if err != nil {
		t.Fatalf("failed to parse backend/core: %v", err)
	}

	forbiddenPrefixes := []string{
		"golang.org/x/crypto",
		"crypto/",
		"github.com/pkg/sftp",
		"github.com/creack/pty",
	}

	for _, pkg := range pkgs {
		for fileName, fileAst := range pkg.Files {
			for _, imp := range fileAst.Imports {
				impPath := strings.Trim(imp.Path.Value, `"`)
				for _, prefix := range forbiddenPrefixes {
					if strings.HasPrefix(impPath, prefix) {
						t.Errorf("file %s imports forbidden package %q in backend/core", fileName, impPath)
					}
				}
			}
		}
	}
}
