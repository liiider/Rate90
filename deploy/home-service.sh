#!/usr/bin/env bash
set -euo pipefail
umask 077
stage=$(cd "$(dirname "$0")" && pwd -P)
app="$HOME/Rate90"
ops="$HOME/.local/share/rate90-publish"
runtime="$HOME/.local/share/rate90-runtime"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [[ -S "$XDG_RUNTIME_DIR/bus" ]]; then export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"; fi
find_node() {
  local executable
  for executable in "$runtime/node/bin/node" "$(command -v node || true)" "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node; do
    if [[ -x "$executable" ]] && "$executable" --experimental-sqlite --env-file-if-exists=/dev/null -e "require('node:sqlite')" >/dev/null 2>&1; then
      printf '%s\n' "$executable"; return 0
    fi
  done
  return 1
}
docker_ok() { command -v docker >/dev/null && docker info >/dev/null 2>&1; }
user_service() {
  systemctl --user show-environment >/dev/null 2>&1 &&
    [[ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" == yes ]]
}
cron_ok() {
  command -v crontab >/dev/null && { pgrep -x cron >/dev/null || pgrep -x crond >/dev/null; }
}
cron_job() {
  local label=$1 job=$2
  local old="$stage/crontab.old" new="$stage/crontab.new"
  if ! crontab -l >"$old" 2>"$old.err"; then
    if ! LC_ALL=C crontab -l >"$old" 2>"$old.err"; then
      grep -qi 'no crontab' "$old.err" || { cat "$old.err" >&2; return 1; }
    fi
  fi
  awk -v suffix="# Rate90-$label" 'index($0,suffix)==0' "$old" > "$new"
  printf '%s # Rate90-%s\n' "$job" "$label" >> "$new"
  crontab "$new"
}
if [[ "$1" == probe ]]; then
  if ! { command -v git && command -v ssh-keygen && command -v python3 && command -v flock; } >/dev/null; then echo NEED_PACKAGES; fi
  if ! user_service; then loginctl enable-linger "$(id -un)" </dev/null >/dev/null 2>&1 || true; fi
  # New machines can run the collector as an unprivileged native Node process.
  if ! find_node >/dev/null && { ! docker_ok || [[ -f "$app/.rate90-backend" && "$(cat "$app/.rate90-backend")" != docker ]]; }; then echo "NODE_ARCH=$(uname -m)"; fi
  if ! user_service && ! cron_ok; then echo NEED_SUPERVISOR; fi
  exit
fi
if [[ "$1" == key ]]; then
  mkdir -p "$ops"; chmod 700 "$ops"
  if [[ ! -f "$ops/id_ed25519" ]]; then ssh-keygen -q -t ed25519 -N '' -C Rate90-publisher -f "$ops/id_ed25519"; fi
  ssh-keygen -y -f "$ops/id_ed25519" | awk '{print $1,$2}'
  exit
fi
if [[ "$1" == publisher || "$1" == access ]]; then
  mkdir -p "$ops"
  install -m 600 "$stage/github-known-hosts" "$ops/known_hosts"
  install -m 700 "$stage/publish-home.py" "$ops/publish.py.new"
  mv "$ops/publish.py.new" "$ops/publish.py"
  python3 "$ops/publish.py" --check-access
  if [[ "$1" == access ]]; then exit; fi
  if python3 "$ops/publish.py"; then :; else echo '首次发布等待重试，后台将继续执行。'; fi
  if user_service; then
    mkdir -p "$HOME/.config/systemd/user"
    cat > "$HOME/.config/systemd/user/rate90-publish.service" <<UNIT
[Unit]
Description=Publish completed Rate90 match snapshots
After=network-online.target
[Service]
ExecStart=$(command -v python3) "%h/.local/share/rate90-publish/publish.py" --watch
Restart=always
RestartSec=15
[Install]
WantedBy=default.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable rate90-publish.service
    systemctl --user restart rate90-publish.service
    systemctl --user is-active --quiet rate90-publish.service
  elif cron_ok; then
    cron_job publisher "* * * * * flock -n '$ops/process.lock' python3 '$ops/publish.py' --watch >>'$ops/publish.log' 2>&1"
  else echo '没有可常驻的 systemd 用户服务或 cron'; exit 1; fi
  echo RATE90_PUBLISHER_ACTIVE
  exit
fi
[[ "$1" == install ]] || exit 2
if [[ -f "$stage/node.tar.xz" ]]; then
  (cd "$stage" && sha256sum -c node.sha256)
  mkdir -p "$runtime"
  candidate=$(mktemp -d "$runtime/node.XXXXXXXX")
  tar -xJf "$stage/node.tar.xz" --strip-components=1 -C "$candidate"
  "$candidate/bin/node" --experimental-sqlite -e "require('node:sqlite')" >/dev/null
  ln -s "$candidate" "$runtime/current.$$"
  mv -Tf "$runtime/current.$$" "$runtime/node"
fi
node_bin=$(find_node || true)
if [[ -n "$node_bin" ]]; then export PATH="$(dirname "$node_bin"):$PATH"; fi
if [[ -f "$app/.rate90-backend" ]]; then backend=$(cat "$app/.rate90-backend"); else backend=''; fi
if [[ "$backend" != cron ]] && { user_service || docker_ok; }; then
  (cd "$stage" && bash install.sh)
  exit
fi
cron_ok || { echo 'Linux 缺少可用的后台服务'; exit 1; }
[[ -n "$node_bin" ]] || { echo '无法启动支持 SQLite 的 Node'; exit 1; }
[[ -z "$backend" || "$backend" == cron ]] || { echo "需要恢复既有 $backend 服务"; exit 1; }
mkdir -p "$HOME/.local/share"
exec 9>"$HOME/.local/share/rate90-deploy.lock"
flock -n 9
if [[ ! -e "$app" ]]; then
  [[ -s "$stage/bsd.env" && -s "$stage/seed.tar.gz" ]] || { echo '首次安装缺少 BSD 密钥或数据库'; exit 1; }
  mkdir -p "$stage/release/data/collector"
  tar -xzf "$stage/seed.tar.gz" -C "$stage/release/data/collector" rate90.sqlite
  install -m 600 "$stage/bsd.env" "$stage/release/.env.local"
  cp "$stage/release/REVISION" "$stage/release/.rate90-release"
  echo cron > "$stage/release/.rate90-backend"
  mv -T "$stage/release" "$app"
else
  [[ "$backend" == cron ]] || { echo '已有不同的采集器安装'; exit 1; }
  if ! cmp -s "$app/.rate90-release" "$stage/release/REVISION"; then
    (service=rate90-collector; revision=$(cat "$stage/release/REVISION"); source "$stage/upgrade.sh")
  fi
fi
cd "$app"
"$node_bin" --experimental-sqlite --env-file=.env.local scripts/collect.mjs --publish-only
# Each run exits after checking the queue. The SQLite lock serializes overlapping runs.
cat > "$app/.run-collector.new" <<RUN
#!/bin/bash
set -eu
cd '$app'
[[ ! -e .rate90-paused ]] || exit 0
exec '$node_bin' --experimental-sqlite --env-file=.env.local scripts/collect.mjs
RUN
chmod 700 "$app/.run-collector.new"
mv "$app/.run-collector.new" "$app/.run-collector"
cron_job collector "* * * * * flock -n '$app/.rate90-job.lock' '$app/.run-collector' >>'$app/collector.log' 2>&1"
echo RATE90_COLLECTOR_OK
