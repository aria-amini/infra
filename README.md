# infra

The platform behind my apps: [OpenBao](https://openbao.org) on Railway holds
every app's secrets, plus the ones apps share, such as the development Google
OAuth client. Everything is rebuilt by one task, `mise run up`, which the
`platform` workflow runs from GitHub Actions. Nothing needs my laptop.

## Where things live

| What | Where |
|---|---|
| Railway project `platform` (OpenBao service, volume, domain) | `.railway/railway.ts`, applied by `railway config apply` |
| OpenBao first-time setup (init, admin user) | `mise-tasks/up`, `policies/admin.hcl` |
| OpenBao's KV mount, the `dev` policy, and each app environment's policy and AppRole | `pulumi/` (Pulumi's Vault provider; state in Pulumi Cloud, stack `aria-amini/prod`), driven by `apps.json` |
| The apps, their Railway environments, and the tier each reads | `apps.json` |
| An app's login in Railway (`OPENBAO_ADDR`, `VAULT_ROLE_ID`, `VAULT_SECRET_ID`) | `mise run onboard <app>` |
| Bootstrap secrets `unseal_key`, `recovery_key`, `admin_password`, plus the server address `openbao_addr` | Pulumi ESC environment `aria-amini/platform/bootstrap` |
| A read-only token for each dev machine | `mise run dev-token` |
| `RAILWAY_API_TOKEN`, `PULUMI_ACCESS_TOKEN` | GitHub environment `infra`, usable from `main` only |

The unseal key lets OpenBao start without anyone typing a key. It is generated
once into ESC, then copied to Railway. `up` refuses to replace it: if it is
lost, every stored secret is unreadable.

## Bring it up, or repair it

```sh
gh workflow run platform --repo aria-amini/infra
```

`up` is safe to repeat. It creates only what is missing and ends with OpenBao
unsealed and configured. The same task runs anywhere that has the two tokens as
environment variables.

## Secrets

Values live in the KV mount `secret`:

| Path | Read by |
|---|---|
| `secret/<app>/production`, `secret/<app>/preview` | that app's matching Railway environments |
| `secret/shared/production`, `secret/shared/preview` | every app's matching environments |
| `secret/shared/development` | dev machines (`dev-token`); the development Google OAuth client lives here |

Type values into the OpenBao UI yourself: they never go through git, Pulumi or a
script. Apps read them with varlock's `vaultSecret()`.

## Add an app

1. Add it to `apps.json`: its Railway project ID, service name, and each Railway
   environment with the tier it reads (`production` or `preview`). Merge, then
   run the workflow. The app gets a policy and an AppRole per environment.
2. Give each environment its login (needs a Pulumi and a Railway login):

   ```sh
   mise run onboard <app>
   ```

   It sets `OPENBAO_ADDR`, `VAULT_ROLE_ID` and `VAULT_SECRET_ID` on the app's
   Railway service without triggering a deploy (the login takes effect on the
   next deployment, so redeploy or push to use it), and skips an environment whose
   login still works. Railway PR environments copy the variables of the
   environment they are based on when they are created, so each app's PR
   environments must be based on its `staging` environment, never `production`:
   a PR environment based on production would hold the production login, and
   PR code could read production secrets. (Verified for dutch-oven: a PR
   environment carries staging's login, not production's.)
3. Type the app's secrets into `secret/<app>/<tier>`.

Removing an app from `apps.json` deletes its policy and logins. Pulumi refuses
to run with an empty file.

### varlock's encryption key

Apps that use varlock's `@encryptInjectedEnv` also need `_VARLOCK_ENV_KEY` on
each Railway service, with a different value per environment. This repo does not
manage it. Generate each one once and set it only if absent, so a re-run never
swaps it:

```sh
export RAILWAY_PROJECT_ID=<project-id>
vars=$(railway variable list -e <environment> -s <service> --json) &&
  [ "$(jq -r 'has("_VARLOCK_ENV_KEY")' <<<"$vars")" = false ] &&
  printf %s "$(openssl rand -hex 32)" |
  railway variable set _VARLOCK_ENV_KEY --stdin -e <environment> -s <service> --skip-deploys
```

It sets the key only after a successful read confirms it is absent, so a failed
read never replaces a key that exists.

The build locks the app's secrets with the key and the app unlocks them at boot,
so the value must not change between a build and its deploy. Replacing it
breaks rollbacks to older builds. To rotate, set a new value and redeploy.

## Give a machine access

Each dev machine gets its own read-only token, valid for 30 days and limited to
`secret/shared/development`:

```sh
mise run dev-token
```

It reads the admin password from ESC (so it needs a Pulumi login that can open
`aria-amini/platform/bootstrap`), mints an orphaned token on the `dev` policy,
revokes the admin session, and writes `~/.config/openbao/.env.dev` with mode
`0600`. Run it again, or `bao token renew`, before the 30 days end.

## Sign in

The address is the `openbao` service's public domain in Railway. Open
`<address>/ui/`, choose the Username method, and sign in as `admin`. Read the
password with:

```sh
pulumi env open aria-amini/platform/bootstrap --format json | jq -r .admin_password
```

## Starting from nothing

1. Railway: Account settings, Tokens, create a token for the `applications` workspace.
2. Pulumi: Settings, Access Tokens, create a token.
3. Store each in the `infra` environment from your own terminal. Read the token
   with `read -rs T`, then `printf %s "$T" | gh secret set NAME --env infra --repo aria-amini/infra`.
4. Run the workflow above.

## Things to know

- **The KV mount is protected.** Deleting or replacing it erases every secret in
  it, and there are no backups, so `pulumi/index.ts` marks it (and the AppRole
  backend) `protect: true`. Pulumi refuses to touch them until you remove that
  on purpose.
- **Rebuilding.** If OpenBao is recreated from scratch, `up` refreshes Pulumi's
  state first, so the mount, roles and policies are created again. Stored secret values are
  gone with the old server, every machine needs a new `dev-token`, and every
  app needs `mise run onboard` again.
- **Vault provider on OpenBao.** Pulumi's Vault provider is built for HashiCorp
  Vault; it works against OpenBao for the resources used here (mounts, policies,
  AppRole), but is not officially supported.
- **Trust boundary.** Whoever can change `main` can change the workflow and read
  every secret above. Merging to `main` is the control.
- **No backups yet.** OpenBao's data lives only on its Railway volume. Turn on
  volume backups in Railway and test a restore before relying on it.
- **Recovery key.** OpenBao 2.7 cannot mint a new root token from it, so `up`
  creates the admin user right after init and revokes the root token. If a run
  dies between those steps and nothing is stored yet, delete the `openbao`
  volume in Railway and run `up` again.
- **Audit log.** Not enabled yet. OpenBao 2.7 takes audit devices from the
  server config, not the API.
