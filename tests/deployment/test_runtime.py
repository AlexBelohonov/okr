import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("runtime", ROOT / "infra/terraform/ec2/render-runtime.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
CONFIG = {"domain_name": "okr.example.org", "acme_email": "ops@example.org", "email_mode": "selfhosted", "disable_signup": True}


class RuntimeTests(unittest.TestCase):
    def test_preserves_database_password_on_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            first = runtime.render(CONFIG, directory)
            second = runtime.render({**CONFIG, "disable_signup": False}, directory)
            self.assertEqual(first["POSTGRES_PASSWORD"], second["POSTGRES_PASSWORD"])
            self.assertEqual(first["SLACK_ENCRYPTION_KEY"], second["SLACK_ENCRYPTION_KEY"])
            self.assertEqual(len(first["SLACK_ENCRYPTION_KEY"]), 64)
            self.assertEqual(len(first["POSTGRES_PASSWORD"]), 64)
            self.assertEqual(second["APP_URL"], "https://okr.example.org")
            self.assertEqual(second["COOKIE_SECURE"], "true")
            self.assertEqual(second["DISABLE_SIGNUP"], "false")
            self.assertEqual((Path(directory) / "secrets/runtime.env").stat().st_mode & 0o777, 0o600)

    def test_missing_password_never_rotates_existing_database(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "postgres/18/docker"
            database.mkdir(parents=True)
            (database / "PG_VERSION").write_text("18")
            with self.assertRaises(ValueError):
                runtime.render(CONFIG, directory)
            self.assertFalse((Path(directory) / "secrets/database-password").exists())

    def test_rejects_invalid_retained_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime.render(CONFIG, directory)
            (Path(directory) / "secrets/database-password").write_text("invalid")
            with self.assertRaises(ValueError):
                runtime.render(CONFIG, directory)

    def test_rejects_smtp_override_of_database_and_multiline_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                runtime.render({**CONFIG, "email_mode": "smtp"}, directory, {"POSTGRES_PASSWORD": "forbidden"})
            with self.assertRaises(ValueError):
                runtime.render({**CONFIG, "email_mode": "smtp"}, directory, {"SMTP_PASSWORD": "one\ntwo"})
            with self.assertRaises(ValueError):
                runtime.render({**CONFIG, "email_mode": "smtp"}, directory)

    def test_rejects_hostname_injection(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                runtime.render({**CONFIG, "domain_name": "example.org; bad"}, directory)

    def test_rejects_invalid_retained_slack_key(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime.render(CONFIG, directory)
            (Path(directory) / "secrets/slack-encryption-key").write_text("invalid")
            with self.assertRaises(ValueError):
                runtime.render(CONFIG, directory)

    def test_missing_slack_key_never_rotates_existing_encryption(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime.render(CONFIG, directory)
            key = Path(directory) / "secrets/slack-encryption-key"
            key.unlink()
            with self.assertRaises(ValueError):
                runtime.render(CONFIG, directory)
            self.assertFalse(key.exists())


if __name__ == "__main__":
    unittest.main()
