package service

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const maxAuthFileImportContentBytes = 1024 * 1024

var authFileImportFileTokenRe = regexp.MustCompile(`[^a-z0-9]+`)

type authFileImport struct {
	Name    string
	Payload map[string]any
}

func buildAuthFileImportsFromTokenContent(content string) ([]authFileImport, error) {
	return buildAuthFileImportsFromTokenContentAt(content, time.Now().UTC())
}

func buildAuthFileImportsFromTokenContentAt(content string, now time.Time) ([]authFileImport, error) {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return nil, fmt.Errorf("%w: import content is required", ErrAuthFilesManagementValidation)
	}
	if len([]byte(trimmed)) > maxAuthFileImportContentBytes {
		return nil, fmt.Errorf("%w: import content is too large", ErrAuthFilesManagementValidation)
	}

	records, err := parseAuthFileImportRecords(trimmed)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, fmt.Errorf("%w: no ChatGPT session token found", ErrAuthFilesManagementValidation)
	}

	files := make([]authFileImport, 0, len(records))
	usedNames := make(map[string]int, len(records))
	for _, record := range records {
		payload, nameSeed, err := convertAuthFileImportRecord(record, now)
		if err != nil {
			return nil, err
		}
		name := uniqueAuthFileImportName(nameSeed, now, usedNames)
		files = append(files, authFileImport{Name: name, Payload: payload})
	}
	return files, nil
}

func parseAuthFileImportRecords(content string) ([]map[string]any, error) {
	var parsed any
	decoder := json.NewDecoder(strings.NewReader(content))
	decoder.UseNumber()
	if err := decoder.Decode(&parsed); err != nil {
		if looksLikeJWT(content) {
			return []map[string]any{{"accessToken": content}}, nil
		}
		return nil, fmt.Errorf("%w: JSON parse failed", ErrAuthFilesManagementValidation)
	}
	if token, ok := parsed.(string); ok && looksLikeJWT(token) {
		return []map[string]any{{"accessToken": token}}, nil
	}
	return collectAuthFileImportRecords(parsed), nil
}

func collectAuthFileImportRecords(value any) []map[string]any {
	records := make([]map[string]any, 0)
	var visit func(any)
	visit = func(item any) {
		switch typed := item.(type) {
		case map[string]any:
			if firstAuthFileImportString(typed, authFileImportAccessTokenPaths()...) != "" {
				records = append(records, typed)
				return
			}
			for key, child := range typed {
				switch key {
				case "accessToken", "access_token", "sessionToken", "session_token":
					continue
				default:
					visit(child)
				}
			}
		case []any:
			for _, child := range typed {
				visit(child)
			}
		}
	}
	visit(value)
	return records
}

