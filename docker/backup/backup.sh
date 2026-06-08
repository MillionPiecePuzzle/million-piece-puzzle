#!/bin/sh
# One backup pass: a gzipped mongodump archive and a Redis RDB snapshot, both
# pushed to the private R2 bucket under dated keys, then pruned to the newest N.
#
# Restore (from any host with the rclone `r2` remote and the matching DB tools):
#   Mongo:
#     rclone copy r2:$MPP_BACKUP_BUCKET/mongo-<ts>.archive.gz .
#     mongorestore --uri="<mongo-url>" --gzip --archive=mongo-<ts>.archive.gz --drop
#   Redis:
#     rclone copy r2:$MPP_BACKUP_BUCKET/redis-<ts>.rdb.gz .
#     gunzip redis-<ts>.rdb.gz
#     stop Redis, copy redis-<ts>.rdb into the data dir as dump.rdb, start Redis
#     (RDB loads on boot; run BGREWRITEAOF afterwards since appendonly is on).
set -eu

: "${MPP_MONGO_URL:?MPP_MONGO_URL required}"
: "${MPP_REDIS_URL:?MPP_REDIS_URL required}"
: "${MPP_BACKUP_BUCKET:?MPP_BACKUP_BUCKET required}"
MONGO_DB="${MPP_MONGO_DB:-mpp}"
REMOTE="${MPP_BACKUP_REMOTE:-r2}"
KEEP="${MPP_BACKUP_KEEP:-3}"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mongo_file="mongo-$ts.archive.gz"
redis_file="redis-$ts.rdb.gz"

mongodump --uri="$MPP_MONGO_URL" --db="$MONGO_DB" --gzip --archive="$tmp/$mongo_file" --quiet

# --rdb pulls a full RDB over the wire (SYNC), so the data volume need not be
# shared into this container.
redis-cli -u "$MPP_REDIS_URL" --rdb "$tmp/redis-$ts.rdb"
gzip "$tmp/redis-$ts.rdb"

rclone copyto "$tmp/$mongo_file" "$REMOTE:$MPP_BACKUP_BUCKET/$mongo_file"
rclone copyto "$tmp/$redis_file" "$REMOTE:$MPP_BACKUP_BUCKET/$redis_file"

# Keep the newest KEEP of each kind. Timestamps are ISO basic UTC, so a reverse
# lexicographic sort is newest-first; everything past KEEP is deleted.
prune() {
  rclone lsf "$REMOTE:$MPP_BACKUP_BUCKET/" --include "$1*" 2>/dev/null \
    | sort -r \
    | awk -v k="$KEEP" 'NR>k' \
    | while IFS= read -r f; do
        [ -n "$f" ] && rclone deletefile "$REMOTE:$MPP_BACKUP_BUCKET/$f"
      done
}
prune "mongo-"
prune "redis-"
