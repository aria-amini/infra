output "secret_paths" {
  description = "Where to put this app's secrets, by Railway environment."
  value       = { for env, config in var.environments : env => "${var.kv_mount}/${var.name}/${config.tier}" }
}
