import type { FetchResult } from "./types";

export function markdownToText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "• ")
    .replace(/`([^`]+)`/g, "$1");
}

export function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[... truncated]`;
}

export function buildMetadataHeader(result: FetchResult): string {
  const metaParts: string[] = [];
  metaParts.push(`URL: ${result.finalUrl}`);
  if (result.title) metaParts.push(`Title: ${result.title}`);
  if (result.author) metaParts.push(`Author: ${result.author}`);
  if (result.published) metaParts.push(`Published: ${result.published}`);
  if (result.site) metaParts.push(`Site: ${result.site}`);
  if (result.language) metaParts.push(`Language: ${result.language}`);
  metaParts.push(`Words: ${result.wordCount}`);
  metaParts.push(`Browser: ${result.browser}/${result.os}`);

  return metaParts.map((part) => `> ${part}`).join("\n");
}
