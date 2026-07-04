package authfiles

import (
	"bytes"
	"encoding/json"
	"time"
)

// AuthFilesResponse 是 CPA /management/auth-files 响应 DTO。
type AuthFilesResponse struct {
	Files []AuthFile `json:"files"`
}

// AuthFile 是 CPA /management/auth-files 中单个 auth file 的原始响应 DTO。
type AuthFile struct {
	AuthIndex             string  `json:"auth_index"`
	Name                  string  `json:"name"`
	Path                  string  `json:"path"`
	Email                 string  `json:"email"`
	Type                  string  `json:"type"`
	Provider              string  `json:"provider"`
	Label                 string  `json:"label"`
	Status                string  `json:"status"`
	Source                string  `json:"source"`
	Prefix                string  `json:"prefix"`
	ProxyURL              string  `json:"proxy_url,omitempty"`
	Priority              *int    `json:"priority"`
	Disabled              *bool   `json:"disabled"`
	Note                  *string `json:"note"`
	Unavailable           bool    `json:"unavailable"`
	RuntimeOnly           bool    `json:"runtime_only"`
	Account               string  `json:"account,omitempty"`
	ProjectID             string  `json:"project_id,omitempty"`
	AccountID             string  `json:"account_id,omitempty"`
	PlanType              string  `json:"plan_type,omitempty"`
	WorkspaceName         string  `json:"workspace_name,omitempty"`
	WorkspaceNameCamel    string  `json:"workspaceName,omitempty"`
	TeamName              string  `json:"team_name,omitempty"`
	TeamNameCamel         string  `json:"teamName,omitempty"`
	OrganizationName      string  `json:"organization_name,omitempty"`
	OrganizationNameCamel string  `json:"organizationName,omitempty"`
	OrgName               string  `json:"org_name,omitempty"`
	OrgNameCamel          string  `json:"orgName,omitempty"`
	CodexAuthMetadata
	IDToken *AuthFileIDToken `json:"id_token"`
}

// CodexAuthMetadata 兼容 CPA auth json 顶层保存的 ChatGPT 订阅元数据。
type CodexAuthMetadata struct {
	AccountID        *string    `json:"chatgpt_account_id,omitempty"`
	AccountIDCamel   *string    `json:"chatgptAccountId,omitempty"`
	ActiveStart      *time.Time `json:"chatgpt_subscription_active_start,omitempty"`
	ActiveStartCamel *time.Time `json:"chatgptSubscriptionActiveStart,omitempty"`
	ActiveUntil      *time.Time `json:"chatgpt_subscription_active_until,omitempty"`
	ActiveUntilCamel *time.Time `json:"chatgptSubscriptionActiveUntil,omitempty"`
	PlanType         *string    `json:"chatgpt_plan_type,omitempty"`
	PlanTypeCamel    *string    `json:"chatgptPlanType,omitempty"`
}

// AuthFileIDToken 是 Codex auth file 的 id_token 订阅元数据 DTO。
type AuthFileIDToken struct {
	AccountID             *string    `json:"chatgpt_account_id,omitempty"`
	AccountIDCamel        *string    `json:"chatgptAccountId,omitempty"`
	ActiveStart           *time.Time `json:"chatgpt_subscription_active_start,omitempty"`
	ActiveStartCamel      *time.Time `json:"chatgptSubscriptionActiveStart,omitempty"`
	ActiveUntil           *time.Time `json:"chatgpt_subscription_active_until,omitempty"`
	ActiveUntilCamel      *time.Time `json:"chatgptSubscriptionActiveUntil,omitempty"`
	PlanType              *string    `json:"plan_type,omitempty"`
	PlanTypeCamel         *string    `json:"planType,omitempty"`
	WorkspaceName         *string    `json:"workspace_name,omitempty"`
	WorkspaceNameCamel    *string    `json:"workspaceName,omitempty"`
	TeamName              *string    `json:"team_name,omitempty"`
	TeamNameCamel         *string    `json:"teamName,omitempty"`
	OrganizationName      *string    `json:"organization_name,omitempty"`
	OrganizationNameCamel *string    `json:"organizationName,omitempty"`
	OrgName               *string    `json:"org_name,omitempty"`
	OrgNameCamel          *string    `json:"orgName,omitempty"`
}

func (t *AuthFileIDToken) UnmarshalJSON(data []byte) error {
	if len(bytes.TrimSpace(data)) == 0 || bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return nil
	}
	if bytes.HasPrefix(bytes.TrimSpace(data), []byte(`"`)) {
		return nil
	}
	type alias AuthFileIDToken
	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*t = AuthFileIDToken(decoded)
	return nil
}
