package service

import (
	"strings"
	"time"

	"CLIProxyAPIManager/internal/cpa/dto/authfiles"
)

func resolveAuthFileProjectID(file authfiles.AuthFile) *string {
	switch strings.ToLower(strings.TrimSpace(file.Type)) {
	case "gemini", "gemini-cli", "gemini-cli-code-assist", "antigravity":
		return resolveGeminiCLIProjectID(file)
	default:
		return nil
	}
}

func resolveCodexAccountID(file authfiles.AuthFile) *string {
	var idTokenAccountID *string
	var idTokenAccountIDCamel *string
	if file.IDToken != nil {
		idTokenAccountID = file.IDToken.AccountID
		idTokenAccountIDCamel = file.IDToken.AccountIDCamel
	}
	return firstNonEmptyStringPtr(
		idTokenAccountID,
		idTokenAccountIDCamel,
		file.CodexAuthMetadata.AccountID,
		file.CodexAuthMetadata.AccountIDCamel,
		stringValue(file.AccountID),
	)
}

func resolveCodexPlanType(file authfiles.AuthFile) *string {
	var idTokenPlanType *string
	var idTokenPlanTypeCamel *string
	if file.IDToken != nil {
		idTokenPlanType = file.IDToken.PlanType
		idTokenPlanTypeCamel = file.IDToken.PlanTypeCamel
	}
	return firstNonEmptyStringPtr(
		idTokenPlanType,
		idTokenPlanTypeCamel,
		file.CodexAuthMetadata.PlanType,
		file.CodexAuthMetadata.PlanTypeCamel,
		stringValue(file.PlanType),
	)
}

func resolveCodexWorkspaceName(file authfiles.AuthFile) *string {
	var idTokenWorkspaceName *string
	var idTokenWorkspaceNameCamel *string
	var idTokenTeamName *string
	var idTokenTeamNameCamel *string
	var idTokenOrganizationName *string
	var idTokenOrganizationNameCamel *string
	var idTokenOrgName *string
	var idTokenOrgNameCamel *string
	if file.IDToken != nil {
		idTokenWorkspaceName = file.IDToken.WorkspaceName
		idTokenWorkspaceNameCamel = file.IDToken.WorkspaceNameCamel
		idTokenTeamName = file.IDToken.TeamName
		idTokenTeamNameCamel = file.IDToken.TeamNameCamel
		idTokenOrganizationName = file.IDToken.OrganizationName
		idTokenOrganizationNameCamel = file.IDToken.OrganizationNameCamel
		idTokenOrgName = file.IDToken.OrgName
		idTokenOrgNameCamel = file.IDToken.OrgNameCamel
	}
	workspaceName := firstNonEmptyStringPtr(
		idTokenWorkspaceName,
		idTokenWorkspaceNameCamel,
		idTokenTeamName,
		idTokenTeamNameCamel,
		idTokenOrganizationName,
		idTokenOrganizationNameCamel,
		idTokenOrgName,
		idTokenOrgNameCamel,
		stringValue(file.WorkspaceName),
		stringValue(file.WorkspaceNameCamel),
		stringValue(file.TeamName),
		stringValue(file.TeamNameCamel),
		stringValue(file.OrganizationName),
		stringValue(file.OrganizationNameCamel),
		stringValue(file.OrgName),
		stringValue(file.OrgNameCamel),
	)
	if workspaceName != nil {
		return workspaceName
	}
	if planType := resolveCodexPlanType(file); planType != nil && strings.EqualFold(strings.TrimSpace(*planType), "team") {
		return stringValue(file.Prefix)
	}
	return nil
}

func resolveCodexActiveStart(file authfiles.AuthFile) *time.Time {
	if file.IDToken != nil && file.IDToken.ActiveStart != nil {
		return file.IDToken.ActiveStart
	}
	if file.IDToken != nil && file.IDToken.ActiveStartCamel != nil {
		return file.IDToken.ActiveStartCamel
	}
	if file.CodexAuthMetadata.ActiveStart != nil {
		return file.CodexAuthMetadata.ActiveStart
	}
	return file.CodexAuthMetadata.ActiveStartCamel
}

func resolveCodexActiveUntil(file authfiles.AuthFile) *time.Time {
	if file.IDToken != nil && file.IDToken.ActiveUntil != nil {
		return file.IDToken.ActiveUntil
	}
	if file.IDToken != nil && file.IDToken.ActiveUntilCamel != nil {
		return file.IDToken.ActiveUntilCamel
	}
	if file.CodexAuthMetadata.ActiveUntil != nil {
		return file.CodexAuthMetadata.ActiveUntil
	}
	if file.CodexAuthMetadata.ActiveUntilCamel != nil {
		return file.CodexAuthMetadata.ActiveUntilCamel
	}
	return nil
}

func resolveGeminiCLIProjectID(file authfiles.AuthFile) *string {
	return stringValue(file.ProjectID)
}

func firstNonEmptyStringPtr(values ...*string) *string {
	for _, value := range values {
		if value == nil {
			continue
		}
		trimmed := strings.TrimSpace(*value)
		if trimmed == "" {
			continue
		}
		return &trimmed
	}
	return nil
}

func stringValue(value string) *string {
	return firstNonEmptyStringPtr(&value)
}
