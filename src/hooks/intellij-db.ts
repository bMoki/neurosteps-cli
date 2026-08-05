import { mkdirSync } from "fs";
import { join } from "path";

export interface ConfigureIntellijDbInput {
  ideaDir: string;
  branch: string;
  productName: string;
  uuid: string;
  dbPort: number;
  dbUser: string;
  dbName: string;
  schema?: string;
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function configureIntellijDatabase(input: ConfigureIntellijDbInput): Promise<void> {
  const schema = input.schema ?? "core";
  const dataSourceName = `${input.productName}-${input.branch}`;
  const jdbcUrl = `jdbc:postgresql://localhost:${input.dbPort}/${input.dbName}`;

  mkdirSync(input.ideaDir, { recursive: true });
  mkdirSync(join(input.ideaDir, "dataSources"), { recursive: true });

  await Bun.write(join(input.ideaDir, "dataSources.xml"), dataSourcesXml({ ...input, dataSourceName, jdbcUrl }));
  await Bun.write(join(input.ideaDir, "dataSources.local.xml"), dataSourcesLocalXml({ ...input, dataSourceName, schema }));
  await Bun.write(join(input.ideaDir, "dataSources", "data_sources_history.xml"), dataSourcesHistoryXml({
    ...input,
    dataSourceName,
    jdbcUrl,
    schema,
  }));
}

function dataSourcesXml(input: ConfigureIntellijDbInput & { dataSourceName: string; jdbcUrl: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="DataSourceManagerImpl" format="xml" multifile-model="true">
    <data-source source="LOCAL" name="${xml(input.dataSourceName)}" uuid="${xml(input.uuid)}">
      <driver-ref>postgresql</driver-ref>
      <synchronize>true</synchronize>
      <jdbc-driver>org.postgresql.Driver</jdbc-driver>
      <jdbc-url>${xml(input.jdbcUrl)}</jdbc-url>
      <jdbc-additional-properties>
        <property name="com.intellij.clouds.kubernetes.db.host.port" />
        <property name="com.intellij.clouds.kubernetes.db.enabled" value="false" />
        <property name="com.intellij.clouds.kubernetes.db.container.port" />
      </jdbc-additional-properties>
      <working-dir>$ProjectFileDir$</working-dir>
    </data-source>
  </component>
</project>
`;
}

function dataSourcesLocalXml(input: ConfigureIntellijDbInput & { dataSourceName: string; schema: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="dataSourceStorageLocal">
    <data-source name="${xml(input.dataSourceName)}" uuid="${xml(input.uuid)}">
      <database-info product="PostgreSQL" jdbc-version="4.2" driver-name="PostgreSQL JDBC Driver" dbms="POSTGRES">
        <identifier-quote-string>&quot;</identifier-quote-string>
      </database-info>
      <case-sensitivity plain-identifiers="lower" quoted-identifiers="exact" />
      <secret-storage>master_key</secret-storage>
      <user-name>${xml(input.dbUser)}</user-name>
      <schema-mapping>
        <introspection-scope>
          <node negative="1">
            <node kind="database" qname="@">
              <node kind="schema" qname="@" />
            </node>
            <node kind="database" qname="${xml(input.dbName)}">
              <node kind="schema" qname="${xml(input.schema)}" />
            </node>
          </node>
        </introspection-scope>
      </schema-mapping>
    </data-source>
  </component>
</project>
`;
}

function dataSourcesHistoryXml(
  input: ConfigureIntellijDbInput & { dataSourceName: string; jdbcUrl: string; schema: string },
): string {
  return `<DataSourcesHistory>
  <DataSourceFromHistory isRemovedFromProject="false">
    <data-source source="LOCAL" name="${xml(input.dataSourceName)}" uuid="${xml(input.uuid)}">
      <database-info product="PostgreSQL" jdbc-version="4.2" driver-name="PostgreSQL JDBC Driver" dbms="POSTGRES">
        <identifier-quote-string>&quot;</identifier-quote-string>
      </database-info>
      <case-sensitivity plain-identifiers="lower" quoted-identifiers="exact" />
      <driver-ref>postgresql</driver-ref>
      <synchronize>true</synchronize>
      <jdbc-driver>org.postgresql.Driver</jdbc-driver>
      <jdbc-url>${xml(input.jdbcUrl)}</jdbc-url>
      <jdbc-additional-properties>
        <property name="com.intellij.clouds.kubernetes.db.host.port" />
        <property name="com.intellij.clouds.kubernetes.db.enabled" value="false" />
        <property name="com.intellij.clouds.kubernetes.db.container.port" />
      </jdbc-additional-properties>
      <secret-storage>master_key</secret-storage>
      <user-name>${xml(input.dbUser)}</user-name>
      <schema-mapping>
        <introspection-scope>
          <node negative="1">
            <node kind="database" qname="@">
              <node kind="schema" qname="@" />
            </node>
            <node kind="database" qname="${xml(input.dbName)}">
              <node kind="schema" qname="${xml(input.schema)}" />
            </node>
          </node>
        </introspection-scope>
      </schema-mapping>
      <working-dir>$ProjectFileDir$</working-dir>
    </data-source>
  </DataSourceFromHistory>
</DataSourcesHistory>
`;
}
