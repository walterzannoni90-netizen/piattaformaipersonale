#!/bin/sh
set -eu

mkdir -p /var/data/workspaces
chown -R node:node /var/data

exec gosu node "$@"
