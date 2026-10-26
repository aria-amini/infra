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

Two kinds, kept in two places.

**Secret zero** is what nothing here can regenerate. Keep one Bitwarden item
("infra secret zero") with:

| What | Made by | Needed for |
| --- | --- | --- |
| State passphrase | you, `openssl rand -base64 32` | reading every stack's state |
| Bootstrap age private key | you, `age-keygen` | opening the bootstrap bundle |
| The bootstrap bundle (ciphertext) | the bootstrap run | the unseal key, recovery key, and admin password inside it |

Keep a second copy of the first two offline (printed, or on a USB stick).

**Replaceable tokens** live only in the GitHub `infra` environment. Mint a new
one in a minute if it leaks or is lost:

| Secret | What it is |
| --- | --- |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | R2 token scoped to `aria-infra-state` |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | R2 token scoped to `aria-openbao-backups` |
| `RAILWAY_TOKEN` | Railway account token |
| `TF_VAR_STATE_PASSPHRASE` | the state passphrase, from secret zero |

The `BOOTSTRAP_AGE_RECIPIENT` variable holds the age public key. The
environment only deploys from `main`. GitHub doesn't offer required reviewers
on a private repo at this plan, so starting a workflow is the approval.

Workflows log in to OpenBao with their OIDC token (`auth/github`), so GitHub
holds no OpenBao credential.

Whoever can merge to `main` controls the workflows, and so every secret in
the environment and an admin OpenBao token. Treat write access to this repo as
admin access to all of it. The `ci` role is also bound to the `tofu` workflow
and `workflow_dispatch`, which stops other workflows from logging in to
OpenBao but not from reading the GitHub secrets.

Locally, `mise run tf <stack> <args>` prompts for the same values and never
writes them to disk. While tofu runs they sit in its process environment, which
other processes of the same user can read (`/proc/<pid>/environ`), so run it
only on a machine no agent can reach; use the workflows from anywhere else.
Export any of them first (e.g. from the Bitwarden CLI) to skip the prompt.
Admin logins use `-no-store`, so nothing lands in `~/.vault-token`. The only
OpenBao credential a dev machine should hold is the development-only token.

## Bootstrap (once)

Everything after step 4 runs in GitHub Actions, so no particular machine is
needed.

1. In Cloudflare R2, create `aria-infra-state` and `aria-openbao-backups`, and
   an R2 token for each, scoped to that bucket with Object Read & Write. The
   account's endpoint is already in `mise.toml`.
2. In Railway, create an account token.
3. Make secret zero and save it in Bitwarden:

   ```sh
   openssl rand -base64 32       # the state passphrase
   age-keygen -o bootstrap.key   # keep the file; the public key is printed
   ```

4. Set the environment, typing each value at the prompt:

   ```sh
   gh variable set BOOTSTRAP_AGE_RECIPIENT --env infra --body 'age1...'
   for s in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY BACKUP_S3_ACCESS_KEY_ID \
     BACKUP_S3_SECRET_ACCESS_KEY RAILWAY_TOKEN TF_VAR_STATE_PASSPHRASE; do
     gh secret set "$s" --env infra
   done
   ```

5. Run the **bootstrap** workflow. It checks that R2 locks state, applies the
   `openbao` stack, initializes OpenBao with one recovery key, applies the
   `platform` stack with the root token, creates your admin login, and revokes
   the root token.
6. Download the `bootstrap-bundle` artifact and open it:

   ```sh
   age -d -i bootstrap.key bootstrap-bundle.age
   ```

   Save the output in the Bitwarden item (the root token inside is already
   revoked), then delete the artifact.
7. On each dev machine: `mise run dev-token`.
8. Turn on automated backups for the `openbao` volume in Railway's dashboard,
   on top of the daily snapshots.

If the run fails before OpenBao is initialized, fix the cause and run it again;
the recipient and the lock check are validated first. If it fails after, the
bundle is already written and the artifact uploads anyway: open it, then finish
from a machine you trust with the root token inside:

```sh
VAULT_TOKEN=<root> mise run tf platform apply
BAO_TOKEN=<root> bao write auth/userpass/users/aria password=- \
  token_policies=admin token_ttl=1h token_max_ttl=4h
BAO_TOKEN=<root> bao token revoke -self
```

If `bao operator init` itself fails halfway and there is no artifact, nothing
is stored yet: delete the `openbao` volume in Railway and run the workflow
again.

## Stacks

- **`openbao`**: the server. Raft storage on a Railway volume, a static seal
  key so restarts unseal themselves, an audit log to stdout, no UI.
  `prevent_destroy` guards the project, the service and its volume, and the
  unseal key.
- **`platform`**: OpenBao itself. KV v2 at `secret/` (guarded), AppRole for
  apps, userpass for you, JWT for GitHub Actions, the `admin`, `developer`, and
  `snapshot` policies, and the `openbao-backup` cron service, which uploads a
  raft snapshot daily.
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
| New app | add `stacks/apps/<app>.tf`, merge it, run the **tofu** workflow for `apps` (plan, then apply), add the schema lines |
| Change a stack | run the **tofu** workflow: pick the stack, `plan`, read it, then `apply`. Apply plans again, so it can differ if state changed in between. |
| New dev machine | `mise run dev-token` |
| Admin shell | `export BAO_ADDR=... BAO_TOKEN=$(bao login -method=userpass -no-store -token-only username=aria)` |

Use `kv patch` rather than `kv put` on an existing path: `put` replaces every
key at that path.

## When something goes wrong

The `-replace=` fixes below run in the **tofu** workflow (`apply`, with the
address in `args`) or locally with `mise run tf`.

| What | Do |
| --- | --- |
| An app's AppRole leaked | `mise run tf apps apply -replace='module.<app>.vault_approle_auth_backend_role_secret_id.app["<env>"]'`, then rotate the secrets it could read. Open PR previews keep the old ID; redeploy them from the base. |
| `_VARLOCK_ENV_KEY` leaked | replace `module.<app>.random_bytes.varlock_key["<env>"]` the same way and redeploy. |
| An app secret leaked | rotate it upstream, `bao kv patch`, redeploy. |
| OpenBao lost its data | restore the latest snapshot from the backup bucket: `bao operator raft snapshot restore <file>`. It needs the same unseal key. |
| The backup token expired | the job stopped for 32 days: `mise run tf platform apply -replace=vault_token.backup`. |
| State passphrase lost | CI still holds it, so workflows keep working, but GitHub never shows it again. With every copy gone the state can't be read: start with a new passphrase and `tofu import` each resource, then rotate what only state held (AppRole secret IDs, varlock keys). OpenBao and its secrets are untouched. |
| Bootstrap age key lost | the bundle can't be opened. Nothing running breaks, and your admin login still works. You can no longer make a new root token, and the unseal key is still readable from state: `mise run tf openbao output -raw unseal_key`. Make a new key pair and keep two copies. |
| A GitHub token leaked (R2, Railway) | mint a new one and `gh secret set` it. The R2 tokens only reach their own bucket, and the state in it is encrypted. |
| Railway account compromised | everything: the unseal key lives there too. Rotate every secret. |
