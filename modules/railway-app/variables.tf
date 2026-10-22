variable "name" {
  description = "App slug; its secrets live at secret/<name>/<tier>."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.name))
    error_message = "Use lowercase letters, digits, and dashes."
  }
}

variable "project_id" {
  description = "Railway project ID."
  type        = string
}

variable "service_id" {
  description = "Railway service ID of the app."
  type        = string
}

variable "environments" {
  description = "Railway environments by name, each mapped to a secret tier. PR environments copy their variables from their base environment."
  type = map(object({
    id   = string
    tier = string
  }))

  validation {
    condition     = alltrue([for env in values(var.environments) : contains(["preview", "production"], env.tier)])
    error_message = "Each tier must be preview or production."
  }
}

variable "generated_secrets" {
  description = "Variables to fill with a random value per environment, e.g. BETTER_AUTH_SECRET. Changing one rotates it."
  type        = set(string)
  default     = []
}

variable "openbao_addr" {
  description = "OpenBao's public address; set as OPENBAO_ADDR for builds."
  type        = string
}

variable "kv_mount" {
  type    = string
  default = "secret"
}

variable "approle_path" {
  type    = string
  default = "approle"
}
