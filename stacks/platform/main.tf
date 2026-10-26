data "terraform_remote_state" "openbao" {
  backend = "s3"

  config = {
    bucket                      = var.state_bucket
    key                         = "openbao.tfstate"
    region                      = "auto"
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}

locals {
  openbao = data.terraform_remote_state.openbao.outputs
}

# Secrets live at secret/<app>/<env>, plus secret/shared/<env> for values
# every app reuses. Environments are development, preview, and production.
resource "vault_mount" "secret" {
  path        = "secret"
  type        = "kv"
  options     = { version = "2" }
  description = "App secrets"

  lifecycle {
    prevent_destroy = true
  }
}

# Deployed apps log in with one AppRole per app and environment.
resource "vault_auth_backend" "approle" {
  type = "approle"
}

# Your admin login. Create the user by hand so its password stays out of
# state; see the README.
resource "vault_auth_backend" "userpass" {
  type = "userpass"
}

# GitHub Actions logs in with its OIDC token, so no OpenBao credential is
# stored in GitHub. Only the infra environment of this repo's main branch
# gets a token; see .github/workflows.
resource "vault_jwt_auth_backend" "github" {
  path               = "github"
  oidc_discovery_url = "https://token.actions.githubusercontent.com"
  bound_issuer       = "https://token.actions.githubusercontent.com"
}

resource "vault_jwt_auth_backend_role" "ci" {
  backend         = vault_jwt_auth_backend.github.path
  role_name       = "ci"
  role_type       = "jwt"
  user_claim      = "repository"
  bound_audiences = ["openbao"]

  # Only the tofu workflow, started by hand on main. The bootstrap workflow
  # uses the root token instead.
  bound_claims = {
    repository       = var.github_repository
    environment      = "infra"
    ref              = "refs/heads/main"
    event_name       = "workflow_dispatch"
    job_workflow_ref = "${var.github_repository}/.github/workflows/tofu.yml@refs/heads/main"
  }

  # Applying a stack needs to manage policies, auth backends, and AppRoles.
  token_policies = [vault_policy.admin.name]
  token_ttl      = 1800
  token_max_ttl  = 3600
}

resource "vault_policy" "admin" {
  name = "admin"

  policy = <<-EOT
    path "*" {
      capabilities = ["create", "read", "update", "patch", "delete", "list", "sudo"]
    }
  EOT
}

# For dev machines: every app's development secrets, nothing else.
resource "vault_policy" "developer" {
  name = "developer"

  policy = <<-EOT
    path "${vault_mount.secret.path}/data/+/development" {
      capabilities = ["read"]
    }
  EOT
}

resource "vault_policy" "snapshot" {
  name = "snapshot"

  policy = <<-EOT
    path "sys/storage/raft/snapshot" {
      capabilities = ["read"]
    }
  EOT
}

# The backup job renews this token on every run (the default policy allows
# renew-self), so it lives as long as the job keeps running. This is the
# stored vault_token resource, not the ephemeral one, because its value has
# to land in a Railway variable.
resource "vault_token" "backup" {
  display_name = "openbao-backup"
  policies     = [vault_policy.snapshot.name]
  no_parent    = true
  renewable    = true
  period       = "768h"
}

# Daily raft snapshot to the backup bucket, over Railway's private network.
resource "railway_service" "backup" {
  name          = "openbao-backup"
  project_id    = local.openbao.project_id
  source_image  = "openbao/openbao:${var.openbao_version}"
  start_command = "sh -c 'printenv BACKUP_SCRIPT | sh'"
  cron_schedule = "17 4 * * *"
}

resource "railway_variable_collection" "backup" {
  environment_id = local.openbao.environment_id
  service_id     = railway_service.backup.id

  variables = [
    { name = "BACKUP_SCRIPT", value = file("${path.module}/backup/backup.sh") },
    { name = "BAO_ADDR", value = "http://openbao.railway.internal:8200" },
    { name = "BAO_TOKEN", value = vault_token.backup.client_token },
    { name = "BACKUP_S3_ENDPOINT", value = var.backup.endpoint },
    { name = "BACKUP_S3_BUCKET", value = var.backup.bucket },
    { name = "BACKUP_S3_ACCESS_KEY_ID", value = var.backup.access_key_id },
    { name = "BACKUP_S3_SECRET_ACCESS_KEY", value = var.backup.secret_access_key },
    # Root, so the script can install curl; it runs nothing else.
    { name = "RAILWAY_RUN_UID", value = "0" },
  ]
}
