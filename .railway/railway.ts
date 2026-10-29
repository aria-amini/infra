import { defineRailway, image, preserve, project, service, volume } from "railway/iac";

// OpenBao reads this file on boot; only the unseal key stays out of git.
const config = {
  ui: true,
  cluster_addr: "http://127.0.0.1:8201",
  storage: { raft: { path: "/openbao/file/raft", node_id: "railway-1" } },
  listener: { tcp: { address: "[::]:8200", tls_disable: true } },
  seal: {
    static: { current_key_id: "railway-1", current_key: "env://BAO_UNSEAL_KEY" },
  },
};

export default defineRailway(() => {
  const data = volume("openbao-data", { region: "us-west2", sizeMB: 5000 });

  const openbao = service("openbao", {
    source: image("openbao/openbao:2.7.1"),
    // The image entrypoint writes BAO_LOCAL_CONFIG, fixes the volume's owner and drops
    // root. Railway runs this without a shell, in place of the image's own command.
    startCommand: "docker-entrypoint.sh server",
    // Railway checks /health on $PORT.
    healthcheckPath: "/v1/sys/health?uninitcode=200&sealedcode=200&standbycode=200",
    healthcheckTimeout: 120,
    networking: { serviceDomains: { "*": { port: 8200 } } },
    volumeMounts: { "/openbao/file": data },
    env: {
      BAO_LOCAL_CONFIG: JSON.stringify(config),
      // Set out of band (railway variable set --stdin); preserve() keeps it.
      // Undeclared variables are deleted on apply, so declare every one.
      BAO_UNSEAL_KEY: preserve(),
      BAO_API_ADDR: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      PORT: "8200",
      RAILWAY_RUN_UID: "0",
    },
  });

  return project("platform", { resources: [data, openbao] });
});
