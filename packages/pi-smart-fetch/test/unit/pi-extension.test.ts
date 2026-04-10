import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import piSmartFetchExtension from "../../src/index";

interface RegisteredPiTool {
  name: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: { cwd: string },
  ): Promise<{ content: Array<{ type: string; text: string }> }>;
}

function registerPiTool() {
  let registeredTool: RegisteredPiTool | undefined;

  piSmartFetchExtension({
    registerTool(definition: unknown) {
      registeredTool = definition as RegisteredPiTool;
    },
  } as unknown as ExtensionAPI);

  expect(registeredTool).toBeDefined();
  return registeredTool as RegisteredPiTool;
}

describe("pi extension", () => {
  it("registers a web_fetch tool with the OpenClaw-compatible parameter surface plus verbose", () => {
    const registeredTool = registerPiTool();

    expect(registeredTool.name).toBe("web_fetch");

    const schema = registeredTool.parameters as {
      required?: string[];
      properties?: Record<string, { type?: string }>;
    };

    expect(schema.required).toContain("url");
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining([
        "url",
        "browser",
        "os",
        "headers",
        "maxChars",
        "format",
        "removeImages",
        "includeReplies",
        "proxy",
        "verbose",
      ]),
    );
  });

  it("surfaces invalid URL errors from the pi execution path", async () => {
    const registeredTool = registerPiTool();
    const cwd = await mkdtemp(join(tmpdir(), "smart-fetch-pi-extension-"));
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ webFetchVerboseByDefault: false }, null, 2),
    );

    const response = await registeredTool.execute(
      "tool-call-1",
      { url: "not-a-url" },
      undefined,
      undefined,
      { cwd },
    );

    expect(response.content[0]?.text).toContain("Error: Invalid URL");
  });
});
