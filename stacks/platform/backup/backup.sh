#!/bin/sh
# Daily OpenBao raft snapshot, uploaded to S3-compatible storage (R2). Runs as
# the openbao-backup cron service; stacks/platform passes it in BACKUP_SCRIPT.
# Snapshots stay encrypted by OpenBao's barrier, so they are useless without
# the unseal key.
set -eu
command -v curl >/dev/null || apk add --no-cache curl >/dev/null
# Keep the periodic token alive; it expires if unused for a whole period.
bao token renew >/dev/null
name="openbao-$(date -u +%Y-%m-%dT%H%M%SZ).snap"
bao operator raft snapshot save "/tmp/$name"
curl --fail --silent --show-error \
  --aws-sigv4 "aws:amz:${BACKUP_S3_REGION:-auto}:s3" \
  --user "$BACKUP_S3_ACCESS_KEY_ID:$BACKUP_S3_SECRET_ACCESS_KEY" \
  --upload-file "/tmp/$name" \
  "$BACKUP_S3_ENDPOINT/$BACKUP_S3_BUCKET/openbao/$name"
echo "uploaded $name ($(wc -c < "/tmp/$name") bytes)"
