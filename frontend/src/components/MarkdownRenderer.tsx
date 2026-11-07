import React, { useState } from 'react';

interface MarkdownRendererProps {
  content: string;
  onToggleTask?: (taskIndex: number, newChecked: boolean) => void;
  className?: string;
}

/**
 * Safe, zero-innerHTML React Markdown renderer enforcing Golden Rule 2 & Threat Model Line 150.
 * Renders AST directly to React elements without risking XSS from injected HTML tags.
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  onToggleTask,
  className = '',
}) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopyCode = (code: string, index: number) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    }).catch(() => {});
  };

  const renderBlocks = () => {
    if (!content) {
      return <p className="markdown-empty">Empty note.</p>;
    }

    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeLanguage = '';
    let codeBuffer: string[] = [];
    let inTable = false;
    let tableRows: string[][] = [];
    let inList = false;
    let listType: 'ul' | 'ol' = 'ul';
    let listItems: React.ReactNode[] = [];
    let blockIndex = 0;
    let taskCounter = 0;

    const flushList = () => {
      if (inList && listItems.length > 0) {
        if (listType === 'ol') {
          elements.push(<ol key={`list-${blockIndex++}`} className="markdown-ol">{listItems}</ol>);
        } else {
          elements.push(<ul key={`list-${blockIndex++}`} className="markdown-ul">{listItems}</ul>);
        }
        listItems = [];
        inList = false;
      }
    };

    const flushTable = () => {
      if (inTable && tableRows.length > 0) {
        const headerRow = tableRows[0];
        const bodyRows = tableRows.slice(1).filter(r => !r.every(c => /^[-:\s]+$/.test(c)));
        elements.push(
          <div key={`table-wrapper-${blockIndex++}`} className="markdown-table-wrapper">
            <table className="markdown-table">
              <thead>
                <tr>
                  {headerRow.map((cell, cIdx) => (
                    <th key={`th-${cIdx}`}>{renderInline(cell.trim())}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, rIdx) => (
                  <tr key={`tr-${rIdx}`}>
                    {row.map((cell, cIdx) => (
                      <td key={`td-${rIdx}-${cIdx}`}>{renderInline(cell.trim())}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        tableRows = [];
        inTable = false;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code blocks (```)
      if (line.trim().startsWith('```')) {
        flushList();
        flushTable();
        if (inCodeBlock) {
          const fullCode = codeBuffer.join('\n');
          const codeIdx = blockIndex++;
          elements.push(
            <div key={`code-block-${codeIdx}`} className="markdown-code-block">
              <div className="code-block-header">
                <span className="code-lang">{codeLanguage || 'text'}</span>
                <button
                  type="button"
                  className="code-copy-btn"
                  onClick={() => handleCopyCode(fullCode, codeIdx)}
                  title="Copy code block"
                >
                  {copiedIndex === codeIdx ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
              <pre className="code-content">
                <code>{fullCode}</code>
              </pre>
            </div>
          );
          codeBuffer = [];
          codeLanguage = '';
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
          codeLanguage = line.trim().slice(3).trim();
          codeBuffer = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      // Tables (| col1 | col2 |)
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        flushList();
        inTable = true;
        const cells = line.trim().slice(1, -1).split('|');
        tableRows.push(cells);
        continue;
      } else if (inTable) {
        flushTable();
      }

      // Horizontal rule (--- or ***)
      if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
        flushList();
        elements.push(<hr key={`hr-${blockIndex++}`} className="markdown-hr" />);
        continue;
      }

      // Headings (#, ##, ###, ####)
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        flushList();
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        const headingContent = renderInline(text);
        if (level === 1) {
          elements.push(<h1 key={`h1-${blockIndex++}`} className="markdown-h1">{headingContent}</h1>);
        } else if (level === 2) {
          elements.push(<h2 key={`h2-${blockIndex++}`} className="markdown-h2">{headingContent}</h2>);
        } else if (level === 3) {
          elements.push(<h3 key={`h3-${blockIndex++}`} className="markdown-h3">{headingContent}</h3>);
        } else {
          elements.push(<h4 key={`h4-${blockIndex++}`} className="markdown-h4">{headingContent}</h4>);
        }
        continue;
      }

      // Blockquotes (> quote)
      if (line.trim().startsWith('>')) {
        flushList();
        const quoteText = line.trim().slice(1).trim();
        elements.push(
          <blockquote key={`quote-${blockIndex++}`} className="markdown-blockquote">
            {renderInline(quoteText)}
          </blockquote>
        );
        continue;
      }

      // Task lists (- [ ] or - [x])
      const taskMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
      if (taskMatch) {
        flushList();
        const isChecked = taskMatch[1].toLowerCase() === 'x';
        const taskText = taskMatch[2];
        const currentTaskIdx = taskCounter++;
        elements.push(
          <div key={`task-${blockIndex++}`} className="markdown-task-item">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={(e) => onToggleTask && onToggleTask(currentTaskIdx, e.target.checked)}
              className="markdown-task-checkbox"
            />
            <span className={isChecked ? 'task-done' : ''}>{renderInline(taskText)}</span>
          </div>
        );
        continue;
      }

      // Bullet lists (- item or * item)
      const bulletMatch = line.match(/^[-*]\s+(.*)$/);
      if (bulletMatch) {
        if (!inList || listType !== 'ul') {
          flushList();
          inList = true;
          listType = 'ul';
        }
        listItems.push(
          <li key={`li-${listItems.length}`}>{renderInline(bulletMatch[1])}</li>
        );
        continue;
      }

      // Numbered lists (1. item)
      const numMatch = line.match(/^\d+\.\s+(.*)$/);
      if (numMatch) {
        if (!inList || listType !== 'ol') {
          flushList();
          inList = true;
          listType = 'ol';
        }
        listItems.push(
          <li key={`li-${listItems.length}`}>{renderInline(numMatch[1])}</li>
        );
        continue;
      }

      // Empty line breaks list/table
      if (line.trim() === '') {
        flushList();
        continue;
      }

      // Standard paragraph
      flushList();
      elements.push(
        <p key={`p-${blockIndex++}`} className="markdown-p">
          {renderInline(line)}
        </p>
      );
    }

    flushList();
    flushTable();

    if (inCodeBlock && codeBuffer.length > 0) {
      elements.push(
        <pre key={`code-unterminated-${blockIndex++}`} className="code-content">
          <code>{codeBuffer.join('\n')}</code>
        </pre>
      );
    }

    return elements;
  };

  return (
    <div className={`markdown-rendered-view ${className}`} role="document">
      {renderBlocks()}
    </div>
  );
};

/**
 * Pure React inline parser for bold, italic, code, strikethrough, and safe links without innerHTML.
 */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    // Inline code `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      nodes.push(<code key={`code-${keyIdx++}`} className="markdown-inline-code">{codeMatch[1]}</code>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold **text** or __text__
    const boldMatch = remaining.match(/^(\*\*|__)(.*?)\1/);
    if (boldMatch) {
      nodes.push(<strong key={`bold-${keyIdx++}`}>{renderInline(boldMatch[2])}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic *text* or _text_
    const italicMatch = remaining.match(/^(\*|_)(.*?)\1/);
    if (italicMatch) {
      nodes.push(<em key={`italic-${keyIdx++}`}>{renderInline(italicMatch[2])}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Strikethrough ~~text~~
    const strikeMatch = remaining.match(/^~~(.*?)~~/);
    if (strikeMatch) {
      nodes.push(<del key={`del-${keyIdx++}`}>{renderInline(strikeMatch[1])}</del>);
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // Safe Link [text](url)
    const linkMatch = remaining.match(/^\[(.*?)\]\((.*?)\)/);
    if (linkMatch) {
      const linkText = linkMatch[1];
      const rawUrl = linkMatch[2].trim();
      // Block unsafe protocols like javascript: or data:
      const safeUrl = /^(https?:\/\/|mailto:|#)/i.test(rawUrl) ? rawUrl : '#';
      nodes.push(
        <a
          key={`a-${keyIdx++}`}
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="markdown-link"
        >
          {linkText}
        </a>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Plain text until next token
    const nextSpecial = remaining.search(/[`*_~[]/);
    if (nextSpecial === -1) {
      nodes.push(remaining);
      break;
    } else if (nextSpecial === 0) {
      // Unmatched token character, treat as literal
      nodes.push(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      nodes.push(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    }
  }

  return nodes;
}

/**
 * Toggles the Nth markdown task item (- [ ] / - [x]) inside a markdown document string.
 */
export function toggleMarkdownTaskAtIndex(
  content: string,
  targetTaskIndex: number,
  newChecked: boolean
): string {
  const lines = content.split('\n');
  let currentTaskIdx = 0;
  let inCodeBlock = false;

  const updatedLines = lines.map((line) => {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      return line;
    }
    if (inCodeBlock) {
      return line;
    }
    const taskMatch = line.match(/^([-*]\s+\[)([ xX])(\]\s+.*)$/);
    if (taskMatch) {
      if (currentTaskIdx === targetTaskIndex) {
        currentTaskIdx++;
        return `${taskMatch[1]}${newChecked ? 'x' : ' '}${taskMatch[3]}`;
      }
      currentTaskIdx++;
    }
    return line;
  });

  return updatedLines.join('\n');
}
