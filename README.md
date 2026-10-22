# infra

Infrastructure shared by all my apps, managed with OpenTofu. OpenBao on
Railway is the one place for app secrets and config; each app's Varlock schema
reads it directly. Tools are pinned in `mise.toml`.

## How it fits together

```
OpenBao (Railway project "secrets")
  secret/shared/<env>   values every app reuses, e.g. the dev Google client
  secret/<app>/<env>    app values; env is development, preview, or production

app build (Railway)  AppRole from Railway variables -> reads its app and tier
                     -> varlock freeze writes an encrypted env into the image
app runtime          decrypts the frozen env; never contacts OpenBao
local dev            ~/.config/openbao/.env.dev token -> */development only
tests and CI         never contact OpenBao
```

Restarts and rollbacks never need OpenBao: Railway restores an old image
together with its old variables, including the `_VARLOCK_ENV_KEY` it was
frozen with. Only new builds do.

## Credentials

Run everything through `mise run tf <stack> <args>`. It prompts for what it
needs and never writes credentials to disk, so agents on a dev machine can't
read them:

- state passphrase (password manager)
- R2 access key for the state bucket (password manager)
- Railway account token (password manager)
- OpenBao admin: a 1-hour token from your userpass login, prompted per run

Export any of them first (e.g. from a password manager CLI) to skip the
prompt. Admin logins use `-no-store`, so nothing lands in `~/.vault-token`.

Keep admin credentials off machines where agents run. The only OpenBao
credential a dev machine holds is the development-only token.

## Bootstrap (once)

1. In Cloudflare R2, create two buckets and an access key scoped to each:
   `aria-infra-state` (state) and `aria-openbao-backups` (snapshots). Set
   `AWS_ENDPOINT_URL_S3` in `mise.toml`.
2. Check that R2 enforces state locking: `mise run check-r2-lock`.
3. `mise run tf openbao apply`. Save the unseal key in the password manager:
   `mise run tf openbao output -raw unseal_key`. The recovery keys can't
   decrypt anything without it.
4. Initialize OpenBao and keep the output in the password manager:

   ```sh
   export BAO_ADDR=$(mise run --quiet tf openbao output -raw address)
   bao operator init   # recovery keys and the root token, shown once
   ```

5. Apply the platform with the root token:
   `VAULT_TOKEN=<root> TF_VAR_backup='{...}' mise run tf platform apply`
   (`TF_VAR_backup` holds the backup bucket's endpoint, name, and key).
6. Create your admin login, then revoke the root token:

   ```sh
   BAO_TOKEN=<root> bao write auth/userpass/users/aria \
     password=- token_policies=admin token_ttl=1h token_max_ttl=4h
   BAO_TOKEN=<root> bao token revoke -self
   ```

7. On each dev machine: `mise run dev-token`.
8. Turn on automated backups for the `openbao` volume in Railway's dashboard,
   on top of the daily snapshots.

## Stacks

- **`openbao`**: the server. Raft storage on a Railway volume, a static seal
  key so restarts unseal themselves, an audit log to stdout, no UI.
  `prevent_destroy` guards the project, the service and its volume, and the
  unseal key.
- **`platform`**: OpenBao itself. KV v2 at `secret/` (guarded), AppRole for
  apps, userpass for you, the `admin`, `developer`, and `snapshot` policies,
  and the `openbao-backup` cron service, which uploads a raft snapshot daily.
- **`apps`**: one file per app calling `modules/railway-app`. For each
  Railway environment it creates a policy and AppRole that read only
  `secret/<app>/<tier>` and `secret/shared/<tier>`, and sets `OPENBAO_ADDR`,
  `VAULT_ROLE_ID`, `VAULT_SECRET_ID`, and a fresh `_VARLOCK_ENV_KEY` in one
  Railway variable collection. It never touches the app's other variables.

Map PR previews through their base environment (dutch-oven: `staging`), and
set that as the PR base in Railway's project settings; otherwise previews copy
production's variables.

## Day to day

| Task | How |
| --- | --- |
| Set a secret | `bao kv patch secret/<app>/<env> KEY=value`, then redeploy |
| New app | add `stacks/apps/<app>.tf`, `mise run tf apps apply`, add the schema lines |
| New dev machine | `mise run dev-token` |
| Admin shell | `export BAO_ADDR=... BAO_TOKEN=$(bao login -method=userpass -no-store -token-only username=aria)` |

Use `kv patch` rather than `kv put` on an existing path: `put` replaces every
key at that path.

## When something goes wrong

| What | Do |
| --- | --- |
| An app's AppRole leaked | `mise run tf apps apply -replace='module.<app>.vault_approle_auth_backend_role_secret_id.app["<env>"]'`, then rotate the secrets it could read. Open PR previews keep the old ID; redeploy them from the base. |
| `_VARLOCK_ENV_KEY` leaked | replace `module.<app>.random_bytes.varlock_key["<env>"]` the same way and redeploy. |
| An app secret leaked | rotate it upstream, `bao kv patch`, redeploy. |
| OpenBao lost its data | restore the latest snapshot from the backup bucket: `bao operator raft snapshot restore <file>`. It needs the same unseal key. |
| The backup token expired | the job stopped for 32 days: `mise run tf platform apply -replace=vault_token.backup`. |
| Railway account compromised | everything: the unseal key lives there too. Rotate every secret. |
