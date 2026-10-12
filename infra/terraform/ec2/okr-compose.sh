#!/bin/bash
set -Eeuo pipefail
# Refuse to start writers on an unmounted root-directory fallback.
mountpoint -q /srv/okr
cd /opt/okr/app
exec docker compose --project-name okr --env-file /srv/okr/secrets/runtime.env \
  -f docker-compose.yml -f docker-compose.production.yml \
  -f infra/terraform/ec2/docker-compose.ec2.yml --profile workers "$@"
