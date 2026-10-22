terraform {
  required_providers {
    railway = {
      source = "terraform-community-providers/railway"
    }
    vault = {
      source = "hashicorp/vault"
    }
    random = {
      source = "hashicorp/random"
    }
  }
}
