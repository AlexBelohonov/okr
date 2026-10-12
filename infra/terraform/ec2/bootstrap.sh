#!/bin/bash
set -Eeuo pipefail
umask 077
config=/etc/okr-deploy.json
app=/opt/okr/app
data=/srv/okr
export AWS_DEFAULT_REGION
AWS_DEFAULT_REGION=$(python3 -c 'import json; print(json.load(open("/etc/okr-deploy.json"))["aws_region"])')
volume_id=$(python3 -c 'import json; print(json.load(open("/etc/okr-deploy.json"))["volume_id"])')
volume_serial=${volume_id//-/}

# Nitro device numbering changes. Match the exact EBS serial, never the first disk.
device=''
for ((attempt=0; attempt<300; attempt++)); do
  device=$(lsblk -dn -o PATH,SERIAL | awk -v serial="$volume_serial" '$2 == serial {print $1}')
  if [[ -n "$device" ]]; then break; fi
  sleep 2
done
[[ -b "$device" ]] || { echo 'Expected data volume did not attach; refusing startup.' >&2; exit 1; }
filesystem=$(blkid -s TYPE -o value "$device" || true)
if [[ -z "$filesystem" ]]; then
  # Only a new blank, unpartitioned disk may be formatted.
  signatures=$(wipefs --no-act --noheadings --output TYPE "$device")
  children=$(lsblk -nr -o TYPE "$device" | wc -l)
  [[ -z "$signatures" && "$children" -eq 1 ]] || { echo 'Unrecognized disk contents; refusing format.' >&2; exit 1; }
  mkfs.xfs "$device"
elif [[ "$filesystem" != 'xfs' ]]; then
  echo 'Unexpected data filesystem; refusing format.' >&2; exit 1
fi
uuid=$(blkid -s UUID -o value "$device")
[[ -n "$uuid" ]]
install -d -m 700 "$data"
if ! grep -Fq "UUID=$uuid /srv/okr " /etc/fstab; then
  if awk '$2 == "/srv/okr" {found=1} END {exit !found}' /etc/fstab; then
    echo 'A different mount is already configured; refusing replacement.' >&2; exit 1
  fi
  printf 'UUID=%s /srv/okr xfs defaults,nofail,noatime,x-systemd.device-timeout=180 0 2\n' "$uuid" >> /etc/fstab
fi
mountpoint -q "$data" || mount "$data"
[[ "$(findmnt -n -o UUID --target "$data")" == "$uuid" ]] || { echo 'Unexpected mounted volume.' >&2; exit 1; }
chmod 700 "$data"

smtp_parameter=$(python3 -c 'import json; print(json.load(open("/etc/okr-deploy.json"))["smtp_parameter_name"] or "")')
smtp_file=$(mktemp /run/okr-smtp.XXXXXX)
trap 'rm -f "$smtp_file"' EXIT
if [[ -n "$smtp_parameter" ]]; then
  aws ssm get-parameter --name "$smtp_parameter" --with-decryption --query Parameter.Value --output text > "$smtp_file"
  python3 "$app/infra/terraform/ec2/render-runtime.py" "$config" "$data" "$smtp_file"
else
  python3 "$app/infra/terraform/ec2/render-runtime.py" "$config" "$data"
fi
install -m 700 "$app/infra/terraform/ec2/okr-compose.sh" /usr/local/sbin/okr-compose
/usr/local/sbin/okr-compose config --quiet
# Sequential builds bound peak memory and reuse the shared build stage.
/usr/local/sbin/okr-compose build api
/usr/local/sbin/okr-compose build web
/usr/local/sbin/okr-compose run --rm --no-deps api npm run operations:check -w @okr/api
# An operator rerun must stop writers before applying schema changes.
if systemctl is-active --quiet okr.service; then
  systemctl stop okr.service
fi
/usr/local/sbin/okr-compose up -d --no-build --wait db
/usr/local/sbin/okr-compose run --rm --no-deps migrate

cat > /etc/systemd/system/okr.service <<'UNIT'
[Unit]
Description=OKR single EC2 Compose application
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target
RequiresMountsFor=/srv/okr

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/okr-compose up -d --no-build --wait db api worker web caddy
ExecStartPost=/usr/bin/curl --fail --silent --show-error --retry 10 --retry-delay 3 --retry-connrefused http://127.0.0.1:8080/api/v1/ready
ExecStop=/usr/local/sbin/okr-compose stop -t 30 caddy web api worker db
TimeoutStartSec=600
TimeoutStopSec=180

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now okr.service
echo 'OKR local readiness passed. Public HTTPS additionally requires DNS and successful ACME issuance.'
