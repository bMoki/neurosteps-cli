import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configureIntellijDatabase } from "../../hooks/intellij-db";

describe("configureIntellijDatabase", () => {
  test("writes PostgreSQL datasource and core schema mapping", async () => {
    const root = mkdtempSync(join(tmpdir(), "ns-intellij-db-"));
    const ideaDir = join(root, ".idea");

    try {
      await configureIntellijDatabase({
        ideaDir,
        branch: "NS-43",
        productName: "neurosteps",
        uuid: "d81dda0c-2b1a-4d37-8545-d1186d93e853",
        dbPort: 5438,
        dbUser: "postgres",
        dbName: "teste_postgres",
        schema: "core",
      });

      const dataSources = await Bun.file(join(ideaDir, "dataSources.xml")).text();
      const local = await Bun.file(join(ideaDir, "dataSources.local.xml")).text();
      const history = await Bun.file(join(ideaDir, "dataSources", "data_sources_history.xml")).text();

      expect(dataSources).toContain('component name="DataSourceManagerImpl" format="xml" multifile-model="true"');
      expect(dataSources).toContain('name="neurosteps-NS-43"');
      expect(dataSources).toContain("<driver-ref>postgresql</driver-ref>");
      expect(dataSources).toContain("<jdbc-url>jdbc:postgresql://localhost:5438/teste_postgres</jdbc-url>");
      expect(local).toContain("<secret-storage>master_key</secret-storage>");
      expect(local).toContain("<user-name>postgres</user-name>");
      expect(local).toContain('<node kind="schema" qname="core" />');
      expect(history).toContain('<node kind="database" qname="teste_postgres">');
      expect(history).toContain('<node kind="schema" qname="core" />');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("escapes XML values", async () => {
    const root = mkdtempSync(join(tmpdir(), "ns-intellij-db-"));
    const ideaDir = join(root, ".idea");

    try {
      await configureIntellijDatabase({
        ideaDir,
        branch: "feature & test",
        productName: "neuro<steps>",
        uuid: "uuid-1",
        dbPort: 5438,
        dbUser: "post&gres",
        dbName: "db<name>",
        schema: "core",
      });

      const dataSources = await Bun.file(join(ideaDir, "dataSources.xml")).text();
      const local = await Bun.file(join(ideaDir, "dataSources.local.xml")).text();

      expect(dataSources).toContain('name="neuro&lt;steps&gt;-feature &amp; test"');
      expect(dataSources).toContain("jdbc:postgresql://localhost:5438/db&lt;name&gt;");
      expect(local).toContain("<user-name>post&amp;gres</user-name>");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
