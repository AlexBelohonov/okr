data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" { state = "available" }
data "aws_ssm_parameter" "ami" {
  count = var.ami_id == null ? 1 : 0
  name  = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}
data "aws_subnet" "existing" {
  count = var.existing_public_subnet_id == null ? 0 : 1
  id    = var.existing_public_subnet_id
}
data "aws_ec2_instance_type" "selected" { instance_type = var.instance_type }

locals {
  create_network = var.existing_public_subnet_id == null
  vpc_id         = local.create_network ? aws_vpc.this[0].id : data.aws_subnet.existing[0].vpc_id
  subnet_id      = local.create_network ? aws_subnet.this[0].id : data.aws_subnet.existing[0].id
  zone           = local.create_network ? aws_subnet.this[0].availability_zone : data.aws_subnet.existing[0].availability_zone
  release_sha256 = filesha256(var.release_archive)
  smtp_arn       = var.smtp_parameter_name == null ? null : "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.smtp_parameter_name}"
}

resource "aws_vpc" "this" {
  count                = local.create_network ? 1 : 0
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
}
resource "aws_subnet" "this" {
  count                   = local.create_network ? 1 : 0
  vpc_id                  = aws_vpc.this[0].id
  cidr_block              = "10.42.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
}
resource "aws_internet_gateway" "this" {
  count  = local.create_network ? 1 : 0
  vpc_id = aws_vpc.this[0].id
}
resource "aws_route_table" "this" {
  count  = local.create_network ? 1 : 0
  vpc_id = aws_vpc.this[0].id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this[0].id
  }
}
resource "aws_route_table_association" "this" {
  count          = local.create_network ? 1 : 0
  subnet_id      = aws_subnet.this[0].id
  route_table_id = aws_route_table.this[0].id
}

resource "aws_security_group" "this" {
  name_prefix = "${var.name}-"
  description = "HTTPS and ACME HTTP only; management uses Session Manager."
  vpc_id      = local.vpc_id
}
resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.this.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}
resource "aws_vpc_security_group_ingress_rule" "https" {
  for_each          = var.web_ingress_cidrs
  security_group_id = aws_security_group.this.id
  cidr_ipv4         = each.value
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}
resource "aws_vpc_security_group_egress_rule" "outbound" {
  security_group_id = aws_security_group.this.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_s3_bucket" "release" { bucket_prefix = "${var.name}-release-" }
resource "aws_s3_bucket_public_access_block" "release" {
  bucket                  = aws_s3_bucket.release.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "release" {
  bucket = aws_s3_bucket.release.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_versioning" "release" {
  bucket = aws_s3_bucket.release.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_policy" "release" {
  bucket = aws_s3_bucket.release.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Deny", Principal = "*", Action = "s3:*"
      Resource  = [aws_s3_bucket.release.arn, "${aws_s3_bucket.release.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}
resource "aws_s3_object" "release" {
  bucket      = aws_s3_bucket.release.id
  key         = "releases/${local.release_sha256}.zip"
  source      = var.release_archive
  source_hash = local.release_sha256
  depends_on  = [aws_s3_bucket_public_access_block.release, aws_s3_bucket_server_side_encryption_configuration.release, aws_s3_bucket_versioning.release]
}

resource "aws_iam_role" "host" {
  name_prefix = "${var.name}-host-"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_role_policy" "release" {
  role = aws_iam_role.host.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{ Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.release.arn}/releases/*" }],
      var.smtp_parameter_name == null ? [] : [{ Effect = "Allow", Action = ["ssm:GetParameter"], Resource = local.smtp_arn }],
      var.smtp_kms_key_arn == null ? [] : [{ Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.smtp_kms_key_arn }],
      # Managed SSM core also grants wildcard parameter reads. Explicitly bound them.
      var.smtp_parameter_name == null ? [{
        Effect = "Deny", Action = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:GetParameterHistory"], Resource = "*"
      }] : [],
      var.smtp_parameter_name == null ? [] : [{
        Effect = "Deny", Action = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:GetParameterHistory"], NotResource = local.smtp_arn
      }]
    )
  })
}
resource "aws_iam_instance_profile" "host" {
  name_prefix = "${var.name}-"
  role        = aws_iam_role.host.name
}

resource "aws_ebs_volume" "data" {
  availability_zone = local.zone
  size              = var.data_volume_gib
  type              = "gp3"
  encrypted         = true
  tags              = { Name = "${var.name}-data" }
  lifecycle { prevent_destroy = true }
}
resource "aws_instance" "host" {
  ami                         = var.ami_id == null ? data.aws_ssm_parameter.ami[0].value : var.ami_id
  instance_type               = var.instance_type
  subnet_id                   = local.subnet_id
  vpc_security_group_ids      = [aws_security_group.this.id]
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.host.name
  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    compose_version = var.compose_version
    buildx_version  = var.buildx_version
    bucket          = aws_s3_bucket.release.id
    release_key     = aws_s3_object.release.key
    release_sha256  = local.release_sha256
    region          = var.aws_region
    config_b64 = base64encode(jsonencode({
      domain_name    = var.domain_name, acme_email = var.acme_email, volume_id = aws_ebs_volume.data.id,
      disable_signup = var.disable_signup, email_mode = var.email_mode, smtp_parameter_name = var.smtp_parameter_name,
      aws_region     = var.aws_region, release_sha256 = local.release_sha256
    }))
  })
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
  root_block_device {
    encrypted   = true
    volume_type = "gp3"
    volume_size = var.root_volume_gib
  }
  tags       = { Name = var.name }
  depends_on = [aws_iam_role_policy.release, aws_iam_role_policy_attachment.ssm, aws_route_table_association.this, aws_vpc_security_group_egress_rule.outbound, aws_vpc_security_group_ingress_rule.http, aws_vpc_security_group_ingress_rule.https]
  lifecycle {
    precondition {
      condition     = contains(data.aws_ec2_instance_type.selected.supported_architectures, "x86_64") && data.aws_ec2_instance_type.selected.memory_size >= 4096 && data.aws_ec2_instance_type.selected.hypervisor == "nitro"
      error_message = "Use an x86_64 Nitro instance with at least 4 GiB RAM for on-host builds and EBS serial identification."
    }
    precondition {
      condition     = var.email_mode != "smtp" || var.smtp_parameter_name != null
      error_message = "SMTP mode requires an existing smtp_parameter_name SecureString."
    }
  }
}
resource "aws_volume_attachment" "data" {
  device_name                    = "/dev/sdf"
  volume_id                      = aws_ebs_volume.data.id
  instance_id                    = aws_instance.host.id
  stop_instance_before_detaching = true
}
resource "aws_eip" "host" { domain = "vpc" }
resource "aws_eip_association" "host" {
  instance_id   = aws_instance.host.id
  allocation_id = aws_eip.host.id
}
resource "aws_route53_record" "host" {
  count   = var.route53_zone_id == null ? 0 : 1
  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"
  ttl     = 300
  records = [aws_eip.host.public_ip]
}
