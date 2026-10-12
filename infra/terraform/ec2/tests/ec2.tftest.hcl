# Infrastructure contract tests only: no AWS credentials or cloud resources.
mock_provider "aws" {
  override_during = plan
  mock_data "aws_partition" { defaults = { partition = "aws" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_availability_zones" { defaults = { names = ["us-east-1a"] } }
  mock_data "aws_ssm_parameter" { defaults = { value = "ami-0123456789abcdef0" } }
  mock_data "aws_ec2_instance_type" { defaults = { supported_architectures = ["x86_64"], memory_size = 4096, hypervisor = "nitro" } }
  mock_data "aws_subnet" { defaults = { id = "subnet-0123456789abcdef0", vpc_id = "vpc-0123456789abcdef0", availability_zone = "us-east-1a" } }
  mock_resource "aws_s3_bucket" { defaults = { id = "okr-fixture-release", arn = "arn:aws:s3:::okr-fixture-release" } }
  mock_resource "aws_ebs_volume" { defaults = { id = "vol-0123456789abcdef0" } }
  mock_resource "aws_eip" { defaults = { public_ip = "203.0.113.10" } }
}

variables {
  domain_name     = "okr.example.org"
  acme_email      = "ops@example.org"
  release_archive = "../../../artifacts/okr-ec2.zip"
}

run "dedicated_single_host" {
  command = plan
  assert {
    condition     = length(aws_vpc.this) == 1 && length(aws_subnet.this) == 1 && length(data.aws_subnet.existing) == 0
    error_message = "Default must create a dedicated network."
  }
  assert {
    condition     = aws_instance.host.instance_type == "t3.medium" && aws_instance.host.metadata_options[0].http_tokens == "required" && aws_instance.host.metadata_options[0].http_put_response_hop_limit == 1
    error_message = "Single host must use adequate memory and IMDSv2."
  }
  assert {
    condition     = aws_ebs_volume.data.encrypted && aws_instance.host.root_block_device[0].encrypted && aws_volume_attachment.data.stop_instance_before_detaching
    error_message = "Disks must be encrypted and detached only after stopping the instance."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.http.to_port == 80 && alltrue([for rule in aws_vpc_security_group_ingress_rule.https : rule.to_port == 443])
    error_message = "Ingress is restricted to HTTP/HTTPS; no SSH/database/API ports."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.release.block_public_policy && aws_s3_bucket_public_access_block.release.restrict_public_buckets && jsondecode(aws_iam_role_policy.release.policy).Statement[1].Effect == "Deny" && jsondecode(aws_iam_role_policy.release.policy).Statement[1].Resource == "*"
    error_message = "Private artifacts and minimal host permission are required."
  }
  assert {
    condition     = var.disable_signup && var.email_mode == "selfhosted" && output.app_url == "https://okr.example.org" && length(aws_route53_record.host) == 0
    error_message = "Defaults must retain disabled signup/self-hosted mail and manual DNS."
  }
  assert {
    condition     = length(aws_instance.host.user_data) < 16384 && strcontains(aws_instance.host.user_data, "sha256sum --check --status")
    error_message = "User data must fit EC2 limits and verify downloads."
  }
}

run "existing_subnet_and_dns" {
  command = plan
  variables {
    existing_public_subnet_id = "subnet-0123456789abcdef0"
    route53_zone_id           = "Z0123456789ABC"
  }
  assert {
    condition     = length(aws_vpc.this) == 0 && aws_instance.host.subnet_id == "subnet-0123456789abcdef0" && length(aws_route53_record.host) == 1
    error_message = "Existing subnet and optional DNS must avoid a second network."
  }
}

run "smtp_permission_scope" {
  command = plan
  variables {
    email_mode          = "smtp"
    smtp_parameter_name = "/okr/smtp"
    smtp_kms_key_arn    = "arn:aws:kms:us-east-1:123456789012:key/11111111-1111-1111-1111-111111111111"
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.release.policy).Statement[1].Resource == "arn:aws:ssm:us-east-1:123456789012:parameter/okr/smtp" && jsondecode(aws_iam_role_policy.release.policy).Statement[3].Effect == "Deny" && jsondecode(aws_iam_role_policy.release.policy).Statement[3].NotResource == "arn:aws:ssm:us-east-1:123456789012:parameter/okr/smtp" && length(jsondecode(aws_iam_role_policy.release.policy).Statement) == 4
    error_message = "SMTP must grant read access to only the chosen parameter/key."
  }
}

run "reject_smtp_without_secret" {
  command = plan
  variables { email_mode = "smtp" }
  expect_failures = [aws_instance.host]
}

run "reject_small_host" {
  command = plan
  override_data {
    target = data.aws_ec2_instance_type.selected
    values = { supported_architectures = ["x86_64"], memory_size = 1024, hypervisor = "nitro" }
  }
  expect_failures = [aws_instance.host]
}

run "reject_hostname_injection" {
  command = plan
  variables { domain_name = "example.org; echo unsafe" }
  expect_failures = [var.domain_name]
}

run "reject_arm_host" {
  command = plan
  override_data {
    target = data.aws_ec2_instance_type.selected
    values = { supported_architectures = ["arm64"], memory_size = 4096, hypervisor = "nitro" }
  }
  expect_failures = [aws_instance.host]
}

run "reject_xen_host" {
  command = plan
  override_data {
    target = data.aws_ec2_instance_type.selected
    values = { supported_architectures = ["x86_64"], memory_size = 4096, hypervisor = "xen" }
  }
  expect_failures = [aws_instance.host]
}
