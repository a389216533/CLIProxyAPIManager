package cpamanager

import "testing"

func TestParseVersionOutput(t *testing.T) {
	output := "CLIProxyAPI Version: 7.2.45, Commit: c22795af, BuiltAt: 2026-06-28T22:50:38Z\n"
	if got := ParseVersionOutput(output); got != "v7.2.45" {
		t.Fatalf("expected v7.2.45, got %q", got)
	}
	if got := ParseVersionOutput("no version here"); got != "" {
		t.Fatalf("expected empty version, got %q", got)
	}
}

func TestCompareVersions(t *testing.T) {
	if got, ok := CompareVersions("v7.2.45", "v7.2.47"); !ok || got >= 0 {
		t.Fatalf("expected v7.2.45 < v7.2.47, got %d ok=%v", got, ok)
	}
	if got, ok := CompareVersions("7.2.47", "v7.2.47"); !ok || got != 0 {
		t.Fatalf("expected equal versions, got %d ok=%v", got, ok)
	}
	if _, ok := CompareVersions("dev", "v7.2.47"); ok {
		t.Fatal("expected dev version to be incomparable")
	}
}
