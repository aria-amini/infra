output "address" {
  description = "OpenBao's public address; mise-tasks/tf sets VAULT_ADDR to it."
  value       = local.api_addr
}

output "project_id" {
  value = railway_project.secrets.id
}

output "environment_id" {
  value = railway_project.secrets.default_environment.id
}

output "unseal_key" {
  description = "Store once in the password manager."
  value       = random_bytes.unseal_key.base64
  sensitive   = true
}
