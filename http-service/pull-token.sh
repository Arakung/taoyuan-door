#!/usr/bin/env bash
# 从已登录的手机里直接取出 UUMSToken（绕过登录接口）
# 前提：手机 USB 调试已开、已授权本机，且 App 处于登录状态
# 用法： bash direct/pull-token.sh
set -uo pipefail

PKG="com.tyg.tygsmart"
OUT="http-service/token.json"

command -v adb >/dev/null 2>&1 || { echo "✗ 未找到 adb，请先安装 Android Platform Tools 并加入 PATH"; exit 1; }

echo "• 检查设备…"
adb devices | sed -n '2p' | grep -q 'device$' || { echo "✗ 没有已授权的在线设备，请插上线并确认 USB 调试授权"; exit 1; }

echo "• 读取 $PKG 的 SharedPreferences…"
DUMP="$(adb shell "su -c 'cat /data/data/$PKG/shared_prefs/*.xml' 2>/dev/null" 2>/dev/null)"
if [ -z "$DUMP" ]; then
  echo "  su 方式失败，尝试 run-as（仅对 debuggable 应用有效）…"
  DUMP="$(adb shell "run-as $PKG cat /data/data/$PKG/shared_prefs/*.xml 2>/dev/null" 2>/dev/null)"
fi
if [ -z "$DUMP" ]; then
  echo "✗ 读取失败。常见原因："
  echo "   1) 手机未 root，且应用非 debuggable —— 需要 root，或改用抓包方案"
  echo "   2) Android 10+ 的部分机型 su 需显式授权，请在手机上确认"
  exit 1
fi

echo "• 查找含 token 的字段："
MATCHES="$(printf '%s' "$DUMP" | grep -oE '<string name="[^"]*[Tt][Oo][Kk][Ee][Nn][^"]*">[^<]*</string>' || true)"
if [ -z "$MATCHES" ]; then
  echo "  没匹配到。下面是全部 string 字段，人工找一下："
  printf '%s' "$DUMP" | grep -oE '<string name="[^"]+">[^<]*</string>' | head -60
  exit 1
fi
printf '%s\n' "$MATCHES"

# 优先取名字里含 uums 的
TOKEN="$(printf '%s\n' "$MATCHES" | grep -i 'uums' | head -1 | sed -E 's/.*>(.*)<\/string>/\1/')"
[ -z "$TOKEN" ] && TOKEN="$(printf '%s\n' "$MATCHES" | head -1 | sed -E 's/.*>(.*)<\/string>/\1/')"

if [ -z "$TOKEN" ]; then
  echo "✗ 未能解析出 token 值"
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
printf '{\n  "source": "device",\n  "uumsToken": "%s",\n  "obtainedAt": %s\n}\n' "$TOKEN" "$(date +%s)000" > "$OUT"
echo
echo "✓ 已写入 $OUT"
echo "  UUMSToken：${TOKEN:0:6}****（长度 ${#TOKEN}）"
echo
echo "接下来："
echo "  export TYG_UUMS_TOKEN='$TOKEN'"
echo "  或把 uumsToken 填进 http-service/config.json"
