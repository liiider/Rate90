#!/bin/bash
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/.." && pwd -P)
tmp=$(mktemp -d /tmp/rate90-linux.XXXXXXXX)
code_only=false
if [[ ${1:-} == --code-only ]]; then code_only=true; shift; fi
bundle="$root/dist/rate90-linux-update.tar.gz"
stage=
host=${RATE90_SSH_TARGET:-${1:-}}
if [[ -z "$host" ]]; then read -r -p 'Linux SSH 地址（user@host）: ' host; fi
[[ "$host" =~ ^[A-Za-z0-9_][A-Za-z0-9_.@-]*$ ]] || { echo 'SSH 地址无效'; exit 2; }
opts=(-S "$tmp/ssh" -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
connected() { ssh "${opts[@]}" -O check "$host" >/dev/null 2>&1; }
connect() {
  local attempt status
  if connected; then return 0; fi
  for attempt in 1 2 3; do
    echo "正在连接 Linux SSH（第 $attempt/3 次）…" >&2
    if LC_ALL=C ssh "${opts[@]}" -o ControlPersist=180 -M -fN "$host" 2>"$tmp/ssh-error"; then
      if connected; then return 0; fi
      echo 'SSH 连接已关闭。' >&2
    else
      status=$?
      cat "$tmp/ssh-error" >&2
      if [[ $status != 255 ]] || ! grep -Eiq 'connection (closed|reset|refused|timed out)|broken pipe|operation timed out|no route to host|network is unreachable|timeout waiting for' "$tmp/ssh-error"; then
        return "$status"
      fi
    fi
    if [[ $attempt -lt 3 ]]; then sleep "$((2 * attempt))"; fi
  done
  echo "SSH 连续三次未能建立连接。可在 Mac 终端运行 ssh $host 检查登录。" >&2
  return 255
}
cleanup() {
  local status=$?
  if connected; then
    if [[ -n "$stage" && $status != 255 ]]; then ssh "${opts[@]}" -o BatchMode=yes "$host" "rm -rf -- $stage" </dev/null >/dev/null 2>&1 || true; fi
    ssh "${opts[@]}" -O exit "$host" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT
if [[ "$code_only" == true ]]; then mkdir -p "$root/dist"; fi
cd "$root/dist"
if [[ "$code_only" == true ]]; then
  bundle="$tmp/code-update.tar.gz"
  python3 "$root/deploy/package-home.py" "$bundle" --code-update
  expected=$(shasum -a 256 "$bundle" | cut -d' ' -f1)
else
  shasum -a 256 -c rate90-linux-update.sha256
  expected=$(awk '{print $1}' rate90-linux-update.sha256)
fi
[[ "$expected" =~ ^[0-9a-f]{64}$ ]]
connect
echo 'SSH 已登录，正在检查 Linux 部署目录…'
candidate=$(ssh "${opts[@]}" "$host" 'cd "$HOME" && test "$(cat Rate90/.rate90-backend)" = systemd && umask 077 && mktemp -d .rate90-update.XXXXXXXX')
[[ "$candidate" =~ ^\.rate90-update\.[A-Za-z0-9]+$ ]]
stage=$candidate
echo '正在上传更新包…'
for attempt in 1 2 3; do
  if ssh "${opts[@]}" "$host" "cat > $stage/update.part && mv $stage/update.part $stage/update.tar.gz" < "$bundle"; then break; else status=$?; fi
  if [[ $status != 255 || $attempt == 3 ]]; then exit "$status"; fi
  echo '上传连接中断，重新传送当前更新包。' >&2
  connect
done
echo '上传完成，正在 Linux 校验并安装…'
if [[ "$code_only" == true ]]; then
  ssh "${opts[@]}" "$host" "cd $stage && echo '$expected  update.tar.gz' | sha256sum -c - && tar -xzf update.tar.gz && test -f CODE_ONLY && bash home-service.sh install && bash home-service.sh publisher && cat release/REVISION" | tee "$tmp/result"
  grep -qx RATE90_COLLECTOR_OK "$tmp/result"
  grep -qx RATE90_PUBLISHER_ACTIVE "$tmp/result"
  receipt=$(mktemp "$root/dist/rate90-code-update.receipt.XXXXXXXX")
  { date -u; cat "$tmp/result"; } > "$receipt"
  mv "$receipt" "$root/dist/rate90-code-update.receipt"
  # Use the installed collector's Node and environment; no key leaves Linux.
  remote_node='cd "$HOME/Rate90" && export XDG_RUNTIME_DIR="/run/user/$(id -u)" && pid=$(systemctl --user show rate90-collector.service -p MainPID --value) && node_bin=$(readlink -f "/proc/$pid/exe") && test -x "$node_bin"'
  if ssh "${opts[@]}" "$host" "$remote_node && \"\$node_bin\" --env-file=.env.local -e 'process.exit(process.env.RATE90_AI_KEY || process.env.OPENAI_API_KEY ? 0 : 42)'"; then
    echo '沿用 Linux 已有 AI 配置。'
  else
    status=$?
    [[ $status == 42 ]] || exit "$status"
    network_container=${RATE90_AI_NETWORK_CONTAINER:-}
    relay=''
    if [[ -n "$network_container" ]]; then
      [[ "$network_container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo 'Docker 容器名无效'; exit 2; }
      relay="socket=\$(python3 \"\$HOME/$stage/openai-network.py\" '$network_container') &&"
    fi
    ssh -t "${opts[@]}" "$host" "$remote_node && socket='' && $relay python3 \"\$HOME/$stage/configure-openai.py\" \${socket:+--socket \"\$socket\"} --skip-snapshot-wait"
  fi
  ssh "${opts[@]}" "$host" "$remote_node && \"\$node_bin\" --experimental-sqlite --env-file=.env.local scripts/backfill-tactics-round.mjs"
  exit
fi
ssh "${opts[@]}" "$host" "cd $stage && echo '$expected  update.tar.gz' | sha256sum -c - && tar -xzf update.tar.gz && bash home-service.sh install && bash archive-timer.sh" | tee "$tmp/result"
grep -qx RATE90_LINUX_UPDATED "$tmp/result"
{ date -u; cat "$root/dist/rate90-linux-update.sha256" "$tmp/result"; } > "$tmp/receipt"
cp "$tmp/receipt" "$root/dist/rate90-linux-update.receipt.tmp"
mv "$root/dist/rate90-linux-update.receipt.tmp" "$root/dist/rate90-linux-update.receipt"
