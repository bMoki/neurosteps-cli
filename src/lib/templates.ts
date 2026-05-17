import { readFileSync } from "fs";

export function renderTemplate(
  content: string,
  variables: Record<string, string>,
): string {
  let result = content;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
  }
  return result;
}

export function renderTemplateFile(
  templatePath: string,
  variables: Record<string, string>,
): string {
  const content = readFileSync(templatePath, "utf-8");
  return renderTemplate(content, variables);
}

export async function copyTemplate(
  src: string,
  dst: string,
  variables: Record<string, string>,
): Promise<void> {
  const content = renderTemplateFile(src, variables);
  await Bun.write(dst, content);
}

export function reverseRender(
  content: string,
  variables: Record<string, string>,
): string {
  let result = content;
  for (const [key, value] of Object.entries(variables)) {
    if (value) {
      result = result.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), `{{${key}}}`);
    }
  }
  return result;
}