func convertAuthFileImportRecord(record map[string]any, now time.Time) (map[string]any, string, error) {
	accessToken := firstAuthFileImportString(record, authFileImportAccessTokenPaths()...)
	if accessToken == "" {
		return nil, "", fmt.Errorf("%w: accessToken is required", ErrAuthFilesManagementValidation)
	}
	sessionToken := firstAuthFileImportString(record, authFileImportSessionTokenPaths()...)
	refreshToken := firstAuthFileImportString(record, authFileImportRefreshTokenPaths()...)
	inputIDToken := firstAuthFileImportString(record, authFileImportIDTokenPaths()...)

	accessPayload := parseAuthFileJWTObject(accessToken)
	idPayload := parseAuthFileJWTObject(inputIDToken)
	auth := objectAt(accessPayload, "https://api.openai.com/auth")
	idAuth := objectAt(idPayload, "https://api.openai.com/auth")
	profile := objectAt(accessPayload, "https://api.openai.com/profile")

	expiresAt := ""
	if refreshToken == "" {
		expiresAt = firstNonEmptyString(
			timestampFromUnixSeconds(valueAt(accessPayload, "exp")),
			normalizedImportTimestamp(valueAt(record, "expires")),
			normalizedImportTimestamp(valueAt(record, "expiresAt")),
			normalizedImportTimestamp(valueAt(record, "expired")),
			normalizedImportTimestamp(valueAt(record, "expires_at")),
		)
	}
	email := firstNonEmptyString(
		stringAt(record, "user", "email"),
		stringAt(record, "email"),
		stringAt(record, "meta", "label"),
		stringAt(record, "label"),
		stringAt(record, "credentials", "email"),
		stringAt(record, "providerSpecificData", "email"),
		stringAt(profile, "email"),
		stringAt(idPayload, "email"),
		stringAt(accessPayload, "email"),
	)
	accountID := firstNonEmptyString(
		stringAt(record, "account", "id"),
		stringAt(record, "account_id"),
		stringAt(record, "tokens", "accountId"),
		stringAt(record, "tokens", "account_id"),
		stringAt(record, "chatgptAccountId"),
		stringAt(record, "chatgpt_account_id"),
		stringAt(record, "meta", "chatgptAccountId"),
		stringAt(record, "meta", "chatgpt_account_id"),
		stringAt(record, "tokens", "chatgptAccountId"),
		stringAt(record, "tokens", "chatgpt_account_id"),
		stringAt(record, "providerSpecificData", "chatgptAccountId"),
		stringAt(record, "providerSpecificData", "chatgpt_account_id"),
		stringAt(record, "credentials", "chatgpt_account_id"),
		stringAt(auth, "chatgpt_account_id"),
		stringAt(idAuth, "chatgpt_account_id"),
	)
	if accountID == "" && stringAt(record, "provider") == "codex" {
		accountID = stringAt(record, "id")
	}
	userID := firstNonEmptyString(
		stringAt(record, "user", "id"),
		stringAt(record, "user_id"),
		stringAt(record, "chatgptUserId"),
		stringAt(record, "providerSpecificData", "chatgptUserId"),
		stringAt(record, "providerSpecificData", "chatgpt_user_id"),
		stringAt(auth, "chatgpt_user_id"),
		stringAt(auth, "user_id"),
		stringAt(idAuth, "chatgpt_user_id"),
		stringAt(idAuth, "user_id"),
	)
	planType := firstNonEmptyString(
		stringAt(record, "account", "planType"),
		stringAt(record, "account", "plan_type"),
		stringAt(record, "planType"),
		stringAt(record, "plan_type"),
		stringAt(record, "providerSpecificData", "chatgptPlanType"),
		stringAt(record, "providerSpecificData", "chatgpt_plan_type"),
		stringAt(record, "credentials", "plan_type"),
		stringAt(auth, "chatgpt_plan_type"),
		stringAt(idAuth, "chatgpt_plan_type"),
	)

	syntheticIDToken := ""
	if inputIDToken == "" {
		syntheticIDToken = buildSyntheticCodexIDToken(email, accountID, planType, userID, expiresAt, now)
	}
	idToken := firstNonEmptyString(inputIDToken, syntheticIDToken)
	name := firstNonEmptyString(email, stringAt(record, "name"), stringAt(record, "label"), "ChatGPT Account")
	exportedAt := now.UTC().Format(time.RFC3339Nano)

	payload := map[string]any{
		"type":               "codex",
		"access_token":       accessToken,
		"refresh_token":      refreshToken,
		"last_refresh":       exportedAt,
		"name":               name,
		"email":              email,
		"account_id":         accountID,
		"chatgpt_account_id": accountID,
		"plan_type":          planType,
		"chatgpt_plan_type":  planType,
		"id_token":           idToken,
		"id_token_synthetic": syntheticIDToken != "",
		"session_token":      sessionToken,
		"expired":            expiresAt,
		"disabled":           boolAt(record, "disabled"),
	}
	return stripEmptyAuthFileImportValues(payload), firstNonEmptyString(email, accountID, name), nil
}

func authFileImportAccessTokenPaths() [][]string {
	return [][]string{
		{"accessToken"},
		{"access_token"},
		{"tokens", "accessToken"},
		{"tokens", "access_token"},
		{"token", "accessToken"},
		{"token", "access_token"},
		{"credentials", "accessToken"},
		{"credentials", "access_token"},
	}
}

func authFileImportSessionTokenPaths() [][]string {
	return [][]string{
		{"sessionToken"},
		{"session_token"},
		{"tokens", "sessionToken"},
		{"tokens", "session_token"},
		{"token", "sessionToken"},
		{"token", "session_token"},
		{"credentials", "session_token"},
	}
}

func authFileImportRefreshTokenPaths() [][]string {
	return [][]string{
		{"refreshToken"},
		{"refresh_token"},
		{"tokens", "refreshToken"},
		{"tokens", "refresh_token"},
		{"token", "refreshToken"},
		{"token", "refresh_token"},
		{"credentials", "refresh_token"},
	}
}

func authFileImportIDTokenPaths() [][]string {
	return [][]string{
		{"idToken"},
		{"id_token"},
		{"tokens", "idToken"},
		{"tokens", "id_token"},
		{"token", "idToken"},
		{"token", "id_token"},
		{"credentials", "id_token"},
	}
}

func firstAuthFileImportString(record map[string]any, paths ...[]string) string {
	for _, path := range paths {
		if value := stringAt(record, path...); value != "" {
			return value
		}
	}
	return ""
}

func parseAuthFileJWTObject(token string) map[string]any {
	segments := strings.Split(strings.TrimSpace(token), ".")
	if len(segments) < 2 {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(segments[1])
	if err != nil {
		raw, err = base64.URLEncoding.DecodeString(padBase64URL(segments[1]))
	}
	if err != nil {
		return nil
	}
	var payload map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return nil
	}
	return payload
}

