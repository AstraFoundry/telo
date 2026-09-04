import type { Link, Parent, PhrasingContent, Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified, type Plugin } from "unified";

import {
  parseTeloLink,
  teloMessageLink,
} from "../../../../../contracts/src/ipc";
import { parseReply, type ReplyCitation } from "entities/agent";

const CITATION_MARKER = "#telo-citation=";
const MENTION_MARKER = "#telo-mention=";

function citationKey(citation: ReplyCitation): string {
  return `${citation.chatId}\u0000${citation.messageId}`;
}

function marker(prefix: string, value: string): string {
  return `${prefix}${encodeURIComponent(value)}`;
}

function markerValue(href: string | undefined, prefix: string): string | null {
  if (!href?.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(href.slice(prefix.length));
  } catch {
    return null;
  }
}

export function citationMarker(citation: ReplyCitation): string {
  return marker(
    CITATION_MARKER,
    teloMessageLink(citation.chatId, citation.messageId),
  );
}

export function citationFromMarker(href: string | undefined) {
  const value = markerValue(href, CITATION_MARKER);
  return value ? parseTeloLink(value) : null;
}

export function mentionMarker(name: string): string {
  return marker(MENTION_MARKER, name);
}

export function mentionFromMarker(href: string | undefined): string | null {
  return markerValue(href, MENTION_MARKER);
}

/** Holds back an incomplete bare in-app URL while its final path is streaming. */
export function withoutTrailingTeloLink(
  body: string,
  streaming: boolean,
): string {
  if (!streaming) return body;
  return body.replace(/\s?telo:\/\/\S*$/, "");
}

function parseMarkdown(body: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(body);
}

function walk(
  node: Root | RootContent,
  visit: (node: RootContent) => boolean | void,
): void {
  if (node.type !== "root" && visit(node) === false) return;
  if (!("children" in node)) return;
  for (const child of node.children) walk(child as RootContent, visit);
}

/** Finds real citations in prose and links, excluding fenced and inline code. */
export function collectReplyCitations(body: string): ReplyCitation[] {
  const citations: ReplyCitation[] = [];
  const seen = new Set<string>();
  const add = (citation: ReplyCitation) => {
    const key = citationKey(citation);
    if (seen.has(key)) return;
    seen.add(key);
    citations.push(citation);
  };

  walk(parseMarkdown(body), (node) => {
    if (node.type === "code" || node.type === "inlineCode") return false;
    if (node.type === "link") {
      const link = parseTeloLink(node.url);
      if (link) add({ chatId: link.chatId, messageId: link.messageId });
      return link ? false : undefined;
    }
    if (node.type === "text") {
      for (const citation of parseReply(node.value).citations) add(citation);
    }
  });
  return citations;
}

function plainTextForNode(node: Root | RootContent): string {
  if (node.type === "text") {
    return parseReply(node.value)
      .segments.map((segment) =>
        segment.kind === "text"
          ? segment.text
          : segment.kind === "mention"
            ? `@${segment.name}`
            : "",
      )
      .join("");
  }
  if (node.type === "inlineCode" || node.type === "code") return node.value;
  if (node.type === "image") return node.alt ?? "";
  if (node.type === "break") return "\n";
  if (node.type === "link" && parseTeloLink(node.url)) return "";
  if (!("children" in node)) return "";

  const content = node.children
    .map((child) => plainTextForNode(child as RootContent))
    .join("");
  return [
    "root",
    "paragraph",
    "heading",
    "blockquote",
    "listItem",
    "tableRow",
  ].includes(node.type)
    ? `${content}\n`
    : content;
}

/** Plain copy value: Markdown syntax and internal citation URLs are omitted. */
export function replyMarkdownPlainText(body: string): string {
  return plainTextForNode(parseMarkdown(body))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function segmentNodes(
  value: string,
  mentionNames: ReadonlyArray<string>,
): PhrasingContent[] {
  const parsed = parseReply(value, mentionNames);
  return parsed.segments.map((segment): PhrasingContent => {
    if (segment.kind === "text") return { type: "text", value: segment.text };
    if (segment.kind === "mention") {
      return {
        type: "link",
        url: mentionMarker(segment.name),
        children: [{ type: "text", value: `@${segment.name}` }],
      };
    }
    return {
      type: "link",
      url: citationMarker(segment),
      children: [{ type: "text", value: String(segment.index) }],
    };
  });
}

function transformParent(
  parent: Parent,
  mentionNames: ReadonlyArray<string>,
): void {
  for (let index = parent.children.length - 1; index >= 0; index -= 1) {
    const node = parent.children[index]!;
    if (node.type === "text") {
      parent.children.splice(
        index,
        1,
        ...segmentNodes(node.value, mentionNames),
      );
      continue;
    }
    if (node.type === "link") {
      const citation = parseTeloLink(node.url);
      if (citation) {
        const replacement: Link = {
          type: "link",
          url: citationMarker(citation),
          children: [{ type: "text", value: "1" }],
        };
        parent.children[index] = replacement;
        continue;
      }
    }
    if ("children" in node) {
      transformParent(node as Parent, mentionNames);
    }
  }
}

/**
 * Converts app-specific citations and mentions after Markdown parsing. Code is
 * therefore literal, while prose keeps the existing jump and avatar behavior.
 */
export function createReplyRemarkPlugin(
  mentionNames: ReadonlyArray<string>,
): Plugin<[], Root> {
  return () => (tree) => {
    transformParent(tree, mentionNames);
  };
}
