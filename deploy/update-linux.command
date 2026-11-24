#!/bin/bash
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/.." && pwd -P)
bundle="$root/dist/rate90-linux-update.tar.gz"
tmp=$(mktemp -d /tmp/rate90-linux.XXXXXXXX)
stage=
host=${RATE90_SSH_TARGET:-${1:-}}
if [[ -z "$host" ]]; then read -r -p 'Linux SSH 地址（user@host）: ' host; fi
[[ "$host" =~ ^[A-Za-z0-9_][A-Za-z0-9_.@-]*$ ]] || { echo 'SSH 地址无效'; exit 2; }
opts=(-o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ControlMaster=auto -o ControlPersist=120 -o "ControlPath=$tmp/ssh")
cleanup() {
  if [[ -n "$stage" ]]; then ssh "${opts[@]}" "$host" "rm -rf -- $stage" </dev/null >/dev/null 2>&1 || true; fi
  ssh "${opts[@]}" -O exit "$host" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
cd "$root/dist"
shasum -a 256 -c rate90-linux-update.sha256
expected=$(awk '{print $1}' rate90-linux-update.sha256)
[[ "$expected" =~ ^[0-9a-f]{64}$ ]]
echo '正在连接 Linux 并传输归档与后端更新…'
candidate=$(ssh "${opts[@]}" "$host" 'cd "$HOME" && test "$(cat Rate90/.rate90-backend)" = systemd && umask 077 && mktemp -d .rate90-update.XXXXXXXX')
[[ "$candidate" =~ ^\.rate90-update\.[A-Za-z0-9]+$ ]]
stage=$candidate
ssh "${opts[@]}" "$host" "cat > $stage/update.tar.gz" < "$bundle"
ssh "${opts[@]}" "$host" "cd $stage && echo '$expected  update.tar.gz' | sha256sum -c - && tar -xzf update.tar.gz && bash home-service.sh install && bash archive-timer.sh" | tee "$tmp/result"
grep -qx RATE90_LINUX_UPDATED "$tmp/result"
{ date -u; cat "$root/dist/rate90-linux-update.sha256" "$tmp/result"; } > "$tmp/receipt"
cp "$tmp/receipt" "$root/dist/rate90-linux-update.receipt.tmp"
mv "$root/dist/rate90-linux-update.receipt.tmp" "$root/dist/rate90-linux-update.receipt"
