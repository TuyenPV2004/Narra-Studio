import React, { useState, useMemo } from "react";
import { Check, Copy, Code2, ExternalLink, Earth } from "lucide-react";
import { toast } from "sonner";
import { getElectronApi } from "@/services/electron-api/client";

interface CodeBlockProps {
  language?: string;
  code: string;
}

export function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Đã sao chép đoạn mã");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Không thể sao chép");
    }
  };

  const displayLang = (language || "text").toLowerCase();

  return (
    <div className="source-agent-codeblock">
      <div className="source-agent-codeblock__header">
        <span className="source-agent-codeblock__lang">
          <Code2 size={13} aria-hidden="true" />
          {displayLang}
        </span>
        <button
          type="button"
          className="source-agent-codeblock__copy"
          onClick={handleCopy}
          title="Sao chép toàn bộ mã"
          aria-label="Sao chép mã"
        >
          {copied ? (
            <>
              <Check size={12} className="source-agent-codeblock__check-icon" />
              <span>Đã chép</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Sao chép</span>
            </>
          )}
        </button>
      </div>
      <pre className="source-agent-codeblock__pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface SmartLinkChipProps {
  url: string;
  label: string;
}

export function SmartLinkChip({ url, label }: SmartLinkChipProps) {
  const safeUrl = useMemo(() => {
    if (
      url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("mailto:")
    ) {
      return url;
    }
    return `https://${url}`;
  }, [url]);

  const handleClick = async (event: React.MouseEvent) => {
    event.preventDefault();
    try {
      await getElectronApi().openExternalUrl(safeUrl);
    } catch {
      toast.error("Không thể mở liên kết ngoài.");
    }
  };

  return (
    <a
      href={safeUrl}
      onClick={handleClick}
      target="_blank"
      rel="noopener noreferrer"
      className="source-agent-smart-link-chip"
      title={`${label} (${safeUrl})`}
    >
      <span className="source-agent-smart-link-chip__icon-wrap">
        <Earth
          size={12}
          className="source-agent-smart-link-chip__fallback-icon"
          aria-hidden="true"
        />
      </span>
      <span className="source-agent-smart-link-chip__label">{label}</span>
      <ExternalLink
        size={11}
        className="source-agent-smart-link-chip__arrow"
        aria-hidden="true"
      />
    </a>
  );
}

