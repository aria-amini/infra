# infra

The platform behind my apps: [OpenBao](https://openbao.org) on Railway holds
the secrets my apps share, such as the development Google OAuth client. Each app
keeps its own secrets in its own Railway variables. Everything is rebuilt by one task, `mise run up`, which the
`platform` workflow runs from GitHub Actions. Nothing needs my laptop.

## Where things live

| What | Where |
|---|---|
| Railway project `platform` (OpenBao service, volume, domain) | `.railway/railway.ts`, applied by `railway config apply` |
| OpenBao first-time setup (init, admin user) | `mise-tasks/up`, `policies/admin.hcl` |
| OpenBao's KV mount and the `dev` policy | `pulumi/` (Pulumi's Vault provider; state in Pulumi Cloud, stack `aria-amini/prod`) |
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

## Shared secrets

Shared values live in the KV mount `secret`, at `secret/shared/<name>`. The
first is `secret/shared/development`, which holds the development Google OAuth
client (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). Type values into the OpenBao
UI yourself: they never go through git, Pulumi or a script.

Apps read them in development through varlock's `vaultSecret()`. Nothing
deployed reads OpenBao, so Railway builds and restarts don't depend on it.

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
  it, and there are no backups, so `pulumi/index.ts` marks it `protect: true`. Pulumi refuses to touch them until you remove that
  on purpose.
- **Rebuilding.** If OpenBao is recreated from scratch, `up` refreshes Pulumi's
  state first, so the mount and policies are created again. Stored secret values are gone
  with the old server, and every machine needs a new `dev-token`.
- **Vault provider on OpenBao.** Pulumi's Vault provider is built for HashiCorp
  Vault; it works against OpenBao for the resources used here (a mount and a
  policy), but is not officially supported.
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
