#!/bin/sh
# One backup pass: a gzipped dump of every stateful service on the host, pushed to
# the private R2 bucket under dated keys, then pruned to the newest N of each kind.
#
#   mongo-<ts>.archive.gz       game log: users, cluster merges
#   redis-<ts>.rdb.gz           live board state
#   umami-<ts>.sql.gz           analytics
#   coolify-db-<ts>.sql.gz      Coolify's own Postgres
#   coolify-data-<ts>.tar.gz    /data/coolify: APP_KEY, ssh keys, proxy config
#
# The game's own two dumps run and upload first, so a failure on the Coolify or
# Umami half still leaves the pass with what matters most already on R2.
#
# Restore (from any host with the rclone `r2` remote and the matching DB tools):
#   Mongo:
#     rclone copy r2:$MPP_BACKUP_BUCKET/mongo-<ts>.archive.gz .
#     mongorestore --uri="<mongo-url>" --gzip --archive=mongo-<ts>.archive.gz --drop
#     A restored board is only playable under the MPP_GENERATION_SEED it was
#     dumped with; another seed serves the same pieces at unsolvable positions.
#   Redis:
#     rclone copy r2:$MPP_BACKUP_BUCKET/redis-<ts>.rdb.gz .
#     gunzip redis-<ts>.rdb.gz
#     stop Redis, delete appendonlydir/ from the data volume, copy the file in as
#     dump.rdb, start Redis. Deleting the AOF is not optional: with appendonly on,
#     Redis loads the AOF at boot and ignores dump.rdb entirely, so leaving it in
#     place restores nothing and reports no error. The AOF is rebuilt from the
#     loaded RDB on the next rewrite.
#   Umami and Coolify Postgres:
#     gunzip -c <file>.sql.gz | psql -h <host> -U <user> -d postgres
#   Coolify config:
#     tar xzf coolify-data-<ts>.tar.gz -C /data
#     Its APP_KEY is what decrypts the secrets stored in the Coolify database
#     dump, so neither half restores a working instance without the other.
set -eu

: "${MPP_MONGO_URL:?MPP_MONGO_URL required}"
: "${MPP_REDIS_URL:?MPP_REDIS_URL required}"
: "${MPP_BACKUP_BUCKET:?MPP_BACKUP_BUCKET required}"
MONGO_DB="${MPP_MONGO_DB:-mpp}"
REMOTE="${MPP_BACKUP_REMOTE:-r2}"
KEEP="${MPP_BACKUP_KEEP:-3}"
UMAMI_URL="${MPP_BACKUP_UMAMI_URL:-}"
COOLIFY_DIR="${MPP_BACKUP_COOLIFY_DIR:-/host/coolify}"
COOLIFY_HOST="${MPP_BACKUP_COOLIFY_HOST:-coolify-db}"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

upload() {
  rclone copyto "$tmp/$1" "$REMOTE:$MPP_BACKUP_BUCKET/$1"
}

mongodump --uri="$MPP_MONGO_URL" --db="$MONGO_DB" --gzip --archive="$tmp/mongo-$ts.archive.gz" --quiet
upload "mongo-$ts.archive.gz"

# --rdb pulls a full RDB over the wire (SYNC), so the data volume need not be
# shared into this container.
redis-cli -u "$MPP_REDIS_URL" --rdb "$tmp/redis-$ts.rdb"
gzip "$tmp/redis-$ts.rdb"
upload "redis-$ts.rdb.gz"

# Every dump writes with -f rather than piping into gzip: a pipeline's exit status
# is the compressor's, so a failing dump would upload a well-formed archive of
# nothing and report success.
if [ -n "$UMAMI_URL" ]; then
  pg_dump -d "$UMAMI_URL" -f "$tmp/umami-$ts.sql"
  gzip "$tmp/umami-$ts.sql"
  upload "umami-$ts.sql.gz"
else
  echo "[backup] umami skipped: MPP_BACKUP_UMAMI_URL unset"
fi

if [ -r "$COOLIFY_DIR/source/.env" ]; then
  # The Coolify DB credentials are read from the mounted config instead of being
  # duplicated as service secrets: that mount is already required to back the
  # config up, and reading them there survives a rotation on the Coolify side.
  cf_user="$(sed -n 's/^DB_USERNAME=//p' "$COOLIFY_DIR/source/.env" | tr -d '"' | head -1)"
  cf_pass="$(sed -n 's/^DB_PASSWORD=//p' "$COOLIFY_DIR/source/.env" | tr -d '"' | head -1)"
  # pg_dumpall rather than pg_dump: it carries the roles a whole-instance restore
  # needs, and it does not require knowing the database name.
  PGPASSWORD="$cf_pass" pg_dumpall -h "$COOLIFY_HOST" -U "$cf_user" -f "$tmp/coolify-db-$ts.sql"
  gzip "$tmp/coolify-db-$ts.sql"
  upload "coolify-db-$ts.sql.gz"

  tar czf "$tmp/coolify-data-$ts.tar.gz" -C "$(dirname "$COOLIFY_DIR")" "$(basename "$COOLIFY_DIR")"
  upload "coolify-data-$ts.tar.gz"
else
  echo "[backup] coolify skipped: $COOLIFY_DIR/source/.env not readable"
fi

# Keep the newest KEEP of each kind. Timestamps are ISO basic UTC, so a reverse
# lexicographic sort is newest-first; everything past KEEP is deleted. The two
# Coolify prefixes are spelled out in full because `coolify-` alone would match
# both kinds and let one starve the other out of its slots.
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
prune "umami-"
prune "coolify-db-"
prune "coolify-data-"
