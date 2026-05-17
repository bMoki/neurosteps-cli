import { describe, test, expect } from "bun:test";
import { renderTemplate, reverseRender } from "../../lib/templates";

describe("templates", () => {
  test("renderTemplate replaces placeholders", () => {
    const template = "Hello {{NAME}}, port is {{PORT}}";
    const result = renderTemplate(template, { NAME: "feat-123", PORT: "8080" });
    expect(result).toBe("Hello feat-123, port is 8080");
  });

  test("renderTemplate replaces all occurrences", () => {
    const template = "{{PORT}} and {{PORT}}";
    const result = renderTemplate(template, { PORT: "8080" });
    expect(result).toBe("8080 and 8080");
  });

  test("reverseRender converts values back to placeholders", () => {
    const content = "Hello feat-123, port is 8080";
    const result = reverseRender(content, { NAME: "feat-123", PORT: "8080" });
    expect(result).toBe("Hello {{NAME}}, port is {{PORT}}");
  });

  test("renderTemplate handles empty template", () => {
    const result = renderTemplate("", { NAME: "test" });
    expect(result).toBe("");
  });

  test("reverseRender handles missing values", () => {
    const content = "Hello world";
    const result = reverseRender(content, { NAME: "test" });
    expect(result).toBe("Hello world");
  });
});
