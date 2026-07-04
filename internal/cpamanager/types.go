package cpamanager

import "time"

type Config struct {
	Enabled             bool
	WorkDir             string
	ExePath             string
	ConfigPath          string
	ManagementKey       string
	Port                string
	AutoStart           bool
	UpdateCheckInterval time.Duration
	ReleaseRepo         string
	RequestTimeout      time.Duration
}

type RuntimeStatus struct {
	Enabled             bool          `json:"enabled"`
	Running             bool          `json:"running"`
	PID                 int           `json:"pid,omitempty"`
	ExePath             string        `json:"exePath"`
	ConfigPath          string        `json:"configPath"`
	CurrentVersion      string        `json:"currentVersion,omitempty"`
	LatestVersion       string        `json:"latestVersion,omitempty"`
	UpdateAvailable     bool          `json:"updateAvailable"`
	CanCompare          bool          `json:"canCompare"`
	Message             string        `json:"message,omitempty"`
	UpdateCheckInterval time.Duration `json:"updateCheckInterval"`
}

type UpdateEvent struct {
	Time    time.Time `json:"time"`
	Stage   string    `json:"stage"`
	Message string    `json:"message"`
	Error   bool      `json:"error,omitempty"`
}

type ReleaseInfo struct {
	Version     string
	ZipURL      string
	ChecksumURL string
	AssetName   string
}
