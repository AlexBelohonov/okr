output "app_url" { value = "https://${var.domain_name}" }
output "public_ip" { value = aws_eip.host.public_ip }
output "instance_id" { value = aws_instance.host.id }
output "data_volume_id" { value = aws_ebs_volume.data.id }
output "release_sha256" { value = local.release_sha256 }
output "session_manager_command" {
  value = "aws ssm start-session --region ${var.aws_region} --target ${aws_instance.host.id}"
}
output "dns_instruction" {
  value = var.route53_zone_id == null ? "Create an A record: ${var.domain_name} -> ${aws_eip.host.public_ip}; remove conflicting AAAA records." : "Terraform manages the A record in the supplied public hosted zone."
}
