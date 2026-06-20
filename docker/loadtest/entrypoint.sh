#!/bin/sh
# Dispatch to the load harness or the state-corruption validator. Both run via
# tsx from source (the image builds only @mpp/shared). All flags after the
# subcommand pass straight through.
#
#   run      -> the WS load harness   (packages/load-test, npm run start)
#   validate -> the state validator   (packages/server, npm run validate-state)
set -e

cmd="$1"
shift || true

case "$cmd" in
  run)
    exec npm run start -w @mpp/load-test -- "$@"
    ;;
  validate)
    exec npm run validate-state -w @mpp/server -- "$@"
    ;;
  *)
    echo "usage: run <harness flags> | validate <validator flags>" >&2
    echo "see packages/load-test/README.md" >&2
    exit 1
    ;;
esac
