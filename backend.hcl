# Shared state backend: Cloudflare R2 through its S3 API. Each stack sets its
# own key. The endpoint comes from AWS_ENDPOINT_URL_S3 and the bucket from
# STATE_BUCKET (mise.toml); credentials come from AWS_ACCESS_KEY_ID and
# AWS_SECRET_ACCESS_KEY, prompted by mise-tasks/tf.
region                      = "auto"
use_path_style              = true
use_lockfile                = true
skip_credentials_validation = true
skip_region_validation      = true
skip_requesting_account_id  = true
skip_metadata_api_check     = true
skip_s3_checksum            = true
