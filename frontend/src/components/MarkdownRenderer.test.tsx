import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownRenderer } from './MarkdownRenderer';

describe('F-17 Safe MarkdownRenderer', () => {
  it('renders headings, paragraphs, lists, code blocks, and tasks safely without innerHTML', () => {
    const markdown = `# Architecture Overview
## Subheading
This is a **bold text** with *italic* and \`inline code\`.

- Bullet point 1
- Bullet point 2

1. Numbered item 1
2. Numbered item 2

- [ ] Unfinished task
- [x] Completed task

\`\`\`bash
echo "Hello DoubleAgent"
\`\`\`

> Important security note

[External Link](https://doubleagent.app)
`;

    const { container } = render(<MarkdownRenderer content={markdown} />);

    // Verify Headings
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Architecture Overview');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Subheading');

    // Verify Strong and Italic
    expect(screen.getByText('bold text')).toBeInTheDocument();
    expect(screen.getByText('italic')).toBeInTheDocument();
    expect(screen.getByText('inline code')).toBeInTheDocument();

    // Verify Code Block
    expect(screen.getByText('echo "Hello DoubleAgent"')).toBeInTheDocument();
    expect(screen.getByTitle('Copy code block')).toBeInTheDocument();

    // Verify Tasks
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);

    // Verify Safe Link
    const link = screen.getByRole('link', { name: 'External Link' });
    expect(link).toHaveAttribute('href', 'https://doubleagent.app');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    // Verify blockquote
    expect(screen.getByText('Important security note')).toBeInTheDocument();
  });

  it('neutralizes dangerous javascript: link protocols', () => {
    const maliciousMarkdown = `[Click for XSS](javascript:alert(1))`;
    render(<MarkdownRenderer content={maliciousMarkdown} />);

    const link = screen.getByRole('link', { name: 'Click for XSS' });
    expect(link).toHaveAttribute('href', '#');
  });
});

