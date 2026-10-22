variable "state_passphrase" {
  description = "Encrypts every stack's state and plans. Keep it in your password manager."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.state_passphrase) >= 16
    error_message = "Use a passphrase of at least 16 characters."
  }
}

variable "state_bucket" {
  description = "R2 bucket holding every stack's state."
  type        = string
}

variable "openbao_version" {
  type    = string
  default = "2.7.1"
}

variable "backup" {
  description = "S3-compatible bucket (R2) for daily OpenBao snapshots, with a token scoped to it."
  type = object({
    endpoint          = string
    bucket            = string
    access_key_id     = string
    secret_access_key = string
  })
  sensitive = true
}
