import { resolve } from "node:path";
import { createFollowUpRepository, DEMO_WORKSPACE_ID } from "./repository";

type Repository = ReturnType<typeof createFollowUpRepository>;

const globalDatabase = globalThis as typeof globalThis & {
  followUpRepository?: Repository;
};

export function getRepository() {
  if (!globalDatabase.followUpRepository) {
    const configuredPath = process.env.DATABASE_PATH ?? ".data/followup.db";
    const databasePath = resolve(
      /* turbopackIgnore: true */ process.cwd(),
      configuredPath,
    );
    globalDatabase.followUpRepository = createFollowUpRepository(databasePath);
    globalDatabase.followUpRepository.seedDemoWorkspace();
  }
  return globalDatabase.followUpRepository;
}

export { DEMO_WORKSPACE_ID };
