#!/bin/sh
# 桃园谷开门 · QNAP 无 Docker 启动脚本
#
# 用途：NAS 拉不到 Docker Hub 镜像时，用官方静态 Node 直接跑（不装 Entware、不污染系统分区）。
# 文件放在 /share/Container/taoyuan/ 下，和 core.mjs、serve.mjs、config.json 同级。
#
#   sh run-without-docker.sh start        # 首次会自动下载 Node 并启动
#   sh run-without-docker.sh stop
#   sh run-without-docker.sh status
#   sh run-without-docker.sh autostart    # 注册开机自启（写 /etc/config/crontab）
#
# 可用环境变量覆盖：TYG_DIR（默认 /share/Container/taoyuan）、NODE_VER、PORT

set -e

TYG_DIR="${TYG_DIR:-/share/Container/taoyuan}"
NODE_VER="${NODE_VER:-v22.11.0}"
PORT="${PORT:-8787}"
HOST="${HOST:-0.0.0.0}"
PIDFILE="$TYG_DIR/taoyuan.pid"
LOGFILE="$TYG_DIR/run.log"

case "$(uname -m)" in
  x86_64|amd64)        ARCH=linux-x64 ;;
  aarch64|arm64)       ARCH=linux-arm64 ;;
  armv7l|armv6l)       ARCH=linux-armv7l ;;
  *) echo "✗ 不支持的架构：$(uname -m)"; exit 1 ;;
esac

NODE_BIN="$TYG_DIR/node/bin/node"

need_node() {
  if [ -x "$NODE_BIN" ]; then return 0; fi
  echo "→ 未检测到 Node，开始下载 $NODE_VER ($ARCH)"
  mkdir -p "$TYG_DIR/node"
  TMP="$TYG_DIR/node.tar.gz"
  URL1="https://npmmirror.com/mirrors/node/$NODE_VER/node-$NODE_VER-$ARCH.tar.gz"
  URL2="https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-$ARCH.tar.gz"
  if ! curl -fL --retry 2 -m 600 -o "$TMP" "$URL1" 2>/dev/null; then
    echo "  镜像站失败，改试官方源…"
    curl -fL --retry 2 -m 600 -o "$TMP" "$URL2"
  fi
  tar -xzf "$TMP" -C "$TYG_DIR/node" --strip-components=1
  rm -f "$TMP"
  echo "✓ Node 就绪：$("$NODE_BIN" -v)"
}

is_running() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

case "${1:-start}" in
  start)
    if is_running; then echo "已在运行（PID $(cat "$PIDFILE")）"; exit 0; fi
    need_node
    [ -f "$TYG_DIR/serve.mjs" ] || { echo "✗ 缺少 $TYG_DIR/serve.mjs"; exit 1; }
    [ -f "$TYG_DIR/config.json" ] || { echo "✗ 缺少 $TYG_DIR/config.json"; exit 1; }
    TZ=Asia/Shanghai PORT="$PORT" HOST="$HOST" \
      nohup "$NODE_BIN" "$TYG_DIR/serve.mjs" >> "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    sleep 2
    if is_running; then
      echo "✓ 已启动（PID $(cat "$PIDFILE")，端口 $PORT）"
      tail -n 3 "$LOGFILE" 2>/dev/null || true
    else
      echo "✗ 启动失败，日志："; tail -n 20 "$LOGFILE"; exit 1
    fi
    ;;
  stop)
    if is_running; then kill "$(cat "$PIDFILE")" && rm -f "$PIDFILE" && echo "✓ 已停止"; else echo "未在运行"; fi
    ;;
  status)
    if is_running; then
      echo "运行中（PID $(cat "$PIDFILE")）"
      curl -s -m 5 "http://127.0.0.1:$PORT/health" || echo "（健康检查无响应）"
      echo
    else
      echo "未运行"
    fi
    ;;
  autostart)
    LINE="@reboot $TYG_DIR/run-without-docker.sh start"
    if grep -qF "$LINE" /etc/config/crontab 2>/dev/null; then
      echo "已存在开机任务"
    else
      echo "$LINE" >> /etc/config/crontab
      crontab /etc/config/crontab
      echo "✓ 已写入开机自启（/etc/config/crontab）"
    fi
    ;;
  *)
    echo "用法：sh $0 {start|stop|status|autostart}"; exit 1 ;;
esac
