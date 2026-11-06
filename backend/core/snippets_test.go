package core_test

import (
	"errors"
	"strings"
	"testing"

	"doubleagent/backend/core"
)

func TestSnippet_ExtractVariables_F15(t *testing.T) {
	body := `ping -c {{COUNT=4:Number of packets}} {{HOST}}
tail -n {{LINES=50}} {{FILE:/var/log/syslog}}
curl -u {{USER}}:{{PASSWORD}} http://{{IP}}:{{PORT=8080}}/api
deploy --secret={{SECRET:prod-key}} --env={{ENV=production}}
`
	vars := core.ExtractSnippetVariables(body)
	if len(vars) != 10 {
		t.Fatalf("expected 10 variables, got %d", len(vars))
	}

	varMap := make(map[string]core.SnippetVariable)
	for _, v := range vars {
		varMap[strings.ToUpper(v.Name)] = v
	}

	// Verify COUNT
	countVar, ok := varMap["COUNT"]
	if !ok {
		t.Fatal("missing COUNT variable")
	}
	if countVar.DefaultValue != "4" {
		t.Errorf("expected COUNT default '4', got '%s'", countVar.DefaultValue)
	}
	if countVar.Description != "Number of packets" {
		t.Errorf("expected description 'Number of packets', got '%s'", countVar.Description)
	}

	// Verify HOST (built-in description)
	hostVar, ok := varMap["HOST"]
	if !ok {
		t.Fatal("missing HOST variable")
	}
	if !core.IsBuiltinSnippetVariable(hostVar.Name) {
		t.Error("HOST should be marked as builtin")
	}
	if !strings.Contains(hostVar.Description, "Target IP") {
		t.Errorf("unexpected HOST description: %s", hostVar.Description)
	}

	// Verify SECRET:prod-key
	secVar, ok := varMap["SECRET:PROD-KEY"]
	if !ok {
		t.Fatal("missing SECRET:prod-key variable")
	}
	if secVar.SecretRef != "prod-key" {
		t.Errorf("expected SecretRef 'prod-key', got '%s'", secVar.SecretRef)
	}
}

func TestSnippet_ResolveSnippet_F15(t *testing.T) {
	ctx := core.SnippetContext{
		HostID:     "host-1",
		HostLabel:  "web-server-01",
		Address:    "10.0.0.50",
		IP:         "10.0.0.50",
		Hostname:   "web-server-01.internal",
		Port:       2222,
		Username:   "admin",
		WorkingDir: "/var/www/html",
		Timestamp:  "2026-11-06 18:00:00",
		Date:       "2026-11-06",
		Time:       "18:00:00",
	}

	secretMock := func(ref string) (string, error) {
		if ref == "session_password" {
			return "VaultP@ssword123", nil
		}
		if ref == "api-token" {
			return "tok_sec_9999", nil
		}
		return "", errors.New("unknown secret")
	}

	t.Run("resolves context builtins", func(t *testing.T) {
		tmpl := "ssh {{USER}}@{{HOST}}:{{PORT}} -d {{CWD}} at {{TIMESTAMP}}"
		resolved, err := core.ResolveSnippet(tmpl, ctx, nil, secretMock)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		expected := "ssh admin@10.0.0.50:2222 -d /var/www/html at 2026-11-06 18:00:00"
		if resolved != expected {
			t.Errorf("got %q, want %q", resolved, expected)
		}
	})

	t.Run("resolves user parameters with overrides and defaults", func(t *testing.T) {
		tmpl := "docker run -p {{HOST_PORT=80}}:{{CONTAINER_PORT=80}} --name {{NAME}} {{IMAGE=nginx:alpine}}"
		userVals := map[string]string{
			"NAME":      "my-web",
			"HOST_PORT": "8080",
		}
		resolved, err := core.ResolveSnippet(tmpl, ctx, userVals, secretMock)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		expected := "docker run -p 8080:80 --name my-web nginx:alpine"
		if resolved != expected {
			t.Errorf("got %q, want %q", resolved, expected)
		}
	})

	t.Run("resolves password and secret references", func(t *testing.T) {
		tmpl := "curl -u {{USER}}:{{PASSWORD}} -H 'Authorization: Bearer {{SECRET:api-token}}' http://{{HOST}}/api"
		resolved, err := core.ResolveSnippet(tmpl, ctx, nil, secretMock)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		expected := "curl -u admin:VaultP@ssword123 -H 'Authorization: Bearer tok_sec_9999' http://10.0.0.50/api"
		if resolved != expected {
			t.Errorf("got %q, want %q", resolved, expected)
		}
	})

	t.Run("fails on missing mandatory variable", func(t *testing.T) {
		tmpl := "iptables -A INPUT -s {{MANDATORY_IP}} -j DROP"
		_, err := core.ResolveSnippet(tmpl, ctx, nil, secretMock)
		if err == nil {
			t.Fatal("expected error on missing mandatory variable, got nil")
		}
		if !strings.Contains(err.Error(), "MANDATORY_IP") {
			t.Errorf("error should mention MANDATORY_IP, got %v", err)
		}
	})

	t.Run("supports multi-line commands", func(t *testing.T) {
		tmpl := `echo "Starting backup for {{HOST}} on {{DATE}}"
tar -czf {{BACKUP_FILE=backup.tar.gz}} {{CWD}}
echo "Done"
`
		resolved, err := core.ResolveSnippet(tmpl, ctx, nil, secretMock)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(resolved, "Starting backup for 10.0.0.50 on 2026-11-06") {
			t.Errorf("resolved text mismatch: %s", resolved)
		}
		if !strings.Contains(resolved, "tar -czf backup.tar.gz /var/www/html") {
			t.Errorf("resolved text mismatch: %s", resolved)
		}
	})
}
