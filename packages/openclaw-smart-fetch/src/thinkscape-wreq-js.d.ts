declare module "@thinkscape/wreq-js" {
  export function fetch(
    input: string | URL,
    init?: Record<string, unknown>,
  ): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    url?: string;
    headers: { get(name: string): string | null };
    text(): Promise<string>;
    json(): Promise<unknown>;
  }>;

  export function getProfiles(): string[];
}
