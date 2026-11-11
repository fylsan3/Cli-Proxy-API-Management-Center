#!/usr/bin/env bash
# CPA（CLIProxyAPI）Mac 后台服务控制脚本：用 macOS 自带的 launchd 在后台运行，
# 关掉终端也不停；崩溃自动拉起；登录后自动启动。
#
# 用法：
#   ./cpactl.sh start     启动（后台运行）
#   ./cpactl.sh stop      停止（不会被自动拉起）
#   ./cpactl.sh restart   重启
#   ./cpactl.sh status    查看状态
#   ./cpactl.sh logs      实时看日志（Ctrl+C 退出，不影响服务）
#
# 安装目录默认 ~/cliproxyapi，可用环境变量 CPA_HOME 改，例如：
#   CPA_HOME=/opt/cpa ./cpactl.sh start
# 本脚本不修改 config.yaml。
set -euo pipefail

CPA_HOME="${CPA_HOME:-$HOME/cliproxyapi}"
LABEL="${CPA_LABEL:-com.local.cliproxyapi}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BIN="$CPA_HOME/bin/cli-proxy-api"
CFG="$CPA_HOME/config.yaml"
DOMAIN="gui/$(id -u)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[注意]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "这个脚本只适用于 macOS"

# 从 config.yaml 读端口（读不到就用默认 8317）
cpa_port() {
  local p
  # 兼容两种写法：顶层 port: 8317（旧版），或 server: 下的 port: 8317（v8）
  p="$(awk '
    /^[^[:space:]#]/ { insrv = ($0 ~ /^server:/) }
    /^port:[[:space:]]*[0-9]+/ { gsub(/[^0-9]/, "", $2); print $2; exit }
    insrv && /^[[:space:]]+port:[[:space:]]*[0-9]+/ { gsub(/[^0-9]/, "", $2); print $2; exit }
  ' "$CFG" 2>/dev/null || true)"
  echo "${p:-8317}"
}

# launchd 管理的进程 PID（没有则为空）
service_pid() {
  launchctl list 2>/dev/null | awk -v l="$LABEL" '$3==l && $1 ~ /^[0-9]+$/ {print $1}' || true
}

service_loaded() { launchctl list 2>/dev/null | awk -v l="$LABEL" '$3==l {f=1} END {exit !f}'; }

# 正在监听 CPA 端口的进程 PID
port_pids() { lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | sort -u | xargs || true; }

# 不归 launchd 管的 CPA 进程（比如在终端里前台跑的）：按端口找，排除后台服务自己
foreground_pids() {
  local svc p out=""
  svc="$(service_pid)"
  for p in $(port_pids "$(cpa_port)"); do
    if [ -n "$svc" ] && [ "$p" = "$svc" ]; then continue; fi
    # 只算 CPA 程序（lsof 显示的进程名为 cli-proxy…），别的程序占端口另行提示
    case "$(proc_name "$p")" in cli-proxy*) out="$out $p" ;; esac
  done
  echo "$out" | xargs
}

proc_name() { lsof -nP -p "$1" 2>/dev/null | awk 'NR==2 {print $1}'; }

port_listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

ensure_plist() {
  [ -f "$PLIST" ] && return 0
  local tpl="$SCRIPT_DIR/templates/com.local.cliproxyapi.plist"
  [ -f "$tpl" ] || die "没有 ${PLIST}，也找不到模板 ${tpl}（请在安装包目录里运行，或先运行 ./install.sh）"
  mkdir -p "$HOME/Library/LaunchAgents" "$CPA_HOME/logs"
  sed -e "s#__CPA_HOME__#$CPA_HOME#g" -e "s#<string>com.local.cliproxyapi</string>#<string>$LABEL</string>#" "$tpl" > "$PLIST"
  say "已生成后台服务配置 $PLIST"
}

wait_port() {
  local port="$1" i
  for i in $(seq 1 20); do
    port_listening "$port" && return 0
    sleep 0.5
  done
  return 1
}

check_config() {
  if ! grep -Eq '^[[:space:]]*disable-auto-update-panel:[[:space:]]*true' "$CFG" 2>/dev/null; then
    warn "config.yaml 里没有 'disable-auto-update-panel: true'，官方面板可能会覆盖二开面板（脚本不会替你改）"
  fi
}

