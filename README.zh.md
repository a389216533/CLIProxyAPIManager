# CLIProxyAPIManager

[English README](./README.md)

`CLIProxyAPIManager` 是面向 Windows 的 CLIProxyAPI 本地管理与用量统计工具。它以一个 Windows 可执行文件启动 Web 管理台，并在本机下载、配置和管理内置的 CLIProxyAPI（CPA）进程。

本项目当前只按 Windows 使用场景维护。不提供 Docker、Linux、macOS、Homebrew 或 systemd 部署支持。

## 主要功能

- Windows 便携运行：双击 `CLIProxyAPIManager.exe` 即可启动管理台。
- 内置 CPA 管理：自动下载 `cli-proxy-api.exe`，生成并同步 `data/cpa/config.yaml`。
- 用量统计：消费 CPA usage 队列，将请求、Token、成本、缓存、延迟等数据写入 SQLite。
- Web Dashboard：提供总览、趋势分析、请求事件、凭证、价格、配置诊断和 CPA 管理页面。
- 凭证与限额：查看 Auth File / AI Provider 使用状态，支持限额刷新、巡检和排序。
- 代理池：在管理台维护代理池，并批量写入 CPA auth file 的 `proxy_url`。
- 局域网只读访问：普通成员可查看统计数据，管理操作需要管理员登录。

## 目录结构

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

首次运行会在 exe 所在目录初始化 `.env` 和 `data/`。升级时保留这两个路径即可保留配置、密钥、SQLite 数据、日志和 CPA 配置。

## 快速开始

1. 将发行包解压到固定目录，例如：

   ```text
   D:\CLIProxyAPIManager
   ```

2. 双击运行：

   ```text
   CLIProxyAPIManager.exe
   ```

3. 浏览器会自动打开：

   ```text
   http://127.0.0.1:18217/
   ```

4. 首次进入页面时设置两个密钥：

   - 管理后台密码：写入 `.env` 的 `MANAGER_LOGIN_PASSWORD` / `LOGIN_PASSWORD`。
   - CPA Management Center 密钥：写入 `.env` 的 `CPA_MANAGED_SECRET_KEY` / `CPA_MANAGEMENT_KEY`，并同步到 `data/cpa/config.yaml`。

## 局域网访问

默认监听：

```env
WEB_HOST=0.0.0.0
APP_PORT=18217
```

局域网成员访问：

```text
http://管理机局域网IP:18217/
```

如果无法访问，检查 Windows 防火墙是否允许 `CLIProxyAPIManager.exe` 入站，或手动放行 TCP `18217`。不要把管理后台密码或 CPA Management Center 密钥发给普通成员。

## 关键配置

常用配置写在 `.env`：

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

修改 `.env` 后重启程序生效。`CPA_MANAGED_ENABLED=true` 时，程序会优先使用内置 CPA；如需连接外部 CPA，可关闭该项并手动配置 `CPA_BASE_URL`、`CPA_MANAGEMENT_KEY` 和 `REDIS_QUEUE_ADDR`。

## 升级

1. 关闭正在运行的 `CLIProxyAPIManager.exe`。
2. 用新版 `CLIProxyAPIManager.exe` 覆盖旧文件。
3. 保留原目录下的 `.env` 和 `data/`。
4. 重新启动程序。

不要删除 `data/`，否则会丢失 SQLite 历史数据、CPA 配置、日志和备份。

## 开发运行

需要 Go、Node.js 和 npm：

```powershell
npm --prefix .\web ci
npm --prefix .\web run build
go run .\cmd\server --env .\.env
```

常用验证：

```powershell
go test .\cmd\... .\internal\...
npm --prefix .\web run test
npm --prefix .\web run lint
npm --prefix .\web run typecheck
```

## 打包 Windows 发行目录

```powershell
.\scripts\build-windows.ps1
```

输出：

```text
dist-windows/
  CLIProxyAPIManager.exe
  .env.example
```

发行目录不会包含开发机的 `.env` 和 `data/`。

## 常见问题

### 页面打不开

确认程序仍在运行，端口未被占用，并检查 Windows 防火墙。默认本机地址是 `http://127.0.0.1:18217/`。

### CPA 启动失败

打开“配置诊断”和“CPA 管理”页面查看原因。重点检查 `CPA_MANAGED_SECRET_KEY` 是否和 `data/cpa/config.yaml` 中的 `remote-management.secret-key` 一致。

### 没有用量数据

确认 CPA 已启用 usage statistics，且 `CPA_BASE_URL`、`CPA_MANAGEMENT_KEY`、`REDIS_QUEUE_ADDR` 指向当前运行的 CPA。
