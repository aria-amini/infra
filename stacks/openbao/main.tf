resource "railway_project" "secrets" {
  name         = "secrets"
  description  = "OpenBao, the secret store for every app."
  workspace_id = var.workspace_id

  lifecycle {
    prevent_destroy = true
  }
}

resource "railway_service" "openbao" {
  name         = "openbao"
  project_id   = railway_project.secrets.id
  source_image = "openbao/openbao:${var.openbao_version}"

  # The image entrypoint adds -config=/openbao/config, where BAO_LOCAL_CONFIG lands.
  start_command = "server"

  # Healthy once listening; an uninitialized server must still pass the first deploy.
  healthcheck_path    = "/v1/sys/health?uninitcode=200&standbycode=200"
  healthcheck_timeout = 120
  restart_policy_type = "ALWAYS"

  # Single node: integrated raft storage lives on this volume.
  volume = {
    name       = "openbao-data"
    mount_path = "/openbao/file"
  }

  # Destroying the service deletes the volume, and every secret with it.
  lifecycle {
    prevent_destroy = true
  }
}

resource "railway_service_domain" "openbao" {
  environment_id = railway_project.secrets.default_environment.id
  service_id     = railway_service.openbao.id
  subdomain      = var.subdomain
  target_port    = 8200
}

# 32-byte AES key for the static seal, so restarts unseal on their own.
# Recovery keys cannot decrypt the data without it: keep a copy in the
# password manager (tofu output -raw unseal_key) and never replace it.
resource "random_bytes" "unseal_key" {
  length = 32

  lifecycle {
    prevent_destroy = true
  }
}

locals {
  api_addr = "https://${railway_service_domain.openbao.domain}"

  config = {
    ui            = false
    disable_mlock = true
    api_addr      = local.api_addr
    cluster_addr  = "http://127.0.0.1:8201"

    storage = {
      raft = {
        path    = "/openbao/file/raft"
        node_id = "railway-1"
      }
    }

    # Railway's edge terminates TLS in front of the service.
    listener = {
      tcp = {
        address     = "[::]:8200"
        tls_disable = true
      }
    }

    seal = {
      static = {
        current_key_id = "railway-1"
        current_key    = "env://BAO_UNSEAL_KEY"
      }
    }

    # Every request, with tokens and values HMAC'd, into Railway's logs.
    audit = [{
      stdout = {
        type    = "file"
        path    = "stdout"
        options = { file_path = "stdout" }
      }
    }]
  }
}

resource "railway_variable_collection" "openbao" {
  environment_id = railway_project.secrets.default_environment.id
  service_id     = railway_service.openbao.id

  variables = [
    { name = "BAO_LOCAL_CONFIG", value = jsonencode(local.config) },
    { name = "BAO_UNSEAL_KEY", value = random_bytes.unseal_key.base64 },
    # Railway volumes mount as root: start as root so the entrypoint can chown
    # /openbao/file, then it drops to the openbao user.
    { name = "RAILWAY_RUN_UID", value = "0" },
  ]
}
