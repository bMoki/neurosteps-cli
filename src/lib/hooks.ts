import { readSettings } from "./settings";
import { configureIntellijDatabase } from "../hooks/intellij-db";
import { configureIntellijTerminals, type IntellijTerminalRepo } from "../hooks/intellij-terminals";

export type HookEvent = "new:after";
export type HookName = "intellij:configure-db" | "intellij:configure-terminals";

export interface NewAfterHookContext {
  branch: string;
  ideaDir: string;
  productName: string;
  dataSourceUuid: string;
  dbPort: number;
  dbUser: string;
  dbName: string;
  dbSchema?: string;
  repos: IntellijTerminalRepo[];
}

export interface HookContextByEvent {
  "new:after": NewAfterHookContext;
}

const DEFAULT_HOOKS: Record<HookEvent, HookName[]> = {
  "new:after": ["intellij:configure-db", "intellij:configure-terminals"],
};

export async function runHooks<E extends HookEvent>(event: E, context: HookContextByEvent[E]): Promise<void> {
  const settings = await readSettings();
  const configuredHooks = settings.hooks?.[event] as HookName[] | undefined;
  const hooks = configuredHooks ?? DEFAULT_HOOKS[event];

  for (const hook of hooks) {
    await runHook(hook, event, context);
  }
}

async function runHook<E extends HookEvent>(hook: HookName, event: E, context: HookContextByEvent[E]): Promise<void> {
  if (hook === "intellij:configure-db" && event === "new:after") {
    const newContext = context as HookContextByEvent["new:after"];
    await configureIntellijDatabase({
      ideaDir: newContext.ideaDir,
      branch: newContext.branch,
      productName: newContext.productName,
      uuid: newContext.dataSourceUuid,
      dbPort: newContext.dbPort,
      dbUser: newContext.dbUser,
      dbName: newContext.dbName,
      schema: newContext.dbSchema,
    });
    return;
  }

  if (hook === "intellij:configure-terminals" && event === "new:after") {
    const newContext = context as HookContextByEvent["new:after"];
    await configureIntellijTerminals({
      ideaDir: newContext.ideaDir,
      repos: newContext.repos,
    });
    return;
  }

  throw new Error(`Hook desconhecido: ${hook}`);
}