do_start() {
  [ -x "$BIN" ] || die "找不到程序 ${BIN}（CPA_HOME=$CPA_HOME 对吗？）"
  [ -f "$CFG" ] || die "找不到配置 $CFG"
  local fg port
  fg="$(foreground_pids)"
  if [ -n "$fg" ]; then
    warn "检测到 CPA 正在终端里前台运行（PID: ${fg}）。"
    warn "请先到那个终端窗口按 Ctrl+C 停掉，再运行：$0 start"
    warn "（或运行 $0 stop --all 由脚本帮你正常关闭它）"
    exit 1
  fi
  if [ -n "$(service_pid)" ]; then
    say "CPA 已经在后台运行（PID $(service_pid)），无需启动"; return 0
  fi
  port="$(cpa_port)"
  if port_listening "$port"; then
    die "端口 $port 已被其他程序占用：$(lsof -nP -iTCP:"$port" -sTCP:LISTEN | awk 'NR==2 {print $1" PID "$2}')"
  fi
  ensure_plist
  mkdir -p "$CPA_HOME/logs"
  xattr -d com.apple.quarantine "$BIN" 2>/dev/null || true
  if service_loaded; then launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true; fi
  launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null || launchctl load "$PLIST"
  if wait_port "$port"; then
    say "CPA 已在后台启动（PID $(service_pid)，端口 ${port}）"
    say "管理面板：http://127.0.0.1:$port/management.html"
    say "关掉终端也会继续运行；登录 Mac 后自动启动"
  else
    warn "10 秒内端口 $port 没起来，看日志：tail -50 $CPA_HOME/logs/err.log"
    exit 1
  fi
  check_config
}

do_stop() {
  local all="${1:-}" fg p i
  if service_loaded; then
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
    for i in $(seq 1 20); do [ -z "$(service_pid)" ] && break; sleep 0.5; done
    say "后台服务已停止（不会被自动拉起；下次登录 Mac 会自动启动，除非运行 $0 disable）"
  else
    say "后台服务本来就没在运行"
  fi
  fg="$(foreground_pids)"
  if [ -n "$fg" ]; then
    if [ "$all" = "--all" ]; then
      for p in $fg; do kill -TERM "$p" 2>/dev/null || true; done
      for i in $(seq 1 20); do [ -z "$(foreground_pids)" ] && break; sleep 0.5; done
      if [ -n "$(foreground_pids)" ]; then warn "前台进程 $(foreground_pids) 10 秒内没退出，请到它的终端按 Ctrl+C"; exit 1; fi
      say "终端里前台运行的 CPA（PID ${fg}）已正常关闭"
    else
      warn "还有在终端里前台运行的 CPA（PID ${fg}），请到那个窗口按 Ctrl+C；或运行 $0 stop --all"
    fi
  fi
}

do_disable() {
  do_stop
  if [ -f "$PLIST" ]; then
    mv "$PLIST" "$PLIST.disabled"
    say "已关闭开机自启（配置移到 $PLIST.disabled）。重新开启：$0 start"
  fi
}

do_status() {
  local port pid fg
  port="$(cpa_port)"; pid="$(service_pid)"; fg="$(foreground_pids)"
  echo "安装目录：$CPA_HOME"
  local ver
  ver="$("$BIN" -h 2>&1 | grep -Eo 'Version: [^,]+' | head -1 || true)"
  echo "程序版本：${ver:-未知}"
  if [ -n "$pid" ]; then echo "后台服务：运行中（PID ${pid}）"
  elif service_loaded; then echo "后台服务：已加载但进程不在（可能在崩溃重启，看 err.log）"
  else echo "后台服务：未运行"; fi
  if [ -n "$fg" ]; then echo "终端前台进程：${fg}（不受本脚本管理，关掉那个终端窗口它就停了）"; fi
  if port_listening "$port"; then echo "端口 ${port}：监听中"; else echo "端口 ${port}：未监听"; fi
  if [ -f "$PLIST" ]; then echo "开机自启：已开启（${PLIST}）"; else echo "开机自启：未开启"; fi
  check_config
}

case "${1:-}" in
  start)   do_start ;;
  stop)    do_stop "${2:-}" ;;
  restart) do_stop; do_start ;;
  status)  do_status ;;
  logs)    mkdir -p "$CPA_HOME/logs"; touch "$CPA_HOME/logs/out.log" "$CPA_HOME/logs/err.log"; tail -n 50 -f "$CPA_HOME/logs/out.log" "$CPA_HOME/logs/err.log" ;;
  disable) do_disable ;;
  *) echo "用法：$0 {start|stop [--all]|restart|status|logs|disable}"; exit 2 ;;
esac
