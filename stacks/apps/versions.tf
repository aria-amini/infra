terraform {
  required_version = "~> 1.13"

  required_providers {
    railway = {
      source  = "terraform-community-providers/railway"
      version = "~> 0.6.3"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
    vault = {
      source  = "hashicorp/vault"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    key = "apps.tfstate"
  }

  # State holds every app's AppRole secret ID and varlock key.
  encryption {
    key_provider "pbkdf2" "main" {
      passphrase = var.state_passphrase
    }

    method "aes_gcm" "main" {
      keys = key_provider.pbkdf2.main
    }

    state {
      method   = method.aes_gcm.main
      enforced = true
    }

    plan {
      method   = method.aes_gcm.main
      enforced = true
    }
  }
}

# Reads VAULT_ADDR and VAULT_TOKEN; OpenBao speaks the Vault API.
provider "vault" {}

provider "railway" {}
