import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ source }: { source: string }) {
  if (!source.trim()) return <p className="text-sm text-muted">No notes yet.</p>;
  return (
    <div className="prose-notes text-sm leading-relaxed text-ink-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
}
