# CLIProxyAPIManager

[中文说明](./README.zh.md)

`CLIProxyAPIManager` is a Windows-focused local management and usage dashboard for CLIProxyAPI. It starts a local Web console from a single Windows executable and manages a bundled CLIProxyAPI (CPA) process on the same machine.

This project is maintained for Windows usage only. Docker, Linux, macOS, Homebrew, and systemd deployments are not supported.

## Features

- Portable Windows runtime: start the console by running `CLIProxyAPIManager.exe`.
- Bundled CPA management: download `cli-proxy-api.exe`, generate `data/cpa/config.yaml`, and keep the management key in sync.
- Usage persistence: consume CPA usage events and store requests, tokens, cost, cache, latency, and result data in SQLite.
- Web dashboard: overview, analysis, request events, credentials, pricing, config diagnostics, and CPA runtime management.
- Credential tools: inspect Auth File / AI Provider usage, refresh quota, and sort account status.
- Proxy pools: maintain proxy pools and batch-write `proxy_url` to CPA auth files.
- LAN read-only access: teammates can view usage pages while admin actions require login.

## Runtime Layout

```text
CLIProxyAPIManager.exe
.env
data/
  CLIProxyAPIManager.db
  logs/
  backups/
  cpa/
    cli-proxy-api.exe
    config.yaml
```

On first launch, the app initializes `.env` and `data/` beside the executable. Keep both paths when upgrading.

## Quick Start

1. Extract the release package to a fixed directory, for example:

   ```text
   D:\CLIProxyAPIManager
   ```

2. Run:

   ```text
   CLIProxyAPIManager.exe
   ```

3. Open the local console:

   ```text
   http://127.0.0.1:18217/
   ```

4. On first setup, provide:

   - Admin console password: saved to `MANAGER_LOGIN_PASSWORD` / `LOGIN_PASSWORD`.
   - CPA Management Center key: saved to `CPA_MANAGED_SECRET_KEY` / `CPA_MANAGEMENT_KEY` and synced to `data/cpa/config.yaml`.

## LAN Access

Default listen settings:

```env
WEB_HOST=0.0.0.0
APP_PORT=18217
```

LAN users can open:

```text
http://manager-machine-ip:18217/
```

If the page is unreachable, allow inbound access for `CLIProxyAPIManager.exe` or TCP `18217` in Windows Firewall. Do not share the admin password or CPA management key with read-only users.

## Configuration

Common `.env` values:

```env
APP_PORT=18217
WEB_HOST=0.0.0.0
CPA_MANAGED_ENABLED=true
CPA_AUTO_START=true
CPA_BASE_URL=http://127.0.0.1:18218
CPA_MANAGEMENT_KEY=...
MANAGER_LOGIN_PASSWORD=...
CPA_MANAGED_SECRET_KEY=...
WORK_DIR=./data
OPEN_BROWSER_ON_START=true
```

Restart the app after changing `.env`. With `CPA_MANAGED_ENABLED=true`, the app manages the bundled CPA. To use an external CPA, disable it and set `CPA_BASE_URL`, `CPA_MANAGEMENT_KEY`, and `REDIS_QUEUE_ADDR` manually.

## Upgrade

1. Stop `CLIProxyAPIManager.exe`.
2. Replace the old executable with the new one.
3. Keep the existing `.env` and `data/`.
4. Start the app again.

Do not delete `data/`; it contains SQLite history, CPA config, logs, and backups.

## Development

Requirements: Go, Node.js, and npm.

```powershell
npm --prefix .\web ci
npm --prefix .\web run build
go run .\cmd\server --env .\.env
```

Verification:

```powershell
go test .\cmd\... .\internal\...
npm --prefix .\web run test
npm --prefix .\web run lint
npm --prefix .\web run typecheck
```

## Build Windows Release

```powershell
.\scripts\build-windows.ps1
```

Output:

```text
dist-windows/
  CLIProxyAPIManager.exe
  .env.example
```

The release directory does not include your development `.env` or `data/`.

## Troubleshooting

### The console does not open

Check that the process is still running, the port is free, and Windows Firewall allows inbound access. The default local URL is `http://127.0.0.1:18217/`.

### Bundled CPA does not start

Open Config Diagnostics and CPA Management in the console. Check that `CPA_MANAGED_SECRET_KEY` matches `remote-management.secret-key` in `data/cpa/config.yaml`.

### No usage data appears

Confirm that CPA usage statistics are enabled and that `CPA_BASE_URL`, `CPA_MANAGEMENT_KEY`, and `REDIS_QUEUE_ADDR` point to the running CPA instance.
