import { resolveBackendDir, resolveFrontendDir, resolveManagerDir, hasManager, PRODUCT_NAME, PORTLESS_PROXY_PORT, BACKEND_MODULE } from "../lib/config";
import { spawnTerminal } from "../lib/shell";
import { detail, emptyLine, hint, spinner } from "../lib/logger";
import { BranchNotFoundError, setupBranchRuntime } from "./branch-setup";

export async function startAction(branch: string): Promise<void> {
  const s = spinner(`Iniciando ${branch}...`).start();

  const runtime = await setupBranchRuntime(branch, {
    startDatabase: true,
    ensurePortlessProxy: true,
    registerPortlessAliases: true,
    onStep: (step) => {
      if (step === "database:start") s.text = "Iniciando PostgreSQL...";
      if (step === "database:wait") s.text = "Aguardando PostgreSQL...";
      if (step === "portless:proxy") s.text = "Iniciando proxy Portless...";
      if (step === "portless:aliases") s.text = "Registrando aliases Portless...";
    },
  }).catch((error) => {
    if (error instanceof BranchNotFoundError) {
      s.fail(error.message);
      process.exit(1);
    }
    throw error;
  });

  s.text = "Abrindo terminais...";
  const backendDir = resolveBackendDir(branch);
  const frontendDir = resolveFrontendDir(branch);

  await spawnTerminal(backendDir, {
    QUARKUS_HTTP_PORT: String(runtime.env.BACKEND_PORT),
    QUARKUS_DATASOURCE_JDBC_URL: `jdbc:postgresql://localhost:${runtime.env.DB_PORT}/${runtime.env.DB_NAME}`,
    QUARKUS_DATASOURCE_USERNAME: runtime.env.DB_USER,
    QUARKUS_DATASOURCE_PASSWORD: runtime.env.DB_PASSWORD,
    QUARKUS_PROFILE: "dev",
  }, `mvn -pl ${BACKEND_MODULE}-core quarkus:dev`);

  await spawnTerminal(frontendDir, {
    REACT_APP_API_URL: runtime.urls.backend,
    REACT_APP_WEB_URL: runtime.urls.frontend,
    REACT_APP_FRONTEND_PORT: String(runtime.env.FRONTEND_PORT),
    REACT_APP_BRANCH_NAME: branch,
    REACT_APP_PRODUCT_NAME: PRODUCT_NAME,
    REACT_APP_PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
  }, "npm start");

  if (hasManager(branch)) {
    const managerDir = resolveManagerDir(branch);
    await spawnTerminal(managerDir, {
      VITE_APP_URL: runtime.urls.manager!,
      VITE_WEB_URL: runtime.urls.frontend,
      VITE_API_URL: runtime.urls.backend,
      PORT: String(runtime.env.MANAGER_PORT!),
      VITE_BRANCH_NAME: branch,
      VITE_PRODUCT_NAME: PRODUCT_NAME,
      VITE_PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
    }, "npm run dev");
  }

  s.succeed(`Serviços iniciados para ${branch}`);
  emptyLine();
  detail("Backend", runtime.urls.backend);
  detail("Frontend", runtime.urls.frontend);
  if (runtime.urls.manager) {
    detail("Manager", runtime.urls.manager);
  }
  emptyLine();
  hint(`Próximo passo: ns status ${branch}  # ver status dos serviços`);
}
