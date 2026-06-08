#!/bin/sh
# Backup loop: run a pass at start, then every MPP_BACKUP_INTERVAL_SEC. A failed
# pass is logged but never exits the container, so a transient Redis/Mongo/R2
# hiccup does not stop later backups. Local dev sets MPP_BACKUP_ENABLED=0 (no R2
# creds there), which idles the loop instead.
set -eu

ENABLED="${MPP_BACKUP_ENABLED:-1}"
INTERVAL="${MPP_BACKUP_INTERVAL_SEC:-21600}"

if [ "$ENABLED" != "1" ]; then
  echo "[backup] disabled (MPP_BACKUP_ENABLED=$ENABLED), idling"
  while true; do sleep 3600; done
fi

echo "[backup] starting: interval ${INTERVAL}s, keep ${MPP_BACKUP_KEEP:-3}, bucket ${MPP_BACKUP_BUCKET:-unset}"
while true; do
  at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if /usr/local/bin/backup.sh; then
    echo "[backup] ok ($at)"
  else
    echo "[backup] FAILED ($at)" >&2
  fi
  sleep "$INTERVAL"
done
