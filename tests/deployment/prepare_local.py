"""Prepare isolated synthetic production fixtures and validate the release archive."""
import importlib.util
import json
import sys
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts/ec2-check"
OUT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location("runtime", ROOT / "infra/terraform/ec2/render-runtime.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
config = {"domain_name": "okr.example.org", "acme_email": "ops@example.org", "email_mode": "smtp", "disable_signup": True}
smtp = {"SMTP_HOST": "smtp.example.org", "SMTP_PORT": "587", "SMTP_SECURE": "false", "MAIL_FROM": "noreply@example.org",
        "SMTP_USER": "fixture-user", "SMTP_PASSWORD": "fixture '$dollar' \\ slash \"quote\""}
runtime.render(config, OUT / "data", smtp)
(OUT / "expected.json").write_text(json.dumps(smtp))
# Different local ports and an INTERNAL test certificate; public ACME is not exercised here.
test_caddy = (ROOT / "infra/terraform/ec2/Caddyfile").read_text().replace("{$ACME_EMAIL}", "ops@example.org").replace("{$OKR_DOMAIN}", "okr.example.org").replace("encode zstd gzip", "tls internal\n\tencode zstd gzip")
(OUT / "Caddyfile").write_text(test_caddy)
(OUT / "compose.yml").write_text("""name: okr-ec2-check
services:
  api:
    image: okr-ec2-check-api
  migrate:
    image: okr-ec2-check-api
  web:
    image: okr-ec2-check-web
    ports: !override
      - '127.0.0.1:18080:80'
  caddy:
    ports: !override
      - '127.0.0.1:18081:80'
      - '127.0.0.1:18443:443'
    volumes: !override
      - ./artifacts/ec2-check/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./artifacts/ec2-check/data/caddy-data:/data
      - ./artifacts/ec2-check/data/caddy-config:/config
  worker:
    image: okr-ec2-check-api
    environment:
      EMAIL_MODE: selfhosted
""")
with zipfile.ZipFile(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "artifacts/okr-ec2.zip") as archive:
    names = archive.namelist()
    for name in names:
        path = Path(name)
        assert not path.is_absolute() and ".." not in path.parts and "\\" not in name
        assert not any(part in ("node_modules", ".aws", ".git", ".terraform", "artifacts") or part.startswith(".env") for part in path.parts)
        assert not name.endswith((".tfstate", ".tfvars", ".pem", ".key"))
    for name in ("Dockerfile", "tsconfig.base.json", "infra/nginx.conf", "apps/api/prisma/schema.prisma", "infra/terraform/ec2/bootstrap.sh"):
        assert name in names
    target = OUT / "build-context"
    assert not target.exists(), "Use a fresh build context."
    archive.extractall(target)
print(f"Prepared isolated runtime fixtures; {len(names)} safe archive entries, no .env/state/credentials.")
