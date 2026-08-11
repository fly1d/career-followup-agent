import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const databasePath = resolve(".data/e2e.db");
for (const suffix of ["", "-shm", "-wal"]) {
  rmSync(`${databasePath}${suffix}`, { force: true });
}

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--port", "3100"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_PATH: databasePath,
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code) => process.exit(code ?? 0));
