#!/usr/bin/env python3
"""Write Compose configuration without exposing secret values in Terraform or logs."""
import json
import os
from pathlib import Path
import re
import secrets
import sys

SMTP_KEYS = {"SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_SECURE", "MAIL_FROM"}


def render(config, data_dir, smtp=None):
    if not re.fullmatch(r"([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", config["domain_name"]):
        raise ValueError("Invalid public hostname")
    if config["email_mode"] not in ("selfhosted", "smtp") or not isinstance(config["disable_signup"], bool):
        raise ValueError("Invalid account configuration")
    if config["email_mode"] == "smtp" and (not isinstance(smtp, dict) or not smtp):
        raise ValueError("SMTP requires a nonempty JSON object")
    smtp = smtp or {}
    if set(smtp) - SMTP_KEYS:
        raise ValueError("SMTP JSON contains unsupported setting names")
    if any(not isinstance(v, str) or any(c in v for c in "\n\r\0") for v in smtp.values()):
        raise ValueError("SMTP settings must be single-line strings")
    data = Path(data_dir)
    directory = data / "secrets"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    password_file = directory / "database-password"
    if password_file.exists():
        password = password_file.read_text().strip()
        if not re.fullmatch(r"[a-f0-9]{64}", password):
            raise ValueError("Existing database credential is invalid; refusing rotation")
    else:
        postgres = data / "postgres"
        if postgres.exists() and any(postgres.iterdir()):
            raise ValueError("Database data exists without its credential; refusing a new password")
        password = secrets.token_hex(32)
        with password_file.open("x") as file:
            file.write(password + "\n")
        os.chmod(password_file, 0o600)
    slack_key_file = directory / "slack-encryption-key"
    if slack_key_file.exists():
        slack_key = slack_key_file.read_text().strip()
        if not re.fullmatch(r"[a-f0-9]{64}", slack_key):
            raise ValueError("Invalid retained Slack encryption key")
    else:
        previous_runtime = directory / "runtime.env"
        if previous_runtime.exists() and re.search(r"^SLACK_ENCRYPTION_KEY=.+$", previous_runtime.read_text(), re.MULTILINE):
            raise ValueError("Slack runtime exists without its retained encryption key; refusing rotation")
        slack_key = secrets.token_hex(32)
        with slack_key_file.open("x") as file:
            file.write(slack_key + "\n")
        os.chmod(slack_key_file, 0o600)
    values = {
        "POSTGRES_PASSWORD": password, "APP_URL": "https://" + config["domain_name"],
        "NODE_ENV": "production", "COOKIE_SECURE": "true", "WEB_PORT": "8080",
        "DISABLE_SIGNUP": str(config["disable_signup"]).lower(), "EMAIL_MODE": config["email_mode"],
        "OKR_DOMAIN": config["domain_name"], "ACME_EMAIL": config["acme_email"],
        "OKR_DATA_DIR": str(data), "SMTP_HOST": "", "SMTP_PORT": "587",
        "SMTP_USER": "", "SMTP_PASSWORD": "", "SMTP_SECURE": "false", "MAIL_FROM": "",
        "SLACK_ENCRYPTION_KEY": slack_key,
    }
    values.update(smtp)
    # Compose parses double-quoted escapes and interpolates $. $$ preserves a literal dollar.
    lines = [key + "=" + json.dumps(value, ensure_ascii=False).replace("$", "$$") for key, value in values.items()]
    target = directory / "runtime.env"
    temporary = directory / "runtime.env.new"
    temporary.write_text("\n".join(lines) + "\n")
    os.chmod(temporary, 0o600)
    temporary.replace(target)
    return values


if __name__ == "__main__":
    try:
        with open(sys.argv[1]) as file:
            config = json.load(file)
        smtp = None
        if len(sys.argv) > 3:
            with open(sys.argv[3]) as file:
                smtp = json.load(file)
        render(config, sys.argv[2], smtp)
        print("Runtime configuration prepared; secret values omitted.")
    except Exception:
        print("Runtime configuration failed; inspect setting names and retained credential files without publishing values.", file=sys.stderr)
        sys.exit(1)
