# Mac 上的 CPA 启动 / 停止 / 重启脚本

用 macOS 自带的 launchd（系统服务管家）在后台运行 CPA：**关掉终端也不停、崩溃自动拉起、登录 Mac 后自动启动**。
脚本不修改 `config.yaml`，也不改 CPA 程序本身。发布包（Releases 里的 `cpa-macmini-*.tar.gz`）已包含这些文件。

## 用法

| 命令 | 作用 |
|---|---|
| `./start.sh` | 启动（后台运行） |
| `./stop.sh` | 停止后台服务（不会被自动拉起） |
| `./stop.sh --all` | 同上，并把在终端窗口里前台跑的 CPA 也正常关掉 |
| `./restart.sh` | 重启 |
| `./status.sh` | 查看：程序版本、后台 PID、有无前台进程、端口是否监听、是否开机自启 |
| `./cpactl.sh logs` | 实时看日志（Ctrl+C 只退出看日志，不影响服务） |
| `./cpactl.sh disable` | 停止并关闭开机自启 |

- 安装目录默认 `~/cliproxyapi`（需有 `bin/cli-proxy-api` 和 `config.yaml`），别的目录用 `CPA_HOME=/其他目录 ./start.sh`。
- 服务名默认 `com.local.cliproxyapi`（可用 `CPA_LABEL` 改），配置文件在 `~/Library/LaunchAgents/`。没有时从 `templates/` 自动生成。
- 端口从 `config.yaml` 读（兼容顶层 `port:` 和 `server:` 下的 `port:`），读不到按 8317。

## 从「终端前台运行」换成后台

```bash
./status.sh       # 显示「终端前台进程：PID」
# 到那个终端窗口按 Ctrl+C（或运行 ./stop.sh --all）
./start.sh
./status.sh       # 看到「后台服务：运行中」「端口 8317：监听中」即可，终端可以关了
```

`start.sh` 发现还有前台 CPA 时会拒绝启动并提示，不会出现两个 CPA 抢端口。
