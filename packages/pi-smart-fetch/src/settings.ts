import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type {
  FetchToolConfig,
  FingerprintOs,
  IncludeRepliesOption,
} from "smart-fetch-core";

const VALID_OS_VALUES = new Set<FingerprintOs>([
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
]);

interface PiSmartFetchSettings {
  smartFetchVerboseByDefault?: boolean;
  smartFetchDefaultMaxChars?: number;
  smartFetchDefaultTimeoutMs?: number;
  smartFetchDefaultBrowser?: string;
  smartFetchDefaultOs?: FingerprintOs;
  smartFetchDefaultRemoveImages?: boolean;
  smartFetchDefaultIncludeReplies?: IncludeRepliesOption;
  smartFetchDefaultBatchConcurrency?: number;
}

export interface ResolvedPiSmartFetchSettings extends FetchToolConfig {
  verboseByDefault: boolean;
}

function readBoolean(
  source: Record<string, unknown>,
  keys: string[],
): boolean | undefined {
  for (const key of keys) {
    if (typeof source[key] === "boolean") {
      return source[key] as boolean;
    }
  }

  return undefined;
}

function readPositiveNumber(
  source: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return undefined;
}

function readNonEmptyString(
  source: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function readOs(
  source: Record<string, unknown>,
  keys: string[],
): FingerprintOs | undefined {
  for (const key of keys) {
    const value = source[key];
    if (
      typeof value === "string" &&
      VALID_OS_VALUES.has(value as FingerprintOs)
    ) {
      return value as FingerprintOs;
    }
  }

  return undefined;
}

function readIncludeReplies(
  source: Record<string, unknown>,
  keys: string[],
): IncludeRepliesOption | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean" || value === "extractors") {
      return value;
    }
  }

  return undefined;
}

function normalizePiSmartFetchSettings(input: unknown): PiSmartFetchSettings {
  if (!input || typeof input !== "object") return {};

  const source = input as Record<string, unknown>;

  return {
    smartFetchVerboseByDefault: readBoolean(source, [
      "smartFetchVerboseByDefault",
      "webFetchVerboseByDefault",
    ]),
    smartFetchDefaultMaxChars: readPositiveNumber(source, [
      "smartFetchDefaultMaxChars",
      "webFetchDefaultMaxChars",
    ]),
    smartFetchDefaultTimeoutMs: readPositiveNumber(source, [
      "smartFetchDefaultTimeoutMs",
    ]),
    smartFetchDefaultBrowser: readNonEmptyString(source, [
      "smartFetchDefaultBrowser",
    ]),
    smartFetchDefaultOs: readOs(source, ["smartFetchDefaultOs"]),
    smartFetchDefaultRemoveImages: readBoolean(source, [
      "smartFetchDefaultRemoveImages",
    ]),
    smartFetchDefaultIncludeReplies: readIncludeReplies(source, [
      "smartFetchDefaultIncludeReplies",
    ]),
    smartFetchDefaultBatchConcurrency: readPositiveNumber(source, [
      "smartFetchDefaultBatchConcurrency",
      "webFetchDefaultBatchConcurrency",
    ]),
  };
}

export function resolvePiSmartFetchSettings(
  globalSettings: unknown,
  projectSettings: unknown,
): ResolvedPiSmartFetchSettings {
  const global = normalizePiSmartFetchSettings(globalSettings);
  const project = normalizePiSmartFetchSettings(projectSettings);

  return {
    verboseByDefault:
      project.smartFetchVerboseByDefault ??
      global.smartFetchVerboseByDefault ??
      false,
    maxChars:
      project.smartFetchDefaultMaxChars ?? global.smartFetchDefaultMaxChars,
    timeoutMs:
      project.smartFetchDefaultTimeoutMs ?? global.smartFetchDefaultTimeoutMs,
    browser:
      project.smartFetchDefaultBrowser ?? global.smartFetchDefaultBrowser,
    os: project.smartFetchDefaultOs ?? global.smartFetchDefaultOs,
    removeImages:
      project.smartFetchDefaultRemoveImages ??
      global.smartFetchDefaultRemoveImages,
    includeReplies:
      project.smartFetchDefaultIncludeReplies ??
      global.smartFetchDefaultIncludeReplies,
    batchConcurrency:
      project.smartFetchDefaultBatchConcurrency ??
      global.smartFetchDefaultBatchConcurrency,
  };
}

async function readSettingsFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return {};
  }
}

export async function loadPiSmartFetchSettings(
  cwd: string,
  agentDir = getAgentDir(),
): Promise<ResolvedPiSmartFetchSettings> {
  const globalSettings = await readSettingsFile(
    join(agentDir, "settings.json"),
  );
  const projectSettings = await readSettingsFile(
    join(cwd, ".pi", "settings.json"),
  );

  return resolvePiSmartFetchSettings(globalSettings, projectSettings);
}
