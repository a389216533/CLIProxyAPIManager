package api

import (
	"bufio"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"CLIProxyAPIManager/internal/config"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type configDiagnosticLevel string

const (
	configDiagnosticLevelInfo    configDiagnosticLevel = "info"
	configDiagnosticLevelWarning configDiagnosticLevel = "warning"
	configDiagnosticLevelError   configDiagnosticLevel = "error"
)

type configStatusResponse struct {
	OK     bool   `json:"ok"`
	Status string `json:"status"`
}

type configDiagnosticsResponse struct {
	OK     bool                    `json:"ok"`
	Status string                  `json:"status"`
	Checks []configDiagnosticCheck `json:"checks"`
}

type configDiagnosticCheck struct {
	Code    string                `json:"code"`
	OK      bool                  `json:"ok"`
	Level   configDiagnosticLevel `json:"level"`
	Message string                `json:"message"`
}

type parsedCPAConfig struct {
	Port                   string
	SecretKey              string
	UsageStatisticsEnabled *bool
	LoggingToFile          *bool
	AuthDir                string
}

func registerConfigDiagnosticsRoutes(router gin.IRoutes, cfg *config.Config) {
	router.GET("/config/status", func(c *gin.Context) {
		diagnostics := buildConfigDiagnostics(cfg)
		c.JSON(http.StatusOK, configStatusResponse{OK: diagnostics.OK, Status: diagnostics.Status})
	})
	router.GET("/config/diagnostics", func(c *gin.Context) {
		c.JSON(http.StatusOK, buildConfigDiagnostics(cfg))
	})
}

func buildConfigDiagnostics(cfg *config.Config) configDiagnosticsResponse {
	if cfg == nil {
		return configDiagnosticsResponse{
			OK:     false,
			Status: "配置不可用",
			Checks: []configDiagnosticCheck{{
				Code:    "config.loaded",
				OK:      false,
				Level:   configDiagnosticLevelError,
				Message: "后端没有加载应用配置，无法执行诊断。",
			}},
		}
	}

	checks := []configDiagnosticCheck{
		checkString("web.host", cfg.WebHost, "WEB_HOST 已配置。", "WEB_HOST 为空，局域网访问可能不可用。", configDiagnosticLevelError),
		checkString("web.port", cfg.AppPort, "APP_PORT 已配置为 "+cfg.AppPort+"。", "APP_PORT 为空，Web 服务无法确定监听端口。", configDiagnosticLevelError),
		checkString("cpa.base_url", cfg.CPABaseURL, "CPA_BASE_URL 已配置为 "+cfg.CPABaseURL+"。", "CPA_BASE_URL 为空，Keeper 无法访问 CPA。", configDiagnosticLevelError),
		checkBool("auth.enabled", cfg.AuthEnabled, "管理后台登录保护已启用。", "管理后台登录保护未启用。", configDiagnosticLevelError),
		checkString("auth.password", cfg.LoginPassword, "管理员密码已配置。", "管理员密码未配置，首次启动应先完成初始化。", configDiagnosticLevelError),
		checkString("cpa.management_key", cfg.CPAManagementKey, "CPA 管理密钥已配置。", "CPA 管理密钥未配置，CPA 管理接口会认证失败。", configDiagnosticLevelError),
		checkBool("cpa.managed", cfg.CPAManagedEnabled, "内置 CPA 管理已启用。", "内置 CPA 管理未启用。", configDiagnosticLevelWarning),
		checkBool("cpa.auto_start", cfg.CPAAutoStart, "启动 Manager 时会自动启动内置 CPA。", "CPA 自动启动未启用，需要手动启动。", configDiagnosticLevelWarning),
	}

	checks = append(checks,
		checkPathExists("env.file", cfg.EnvFile, false, "当前 .env 文件存在。", "当前 .env 文件不存在。", configDiagnosticLevelWarning),
		checkPathExists("work_dir", cfg.WorkDir, true, "WORK_DIR 目录存在。", "WORK_DIR 目录不存在。", configDiagnosticLevelError),
		checkPathExists("sqlite.path", cfg.SQLitePath, false, "SQLite 数据库文件存在。", "SQLite 数据库文件暂不存在，首次运行会创建。", configDiagnosticLevelInfo),
		checkPathExists("cpa.work_dir", cfg.CPAWorkDir, true, "CPA_WORK_DIR 目录存在。", "CPA_WORK_DIR 目录不存在。", configDiagnosticLevelError),
		checkPathExists("cpa.exe", cfg.CPAExePath, false, "内置 CPA 可执行文件存在。", "内置 CPA 可执行文件不存在。", configDiagnosticLevelError),
		checkPathExists("cpa.config", cfg.CPAConfigPath, false, "CPA config.yaml 存在。", "CPA config.yaml 不存在。", configDiagnosticLevelError),
	)

	cpaConfig, cpaConfigErr := parseCPAConfigFile(cfg.CPAConfigPath)
	if cpaConfigErr == nil {
		checks = append(checks, buildCPAConfigChecks(cfg, cpaConfig)...)
	} else {
		level := configDiagnosticLevelError
		if errors.Is(cpaConfigErr, os.ErrNotExist) {
			level = configDiagnosticLevelWarning
		}
		checks = append(checks, configDiagnosticCheck{
			Code:    "cpa.config.readable",
			OK:      false,
			Level:   level,
			Message: "无法读取 CPA config.yaml：" + cpaConfigErr.Error(),
		})
	}

	ok := true
	hasWarning := false
	for _, check := range checks {
		if check.OK {
			continue
		}
		if check.Level == configDiagnosticLevelError {
			ok = false
		}
		if check.Level == configDiagnosticLevelWarning {
			hasWarning = true
		}
	}
	status := "正常"
	if !ok {
		status = "异常"
	} else if hasWarning {
		status = "需要注意"
	}

	return configDiagnosticsResponse{OK: ok, Status: status, Checks: checks}
}

func buildCPAConfigChecks(cfg *config.Config, cpaConfig parsedCPAConfig) []configDiagnosticCheck {
	expectedPort := cfg.CPAPort()
	checks := []configDiagnosticCheck{
		{
			Code:    "cpa.config.port",
			OK:      cpaConfig.Port == expectedPort,
			Level:   configDiagnosticLevelError,
			Message: cpaConfigPortMessage(cpaConfig.Port, expectedPort),
		},
		{
			Code:    "cpa.config.management_key",
			OK:      cpaConfigSecretMatches(cpaConfig.SecretKey, cfg.CPAManagementKey),
			Level:   configDiagnosticLevelError,
			Message: cpaConfigSecretMessage(cpaConfig.SecretKey),
		},
		{
			Code:    "cpa.config.usage_statistics",
			OK:      cpaConfig.UsageStatisticsEnabled != nil && *cpaConfig.UsageStatisticsEnabled,
			Level:   configDiagnosticLevelError,
			Message: boolConfigMessage(cpaConfig.UsageStatisticsEnabled, "CPA usage-statistics-enabled 已开启。", "CPA usage-statistics-enabled 未开启，Keeper 无法采集用量。"),
		},
		{
			Code:    "cpa.config.logging_to_file",
			OK:      cpaConfig.LoggingToFile != nil && *cpaConfig.LoggingToFile,
			Level:   configDiagnosticLevelWarning,
			Message: boolConfigMessage(cpaConfig.LoggingToFile, "CPA logging-to-file 已开启。", "CPA logging-to-file 未开启，排障时缺少 CPA 日志。"),
		},
		{
			Code:    "cpa.config.auth_dir",
			OK:      strings.TrimSpace(cpaConfig.AuthDir) != "",
			Level:   configDiagnosticLevelWarning,
			Message: stringConfigMessage(cpaConfig.AuthDir, "CPA auth-dir 已配置。", "CPA auth-dir 未配置，认证文件列表可能不完整。"),
		},
	}
	return checks
}

func checkString(code, value, okMessage, failMessage string, level configDiagnosticLevel) configDiagnosticCheck {
	ok := strings.TrimSpace(value) != ""
	return configDiagnosticCheck{Code: code, OK: ok, Level: level, Message: selectMessage(ok, okMessage, failMessage)}
}

func checkBool(code string, value bool, okMessage, failMessage string, level configDiagnosticLevel) configDiagnosticCheck {
	return configDiagnosticCheck{Code: code, OK: value, Level: level, Message: selectMessage(value, okMessage, failMessage)}
}

func checkPathExists(code, target string, wantDir bool, okMessage, failMessage string, level configDiagnosticLevel) configDiagnosticCheck {
	target = strings.TrimSpace(target)
	if target == "" {
		return configDiagnosticCheck{Code: code, OK: false, Level: level, Message: failMessage}
	}
	info, err := os.Stat(target)
	ok := err == nil && info.IsDir() == wantDir
	if err == nil && wantDir && !info.IsDir() {
		failMessage += " 当前路径不是目录。"
	}
	if err == nil && !wantDir && info.IsDir() {
		failMessage += " 当前路径是目录。"
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		failMessage += " " + err.Error()
	}
	return configDiagnosticCheck{Code: code, OK: ok, Level: level, Message: selectMessage(ok, okMessage, failMessage)}
}

func parseCPAConfigFile(path string) (parsedCPAConfig, error) {
	file, err := os.Open(filepath.Clean(path))
	if err != nil {
		return parsedCPAConfig{}, err
	}
	defer file.Close()

	var parsed parsedCPAConfig
	var section string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		rawLine := scanner.Text()
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if !strings.HasPrefix(rawLine, " ") && strings.HasSuffix(line, ":") {
			section = strings.TrimSuffix(line, ":")
			continue
		}
		if !strings.HasPrefix(rawLine, " ") {
			section = ""
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		switch {
		case section == "" && key == "port":
			parsed.Port = value
		case section == "" && key == "usage-statistics-enabled":
			parsed.UsageStatisticsEnabled = parseOptionalBool(value)
		case section == "" && key == "logging-to-file":
			parsed.LoggingToFile = parseOptionalBool(value)
		case section == "" && key == "auth-dir":
			parsed.AuthDir = value
		case section == "remote-management" && key == "secret-key":
			parsed.SecretKey = value
		}
	}
	if err := scanner.Err(); err != nil {
		return parsedCPAConfig{}, err
	}
	return parsed, nil
}

func parseOptionalBool(value string) *bool {
	parsed, err := strconv.ParseBool(strings.TrimSpace(value))
	if err != nil {
		return nil
	}
	return &parsed
}

func cpaConfigSecretMatches(configSecret, managementKey string) bool {
	configSecret = strings.TrimSpace(configSecret)
	managementKey = strings.TrimSpace(managementKey)
	if configSecret == "" || managementKey == "" {
		return false
	}
	if strings.HasPrefix(configSecret, "$2a$") || strings.HasPrefix(configSecret, "$2b$") || strings.HasPrefix(configSecret, "$2y$") {
		return bcrypt.CompareHashAndPassword([]byte(configSecret), []byte(managementKey)) == nil
	}
	return configSecret == managementKey
}

func cpaConfigPortMessage(actual, expected string) string {
	if actual == expected {
		return "CPA config.yaml 端口与 CPA_BASE_URL 一致：" + expected + "。"
	}
	if strings.TrimSpace(actual) == "" {
		return "CPA config.yaml 未配置 port，期望端口为 " + expected + "。"
	}
	return "CPA config.yaml 端口为 " + actual + "，但 CPA_BASE_URL 期望端口为 " + expected + "。"
}

func cpaConfigSecretMessage(secret string) string {
	if strings.TrimSpace(secret) == "" {
		return "CPA config.yaml 未配置 remote-management.secret-key。"
	}
	return "CPA config.yaml 的 remote-management.secret-key 与 Keeper 管理密钥一致。"
}

func boolConfigMessage(value *bool, okMessage, failMessage string) string {
	if value != nil && *value {
		return okMessage
	}
	return failMessage
}

func stringConfigMessage(value, okMessage, failMessage string) string {
	return selectMessage(strings.TrimSpace(value) != "", okMessage, failMessage)
}

func selectMessage(ok bool, okMessage, failMessage string) string {
	if ok {
		return okMessage
	}
	return failMessage
}
