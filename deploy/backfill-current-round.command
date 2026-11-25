#!/bin/bash
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/.." && pwd -P)
target=${RATE90_SSH_TARGET:-${1:-}}
if [[ -z "$target" ]]; then read -r -p 'Linux SSH 地址（user@host）: ' target; fi
[[ "$target" =~ ^[A-Za-z0-9_][A-Za-z0-9_.@-]*$ ]] || { echo 'SSH 地址无效'; exit 2; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/scope"
echo '正在读取正式站本轮已完赛的比赛…'
if ! curl -fsSL --max-time 30 https://r90.liderrr.cc/ui/data/collected-index.js -o "$tmp/scope/collected-index.js"; then
  echo '正式站索引暂不可达，改读正式发布分支的快照。'
  curl -fsSL --max-time 30 https://raw.githubusercontent.com/liiider/Rate90/main/public/ui/data/collected-index.js -o "$tmp/scope/collected-index.js"
fi
echo '正在连接 Linux，独立补录本轮战术分析…'
tar_options=()
if [[ $(uname -s) == Darwin ]]; then tar_options+=(--no-xattrs --no-mac-metadata); fi
COPYFILE_DISABLE=1 tar "${tar_options[@]}" -czf - --exclude='*.test.mjs' -C "$root" server scripts/backfill-tactics-round.mjs -C "$tmp" scope |
  ssh -T -o StrictHostKeyChecking=yes -o ConnectTimeout=12 -o ServerAliveInterval=30 "$target" '
    set -eu
    umask 077
    stage=$(mktemp -d)
    trap '\''rm -rf "$stage"'\'' EXIT
    tar -xzf - -C "$stage"
    cd "$HOME/Rate90"
    test -s data/collector/rate90.sqlite
    node_bin="$HOME/.local/share/rate90-runtime/node/bin/node"
    if [ ! -x "$node_bin" ]; then
      pid=$(XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user show rate90-collector.service -p MainPID --value || true)
      node_bin=$(readlink -f "/proc/${pid:-0}/exe" || true)
    fi
    if [ ! -x "$node_bin" ]; then node_bin=$(command -v node); fi
    RATE90_TACTICS_SCOPE_DIR="$stage/scope" "$node_bin" --experimental-sqlite --env-file=.env.local "$stage/scripts/backfill-tactics-round.mjs"
  '
