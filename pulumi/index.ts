import * as pulumi from "@pulumi/pulumi";
import * as vault from "@pulumi/vault";

// Secrets shared by every app live under secret/shared/<tier>. Values are typed
// into OpenBao by hand; nothing in this program holds a secret.
const kv = new vault.Mount("kv", {
  path: "secret",
  type: "kv",
  options: { version: "2" },
  description: "Shared secrets",
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
