# Upgrade a managed collector in place, retaining the live SQLite database and credentials.
[[ -f "$app/.rate90-backend" && -f "$app/.rate90-release" ]] || { echo "现有目录不是受管采集器，已保留。"; exit 1; }
previous=$(cat "$app/.rate90-release")
managed_revision() {
  [[ "$1" =~ ^pkg-[0-9a-f]{64}$ || "$1" == c12b0511c7e1fb43486e8d058401f9de7f3700fa || "$1" == a270350fdadb4f34829acf75c212ad7e74524bb4 ]]
}
managed_revision "$previous" || { echo "无法匹配既有采集器版本：$previous"; exit 1; }
backend=$(cat "$app/.rate90-backend")
case "$backend" in
  docker)
    label=$(docker inspect -f '{{index .Config.Labels "cc.liderrr.rate90.release"}}' "$service")
    mount=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app"}}{{.Source}}{{end}}{{end}}' "$service")
    [[ "$mount" == "$app" ]] && managed_revision "$label" || { echo '容器不属于该安装'; exit 1; }
    image=$(docker inspect -f '{{.Image}}' "$service")
    run_node() { docker run --rm --user "$(id -u):$(id -g)" --mount "type=bind,src=$app,dst=/app" --workdir /app "$image" node --experimental-sqlite --env-file=.env.local "$@"; }
    running() { [[ "$(docker inspect -f '{{.State.Running}}' "$service")" == true ]]; }
    service_stop() { docker stop "$service" >/dev/null; }
    service_start() { docker start "$service" >/dev/null; }
    ;;
  systemd)
    [[ "$(systemctl --user show "$service" -p WorkingDirectory --value)" == "$app" ]] || { echo "采集服务目录与安装路径不符"; exit 1; }
    run_node() { node --experimental-sqlite --env-file=.env.local "$@"; }
    running() { systemctl --user is-active --quiet "$service"; }
    service_stop() { systemctl --user stop "$service"; }
    service_start() { systemctl --user start "$service"; }
    ;;
  cron)
    run_node() { node --experimental-sqlite --env-file=.env.local "$@"; }
    running() { [[ ! -e "$app/.rate90-paused" ]] && crontab -l | grep -F '# Rate90-collector' >/dev/null; }
    service_stop() {
      touch "$app/.rate90-paused"
      if [[ -z "${cron_lock:-}" ]]; then exec 8>"$app/.rate90-job.lock"; flock 8; cron_lock=true; fi
    }
    service_start() { rm -f "$app/.rate90-paused"; }
    ;;
  *) echo "未知的采集服务：$backend"; exit 1 ;;
esac
cd "$app"
[[ -s data/collector/rate90.sqlite && -s .env.local ]]
check_version() {
  run_node --input-type=module -e "import {ruleVersion} from './server/recommend.mjs'; import {assetDirectory,readAsset} from './server/collected-feed.mjs'; if((await readAsset(assetDirectory,'collected-index')).ruleVersion !== ruleVersion) process.exit(1); console.log(ruleVersion);"
}
archive_seed="$stage/bsd-raw.sqlite"
if [[ -f "$archive_seed" ]]; then
  python3 "$stage/bsd-seed.py" merge "$archive_seed" "$app/data/collector/bsd-raw.sqlite"
elif [[ "$previous" == "$revision" ]] && running && check_version; then echo RATE90_COLLECTOR_OK; exit 0; fi
was_running=false
saved="$stage/previous.tar"
queue="$app/data/collector/rate90.sqlite"
backup_queue() {
  python3 - "$1" "$2" <<'PY'
import sqlite3, sys
from pathlib import Path
with sqlite3.connect(Path(sys.argv[1]).resolve().as_uri()+'?mode=ro', uri=True) as src, sqlite3.connect(sys.argv[2]) as dest:
    src.backup(dest)
PY
}
had_index=false
if [[ -f public/ui/data/collected-index.js ]]; then had_index=true; fi
recover() {
  code=$?
  trap - EXIT
  if (( code != 0 )); then
    service_stop || true
    if [[ -e "$saved" ]]; then
      tar -xf "$saved" -C "$app"
      if [[ "$had_index" == false ]]; then rm -f "$app/public/ui/data/collected-index.js"; fi
    fi
    if [[ -f "$stage/previous-queue.sqlite" ]]; then backup_queue "$stage/previous-queue.sqlite" "$queue"; fi
    if [[ "$was_running" == true ]]; then service_start; fi
  fi
  exit "$code"
}
trap recover EXIT
if running; then was_running=true; service_stop; fi
items=(server scripts package.json REVISION .rate90-release data/bsd-sample.json public/ui/data/fixtures.js public/ui/data/teams.js public/ui/data/process-ratings.js)
if [[ -f public/ui/data/tactical-edits-20261125.js ]]; then items+=(public/ui/data/tactical-edits-20261125.js); fi
if [[ -f public/ui/data/collected-index.js ]]; then items+=(public/ui/data/collected-index.js); fi
tar -cf "$saved.part" "${items[@]}"
mv "$saved.part" "$saved"
if [[ -f "$archive_seed" || -f "$stage/CODE_ONLY" ]]; then
  backup_queue "$queue" "$stage/previous-queue.part"
  mv "$stage/previous-queue.part" "$stage/previous-queue.sqlite"
fi
# The release contains code, the offline archive and its immutable day files only.
files=(server scripts package.json REVISION)
if [[ -f "$stage/CODE_ONLY" ]]; then
  files+=(public/ui/data/tactical-edits-20261125.js)
else
  files+=(data/bsd-sample.json public)
fi
(cd "$stage/release" && tar -cf - "${files[@]}") | tar -xf -
if [[ -f "$archive_seed" ]]; then
  run_node scripts/collect.mjs --publish-only --import-archive
else
  run_node scripts/collect.mjs --publish-only
fi
check_version
service_start
running
cp REVISION .rate90-release.new
mv .rate90-release.new .rate90-release
echo RATE90_COLLECTOR_OK
