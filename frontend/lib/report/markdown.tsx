"use client";
/**
 * Tiny, zero-dependency Markdown renderer for report note boxes.
 *
 * Supports exactly what an analyst needs in an executive summary — **bold**,
 * *italic*, `code`, and `- ` / `* ` bullet lists — and nothing else. It builds
 * real React nodes (never dangerouslySetInnerHTML), so there's no XSS surface
 * and it adds ~0 KB to the bundle, in keeping with the app's edge-first ethos.
 */
import { Fragment, type ReactNode } from "react";

// Inline: **bold** / __bold__ before *italic* / _italic_ (so ** isn't eaten by *).
const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`)/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[2] !== undefined || m[3] !== undefined) {
      out.push(<strong key={key} className="font-semibold text-white">{m[2] ?? m[3]}</strong>);
    } else if (m[4] !== undefined || m[5] !== undefined) {
      out.push(<em key={key}>{m[4] ?? m[5]}</em>);
    } else if (m[6] !== undefined) {
      out.push(<code key={key} className="font-mono text-[0.9em] text-amber-300">{m[6]}</code>);
    }
    last = INLINE.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ children, className }: { children: string; className?: string }) {
  const lines = children.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (!bullets.length) return;
    const items = bullets;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-0.5">
        {items.map((b, j) => <li key={j}>{renderInline(b, `b${blocks.length}-${j}`)}</li>)}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((line, idx) => {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }
    flushBullets();
    if (line.trim() === "") return;
    blocks.push(
      <p key={`p-${idx}`} className="whitespace-pre-wrap">{renderInline(line, `p${idx}`)}</p>,
    );
  });
  flushBullets();

  return <div className={className}>{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
