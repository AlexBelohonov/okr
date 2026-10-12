# Deploy the OKR app on one EC2

This deployment runs PostgreSQL, migrations, API, mail worker, frontend and Caddy on **one EC2 instance** with Docker Compose. By default Terraform creates a dedicated VPC, public subnet, internet gateway, Elastic IP, encrypted root disk, separate encrypted persistent data disk and private versioned S3 release bucket. There is no RDS, load balancer, NAT gateway or second instance.

Defaults: Amazon Linux 2023 x86_64, `t3.medium` (4 GiB), 40 GiB root and 40 GiB data, self-hosted email, public signup disabled. Invitation onboarding remains available. EC2 replacements reuse database credentials, PostgreSQL data and certificate storage on `/srv/okr`. Replacement requires downtime; this is a single-host deployment.

## Prepare and deploy

You need Terraform 1.9 or newer (below 2), authenticated AWS credentials with provisioning permissions, and a public hostname you control. AWS resources incur charges. These scripts have been tested locally; no AWS resources were created during implementation. Real EC2/cloud-init, Session Manager and public ACME issuance still require deployment verification.

From the repository root in PowerShell:

```powershell
.\scripts\package-ec2.ps1
Copy-Item infra/terraform/ec2/terraform.tfvars.example infra/terraform/ec2/terraform.tfvars
```

The packager includes only application/build/runtime inputs, excluding `.env`, credentials, tests, dependencies and generated files. It refuses to overwrite an archive; use `-Destination artifacts/okr-ec2-next.zip` for a later release. No Git checkout or host Node is needed.

The current R012 review package is `artifacts/okr-ec2-r012.zip`, including outbound Slack and nine migrations. Set `release_archive` to its absolute path to deploy that revision. The retained earlier `okr-ec2.zip` is R011 and does not include Slack. For subsequent releases, package a new filename rather than overwriting review artifacts.

Edit `terraform.tfvars`: set `aws_region`, `domain_name`, `acme_email` and the absolute `release_archive` ZIP path. Forward slashes work in Windows paths. Keep `existing_public_subnet_id` unset to create the dedicated VPC. Optionally set `route53_zone_id` to an existing public hosted zone for the hostname; otherwise create its DNS A record yourself using the output IP.

```powershell
terraform -chdir=infra/terraform/ec2 init
terraform -chdir=infra/terraform/ec2 fmt -check -recursive
terraform -chdir=infra/terraform/ec2 validate
terraform -chdir=infra/terraform/ec2 plan -out=ec2.tfplan
terraform -chdir=infra/terraform/ec2 show ec2.tfplan
terraform -chdir=infra/terraform/ec2 apply ec2.tfplan
terraform -chdir=infra/terraform/ec2 output
```

Review the saved plan before applying. Preserve the state and provider lockfile. The default backend is local; configure a protected remote backend before shared operations. Keep state, plans and variable files out of source control. SMTP/database secrets are not Terraform variables or release inputs.

Point the hostname's **A record** to `public_ip` and remove conflicting AAAA records. Ports 80 and 443 must reach the instance for certificate issuance. Caddy obtains and renews public HTTPS certificates when DNS and external reachability are correct. HTTP redirects to HTTPS. Optional `web_ingress_cidrs` restricts HTTPS clients; HTTP remains public for validation. See [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).

```powershell
curl.exe --fail https://your-hostname.example/api/v1/ready
```

Wait for first-boot downloads, builds and migrations. Readiness should return `database: connected`; then open `app_url`. Database and API ports are not published. Nginx is bound to host loopback; Caddy is the public entry point. There is no SSH ingress.

## First administrator

Use AWS Console Session Manager, or the output `session_manager_command` with AWS CLI and its Session Manager plugin. Your operator identity needs permission to start a session. On the instance:

```bash
sudo -i
cloud-init status --wait
systemctl status okr --no-pager
/usr/local/sbin/okr-compose ps
read -r -s -p 'New administrator password: ' admin_password
printf '\n'
printf '%s' "$admin_password" | /usr/local/sbin/okr-compose run --rm --no-deps -T api \
  npm run platform:bootstrap -w @okr/api -- \
  --email admin@example.org --name 'Administrator' --password-stdin
unset admin_password
```

Choose your own email/name/password. This explicit command creates a verified platform administrator and grants no organization membership. Sign in over HTTPS and create the first organization, then invite people. No administrator/password is automatically created by Terraform. Existing active accounts can be explicitly promoted using the existing [bootstrap runbook](../../../README.md).

Public registration remains disabled unless `disable_signup = false`. Existing login, recovery and valid invitations remain available.

## Optional SMTP

Default `email_mode = "selfhosted"` uses the app's existing self-hosted account recovery/onboarding behavior. For real delivery, create a same-region **SSM SecureString** yourself containing JSON with only these string keys:

```json
{
  "SMTP_HOST": "your.smtp.host",
  "SMTP_PORT": "587",
  "SMTP_SECURE": "false",
  "MAIL_FROM": "OKR <noreply@example.org>",
  "SMTP_USER": "your-user",
  "SMTP_PASSWORD": "your-secret"
}
```

Use valid relay credentials; port 587 requires STARTTLS and port 465 uses `SMTP_SECURE: "true"`. Anonymous relays omit both credential keys. Store the JSON through the AWS console or a protected file, keeping values out of shell history and Terraform.

