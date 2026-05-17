import { WORKSPACE_DIR, WORKTREES_DIR, readWorkspaceEnv, PORTLESS_PROXY_PORT, PRODUCT_NAME } from "../lib/config";
import { renderTemplate, reverseRender } from "../lib/templates";
import { spinner } from "../lib/logger";
import { join } from "path";
import { exec } from "../lib/shell";
import { ensureWorkspaceBootstrap } from "../lib/bootstrap";
import { pathExistsAsync } from "../lib/filesystem";

interface TemplateFromDeps {
  readEnv: typeof readWorkspaceEnv;
  shell: typeof exec;
}

const defaultFromDeps: TemplateFromDeps = {
  readEnv: readWorkspaceEnv,
  shell: exec,
};

export async function templateFromAction(
  branch: string,
  deps: Partial<TemplateFromDeps> = {},
): Promise<void> {
  const { readEnv, shell } = { ...defaultFromDeps, ...deps };

  const s = spinner(`Capturando template de ${branch}...`).start();
  await ensureWorkspaceBootstrap();

  const wtDir = join(WORKTREES_DIR, branch);
  const ideaDir = join(wtDir, ".idea");

  if (!(await pathExistsAsync(join(wtDir, ".workspace.env")))) {
    s.fail(`Worktree não encontrada para '${branch}'`);
    process.exit(1);
  }

  if (!(await pathExistsAsync(ideaDir))) {
    s.fail(`Diretório .idea não encontrado para '${branch}'`);
    process.exit(1);
  }

  const env = await readEnv(branch);
  const vars: Record<string, string> = {
    DB_PORT: env ? String(env.DB_PORT) : "",
    BACKEND_PORT: env ? String(env.BACKEND_PORT) : "",
    FRONTEND_PORT: env ? String(env.FRONTEND_PORT) : "",
    MANAGER_PORT: env?.MANAGER_PORT ? String(env.MANAGER_PORT) : "",
    BRANCH_NAME: env?.BRANCH_NAME ?? branch,
    BRANCH_SLUG: env?.BRANCH_SLUG ?? "",
    PRODUCT_NAME,
    PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
  };

  // Capture misc.xml
  const branchMisc = join(ideaDir, "misc.xml");
  if (await pathExistsAsync(branchMisc)) {
    const content = await Bun.file(branchMisc).text();
    await Bun.write(join(WORKSPACE_DIR, "templates/idea/misc.xml"), content);
    s.text = "misc.xml capturado";
  }

  // Capture other config files
  const otherConfigs = ["compiler.xml", "encodings.xml", "jarRepositories.xml"];
  for (const cfg of otherConfigs) {
    const src = join(ideaDir, cfg);
    if (await pathExistsAsync(src)) {
      await Bun.write(join(WORKSPACE_DIR, `templates/idea/${cfg}`), await Bun.file(src).text());
    }
  }

  // Capture directories
  const cfgDirs = ["inspectionProfiles", "codeStyles", "scopes"];
  for (const dir of cfgDirs) {
    const src = join(ideaDir, dir);
    if (await pathExistsAsync(src)) {
      await shell(["rm", "-rf", join(WORKSPACE_DIR, `templates/idea/${dir}`)], { silent: true });
      await shell(["cp", "-R", src, join(WORKSPACE_DIR, `templates/idea/${dir}`)], { silent: true });
    }
  }

  // Capture run configurations
  const branchRunconfigs = join(ideaDir, "runConfigurations");
  const templateRunconfigs = join(WORKSPACE_DIR, "templates/runConfigurations");

  if (await pathExistsAsync(branchRunconfigs)) {
    await shell(["mkdir", "-p", templateRunconfigs], { silent: true });
    await shell(["rm", "-f", join(templateRunconfigs, "*.xml")], { silent: true });

    const result = await shell(["ls", "-1", branchRunconfigs], { silent: true });
    const files = result.stdout.split("\n").filter((f) => f.endsWith(".xml"));

    for (const rcName of files) {
      const content = await Bun.file(join(branchRunconfigs, rcName)).text();
      const reversed = reverseRender(content, vars);
      await Bun.write(join(templateRunconfigs, rcName), reversed);
    }
  }

  s.succeed(`Template capturado de '${branch}'`);
}

