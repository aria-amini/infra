locals {
  generated = {
    for pair in setproduct(keys(var.environments), var.generated_secrets) :
    "${pair[0]}/${pair[1]}" => { env = pair[0], name = pair[1] }
  }
}

# Each environment reads its own app secrets plus the shared ones for its tier.
resource "vault_policy" "app" {
  for_each = var.environments

  name = "${var.name}-${each.key}"

  policy = <<-EOT
    path "${var.kv_mount}/data/${var.name}/${each.value.tier}" {
      capabilities = ["read"]
    }

    path "${var.kv_mount}/data/shared/${each.value.tier}" {
      capabilities = ["read"]
    }
  EOT
}

resource "vault_approle_auth_backend_role" "app" {
  for_each = var.environments

  backend        = var.approle_path
  role_name      = "${var.name}-${each.key}"
  token_policies = [vault_policy.app[each.key].name]
  token_ttl      = 900
  token_max_ttl  = 3600
}

resource "vault_approle_auth_backend_role_secret_id" "app" {
  for_each = var.environments

  backend   = var.approle_path
  role_name = vault_approle_auth_backend_role.app[each.key].role_name
}

# Encrypts the env varlock freezes into each build. Rollbacks restore the old
# variables too, so a rotated key still matches older builds.
resource "random_bytes" "varlock_key" {
  for_each = var.environments

  length = 32
}

resource "random_password" "generated" {
  for_each = local.generated

  length  = 48
  special = false
}

# One collection per environment, so a change redeploys each environment once.
# It only touches the variables it lists; the app's others stay as they are.
resource "railway_variable_collection" "app" {
  for_each = var.environments

  environment_id = each.value.id
  service_id     = var.service_id

  variables = concat(
    [
      { name = "OPENBAO_ADDR", value = var.openbao_addr },
      { name = "VAULT_ROLE_ID", value = vault_approle_auth_backend_role.app[each.key].role_id },
      { name = "VAULT_SECRET_ID", value = vault_approle_auth_backend_role_secret_id.app[each.key].secret_id },
      { name = "_VARLOCK_ENV_KEY", value = random_bytes.varlock_key[each.key].hex },
    ],
    [
      for name in sort(tolist(var.generated_secrets)) :
      { name = name, value = random_password.generated["${each.key}/${name}"].result }
    ],
  )
}
