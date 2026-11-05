import { describe, expect, mock, test } from "bun:test";
import { NsError, createSilentContext, deriveServiceState, runStatus } from "../../core";
import type { NsProgressEvent } from "../../core";
import type { StatusDeps } from "../../core/operations/status";
import type { BranchFlagInfo } from "../../lib/branch-flags";
import { PRODUCT_NAME } from "../../lib/config";
import {
  TEST_BACKEND_PORT,
  TEST_DB_CONTAINER,
  TEST_FRONTEND_PORT,
  TEST_MANAGER_PORT,
  createMockWorkspaceEnv,
} from "../setup";

type WorkspaceEnv = Awaited<ReturnType<StatusDeps["readWorkspaceEnv"]>>;

const NO_FLAGS: BranchFlagInfo = {
  flags: [],
  stale: false,
  lastCommitAt: null,
  lastCliUsedAt: null,
};

function createDeps(overrides: Partial<StatusDeps> = {}): Partial<StatusDeps> {
  return {
    listBranches: mock(() => ["feat-123"]),
    readWorkspaceEnv: mock(() => Promise.resolve(createMockWorkspaceEnv() as WorkspaceEnv)),
    listRunningContainers: mock(() => Promise.resolve([TEST_DB_CONTAINER])),
    listListeningPorts: mock(() => Promise.resolve(new Set<number>())),
    listServicePanes: mock(() => Promise.resolve(new Map())),
    getBranchFlagsMany: mock((branches: string[]) =>
      Promise.resolve(new Map(branches.map((branch) => [branch, NO_FLAGS])))),
    listBaseRepos: mock(() => []),
    ...overrides,
  };
}

