#!/usr/bin/env bash
set -euo pipefail
umask 077
stage=$(pwd -P)
app="$HOME/Rate90"
service=rate90-collector
image=node:22-bookworm-slim
revision=$(cat "$stage/release/REVISION")
mkdir -p "$HOME/.local/share"
exec 9>"$HOME/.local/share/rate90-deploy.lock"
flock -n 9 || { echo "另一次部署正在执行"; exit 1; }

if [[ -e "$app" ]]; then
  # An interrupted first installation can resume through the original setup.
  if [[ ! -f "$app/.rate90-backend" || ! -f "$app/.rate90-release" ]]; then echo "服务器已有非受管目录 $app"; exit 1; fi
  resume=false
  if cmp -s "$app/.rate90-release" "$stage/release/REVISION"; then
    case "$(cat "$app/.rate90-backend")" in
      docker) if docker info >/dev/null 2>&1 && ! docker container inspect "$service" >/dev/null 2>&1; then resume=true; fi ;;
      systemd) if [[ ! -e "$HOME/.config/systemd/user/$service.service" ]]; then resume=true; fi ;;
    esac
  fi
  if [[ "$resume" != true ]]; then source "$stage/upgrade.sh"; exit; fi
fi
node_bin=$(command -v node || true)
host_ready=false
if [[ -n "$node_bin" ]] && "$node_bin" --experimental-sqlite --env-file-if-exists=/dev/null -e "require('node:sqlite')" >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  host_ready=true
fi
docker_ready=false
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then docker_ready=true; fi
if [[ -f "$app/.rate90-backend" ]]; then
  backend=$(cat "$app/.rate90-backend")
elif "$host_ready" && [[ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" == yes ]]; then
  backend=systemd
elif "$docker_ready"; then
  backend=docker
elif "$host_ready"; then
  backend=systemd
else
  echo "服务器上未找到可用的 Docker 或支持 SQLite 的 Node.js 用户服务。"
  exit 1
fi
case "$backend" in
  docker)
    "$docker_ready" || { echo "当前用户无法访问 Docker"; exit 1; }
    existing=$(docker ps -a --filter "name=^/${service}$" --format '{{.Names}}')
    if [[ -n "$existing" && "$(docker inspect -f '{{index .Config.Labels "cc.liderrr.rate90.release"}}' "$service")" != "$revision" ]]; then
      echo "已有同名容器，已保留。"; exit 1
    fi
    docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image"
    ;;
  systemd)
    "$host_ready" || { echo "Node.js 或 systemd 用户服务不可用"; exit 1; }
    ;;
  *) echo "未知的既有采集方式"; exit 1 ;;
esac

if [[ ! -d "$app" ]]; then
  if systemctl --user cat "$service.service" >/dev/null 2>&1; then
    echo "已经存在 $service.service，请先确认旧服务。"; exit 1
  fi
  [[ -s "$stage/bsd.env" && -s "$stage/seed.tar.gz" ]] || { echo '首次安装缺少 BSD 密钥或数据库'; exit 1; }
  mkdir -p "$stage/release/data/collector"
  tar -xzf "$stage/seed.tar.gz" -C "$stage/release/data/collector" rate90.sqlite
  install -m 600 "$stage/bsd.env" "$stage/release/.env.local"
  cp "$stage/release/REVISION" "$stage/release/.rate90-release"
  echo "$backend" > "$stage/release/.rate90-backend"
  mv -T "$stage/release" "$app"
fi
cd "$app"
flags=(--experimental-sqlite --env-file=.env.local)
if [[ "$backend" == docker ]]; then
  container_args=(--user "$(id -u):$(id -g)" --mount "type=bind,src=$app,dst=/app" --workdir /app)
  run_node() { docker run --rm "${container_args[@]}" "$image" node "${flags[@]}" "$@"; }
  already=$(docker inspect -f '{{.State.Running}}' "$service" 2>/dev/null || true)
else
  run_node() { "$node_bin" "${flags[@]}" "$@"; }
  already=false
  if systemctl --user is-active --quiet "$service"; then already=true; fi
fi
run_node -e "const {DatabaseSync}=require('node:sqlite'); if(!process.env.BSD_API_TOKEN) throw Error('未找到 BSD_API_TOKEN'); const db=new DatabaseSync('data/collector/rate90.sqlite',{readOnly:true}); console.log('现有比赛记录',db.prepare('SELECT count(*) AS n FROM games').get().n); db.close()"
if [[ "$already" != true ]]; then
  run_node scripts/collect.mjs --publish-only
  if [[ "$backend" == docker ]]; then
    if [[ -n "$existing" ]]; then docker start "$service"; else
      docker run -d --name "$service" --label "cc.liderrr.rate90.release=$revision" --restart unless-stopped --log-opt max-size=10m --log-opt max-file=3 "${container_args[@]}" "$image" node "${flags[@]}" scripts/collect.mjs --watch
    fi
  else
    mkdir -p "$HOME/.config/systemd/user"
    cat > "$HOME/.config/systemd/user/$service.service" <<UNIT
[Unit]
Description=Rate90 football fixture collector
After=network-online.target

[Service]
WorkingDirectory=%h/Rate90
ExecStart="$node_bin" --experimental-sqlite --env-file=.env.local scripts/collect.mjs --watch
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable --now "$service"
  fi
fi
if [[ "$backend" == docker ]]; then
  logs() { docker logs --tail 35 "$service" 2>&1; }
  running() { [[ "$(docker inspect -f '{{.State.Running}}' "$service")" == true ]]; }
else
  logs() { journalctl --user -u "$service" -n 35 -o cat --no-pager; }
  running() { systemctl --user is-active --quiet "$service"; }
  if [[ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" != yes ]]; then
    loginctl enable-linger "$(id -un)" || echo "当前服务已启动；离线常驻需在 Linux 执行 loginctl enable-linger $(id -un)"
  fi
fi
echo "服务方式 $backend，提交 $revision，等待首条采集结果。"
for ((i=0; i<90; i++)); do
  if ! running; then echo "采集服务已停止"; logs; exit 1; fi
  report=$(logs | awk '/"calendars":/ {line=$0} END {print line}')
  if [[ -n "$report" ]]; then
    printf '%s\n' "$report"
    if [[ "$report" == *'"errors":[]'* ]]; then echo RATE90_COLLECTOR_OK; exit 0; fi
    echo "服务已启动，数据源返回了上方错误。"; exit 1
  fi
  sleep 2
done
logs
echo "服务仍在运行，首轮采集尚未返回。"
exit 2
