FROM alpine:3.20
# The Postgres client is pinned to the major the Umami and Coolify servers run
# (both 15.18): Alpine ships no unversioned postgresql-client, and pg_dump refuses
# a server newer than itself, so this line moves with whichever upgrades first.
RUN apk add --no-cache redis rclone mongodb-tools postgresql15-client ca-certificates
COPY docker/backup/backup.sh docker/backup/entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
