variable "state_passphrase" {
  description = "Encrypts this stack's state and plans. Keep it in your password manager."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.state_passphrase) >= 16
    error_message = "Use a passphrase of at least 16 characters."
  }
}

variable "openbao_addr" {
  description = "OpenBao's public address; mise-tasks/tf sets it from the openbao stack."
  type        = string
}