Set `email_mode = "smtp"` and `smtp_parameter_name = "/okr/smtp"`. For a customer-managed encryption key, also set `smtp_kms_key_arn` and ensure its key policy permits the instance role. EC2 reads/decrypts the parameter into a temporary protected file and deletes that file after rendering the runtime configuration. Its role denies reads of other parameters, including broad reads otherwise granted by [AWS's Session Manager core policy](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonSSMManagedInstanceCore.html).

Persistent database credentials, the Slack encryption key and `runtime.env` live in `/srv/okr/secrets` with root-only access. Password/key generation is once per data disk; missing/invalid retained credentials with existing data/configuration cause startup to fail rather than silently rotate them. Production preflight runs before migration/startup. Do not remove these files or publish their contents.

If only the SecureString value changes, Terraform does not detect it. Run `sudo /usr/local/sbin/okr-bootstrap` during a maintenance window to fetch it again and restart. This rebuilds, checks configuration, stops application writers before migrations and restarts the stack.

## Operation, upgrades and recovery

Slack delivery runs in the existing worker, including with self-hosted email. EC2 generates `SLACK_ENCRYPTION_KEY` once in `/srv/okr/secrets/slack-encryption-key` and retains it across releases/host replacement. Preserve that file with protected backups; losing it makes saved webhooks unreadable. No Slack credential is supplied to Terraform. An organization owner/admin connects the chosen Slack incoming webhook inside the app using [Slack setup](../../../README.md#slack-setup). Live delivery still requires a real webhook and channel verification.

```bash
sudo systemctl restart okr
sudo journalctl -u okr --no-pager -n 100
sudo /usr/local/sbin/okr-compose logs --tail 100 api worker web caddy
sudo /usr/local/sbin/okr-compose run --rm --no-deps api npm run operations:check -w @okr/api
```

First-boot failures appear in `/var/log/cloud-init-output.log`; fix configuration or network/dependency access, then rerun `sudo /usr/local/sbin/okr-bootstrap` if the app and bootstrap files were downloaded. The wrapper refuses to run if the data disk is not mounted. Failed migrations leave application writers stopped; resolve or restore before restarting them. Do not bypass preflight or reset credentials to recover.

Build a new ZIP, change `release_archive`, review the plan and apply during a maintenance window. Changes to user data (release or startup configuration) replace the EC2 instance, with the old host stopped/destroyed before the new host attaches the same data disk. A new default Amazon Linux AMI can also cause replacement; pin a regional AL2023 x86_64 `ami_id` for controlled upgrades. Changing VPC/subnet/availability zone may require a new data disk and explicit migration rather than ordinary replacement. Only x86_64 Nitro instances with at least 4 GiB are accepted.

Take a protected database backup before upgrades. On the instance, for example:

```bash
sudo -i
install -d -m 700 /srv/okr/backups
backup_name="okr-$(date -u +%Y%m%dT%H%M%SZ).dump"
/usr/local/sbin/okr-compose exec -T db pg_dump -U okr -d okr -Fc -f "/tmp/$backup_name"
/usr/local/sbin/okr-compose cp "db:/tmp/$backup_name" "/srv/okr/backups/$backup_name"
chmod 600 "/srv/okr/backups/$backup_name"
/usr/local/sbin/okr-compose exec -T db rm -f "/tmp/$backup_name"
```

Copy backups to protected storage outside this disk and establish retention/restore drills. An EBS disk or a backup on that same disk does not provide disaster recovery. Restore to an isolated database first using the existing [backup/restore procedures](../../../README.md); review sessions, invitations and queued mail before a real cutover. No automatic backup schedule or monitoring service is installed.

The data disk has Terraform `prevent_destroy`; ordinary destroy or changes requiring its replacement are intentionally refused. Deliberate deletion requires a verified backup and explicit lifecycle change. The versioned release bucket also refuses automatic removal while nonempty. There is no automatic data-purge command.

## Local verification

The repository includes eight mocked Terraform plan tests (`terraform test` after packaging/init), seven Python runtime-configuration checks, plugin download/checksum checks and an isolated production Compose/HTTPS rehearsal. Mocked tests require no AWS credentials and create no cloud resources. Python and Terraform can run in containers:

```powershell
docker run --rm --mount type=bind,source="$PWD",target=/workspace hashicorp/terraform:1.13.5 -chdir=/workspace/infra/terraform/ec2 init -backend=false
docker run --rm --mount type=bind,source="$PWD",target=/workspace hashicorp/terraform:1.13.5 -chdir=/workspace/infra/terraform/ec2 test -no-color
docker run --rm --mount type=bind,source="$PWD",target=/workspace python:3.12-alpine python -m unittest discover -s /workspace/tests/deployment -p test_runtime.py -v
docker run --rm --mount type=bind,source="$PWD",target=/workspace python:3.12-alpine python /workspace/tests/deployment/verify_downloads.py
```

Deployment-specific evidence and remaining cloud verification are recorded in [PROGRESS.md](../../../PROGRESS.md) and [REVIEWS.md](../../../REVIEWS.md). Local HTTPS uses a trusted internal test CA; it does not prove public certificate issuance, EC2 boot or IAM propagation.
