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
    body?: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
    json(): Promise<unknown>;
    arrayBuffer?(): Promise<ArrayBuffer>;
    readable?(): NodeJS.ReadableStream;
  }>;

  export function getProfiles(): string[];
}
