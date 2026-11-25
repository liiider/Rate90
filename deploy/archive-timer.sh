#!/usr/bin/env bash
set -euo pipefail
umask 077
app="$HOME/Rate90"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [[ -S "$XDG_RUNTIME_DIR/bus" ]]; then export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"; fi
[[ "$(cat "$app/.rate90-backend")" == systemd ]]
systemctl --user is-active --quiet rate90-collector.service
pid=$(systemctl --user show rate90-collector.service -p MainPID --value)
node_bin=$(readlink -f "/proc/$pid/exe")
"$node_bin" --experimental-sqlite -e "require('node:sqlite')"
unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"
cat > "$unit_dir/rate90-bsd-incremental.service.new" <<UNIT
[Unit]
Description=Archive new and recently changed BSD match data
After=network-online.target
[Service]
Type=oneshot
WorkingDirectory=%h/Rate90
ExecStart="$node_bin" --experimental-sqlite --env-file=.env.local scripts/pull-bsd-local.mjs --incremental
UNIT
cat > "$unit_dir/rate90-bsd-incremental.timer.new" <<'UNIT'
[Unit]
Description=Update the Rate90 BSD archive daily
[Timer]
OnActiveSec=10min
OnCalendar=*-*-* 01:45:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
for kind in service timer; do
  mv "$unit_dir/rate90-bsd-incremental.$kind.new" "$unit_dir/rate90-bsd-incremental.$kind"
done
systemctl --user daemon-reload
systemctl --user enable --now rate90-bsd-incremental.timer
systemctl --user is-active --quiet rate90-bsd-incremental.timer
systemctl --user list-timers rate90-bsd-incremental.timer --no-pager
echo RATE90_LINUX_UPDATED
