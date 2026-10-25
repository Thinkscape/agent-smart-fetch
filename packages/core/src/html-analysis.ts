/**
 * HTML analysis: parse a page once, read the signals the fetch pipeline needs,
 * run Defuddle, and render a DOM fallback when Defuddle finds nothing.
 *
 * This module runs inside the worker thread, so it must not import wreq-js.
 */

import { parseLinkedomHTML } from "./dom";
import type {
  ExtractedContent,
  FetchDependencies,
  HtmlAnalysis,
  HtmlAnalysisRequest,
  OutputFormat,
} from "./types";

/**
 * Detects X/Twitter "JavaScript is disabled" shell pages that indicate a tweet
 * no longer exists (deleted, protected, or suspended). When X returns these
 * pages instead of a proper 404, the oEmbed API also returns 404.
 */
function isTwitterJsDisabledPage(document: Document, url: string): boolean {
  if (!/^(https?:\/\/)?(www\.)?(x\.com|twitter\.com)\//i.test(url))
    return false;
  const text =
    document.body?.textContent ?? document.documentElement?.textContent ?? "";
  return (
    text.includes("JavaScript is disabled") &&
    text.includes("supported browser")
  );
}

function extractDomTextFallback(document: Document): string {
  const bodyText =
    document.body?.textContent ?? document.documentElement?.textContent ?? "";
  return bodyText
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}[\]()+#.!|>-])/g, "\\$1");
}

function normalizeInlineWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function renderInlineMarkdown(node: Node): string {
  if (node.nodeType === 3) {
    return normalizeInlineWhitespace(node.textContent ?? "");
  }

  if (node.nodeType !== 1) {
    return "";
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (["script", "style", "meta", "link"].includes(tag)) {
    return "";
  }

  if (tag === "br") {
    return "  \n";
  }

  if (tag === "code") {
    const content = normalizeInlineWhitespace(element.textContent ?? "");
    return content ? `\`${content}\`` : "";
  }

  if (tag === "img") {
    const alt = element.getAttribute("alt") ?? "";
    const src = element.getAttribute("src") ?? "";
    return src ? `![${escapeMarkdownText(alt)}](${src})` : "";
  }

  const childContent = Array.from(element.childNodes)
    .map(renderInlineMarkdown)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (tag === "a") {
    const href = element.getAttribute("href") ?? "";
    if (!href) return childContent;
    return `[${childContent || href}](${href})`;
  }

  if (["strong", "b"].includes(tag)) {
    return childContent ? `**${childContent}**` : "";
  }

  if (["em", "i"].includes(tag)) {
    return childContent ? `*${childContent}*` : "";
  }

  return childContent;
}

function renderBlockMarkdown(node: Node, depth = 0): string {
  if (node.nodeType === 3) {
    const text = normalizeInlineWhitespace(node.textContent ?? "");
    return text ? `${text}\n\n` : "";
  }

  if (node.nodeType !== 1) {
    return "";
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (["script", "style", "meta", "link"].includes(tag)) {
    return "";
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number.parseInt(tag.slice(1), 10);
    const content = Array.from(element.childNodes)
      .map(renderInlineMarkdown)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return content ? `${"#".repeat(level)} ${content}\n\n` : "";
  }

  if (tag === "p") {
    const content = Array.from(element.childNodes)
      .map(renderInlineMarkdown)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return content ? `${content}\n\n` : "";
  }

  if (tag === "pre") {
    const content = (element.textContent ?? "").trim();
    return content ? `\`\`\`\n${content}\n\`\`\`\n\n` : "";
  }

  if (tag === "blockquote") {
    const content = Array.from(element.childNodes)
      .map((child) => renderBlockMarkdown(child, depth))
      .join("")
      .trim();
    if (!content) return "";
    return `${content
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n")}\n\n`;
  }

  if (tag === "ul" || tag === "ol") {
    const items = Array.from(element.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((child, index) => {
        const prefix = tag === "ol" ? `${index + 1}. ` : "- ";
        const content = Array.from(child.childNodes)
          .map((grandchild) => {
            const childTag =
              grandchild.nodeType === 1
                ? (grandchild as Element).tagName.toLowerCase()
                : "";
            return childTag === "ul" || childTag === "ol"
              ? `\n${renderBlockMarkdown(grandchild, depth + 1)}`
              : renderInlineMarkdown(grandchild);
          })
          .join(" ")
          .replace(/\s+\n/g, "\n")
          .replace(/\n\s+/g, "\n")
          .replace(/\s+/g, " ")
          .trim();
        if (!content) return "";
        const indented = content
          .split("\n")
          .map((line, lineIndex) =>
            lineIndex === 0
              ? `${"  ".repeat(depth)}${prefix}${line}`
              : `${"  ".repeat(depth + 1)}${line}`,
          )
          .join("\n");
        return indented;
      })
      .filter(Boolean)
      .join("\n");
    return items ? `${items}\n\n` : "";
  }

  if (tag === "hr") {
    return "---\n\n";
  }

  const blockContent = Array.from(element.childNodes)
    .map((child) => renderBlockMarkdown(child, depth))
    .join("");

  if (blockContent.trim()) {
    return blockContent;
  }

  const inlineContent = Array.from(element.childNodes)
    .map(renderInlineMarkdown)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return inlineContent ? `${inlineContent}\n\n` : "";
}

function extractDomMarkdownFallback(document: Document): string {
  const root = document.body ?? document.documentElement;
  if (!root) return "";

  return Array.from(root.childNodes)
    .map((node) => renderBlockMarkdown(node))
    .join("")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractQualifiedAlternateLinks(
  document: Document,
  baseUrl: string,
  format: OutputFormat,
): string[] {
  const acceptedTypes: Record<OutputFormat, string[]> = {
    markdown: ["text/markdown", "text/x-markdown"],
    text: ["text/plain", "text/markdown", "text/x-markdown"],
    html: ["text/html", "application/xhtml+xml"],
    json: ["application/json", "text/json"],
    raw: [],
  };
  const accepted = acceptedTypes[format];
  const head = document.head;
  if (!head) return [];

  const links = Array.from(head.querySelectorAll("link"));
  const candidates: string[] = [];
  for (const link of links) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("alternate")) continue;

    const type =
      (link.getAttribute("type") ?? "").split(";")[0]?.trim().toLowerCase() ??
      "";
    const isAccepted =
      accepted.some((value) => type === value) ||
      (format === "json" && type.endsWith("+json"));
    if (!isAccepted) continue;

    const href = link.getAttribute("href");
    if (!href) continue;

    try {
      const target = new URL(href, baseUrl).toString();
      if (target !== baseUrl && !candidates.includes(target)) {
        candidates.push(target);
      }
    } catch {
      // Ignore malformed alternate links.
    }
  }

  return candidates;
}

function pickExtractedContent(extracted: ExtractedContent): ExtractedContent {
  return {
    content: extracted.content,
    wordCount: extracted.wordCount,
    title: extracted.title,
    author: extracted.author,
    published: extracted.published,
    site: extracted.site,
    language: extracted.language,
    extractorType: extracted.extractorType,
  };
}

export async function analyzeHtml(
  request: HtmlAnalysisRequest,
  defuddle: FetchDependencies["defuddle"],
): Promise<HtmlAnalysis> {
  const document = parseLinkedomHTML(request.html, request.url);
  // Read these before Defuddle runs: it mutates the document it extracts from.
  const analysis: HtmlAnalysis = {
    alternateLinks: extractQualifiedAlternateLinks(
      document,
      request.url,
      request.format,
    ),
    isXJsDisabledShell: isTwitterJsDisabledPage(document, request.requestUrl),
  };
  if (!request.extract) {
    return analysis;
  }

  let extracted: ExtractedContent;
  let error: string | undefined;
  const consoleErrors: string[][] = [];
  // Defuddle's async extractors (e.g. X oEmbed) can throw on 404 and
  // log a noisy "Error in async extraction" via console.error. Suppress
  // that spam by intercepting console.error during the defuddle call.
  // We also capture the suppressed errors for later analysis.
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    consoleErrors.push(
      args.filter((arg): arg is string => typeof arg === "string"),
    );
  };
  try {
    extracted = pickExtractedContent(
      await defuddle(document, request.url, request.extract),
    );
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    extracted = { content: undefined, wordCount: 0 };
  } finally {
    console.error = origConsoleError;
  }

  analysis.extraction = { extracted, consoleErrors };
  if (error !== undefined) {
    analysis.extraction.error = error;
  }
  if (request.fallback && (!extracted.content || extracted.wordCount === 0)) {
    // The fallback must see the page as served, so parse it again; this is
    // the only path that pays for a second parse.
    const original = parseLinkedomHTML(request.html, request.url);
    analysis.extraction.fallback = {
      text: extractDomTextFallback(original),
    };
    if (request.fallback === "markdown") {
      analysis.extraction.fallback.markdown =
        extractDomMarkdownFallback(original);
    }
  }
  return analysis;
}
