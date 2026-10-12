variable "aws_region" {
  type    = string
  default = "us-east-1"
  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z0-9]+)+-[0-9]+$", var.aws_region))
    error_message = "Supply an AWS region identifier such as us-east-1."
  }
}

variable "name" {
  type    = string
  default = "okr"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,24}$", var.name))
    error_message = "Use 2-25 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "domain_name" {
  description = "Public HTTPS hostname; point its DNS A record at the Elastic IP."
  type        = string
  validation {
    condition     = length(var.domain_name) <= 253 && can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", var.domain_name))
    error_message = "Supply a lowercase DNS hostname, without a scheme, port or path."
  }
}

variable "acme_email" {
  description = "Email for certificate renewal notices."
  type        = string
  validation {
    condition     = can(regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$", var.acme_email))
    error_message = "Supply a valid certificate contact email."
  }
}

variable "release_archive" {
  description = "Absolute path to the ZIP produced by scripts/package-ec2.ps1. No secrets in this archive."
  type        = string
}

variable "instance_type" {
  description = "x86_64 Nitro instance; t3.medium has 4 GiB for on-host image builds."
  type        = string
  default     = "t3.medium"
}

variable "ami_id" {
  description = "Optional pinned Amazon Linux 2023 x86_64 AMI. Null resolves the regional AWS public SSM parameter."
  type        = string
  default     = null
}

variable "existing_public_subnet_id" {
  description = "Optional existing subnet with internet-gateway routing. Null creates a dedicated VPC/public subnet."
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = "Optional existing public hosted zone. Null requires a manual A record."
  type        = string
  default     = null
}

variable "web_ingress_cidrs" {
  description = "HTTPS client CIDRs. HTTP stays public for ACME validation and HTTPS redirects."
  type        = set(string)
  default     = ["0.0.0.0/0"]
  validation {
    condition     = length(var.web_ingress_cidrs) > 0 && alltrue([for cidr in var.web_ingress_cidrs : can(cidrnetmask(cidr))])
    error_message = "Supply at least one IPv4 CIDR."
  }
}

variable "root_volume_gib" {
  type    = number
  default = 40
  validation {
    condition     = var.root_volume_gib >= 30 && floor(var.root_volume_gib) == var.root_volume_gib
    error_message = "Root volume must be a whole number of GiB, at least 30 for image builds."
  }
}

variable "data_volume_gib" {
  type    = number
  default = 40
  validation {
    condition     = var.data_volume_gib >= 20 && floor(var.data_volume_gib) == var.data_volume_gib
    error_message = "Data volume must be a whole number of GiB, at least 20."
  }
}

variable "disable_signup" {
  type    = bool
  default = true
}

variable "email_mode" {
  type    = string
  default = "selfhosted"
  validation {
    condition     = contains(["selfhosted", "smtp"], var.email_mode)
    error_message = "email_mode must be selfhosted or smtp."
  }
}

variable "smtp_parameter_name" {
  description = "Existing same-region SSM SecureString containing SMTP JSON. Value is read only by EC2, never Terraform."
  type        = string
  default     = null
  validation {
    condition     = var.smtp_parameter_name == null ? true : can(regex("^/[A-Za-z0-9_./-]+$", var.smtp_parameter_name))
    error_message = "Use a full SSM parameter path starting with /."
  }
}

variable "smtp_kms_key_arn" {
  description = "Optional customer-managed key ARN used by the existing SMTP SecureString."
  type        = string
  default     = null
}

variable "compose_version" {
  type    = string
  default = "v5.6.0"
  validation {
    condition     = can(regex("^v[0-9]+\\.[0-9]+\\.[0-9]+$", var.compose_version))
    error_message = "Supply a stable Compose release tag such as v5.6.0 (must support !override)."
  }
}

variable "buildx_version" {
  type    = string
  default = "v0.27.0"
  validation {
    condition     = can(regex("^v[0-9]+\\.[0-9]+\\.[0-9]+$", var.buildx_version))
    error_message = "Supply a stable Buildx release tag."
  }
}
