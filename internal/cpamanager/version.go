package cpamanager

import (
	"regexp"
	"strconv"
	"strings"
)

var versionLinePattern = regexp.MustCompile(`CLIProxyAPI Version:\s*v?([0-9]+\.[0-9]+\.[0-9]+)`)
var stableVersionPattern = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)$`)

func ParseVersionOutput(output string) string {
	matches := versionLinePattern.FindStringSubmatch(output)
	if matches == nil {
		return ""
	}
	return "v" + matches[1]
}

func CompareVersions(left, right string) (int, bool) {
	leftParts, ok := parseStableVersion(left)
	if !ok {
		return 0, false
	}
	rightParts, ok := parseStableVersion(right)
	if !ok {
		return 0, false
	}
	for i := range leftParts {
		if leftParts[i] < rightParts[i] {
			return -1, true
		}
		if leftParts[i] > rightParts[i] {
			return 1, true
		}
	}
	return 0, true
}

func parseStableVersion(value string) ([3]int, bool) {
	matches := stableVersionPattern.FindStringSubmatch(strings.TrimSpace(value))
	if matches == nil {
		return [3]int{}, false
	}
	var parts [3]int
	for i := range parts {
		parsed, err := strconv.Atoi(matches[i+1])
		if err != nil {
			return [3]int{}, false
		}
		parts[i] = parsed
	}
	return parts, true
}
