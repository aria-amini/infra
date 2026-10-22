variable "state_passphrase" {
  description = "Encrypts this stack's state and plans. Keep it in your password manager."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.state_passphrase) >= 16
    error_message = "Use a passphrase of at least 16 characters."
  }
}

variable "workspace_id" {
  description = "Railway workspace; required when the token can see more than one."
  type        = string
  default     = null
}

variable "subdomain" {
  description = "Public hostname is <subdomain>.up.railway.app."
  type        = string
  default     = "aria-openbao"
}

variable "openbao_version" {
  type    = string
  default = "2.7.1"
}