// Tokenize and render inline formatting safely (bold, italic, code, smart links, strikethrough)
export function renderInlineMarkdown(text: string): React.ReactNode[] {
  if (!text) return [];

  // Match inline tokens: `code`, ***bold-italic***, **bold**, *italic*, ~~strike~~, [text](url)
  const regex =
    /(`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (!part) return null;

    // Inline code `...`
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code key={index} className="source-agent-inline-code">
          {part.slice(1, -1)}
        </code>
      );
    }

    // Bold + Italic ***...***
    if (part.startsWith("***") && part.endsWith("***") && part.length >= 6) {
      return (
        <strong key={index}>
          <em>{part.slice(3, -3)}</em>
        </strong>
      );
    }

    // Bold **...**
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    // Italic *...*
    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }

    // Strikethrough ~~...~~
    if (part.startsWith("~~") && part.endsWith("~~") && part.length >= 4) {
      return <del key={index}>{part.slice(2, -2)}</del>;
    }

    // Link [text](url) -> Smart Link Chip with Favicon
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch && linkMatch[1] && linkMatch[2]) {
      const label = linkMatch[1];
      const url = linkMatch[2];
      return <SmartLinkChip key={index} url={url} label={label} />;
    }

    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

interface TableData {
  headers: string[];
  rows: string[][];
}

function parseMarkdownTable(lines: string[]): TableData | null {
  if (lines.length < 2) return null;
  const parseRow = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());

  const headers = parseRow(lines[0] || "");
  const separatorLine = lines[1] || "";
  const isSeparator =
    /^[\s|:-]+$/.test(separatorLine) && separatorLine.includes("-");
  if (!isSeparator) return null;

  const rows = lines.slice(2).map(parseRow);
  return { headers, rows };
}

interface RawListItem {
  indent: number;
  type: "ul" | "ol";
  text: string;
}

interface TreeNode {
  text: string;
  type: "ul" | "ol";
  children: TreeNode[];
}

function buildListTree(items: RawListItem[]): TreeNode[] {
  if (!items.length) return [];
  const roots: TreeNode[] = [];
  const stack: { indent: number; node: TreeNode }[] = [];

  for (const item of items) {
    const node: TreeNode = { text: item.text, type: item.type, children: [] };

    // Pop stack until top has strictly smaller indent
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= item.indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1]!.node.children.push(node);
    }

    stack.push({ indent: item.indent, node });
  }

  return roots;
}

function renderListTree(nodes: TreeNode[], keyPrefix: string): React.ReactNode {
  if (!nodes.length) return null;
  const isOl = nodes[0]?.type === "ol";
  const ListTag = isOl ? "ol" : "ul";
  const className = isOl ? "source-agent-ol" : "source-agent-ul";

  return (
    <ListTag key={keyPrefix} className={className}>
      {nodes.map((node, index) => (
        <li key={`${keyPrefix}-${index}`}>
          <span>{renderInlineMarkdown(node.text)}</span>
          {node.children.length > 0 &&
            renderListTree(node.children, `${keyPrefix}-${index}-sub`)}
        </li>
      ))}
    </ListTag>
  );
}

export function AgentMarkdownRenderer({ content }: { content: string }) {
  const elements = useMemo(() => {
    if (!content) return null;

    const blocks: React.ReactNode[] = [];
    const lines = content.split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i]!;

      // 1. Fenced Code Block (```lang)
      if (line.trim().startsWith("```")) {
        const langMatch = line.trim().match(/^```([a-zA-Z0-9_-]+)?/);
        const language = langMatch?.[1] || "";
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
          codeLines.push(lines[i]!);
          i++;
        }
        if (i < lines.length && lines[i]!.trim().startsWith("```")) {
          i++; // skip closing ```
        }
        blocks.push(
          <CodeBlock
            key={`code-${blocks.length}`}
            language={language}
            code={codeLines.join("\n")}
          />,
        );
        continue;
      }

      // 2. Horizontal Rule (---, ***, ___) - Skip dividing lines for a cleaner chat UI
      if (/^(?:---|\\*\\*\\*|___)\s*$/.test(line.trim())) {
        i++;
        continue;
      }

      // 3. Headings (# H1, ## H2, ### H3, #### H4)
      const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1]!.length;
        const text = headingMatch[2]!;
        const inline = renderInlineMarkdown(text);
        if (level === 1) {
          blocks.push(
            <h1 key={`h1-${blocks.length}`} className="source-agent-h1">
              {inline}
            </h1>,
          );
        } else if (level === 2) {
          blocks.push(
            <h2 key={`h2-${blocks.length}`} className="source-agent-h2">
              {inline}
            </h2>,
          );
        } else if (level === 3) {
          blocks.push(
            <h3 key={`h3-${blocks.length}`} className="source-agent-h3">
              {inline}
            </h3>,
          );
        } else {
          blocks.push(
            <h4 key={`h4-${blocks.length}`} className="source-agent-h4">
              {inline}
            </h4>,
          );
        }
        i++;
        continue;
      }

      // 4. Blockquotes (> quote)
      if (line.trim().startsWith(">")) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i]!.trim().startsWith(">")) {
          quoteLines.push(lines[i]!.replace(/^>\s?/, ""));
          i++;
        }
        blocks.push(
          <blockquote
            key={`quote-${blocks.length}`}
            className="source-agent-blockquote"
          >
            {quoteLines.map((q, qIdx) => (
              <p key={qIdx}>{renderInlineMarkdown(q)}</p>
            ))}
          </blockquote>,
        );
        continue;
      }

      // 5. Tables (| col 1 | col 2 |)
      if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
        const tableLines: string[] = [];
        while (
          i < lines.length &&
          lines[i]!.trim().startsWith("|") &&
          lines[i]!.trim().endsWith("|")
        ) {
          tableLines.push(lines[i]!);
          i++;
        }
        const tableData = parseMarkdownTable(tableLines);
        if (tableData) {
          blocks.push(
            <div
              key={`table-wrap-${blocks.length}`}
              className="source-agent-table-wrap"
            >
              <table className="source-agent-table">
                <thead>
                  <tr>
                    {tableData.headers.map((h, hIdx) => (
                      <th key={hIdx}>{renderInlineMarkdown(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx}>{renderInlineMarkdown(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>,
          );
          continue;
        }
      }

      // 6. Lists (Unordered & Ordered, with full nested hierarchy support)
      const listMatch = line.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.+)$/);
      if (listMatch) {
        const listItems: RawListItem[] = [];
        while (i < lines.length) {
          const l = lines[i]!;
          const currentMatch = l.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.+)$/);
          if (!currentMatch) break;
          const rawIndent = currentMatch[1]!.replace(/\t/g, "  ").length;
          const isUl = /^\s*[-*+]\s+/.test(l);
          listItems.push({
            indent: rawIndent,
            type: isUl ? "ul" : "ol",
            text: currentMatch[2]!,
          });
          i++;
        }
        const tree = buildListTree(listItems);
        blocks.push(renderListTree(tree, `list-${blocks.length}`));
        continue;
      }

      // 8. Regular Paragraphs (collect consecutive non-empty lines)
      if (line.trim()) {
        const pLines: string[] = [];
        while (
          i < lines.length &&
          lines[i]!.trim() &&
          !lines[i]!.trim().startsWith("```") &&
          !lines[i]!.match(/^(#{1,4})\s+/) &&
          !lines[i]!.trim().startsWith(">") &&
          !(
            lines[i]!.trim().startsWith("|") && lines[i]!.trim().endsWith("|")
          ) &&
          !/^\s*[-*+]\s+/.test(lines[i]!) &&
          !/^\s*\d+\.\s+/.test(lines[i]!) &&
          !/^(?:---|\\*\\*\\*|___)\s*$/.test(lines[i]!.trim())
        ) {
          pLines.push(lines[i]!);
          i++;
        }
        blocks.push(
          <p key={`p-${blocks.length}`} className="source-agent-paragraph">
            {pLines.map((pLine, pIdx) => (
              <React.Fragment key={pIdx}>
                {renderInlineMarkdown(pLine)}
                {pIdx < pLines.length - 1 && <br />}
              </React.Fragment>
            ))}
          </p>,
        );
        continue;
      }

      // Empty line / whitespace
      i++;
    }

    return blocks;
  }, [content]);

  return <div className="source-agent-markdown-content">{elements}</div>;
}
