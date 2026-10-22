output "kv_path" {
  value = vault_mount.secret.path
}

output "approle_path" {
  value = vault_auth_backend.approle.path
}
