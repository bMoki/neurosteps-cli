import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  BACKEND_REPO,
  BASE_DIR,
  DB_NAME,
  DB_PASSWORD,
  DB_USER,
  FRONTEND_REPO,
  MANAGER_REPO,
  PRODUCT_NAME,
  WORKSPACE_DIR,
  env,
  reloadEnv,
  workspaceEnvSchema,
} from "../../lib/env";
import {
  BACKEND_REPO as CONFIG_BACKEND_REPO,
  WORKSPACE_DIR as CONFIG_WORKSPACE_DIR,
} from "../../lib/config";

const trackedEnvKeys = [
  "NS_BASE_DIR",
  "NS_PRODUCT_NAME",
  "NS_BACKEND_MODULE",
  "NS_BACKEND_REPO_NAME",
  "NS_MANAGER_REPO_NAME",
  "NS_SEED_VOLUME",
  "NS_BACKEND_REPO",
  "NS_FRONTEND_REPO",
  "NS_MANAGER_REPO",
  "NS_DB_USER",
  "NS_DB_PASSWORD",
  "NS_DB_NAME",
] as const;

type TrackedEnvKey = (typeof trackedEnvKeys)[number];

async function withProcessEnv(
  vars: Partial<Record<TrackedEnvKey, string>>,
  run: () => void | Promise<void>,
): Promise<void> {
  const original = Object.fromEntries(
    trackedEnvKeys.map((key) => [key, process.env[key]]),
  ) as Record<TrackedEnvKey, string | undefined>;

  try {
    for (const [key, value] of Object.entries(vars)) {
      process.env[key] = value;
    }

    await reloadEnv();
    await run();
  } finally {
    for (const key of trackedEnvKeys) {
      const value = original[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    await reloadEnv();
  }
}

describe("env reload", () => {
  test("updates computed exports after reloadEnv", async () => {
    await withProcessEnv(
      {
        NS_BASE_DIR: "/tmp/ns-reload-one",
        NS_PRODUCT_NAME: "alpha",
        NS_BACKEND_MODULE: "alpha-core",
        NS_BACKEND_REPO_NAME: "alpha-backend",
        NS_MANAGER_REPO_NAME: "alpha-manager",
        NS_SEED_VOLUME: "alpha_seed",
        NS_BACKEND_REPO: "",
        NS_FRONTEND_REPO: "",
        NS_MANAGER_REPO: "",
      },
      async () => {
        expect(env.NS_PRODUCT_NAME).toBe("alpha");
        expect(PRODUCT_NAME).toBe("alpha");
        expect(BASE_DIR).toBe("/tmp/ns-reload-one");
        expect(WORKSPACE_DIR).toBe("/tmp/ns-reload-one/alpha-workspace");
        expect(BACKEND_REPO).toBe(join("/tmp/ns-reload-one", "alpha-backend"));
        expect(FRONTEND_REPO).toBe(join("/tmp/ns-reload-one", "frontend"));
        expect(MANAGER_REPO).toBe(join("/tmp/ns-reload-one", "alpha-manager"));

        process.env.NS_BASE_DIR = "/tmp/ns-reload-two";
        process.env.NS_PRODUCT_NAME = "beta";
        process.env.NS_BACKEND_REPO_NAME = "beta-backend";
        process.env.NS_MANAGER_REPO_NAME = "beta-manager";
        process.env.NS_SEED_VOLUME = "beta_seed";
        await reloadEnv();

        expect(env.NS_PRODUCT_NAME).toBe("beta");
        expect(PRODUCT_NAME).toBe("beta");
        expect(BASE_DIR).toBe("/tmp/ns-reload-two");
        expect(WORKSPACE_DIR).toBe("/tmp/ns-reload-two/beta-workspace");
        expect(BACKEND_REPO).toBe(join("/tmp/ns-reload-two", "beta-backend"));
        expect(FRONTEND_REPO).toBe(join("/tmp/ns-reload-two", "frontend"));
        expect(MANAGER_REPO).toBe(join("/tmp/ns-reload-two", "beta-manager"));
      },
    );
  });

  test("updates config re-exports after reloadEnv", async () => {
    await withProcessEnv(
      {
        NS_BASE_DIR: "/tmp/ns-config-reexport",
        NS_PRODUCT_NAME: "gamma",
        NS_BACKEND_MODULE: "gamma-core",
        NS_BACKEND_REPO_NAME: "gamma-backend",
        NS_MANAGER_REPO_NAME: "gamma-manager",
        NS_SEED_VOLUME: "gamma_seed",
        NS_BACKEND_REPO: "",
      },
      () => {
        expect(CONFIG_WORKSPACE_DIR).toBe("/tmp/ns-config-reexport/gamma-workspace");
        expect(CONFIG_BACKEND_REPO).toBe(join("/tmp/ns-config-reexport", "gamma-backend"));
      },
    );
  });

  test("uses current env defaults when parsing workspace env", async () => {
    await withProcessEnv(
      {
        NS_DB_USER: "user_one",
        NS_DB_PASSWORD: "password_one",
        NS_DB_NAME: "db_one",
      },
      async () => {
        let parsed = workspaceEnvSchema.parse({
          BRANCH_NAME: "FEAT-1",
          BRANCH_SLUG: "feat-1",
          DB_PORT: "5432",
          BACKEND_PORT: "8080",
          FRONTEND_PORT: "3000",
          DB_VOLUME: "volume",
          DB_CONTAINER: "container",
          COMPOSE_PROJECT: "project",
        });

        expect(parsed.DB_USER).toBe("user_one");
        expect(parsed.DB_PASSWORD).toBe("password_one");
        expect(parsed.DB_NAME).toBe("db_one");
        expect(DB_USER).toBe("user_one");
        expect(DB_PASSWORD).toBe("password_one");
        expect(DB_NAME).toBe("db_one");

        process.env.NS_DB_USER = "user_two";
        process.env.NS_DB_PASSWORD = "password_two";
        process.env.NS_DB_NAME = "db_two";
        await reloadEnv();

        parsed = workspaceEnvSchema.parse({
          BRANCH_NAME: "FEAT-2",
          BRANCH_SLUG: "feat-2",
          DB_PORT: "5433",
          BACKEND_PORT: "8081",
          FRONTEND_PORT: "3001",
          DB_VOLUME: "volume-two",
          DB_CONTAINER: "container-two",
          COMPOSE_PROJECT: "project-two",
        });

        expect(parsed.DB_USER).toBe("user_two");
        expect(parsed.DB_PASSWORD).toBe("password_two");
        expect(parsed.DB_NAME).toBe("db_two");
        expect(DB_USER).toBe("user_two");
        expect(DB_PASSWORD).toBe("password_two");
        expect(DB_NAME).toBe("db_two");
      },
    );
  });
});
