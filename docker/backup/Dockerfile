FROM alpine:3.20
RUN apk add --no-cache redis rclone mongodb-tools ca-certificates
COPY docker/backup/backup.sh docker/backup/entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
