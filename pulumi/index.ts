import * as fs from "node:fs";
import * as path from "node:path";
import * as pulumi from "@pulumi/pulumi";
import * as vault from "@pulumi/vault";

// Secrets live under secret/<app>/<tier> and secret/shared/<tier>. Values are
// typed into OpenBao by hand; nothing in this program holds a secret.
const kv = new vault.Mount("kv", {
  path: "secret",
  type: "kv",
  options: { version: "2" },
  description: "App and shared secrets",
}, {
  // Replacing or deleting the mount erases every secret in it, and there are no
  // backups. Unprotect it deliberately, never by accident.
  protect: true,
});

// What a developer machine's token may read. `mise run dev-token` mints it.
new vault.Policy("dev", {
  name: "dev",
  policy: pulumi.interpolate`
path "${kv.path}/data/shared/development" {
  capabilities = ["read"]
}
`,
});

const approle = new vault.AuthBackend("approle", {
  type: "approle",
  path: "approle",
}, { protect: true });

// apps.json maps each app's Railway environments to a tier. Each environment
// gets a login that reads its own app's secrets plus the shared ones.
// `mise run onboard` mints the secret ID and hands it to Railway, so no secret
// ID is ever in this program's state.
const apps: Record<string, { environments: Record<string, "production" | "preview"> }> =
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "apps.json"), "utf8"));

if (Object.keys(apps).length === 0) {
  throw new Error("apps.json is empty; refusing to delete every app login");
}

for (const [app, { environments }] of Object.entries(apps)) {
  if (Object.keys(environments).length === 0) {
    throw new Error(`${app} has no environments; remove the app from apps.json to delete its logins`);
  }
  for (const [environment, tier] of Object.entries(environments)) {
    const name = `${app}-${environment}`;

    const policy = new vault.Policy(name, {
      name,
      policy: pulumi.interpolate`
path "${kv.path}/data/${app}/${tier}" {
  capabilities = ["read"]
}

path "${kv.path}/data/shared/${tier}" {
  capabilities = ["read"]
}
`,
    });

    new vault.approle.AuthBackendRole(name, {
      backend: approle.path,
      roleName: name,
      tokenPolicies: [policy.name],
      tokenTtl: 900,
      tokenMaxTtl: 3600,
    });
  }
}