func buildSyntheticCodexIDToken(email, accountID, planType, userID, expiresAt string, now time.Time) string {
	if accountID == "" {
		return ""
	}
	issuedAt := now.UTC().Unix()
	expires := epochSecondsFromImportValue(expiresAt)
	if expires == 0 {
		expires = issuedAt + 90*24*60*60
	}
	authInfo := map[string]any{"chatgpt_account_id": accountID}
	if planType != "" {
		authInfo["chatgpt_plan_type"] = planType
	}
	if userID != "" {
		authInfo["chatgpt_user_id"] = userID
		authInfo["user_id"] = userID
	}
	payload := map[string]any{
		"iat":                         issuedAt,
		"exp":                         expires,
		"https://api.openai.com/auth": authInfo,
	}
	if email != "" {
		payload["email"] = email
	}
	return encodeImportJWTPart(map[string]any{"alg": "none", "typ": "JWT", "cpa_synthetic": true}) + "." + encodeImportJWTPart(payload) + ".synthetic"
}

func encodeImportJWTPart(value any) string {
	raw, _ := json.Marshal(value)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func stripEmptyAuthFileImportValues(payload map[string]any) map[string]any {
	clean := make(map[string]any, len(payload))
	for key, value := range payload {
		switch typed := value.(type) {
		case string:
			if typed == "" && key != "refresh_token" {
				continue
			}
			clean[key] = typed
		case bool:
			if !typed {
				continue
			}
			clean[key] = typed
		default:
			if typed != nil {
				clean[key] = typed
			}
		}
	}
	return clean
}

func uniqueAuthFileImportName(seed string, now time.Time, used map[string]int) string {
	base := sanitizeAuthFileImportName(firstNonEmptyString(seed, "chatgpt-session"))
	timestamp := now.UTC().Format("2006-01-02_15-04-05")
	name := fmt.Sprintf("codex-%s-%s.json", base, timestamp)
	if used[name] == 0 {
		used[name] = 1
		return name
	}
	used[name]++
	return fmt.Sprintf("codex-%s-%s-%d.json", base, timestamp, used[name])
}

func sanitizeAuthFileImportName(value string) string {
	base := strings.ToLower(strings.TrimSpace(value))
	base = strings.TrimSuffix(base, ".json")
	base = authFileImportFileTokenRe.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if len(base) > 80 {
		base = strings.Trim(base[:80], "-")
	}
	if base == "" {
		return "chatgpt-session"
	}
	return base
}

func objectAt(record map[string]any, path ...string) map[string]any {
	value := valueAt(record, path...)
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return nil
}

func stringAt(record map[string]any, path ...string) string {
	switch value := valueAt(record, path...).(type) {
	case string:
		return strings.TrimSpace(value)
	case json.Number:
		return strings.TrimSpace(value.String())
	case float64:
		return strconv.FormatFloat(value, 'f', -1, 64)
	default:
		return ""
	}
}

func boolAt(record map[string]any, path ...string) bool {
	value, ok := valueAt(record, path...).(bool)
	return ok && value
}

func valueAt(record map[string]any, path ...string) any {
	var current any = record
	for _, segment := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = object[segment]
	}
	return current
}

func timestampFromUnixSeconds(value any) string {
	seconds := numericImportValue(value)
	if seconds <= 0 {
		return ""
	}
	return time.Unix(seconds, 0).UTC().Format(time.RFC3339)
}

func normalizedImportTimestamp(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return ""
		}
		if numeric, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
			if numeric > 1e11 {
				numeric /= 1000
			}
			return time.Unix(numeric, 0).UTC().Format(time.RFC3339)
		}
		if parsed, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
			return parsed.UTC().Format(time.RFC3339Nano)
		}
		if parsed, err := time.Parse("2006-01-02 15:04:05", trimmed); err == nil {
			return parsed.UTC().Format(time.RFC3339)
		}
		return ""
	default:
		seconds := numericImportValue(value)
		if seconds <= 0 {
			return ""
		}
		return time.Unix(seconds, 0).UTC().Format(time.RFC3339)
	}
}

func epochSecondsFromImportValue(value string) int64 {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}
	if numeric, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
		if numeric > 1e11 {
			return numeric / 1000
		}
		return numeric
	}
	if parsed, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
		return parsed.UTC().Unix()
	}
	return 0
}

func numericImportValue(value any) int64 {
	switch typed := value.(type) {
	case json.Number:
		numeric, err := typed.Int64()
		if err != nil {
			floatValue, floatErr := typed.Float64()
			if floatErr != nil {
				return 0
			}
			numeric = int64(floatValue)
		}
		if numeric > 1e11 {
			return numeric / 1000
		}
		return numeric
	case float64:
		if typed > 1e11 {
			return int64(typed / 1000)
		}
		return int64(typed)
	case int64:
		return typed
	case int:
		return int64(typed)
	default:
		return 0
	}
}

func padBase64URL(value string) string {
	if remainder := len(value) % 4; remainder != 0 {
		return value + strings.Repeat("=", 4-remainder)
	}
	return value
}

func looksLikeJWT(value string) bool {
	segments := strings.Split(strings.TrimSpace(value), ".")
	return len(segments) >= 2 && segments[0] != "" && segments[1] != ""
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
