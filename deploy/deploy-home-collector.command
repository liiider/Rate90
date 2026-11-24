#!/bin/bash
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/.." && pwd -P)
tmp=$(mktemp -d /tmp/rate90-deploy.XXXXXXXX)
host=lider@100.106.182.10
opts=(-o StrictHostKeyChecking=yes -o ConnectTimeout=18 -o ServerAliveInterval=30 -o ControlMaster=auto -o ControlPersist=300 -o "ControlPath=$tmp/ssh")
stage=
cleanup() {
  if [[ -n "$stage" ]]; then ssh "${opts[@]}" "$host" "rm -rf -- $stage" </dev/null >/dev/null 2>&1 || true; fi
  ssh "${opts[@]}" -O exit "$host" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
echo '正在检查家用 Linux 的运行环境…'
remote_dir=$(ssh "${opts[@]}" "$host" 'umask 077; cd "$HOME" && mktemp -d .rate90-stage.XXXXXXXX')
[[ "$remote_dir" =~ ^\.rate90-stage\.[A-Za-z0-9]+$ ]] || { echo '未获得远端安装目录'; exit 1; }
stage=$remote_dir
python3 "$root/deploy/package-home.py" "$tmp/release.tar.gz"
ssh "${opts[@]}" "$host" "cd $stage && tar -xzf -" <"$tmp/release.tar.gz"
probe=$(ssh "${opts[@]}" "$host" "bash $stage/home-service.sh probe")
if [[ "$probe" == *NEED_PACKAGES* ]]; then
  echo '正在安装发布所需的 Git、SSH、Python 和文件锁工具。'
  ssh -t "${opts[@]}" "$host" 'sudo apt-get update && sudo apt-get install -y git openssh-client python3 util-linux xz-utils'
fi
if [[ "$probe" == *NEED_SUPERVISOR* ]]; then
  echo '正在启用 Linux 用户服务，使采集和发布在退出 SSH 后继续运行。'
  ssh -t "${opts[@]}" "$host" 'if test -d /run/systemd/system; then sudo loginctl enable-linger "$(id -un)" && sudo systemctl start "user@$(id -u).service"; else sudo apt-get update && sudo apt-get install -y cron && sudo service cron start; fi'
  probe=$(ssh "${opts[@]}" "$host" "bash $stage/home-service.sh probe")
  [[ "$probe" != *NEED_SUPERVISOR* ]] || { echo 'systemd 用户服务仍未就绪'; exit 1; }
fi
machine=$(awk -F= '/^NODE_ARCH=/{print $2}' <<<"$probe")
if [[ -n "$machine" ]]; then
  case "$machine" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo "不支持的 Linux 架构 $machine"; exit 1;; esac
  echo "正在为 Linux $arch 准备 Node.js 22…"
  download=(curl -fsSL --proto '=https' --connect-timeout 12 --max-time 240 --retry 2)
  url=https://nodejs.org/dist/latest-v22.x
  "${download[@]}" "$url/SHASUMS256.txt" -o "$tmp/SHA256"
  row=$(awk -v arch="$arch" '$2 ~ ("^node-v22[.][0-9]+[.][0-9]+-linux-" arch "[.]tar[.]xz$") {print $1,$2;exit}' "$tmp/SHA256")
  read -r sha filename <<<"$row"
  [[ "$sha" =~ ^[0-9a-f]{64}$ && "$filename" =~ ^node-(v22\.[0-9]+\.[0-9]+)-linux-(x64|arm64)\.tar\.xz$ ]]
  version=${BASH_REMATCH[1]}
  "${download[@]}" "https://nodejs.org/dist/$version/$filename" -o "$tmp/node.tar.xz"
  printf '%s  node.tar.xz\n' "$sha" >"$tmp/node.sha256"
  (cd "$tmp" && shasum -a 256 -c node.sha256)
  ssh "${opts[@]}" "$host" "cat > $stage/node.tar.xz" <"$tmp/node.tar.xz"
  ssh "${opts[@]}" "$host" "cat > $stage/node.sha256" <"$tmp/node.sha256"
fi
ssh "${opts[@]}" "$host" "bash $stage/home-service.sh install"
pub=$(ssh "${opts[@]}" "$host" "bash $stage/home-service.sh key")
[[ "$pub" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+$ ]] || { echo '未取得发布公钥'; exit 1; }
repo=liiider/Rate90
registered=false
if command -v gh >/dev/null; then
  if gh api --paginate "repos/$repo/keys" --jq '.[] | select(.read_only == false) | .key' 2>/dev/null | awk '{print $1,$2}' | grep -Fqx "$pub"; then
    registered=true
  elif gh api --method POST "repos/$repo/keys" -f title='Rate90 home publisher' -f key="$pub" -F read_only=false >/dev/null 2>"$tmp/github-error"; then
    registered=true
  fi
fi
if [[ "$registered" != true ]]; then
  # Existing registration can still work when this Mac lacks repository-admin API access.
  if ! ssh "${opts[@]}" "$host" "bash $stage/home-service.sh access" </dev/null; then
    printf '%s\n' "$pub" | pbcopy
    echo '发布公钥已复制。在 GitHub 的 Deploy keys 页面粘贴公钥，勾选 Allow write access 并保存。'
    open "https://github.com/$repo/settings/keys/new"
    read -r -p '保存后按回车继续：' _reply </dev/tty
  fi
fi
ssh "${opts[@]}" "$host" "bash $stage/home-service.sh publisher"