describe("runStatus", () => {
  test("monta o estado completo de uma branch", async () => {
    const result = await runStatus({ branch: "feat-123" }, createSilentContext(), createDeps({
      listListeningPorts: mock(() => Promise.resolve(new Set([TEST_BACKEND_PORT, TEST_MANAGER_PORT]))),
    }));

    expect(result.branches).toHaveLength(1);
    const status = result.branches[0]!;
    expect(status.branch).toBe("feat-123");
    expect(status.slug).toBe("feat-123");
    expect(status.path).toEndWith("/feat-123");
    expect(status.dbContainer).toBe("myapp-psql-feat-123");
    expect(status.ports).toMatchObject({ db: 5438, backend: 8084, frontend: 3015, manager: 3021 });
    expect(status.services).toEqual({
      db: "rodando",
      backend: "rodando",
      frontend: "parado",
      manager: "rodando",
      reportServer: null,
    });
    expect(status.aliases.backend).toBe(`feat-123.api.${PRODUCT_NAME}`);
    expect(status.aliases.frontend).toBe(`feat-123.web.${PRODUCT_NAME}`);
    expect(status.aliases.reportServer).toBeUndefined();
  });

  test("serviço ausente na branch vira null, não false", async () => {
    const result = await runStatus({}, createSilentContext(), createDeps({
      readWorkspaceEnv: mock(() => Promise.resolve(createMockWorkspaceEnv({
        MANAGER_PORT: undefined,
        REPORT_SERVER_PORT: undefined,
      }) as WorkspaceEnv)),
    }));

    expect(result.branches[0]!.services.manager).toBeNull();
    expect(result.branches[0]!.services.reportServer).toBeNull();
    expect(result.branches[0]!.aliases.manager).toBeUndefined();
  });

  test("usa o nome da branch em minúsculas quando não há slug", async () => {
    const result = await runStatus({ branch: "NS-1250" }, createSilentContext(), createDeps({
      readWorkspaceEnv: mock(() => Promise.resolve(createMockWorkspaceEnv({ BRANCH_SLUG: "" }) as WorkspaceEnv)),
    }));

    expect(result.branches[0]!.slug).toBe("ns-1250");
    expect(result.branches[0]!.aliases.backend).toBe(`ns-1250.api.${PRODUCT_NAME}`);
  });

  test("lê todas as branches quando não recebe nome", async () => {
    const result = await runStatus({}, createSilentContext(), createDeps({
      listBranches: mock(() => ["a", "b", "c"]),
    }));

    expect(result.branches.map((b) => b.branch)).toEqual(["a", "b", "c"]);
  });

  test("ignora entradas sem .workspace.env ao ler todas", async () => {
    const result = await runStatus({}, createSilentContext(), createDeps({
      listBranches: mock(() => ["AGENTS.md", "feat-123"]),
      readWorkspaceEnv: mock((branch: string) => Promise.resolve(
        branch === "feat-123" ? createMockWorkspaceEnv() as WorkspaceEnv : null,
      )),
    }));

    expect(result.branches.map((b) => b.branch)).toEqual(["feat-123"]);
  });

  test("branch pedida por nome e inexistente é nao-encontrado", async () => {
    const run = runStatus({ branch: "nao-existe" }, createSilentContext(), createDeps({
      readWorkspaceEnv: mock(() => Promise.resolve(null)),
    }));

    await expect(run).rejects.toBeInstanceOf(NsError);
    await run.catch((err: NsError) => {
      expect(err.category).toBe("nao-encontrado");
      expect(err.message).toBe("Worktree não encontrada para 'nao-existe'");
      expect(err.hint).toBe("Rode 'ns status' para ver as branches disponíveis.");
    });
  });

  test("lê o Estado de cada Serviço da porta e da sessão tmux com o nome da branch", async () => {
    const result = await runStatus({ branch: "feat-123" }, createSilentContext(), createDeps({
      listRunningContainers: mock(() => Promise.resolve([])),
      listListeningPorts: mock(() => Promise.resolve(new Set([TEST_BACKEND_PORT]))),
      listServicePanes: mock(() => Promise.resolve(new Map([
        ["ns-feat-123-backend", "alive" as const],
        ["ns-feat-123-frontend", "alive" as const],
        ["ns-feat-123-manager", "failed" as const],
        ["ns-outra-report-server", "failed" as const],
      ]))),
    }));

    expect(result.branches[0]!.services).toEqual({
      db: "parado",
      backend: "rodando",
      frontend: "iniciando",
      manager: "falhou",
      reportServer: null,
    });
  });

  test("Serviço que atende na porta fora do tmux está Rodando", async () => {
    const result = await runStatus({ branch: "feat-123" }, createSilentContext(), createDeps({
      listListeningPorts: mock(() => Promise.resolve(new Set([TEST_FRONTEND_PORT]))),
    }));

    expect(result.branches[0]!.services.frontend).toBe("rodando");
  });

  test("consulta docker, portas, tmux e git em lote, não por branch", async () => {
    const listRunningContainers = mock(() => Promise.resolve([TEST_DB_CONTAINER]));
    const listListeningPorts = mock(() => Promise.resolve(new Set<number>()));
    const listServicePanes = mock(() => Promise.resolve(new Map()));
    const getBranchFlagsMany = mock((branches: string[]) =>
      Promise.resolve(new Map(branches.map((branch) => [branch, NO_FLAGS]))));

    await runStatus({}, createSilentContext(), createDeps({
      listBranches: mock(() => ["a", "b", "c"]),
      listRunningContainers,
      listListeningPorts,
      listServicePanes,
      getBranchFlagsMany,
    }));

    expect(listRunningContainers).toHaveBeenCalledTimes(1);
    expect(listListeningPorts).toHaveBeenCalledTimes(1);
    expect(listServicePanes).toHaveBeenCalledTimes(1);
    expect(getBranchFlagsMany).toHaveBeenCalledTimes(1);
    expect(getBranchFlagsMany.mock.calls[0]![0]).toEqual(["a", "b", "c"]);
  });

  test("não varre git de entrada que não é worktree", async () => {
    const getBranchFlagsMany = mock((branches: string[]) =>
      Promise.resolve(new Map(branches.map((branch) => [branch, NO_FLAGS]))));

    await runStatus({}, createSilentContext(), createDeps({
      listBranches: mock(() => ["AGENTS.md", "feat-123"]),
      readWorkspaceEnv: mock((branch: string) => Promise.resolve(
        branch === "feat-123" ? createMockWorkspaceEnv() as WorkspaceEnv : null,
      )),
      getBranchFlagsMany,
    }));

    expect(getBranchFlagsMany.mock.calls[0]![0]).toEqual(["feat-123"]);
  });

  test("workspace vazio não é erro", async () => {
    const result = await runStatus({}, createSilentContext(), createDeps({
      listBranches: mock(() => []),
    }));

    expect(result.branches).toEqual([]);
  });

  test("devolve os repos base junto com as branches", async () => {
    const baseRepos = [{ repo: "backend", path: "/code/backend" }];
    const result = await runStatus({}, createSilentContext(), createDeps({
      listBranches: mock(() => []),
      listBaseRepos: mock(() => baseRepos),
    }));

    expect(result.baseRepos).toEqual(baseRepos);
  });

  test("emite um evento por branch lida", async () => {
    const events: NsProgressEvent[] = [];
    const ctx = { emit: (event: NsProgressEvent) => events.push(event), ask: async () => false };

    await runStatus({}, ctx, createDeps({ listBranches: mock(() => ["a", "b"]) }));

    expect(events.map((e) => e.step)).toEqual(["status:branch", "status:branch"]);
    expect(events.map((e) => [e.index, e.total])).toEqual([[1, 2], [2, 2]]);
    expect(events[0]!.label).toContain("a");
  });
});

describe("deriveServiceState", () => {
  test("atender na porta é Rodando, com ou sem sessão", () => {
    expect(deriveServiceState(true, undefined)).toBe("rodando");
    expect(deriveServiceState(true, "alive")).toBe("rodando");
    expect(deriveServiceState(true, "failed")).toBe("rodando");
  });

  test("fora da porta, a sessão decide entre Iniciando, Falhou e Parado", () => {
    expect(deriveServiceState(false, "alive")).toBe("iniciando");
    expect(deriveServiceState(false, "failed")).toBe("falhou");
    expect(deriveServiceState(false, "exited")).toBe("parado");
    expect(deriveServiceState(false, undefined)).toBe("parado");
  });
});
