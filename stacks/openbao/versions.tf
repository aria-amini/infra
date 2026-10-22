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
  }

  backend "s3" {
    key = "openbao.tfstate"
  }

  # State holds the unseal key, so it is always encrypted, on top of R2.
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

provider "railway" {}