interface TemplateToDeps {
  readEnv: typeof readWorkspaceEnv;
  shell: typeof exec;
}

const defaultToDeps: TemplateToDeps = {
  readEnv: readWorkspaceEnv,
  shell: exec,
};

export async function templateToAction(
  branch: string,
  deps: Partial<TemplateToDeps> = {},
): Promise<void> {
  const { readEnv, shell } = { ...defaultToDeps, ...deps };

  const s = spinner(`Aplicando template em ${branch}...`).start();
  await ensureWorkspaceBootstrap();

  const wtDir = join(WORKTREES_DIR, branch);

  if (!(await pathExistsAsync(join(wtDir, ".workspace.env")))) {
    s.fail(`Worktree não encontrada para '${branch}'`);
    process.exit(1);
  }

  const env = await readEnv(branch);
  const vars: Record<string, string> = {
    DB_PORT: env ? String(env.DB_PORT) : "",
    BACKEND_PORT: env ? String(env.BACKEND_PORT) : "",
    FRONTEND_PORT: env ? String(env.FRONTEND_PORT) : "",
    MANAGER_PORT: env?.MANAGER_PORT ? String(env.MANAGER_PORT) : "",
    BRANCH_NAME: env?.BRANCH_NAME ?? branch,
    BRANCH_SLUG: env?.BRANCH_SLUG ?? "",
    PRODUCT_NAME,
    PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
  };

  const ideaDir = join(wtDir, ".idea");
  await shell(["mkdir", "-p", ideaDir], { silent: true });

  // Apply misc.xml
  const templateMisc = join(WORKSPACE_DIR, "templates/idea/misc.xml");
  if (await pathExistsAsync(templateMisc)) {
    await shell(["cp", templateMisc, join(ideaDir, "misc.xml")], { silent: true });
  }

  // Apply other config files
  const otherConfigs = ["compiler.xml", "encodings.xml", "jarRepositories.xml"];
  for (const cfg of otherConfigs) {
    const src = join(WORKSPACE_DIR, `templates/idea/${cfg}`);
    if (await pathExistsAsync(src)) {
      await shell(["cp", src, join(ideaDir, cfg)], { silent: true });
    }
  }

  // Apply directories
  const cfgDirs = ["inspectionProfiles", "codeStyles", "scopes"];
  for (const dir of cfgDirs) {
    const src = join(WORKSPACE_DIR, `templates/idea/${dir}`);
    if (await pathExistsAsync(src)) {
      await shell(["rm", "-rf", join(ideaDir, dir)], { silent: true });
      await shell(["cp", "-R", src, join(ideaDir, dir)], { silent: true });
    }
  }

  // Apply run configurations
  const templateRunconfigs = join(WORKSPACE_DIR, "templates/runConfigurations");
  const branchRunconfigs = join(ideaDir, "runConfigurations");

  if (await pathExistsAsync(templateRunconfigs)) {
    await shell(["mkdir", "-p", branchRunconfigs], { silent: true });
    await shell(["rm", "-f", join(branchRunconfigs, "*.xml")], { silent: true });

    const result = await shell(["ls", "-1", templateRunconfigs], { silent: true });
    const files = result.stdout.split("\n").filter((f) => f.endsWith(".xml"));

    for (const rcName of files) {
      const content = await Bun.file(join(templateRunconfigs, rcName)).text();
      const rendered = renderTemplate(content, vars);
      await Bun.write(join(branchRunconfigs, rcName), rendered);
    }
  }

  s.succeed(`Template aplicado em '${branch}'`);
}
