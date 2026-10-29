/**
 * Renders Elasticsearch highlights. The backend wraps matches in \u0002 … \u0003
 * (not HTML), so we split on those and wrap matches in <mark> — no raw HTML is inserted.
 */
export default function Highlight({ text, fallback }: { text?: string[]; fallback: string | null }) {
  const value = text?.[0] ?? fallback ?? "";
  const parts = value.split(/(\u0002[^\u0003]*\u0003)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("\u0002") ? (
          <mark key={i} className="rounded bg-amber-100 px-0.5 text-inherit">
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
