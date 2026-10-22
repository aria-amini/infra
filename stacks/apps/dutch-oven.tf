module "dutch_oven" {
  source = "../../modules/railway-app"

  name       = "dutch-oven"
  project_id = "951d41c1-6b81-4792-af4a-024217a42d63"
  service_id = "ff6266a5-f92d-4725-8416-6823aa4ce39d"

  openbao_addr = var.openbao_addr

  environments = {
    production = { id = "52149a4c-4aa3-4697-bff3-7da1183ecdb8", tier = "production" }
    # Base environment for PR previews.
    staging = { id = "e6656f4e-5d32-4435-aa1b-0d7a8b58bfa6", tier = "preview" }
  }
}

output "dutch_oven" {
  value = module.dutch_oven.secret_paths
}
