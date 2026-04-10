import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

interface PiWebFetchSettings {
  webFetchVerboseByDefault?: boolean;
  webFetchDefaultMaxChars?: number;
}

export interface ResolvedPiWebFetchSettings {
  verboseByDefault: boolean;
  defaultMaxChars?: number;
}

function normalizePiWebFetchSettings(input: unknown): PiWebFetchSettings {
  if (!input || typeof input !== "object") return {};

  const source = input as Record<string, unknown>;
  const settings: PiWebFetchSettings = {};

  if (typeof source.webFetchVerboseByDefault === "boolean") {
    settings.webFetchVerboseByDefault = source.webFetchVerboseByDefault;
  }

  if (
    typeof source.webFetchDefaultMaxChars === "number" &&
    Number.isFinite(source.webFetchDefaultMaxChars) &&
    source.webFetchDefaultMaxChars > 0
  ) {
    settings.webFetchDefaultMaxChars = source.webFetchDefaultMaxChars;
  }

  return settings;
}

export function resolvePiWebFetchSettings(
  globalSettings: unknown,
  projectSettings: unknown,
): ResolvedPiWebFetchSettings {
  const global = normalizePiWebFetchSettings(globalSettings);
  const project = normalizePiWebFetchSettings(projectSettings);

  return {
    verboseByDefault:
      project.webFetchVerboseByDefault ??
      global.webFetchVerboseByDefault ??
      false,
    defaultMaxChars:
      project.webFetchDefaultMaxChars ?? global.webFetchDefaultMaxChars,
  };
}

async function readSettingsFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return {};
  }
}

export async function loadPiWebFetchSettings(
  cwd: string,
  agentDir = getAgentDir(),
): Promise<ResolvedPiWebFetchSettings> {
  const globalSettings = await readSettingsFile(
    join(agentDir, "settings.json"),
  );
  const projectSettings = await readSettingsFile(
    join(cwd, ".pi", "settings.json"),
  );

  return resolvePiWebFetchSettings(globalSettings, projectSettings);
}
