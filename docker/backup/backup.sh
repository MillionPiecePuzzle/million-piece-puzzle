#!/bin/sh
# One backup pass: a gzipped dump of every stateful service on the host, pushed to
# the private R2 bucket under one folder per pass, then pruned to the newest N
# passes.
#
#   <ts>/mongo.archive.gz       game log: users, cluster merges
#   <ts>/redis.rdb.gz           live board state
#   <ts>/umami.sql.gz           analytics
#   <ts>/coolify-db.sql.gz      Coolify's own Postgres
#   <ts>/coolify-data.tar.gz    /data/coolify: APP_KEY, ssh keys, proxy config
#
# The game's own two dumps run and upload first, so a failure on the Coolify or
# Umami half still leaves the pass with what matters most already on R2.
#
# Restore (from any host with the rclone `r2` remote and the matching DB tools).
# Pull the whole pass into a directory named after it, so the dumps stay together
# and dated once they are off the bucket:
#     rclone copy r2:$MPP_BACKUP_BUCKET/<ts> <ts>
#   Mongo:
#     mongorestore --uri="<mongo-url>" --gzip --archive=<ts>/mongo.archive.gz --drop
#     A restored board is only playable under the MPP_GENERATION_SEED it was
#     dumped with; another seed serves the same pieces at unsolvable positions.
#   Redis:
#     gunzip <ts>/redis.rdb.gz
#     The service runs with appendonly on, so dump.rdb is never read: Redis boots
#     from appendonlydir/, and a restored RDB left beside it restores nothing and
#     reports no error. Deleting appendonlydir/ does not help either, since a boot
#     with no manifest starts on an empty dataset and writes a fresh AOF base from
#     it, just as silently. Restore by making the dump the AOF base itself, which
#     is the format Redis already writes there. Stop Redis, then replace the whole
#     directory with:
#       appendonlydir/appendonly.aof.1.base.rdb   the restored redis.rdb
#       appendonlydir/appendonly.aof.1.incr.aof   empty
#       appendonlydir/appendonly.aof.manifest     these two lines:
#         file appendonly.aof.1.base.rdb seq 1 type b
#         file appendonly.aof.1.incr.aof seq 1 type i
#     chown it to the redis user, then start. Write those files only after the
#     stop: shutting Redis down saves the live dataset over the data directory.
#     With a Redis whose command can be changed, booting once with appendonly off
#     loads dump.rdb directly, and CONFIG SET appendonly yes then rebuilds the AOF
#     from memory; both paths were exercised against a full production pass.
#   Umami and Coolify Postgres:
#     gunzip -c <ts>/<file>.sql.gz | psql -h <host> -U <user> -d postgres
#   Coolify config:
#     tar xzf <ts>/coolify-data.tar.gz -C /data
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

# The pass timestamp is the folder, not part of the file names: the dumps of one
# pass are read back together, and a restore names its own directory after it.
upload() {
  rclone copyto "$tmp/$1" "$REMOTE:$MPP_BACKUP_BUCKET/$ts/$1"
}

mongodump --uri="$MPP_MONGO_URL" --db="$MONGO_DB" --gzip --archive="$tmp/mongo.archive.gz" --quiet
upload "mongo.archive.gz"

# --rdb pulls a full RDB over the wire (SYNC), so the data volume need not be
# shared into this container.
redis-cli -u "$MPP_REDIS_URL" --rdb "$tmp/redis.rdb"
gzip "$tmp/redis.rdb"
upload "redis.rdb.gz"

# Every dump writes with -f rather than piping into gzip: a pipeline's exit status
# is the compressor's, so a failing dump would upload a well-formed archive of
# nothing and report success.
if [ -n "$UMAMI_URL" ]; then
  pg_dump -d "$UMAMI_URL" -f "$tmp/umami.sql"
  gzip "$tmp/umami.sql"
  upload "umami.sql.gz"
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
  PGPASSWORD="$cf_pass" pg_dumpall -h "$COOLIFY_HOST" -U "$cf_user" -f "$tmp/coolify-db.sql"
  gzip "$tmp/coolify-db.sql"
  upload "coolify-db.sql.gz"

  tar czf "$tmp/coolify-data.tar.gz" -C "$(dirname "$COOLIFY_DIR")" "$(basename "$COOLIFY_DIR")"
  upload "coolify-data.tar.gz"
else
  echo "[backup] coolify skipped: $COOLIFY_DIR/source/.env not readable"
fi

# Keep the newest KEEP passes. Folder names are ISO basic UTC, so a reverse
# lexicographic sort is newest-first; every older pass is purged whole. Only a
# pass that ran to the end reaches this, so a run that died mid-way leaves a
# partial folder that ages out of the window like any other.
rclone lsf "$REMOTE:$MPP_BACKUP_BUCKET/" --dirs-only \
  | sort -r \
  | awk -v k="$KEEP" 'NR>k' \
  | while IFS= read -r d; do
      [ -n "$d" ] && rclone purge "$REMOTE:$MPP_BACKUP_BUCKET/$d"
    done
