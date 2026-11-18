import { Fragment, type ReactNode } from "react";

/**
 * Notes use a tiny, readable subset of Markdown:
 *   **bold**, *italic*, and lines starting with "- " as bullet lists.
 * The raw text is what gets saved (and exported), so it stays portable.
 */

const BULLET = /^\s*[-*]\s+/;
const INLINE = /(\*\*[^*\n]+?\*\*|\*[^*\s\n](?:[^*\n]*?[^*\s\n])?\*)/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(<strong key={`${keyBase}-${i++}`} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={`${keyBase}-${i++}`} className="italic">{tok.slice(1, -1)}</em>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function FormattedNote({ body }: { body: string }) {
  const lines = body.split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (!list.length) return;
    const k = blocks.length;
    blocks.push(
      <ul key={`ul-${k}`} className="my-1 space-y-0.5 pl-1">
        {list.map((li, j) => (
          <li key={j} className="relative pl-4">
            <span className="absolute left-0.5 top-[0.7em] h-[3px] w-[3px] rounded-full bg-current opacity-60" />
            {inline(li, `li-${k}-${j}`)}
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  const flushPara = () => {
    if (!para.length) return;
    const k = blocks.length;
    blocks.push(
      <p key={`p-${k}`} className="whitespace-pre-wrap">
        {para.map((ln, j) => (
          <Fragment key={j}>
            {j > 0 && "\n"}
            {inline(ln, `p-${k}-${j}`)}
          </Fragment>
        ))}
      </p>,
    );
    para = [];
  };
  for (const ln of lines) {
    if (BULLET.test(ln)) {
      flushPara();
      list.push(ln.replace(BULLET, ""));
    } else if (ln.trim() === "") {
      flushList();
      flushPara();
      if (blocks.length) blocks.push(<div key={`sp-${blocks.length}`} className="h-2" />);
    } else {
      flushList();
      para.push(ln);
    }
  }
  flushList();
  flushPara();
  return <>{blocks}</>;
}

export function wordCount(text: string) {
  const plain = text.replace(/\*+/g, " ").replace(/^\s*[-*]\s+/gm, " ");
  const words = plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return words ? words.length : 0;
}

/** Replaces a range of the textarea in a way that keeps the browser's undo history. */
function replaceRange(el: HTMLTextAreaElement, start: number, end: number, text: string, setValue: (v: string) => void) {
  el.focus();
  el.setSelectionRange(start, end);
  let ok = false;
  try {
    ok = document.execCommand("insertText", false, text);
  } catch {
    ok = false;
  }
  if (!ok) {
    const v = el.value.slice(0, start) + text + el.value.slice(end);
    setValue(v);
  }
}

export type FormatKind = "bold" | "italic" | "bullet";

export function applyFormat(el: HTMLTextAreaElement, kind: FormatKind, setValue: (v: string) => void) {
  const v = el.value;
  const s = el.selectionStart;
  const e = el.selectionEnd;

  if (kind === "bullet") {
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    let le = v.indexOf("\n", e > s && v[e - 1] === "\n" ? e - 1 : e);
    if (le === -1) le = v.length;
    const block = v.slice(ls, le).split("\n");
    const allBullets = block.every((l) => BULLET.test(l) || l.trim() === "");
    const next = block
      .map((l) => (allBullets ? l.replace(BULLET, "") : l.trim() === "" && block.length > 1 ? l : BULLET.test(l) ? l : `- ${l}`))
      .join("\n");
    replaceRange(el, ls, le, next, setValue);
    requestAnimationFrame(() => {
      const caret = ls + next.length;
      el.setSelectionRange(s === e ? caret : ls, caret);
    });
    return;
  }

  const mark = kind === "bold" ? "**" : "*";
  const sel = v.slice(s, e);
  const before = v.slice(Math.max(0, s - mark.length), s);
  const after = v.slice(e, e + mark.length);
  const isWrapped =
    before === mark && after === mark && (kind === "bold" || (v[s - 2] !== "*" && v[e + 1] !== "*"));

  if (isWrapped) {
    replaceRange(el, s - mark.length, e + mark.length, sel, setValue);
    requestAnimationFrame(() => el.setSelectionRange(s - mark.length, e - mark.length));
    return;
  }
  replaceRange(el, s, e, `${mark}${sel}${mark}`, setValue);
  requestAnimationFrame(() => el.setSelectionRange(s + mark.length, e + mark.length));
}

/** Enter inside a bullet continues the list; Enter on an empty bullet ends it. */
export function handleListEnter(el: HTMLTextAreaElement, setValue: (v: string) => void) {
  const v = el.value;
  const s = el.selectionStart;
  if (s !== el.selectionEnd) return false;
  const ls = v.lastIndexOf("\n", s - 1) + 1;
  const line = v.slice(ls, s);
  const m = line.match(/^(\s*)([-*])\s+/);
  if (!m) return false;
  if (line.trim() === m[2]) {
    replaceRange(el, ls, s, "", setValue);
    return true;
  }
  replaceRange(el, s, s, `\n${m[1]}${m[2]} `, setValue);
  return true;
}

/** Ctrl/Cmd+B, Ctrl/Cmd+I shortcuts and list continuation. Returns true if handled. */
export function formatKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, setValue: (v: string) => void) {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.shiftKey && (e.key === "b" || e.key === "B")) {
    e.preventDefault();
    applyFormat(e.currentTarget, "bold", setValue);
    return true;
  }
  if (mod && !e.shiftKey && (e.key === "i" || e.key === "I")) {
    e.preventDefault();
    applyFormat(e.currentTarget, "italic", setValue);
    return true;
  }
  if (e.key === "Enter" && !mod && !e.shiftKey && !e.altKey) {
    if (handleListEnter(e.currentTarget, setValue)) {
      e.preventDefault();
      return true;
    }
  }
  return false;
}
