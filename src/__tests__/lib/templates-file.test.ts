import { describe, test, expect } from "bun:test";
import { renderTemplateFile, copyTemplate } from "../../lib/templates";
import { writeFileSync, unlinkSync } from "fs";

describe("templates file ops", () => {
  const testFile = "/tmp/test-template.txt";

  test("renderTemplateFile reads and renders", () => {
    writeFileSync(testFile, "Hello {{NAME}}");
    const result = renderTemplateFile(testFile, { NAME: "World" });
    expect(result).toBe("Hello World");
    unlinkSync(testFile);
  });

  test("copyTemplate writes rendered file", async () => {
    writeFileSync(testFile, "Port: {{PORT}}");
    const outputFile = "/tmp/test-output.txt";
    
    await copyTemplate(testFile, outputFile, { PORT: "8080" });
    
    const content = await Bun.file(outputFile).text();
    expect(content).toBe("Port: 8080");
    
    unlinkSync(testFile);
    unlinkSync(outputFile);
  });
});
