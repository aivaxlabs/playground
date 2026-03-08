import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
    breaks: true,
    gfm: true,
});

export function renderMarkdown(text: string): string {
    const raw = marked.parse(text);
    if (typeof raw === 'string') {
        return DOMPurify.sanitize(raw);
    }
    return '';
}
