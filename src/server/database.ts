import { resolve } from "node:path";
import { createSqliteFollowUpStore, type FollowUpStore } from "./store";

const globalDatabase = globalThis as typeof globalThis & {
  followUpStorePromise?: Promise<FollowUpStore>;
};

export function getRepository() {
  if (!globalDatabase.followUpStorePromise) {
    const storePromise = createStore();
    globalDatabase.followUpStorePromise = storePromise;
    void storePromise.catch(() => {
      if (globalDatabase.followUpStorePromise === storePromise) {
        globalDatabase.followUpStorePromise = undefined;
      }
    });
  }
  return globalDatabase.followUpStorePromise;
}

async function createStore(): Promise<FollowUpStore> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    const { createPostgresFollowUpStore } = await import("./postgres-store");
    return createPostgresFollowUpStore(connectionString);
  }

  const configuredPath = process.env.DATABASE_PATH?.trim() || ".data/followup.db";
  const databasePath = resolve(
    /* turbopackIgnore: true */ process.cwd(),
    configuredPath,
  );
  return createSqliteFollowUpStore(databasePath);
}
