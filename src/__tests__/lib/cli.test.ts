import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { addGlobalCliOptions, isGlobalBooleanFlag } from "../../lib/cli";

describe("cli contract helpers", () => {
  test("recognizes global boolean flags", () => {
    expect(isGlobalBooleanFlag("--debug")).toBe(true);
    expect(isGlobalBooleanFlag("--no-color")).toBe(true);
    expect(isGlobalBooleanFlag("--no-input")).toBe(true);
    expect(isGlobalBooleanFlag("--force")).toBe(false);
  });

  test("adds global options recursively", () => {
    const child = new Command("child");
    const program = new Command("ns").addCommand(child);

    addGlobalCliOptions(program);

    expect(program.options.some((option) => option.long === "--no-color")).toBe(true);
    expect(child.options.some((option) => option.long === "--no-input")).toBe(true);
    expect(child.options.some((option) => option.long === "--debug")).toBe(true);
  });
});
