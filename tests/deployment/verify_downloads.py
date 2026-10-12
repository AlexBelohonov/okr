"""Verify the pinned Linux plugin assets used by cloud-init; no AWS access."""
import hashlib
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
variables = (ROOT / "infra/terraform/ec2/variables.tf").read_text()
with tempfile.TemporaryDirectory() as directory:
    for project, variable, asset in (
        ("compose", "compose_version", "docker-compose-linux-x86_64"),
        ("buildx", "buildx_version", "buildx-{version}.linux-amd64"),
    ):
        version = re.search(r'variable "' + variable + r'"\s*\{.*?default\s*=\s*"([^"]+)"', variables, re.S)[1]
        asset = asset.format(version=version)
        base = f"https://github.com/docker/{project}/releases/download/{version}/"
        manifest = asset + ".sha256" if project == "compose" else "checksums.txt"
        with urlopen(base + manifest, timeout=60) as response:
            lines = response.read().decode().splitlines()
        matches = [line.split()[0] for line in lines if len(line.split()) == 1 or line.split()[1].lstrip("*") == asset]
        assert len(matches) == 1, f"Checksum missing or ambiguous: {project}"
        target = Path(directory) / ("docker-" + project)
        digest = hashlib.sha256()
        with urlopen(base + asset, timeout=60) as response, target.open("wb") as file:
            while chunk := response.read(1024 * 1024):
                digest.update(chunk)
                file.write(chunk)
        assert digest.hexdigest() == matches[0], f"Checksum mismatch: {project}"
        target.chmod(0o700)
        result = subprocess.check_output([str(target), "version"], text=True)
        assert version.removeprefix("v") in result
        print(f"PASS: {project} {version} Linux x86_64 download, SHA256 and version execution")
