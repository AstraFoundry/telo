import {
  Children,
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import {
  defaultRehypePlugins,
  defaultRemarkPlugins,
  Streamdown,
  type Components,
  type UrlTransform,
} from "streamdown";

import { teloMessageLink } from "../../../../../contracts/src/ipc";
import type { ReplyCitation } from "entities/agent";
import type { MentionTarget } from "entities/chat";
import { safeLink } from "shared/lib/safe-link";
import { CodeBlock, type AgentCodeLanguage } from "shared/ui";

import {
  citationFromMarker,
  createReplyRemarkPlugin,
  mentionFromMarker,
} from "../model/reply-markdown";
import { CitationMark, MentionChip } from "./reply-text";

type MarkdownAnchorProps = ComponentProps<"a"> & { node?: unknown };
type MarkdownCodeProps = ComponentProps<"code"> & {
  node?: unknown;
  "data-block"?: string;
};
type MarkdownImageProps = ComponentProps<"img"> & { node?: unknown };

// Omitting the raw-HTML expansion plugin makes HTML nodes disappear before
// sanitization. The remaining built-ins still sanitize and harden the tree.
const SAFE_REHYPE_PLUGINS = [
  defaultRehypePlugins.sanitize,
  defaultRehypePlugins.harden,
];

const EMPTY_CITATION_INDEXES = new Map<string, number>();
const EMPTY_MENTION_TARGETS = new Map<string, MentionTarget>();
const CitationIndexesContext = createContext<ReadonlyMap<string, number>>(
  EMPTY_CITATION_INDEXES,
);
const MentionTargetsContext = createContext<ReadonlyMap<string, MentionTarget>>(
  EMPTY_MENTION_TARGETS,
);
const StreamingContext = createContext(false);

function codeText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      typeof child === "string" || typeof child === "number" ? child : "",
    )
    .join("")
    .replace(/\n$/, "");
}

function codeLanguage(className: string | undefined): AgentCodeLanguage {
  const language = className?.match(/language-([^\s]+)/)?.[1]?.toLowerCase();
  if (
    language === "bash" ||
    language === "sh" ||
    language === "shell" ||
    language === "zsh"
  ) {
    return "bash";
  }
  if (language === "diff" || language === "patch") return "diff";
  if (language === "json" || language === "jsonc") return "json";
  if (language === "tsx" || language === "jsx") return "tsx";
  if (
    language === "typescript" ||
    language === "ts" ||
    language === "javascript" ||
    language === "js"
  ) {
    return "typescript";
  }
  return "text";
}

function safeImageSource(value: string | undefined): string | null {
  if (!value) return null;
  const safe = safeLink(value);
  return safe?.startsWith("https://") || safe?.startsWith("http://")
    ? safe
    : null;
}

function MarkdownAnchor({
  href,
  children,
  node: _node,
  ...props
}: MarkdownAnchorProps) {
  void _node;
  const citationIndexes = useContext(CitationIndexesContext);
  const mentionTargets = useContext(MentionTargetsContext);
  const citation = citationFromMarker(href);
  if (citation) {
    return (
      <CitationMark
        href={teloMessageLink(citation.chatId, citation.messageId)}
        index={
          citationIndexes.get(
            `${citation.chatId}\u0000${citation.messageId}`,
          ) ?? 1
        }
      />
    );
  }
  const mention = mentionFromMarker(href);
  if (mention) {
    return (
      <MentionChip
        name={mention}
        target={mentionTargets.get(mention.toLocaleLowerCase())}
      />
    );
  }
  const safe = href ? safeLink(href) : null;
  if (!safe) return <>{children}</>;
  return (
    <a {...props} href={safe} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function MarkdownCode({ children, className }: MarkdownCodeProps) {
  const streaming = useContext(StreamingContext);
  return (
    <CodeBlock
      code={codeText(children)}
      language={codeLanguage(className)}
      status={streaming ? "streaming" : "complete"}
    />
  );
}

function MarkdownInlineCode({ node: _node, ...props }: MarkdownCodeProps) {
  void _node;
  return <code {...props} />;
}

function MarkdownImage({
  src,
  alt,
  node: _node,
  ...props
}: MarkdownImageProps) {
  void _node;
  const safe = safeImageSource(src);
  if (!safe) return alt ?? null;
  return (
    <img
      {...props}
      src={safe}
      alt={alt ?? ""}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="my-3 max-h-80 max-w-full rounded-xl object-contain"
    />
  );
}

// Streamdown compares component references at block boundaries. Module-level
// definitions keep completed blocks memoized while the final block grows.
const AGENT_MARKDOWN_COMPONENTS: Components = {
  a: MarkdownAnchor,
  code: MarkdownCode,
  inlineCode: MarkdownInlineCode,
  img: MarkdownImage,
};

const transformUrl: UrlTransform = (url) => {
  if (citationFromMarker(url) || mentionFromMarker(url)) return url;
  return safeLink(url);
};

interface AgentMarkdownProps {
  readonly body: string;
  readonly streaming: boolean;
  readonly citations: ReadonlyArray<ReplyCitation>;
  readonly mentionTargets: ReadonlyMap<string, MentionTarget>;
  readonly mentionNames: ReadonlyArray<string>;
}

/** Stream-safe Markdown with the agent panel's app-specific inline elements. */
export function AgentMarkdown({
  body,
  streaming,
  citations,
  mentionTargets,
  mentionNames,
}: AgentMarkdownProps) {
  const citationIndexes = useMemo(
    () =>
      new Map(
        citations.map((citation, index) => [
          `${citation.chatId}\u0000${citation.messageId}`,
          index + 1,
        ]),
      ),
    [citations],
  );
  const mentionSignature = JSON.stringify(mentionNames);
  const mentionSnapshot = useMemo<ReadonlyArray<string>>(
    () => JSON.parse(mentionSignature) as string[],
    [mentionSignature],
  );
  const remarkPlugins = useMemo(
    () => [
      ...Object.values(defaultRemarkPlugins),
      createReplyRemarkPlugin(mentionSnapshot),
    ],
    [mentionSnapshot],
  );

  return (
    <MentionTargetsContext.Provider value={mentionTargets}>
      <CitationIndexesContext.Provider value={citationIndexes}>
        <StreamingContext.Provider value={streaming}>
          <Streamdown
            // Block rhythm of one half-line between paragraphs; the rest of
            // the reply typography lives on the StreamingResponse container.
            className="space-y-2"
            mode={streaming ? "streaming" : "static"}
            isAnimating={streaming}
            animated={false}
            parseIncompleteMarkdown
            skipHtml
            controls={false}
            components={AGENT_MARKDOWN_COMPONENTS}
            rehypePlugins={SAFE_REHYPE_PLUGINS}
            remarkPlugins={remarkPlugins}
            urlTransform={transformUrl}
            linkSafety={{ enabled: false }}
          >
            {body}
          </Streamdown>
        </StreamingContext.Provider>
      </CitationIndexesContext.Provider>
    </MentionTargetsContext.Provider>
  );
}
