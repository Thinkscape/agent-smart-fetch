import type { FetchToolConfig } from "smart-fetch-core";

export type PluginConfig = FetchToolConfig;

export interface ToolRegistrationApi {
  pluginConfig?: PluginConfig;
  registerTool(definition: {
    name: string;
    description: string;
    parameters: unknown;
    execute(
      toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<{
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    }>;
  }): void;
  logger: {
    info(message: string): void;
  };
}
