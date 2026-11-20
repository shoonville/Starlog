import { Fragment, type ReactNode } from "react";

/**
 * Notes use a tiny, readable subset of Markdown:
 *   **bold**, *italic*, and lines starting with "- " as bullet lists.
 * The raw text is what gets saved (and exported), so it stays portable.
 */

const BULLET = /^\s*[-*]\s+/;
/** "- [ ] thing" or "- [x] thing": a checklist item. */
const CHECK = /^\s*[-*]\s+\[( |x|X)\]\s?/;

/** Ticks or unticks the checklist item on line `index` of a note. */
export function toggleCheckLine(body: string, index: number) {
  const lines = body.split("\n");
  const ln = lines[index];
  if (ln == null) return body;
  const m = ln.match(CHECK);
  if (!m) return body;
  lines[index] = ln.replace(/\[( |x|X)\]/, m[1] === " " ? "[x]" : "[ ]");
  return lines.join("\n");
}
const INLINE = /(\*\*[^*\n]+?\*\*|\*[^*\s\n](?:[^*\n]*?[^*\s\n])?\*)/g;

/** True when `text` contains the (trimmed, case-insensitive) search query. */
export function matchesQuery(text: string, query: string | null | undefined) {
  const q = query?.trim().toLocaleLowerCase();
  return !!q && text.toLocaleLowerCase().includes(q);
}

/** Splits text around search matches and wraps each match in a soft highlight. */
export function highlight(text: string, query: string | null | undefined, keyBase = "h"): ReactNode[] {
  const q = query?.trim().toLocaleLowerCase();
  if (!q) return [text];
  const lower = text.toLocaleLowerCase();
  const out: ReactNode[] = [];
  let from = 0;
  let i = 0;
  for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, at + q.length)) {
    if (at > from) out.push(text.slice(from, at));
    out.push(<mark key={`${keyBase}-m${i++}`} className="search-hit rounded-[3px] bg-[hsl(46_95%_70%/0.3)] px-[1px] text-foreground">{text.slice(at, at + q.length)}</mark>);
    from = at + q.length;
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
}

function inline(text: string, keyBase: string, query?: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(...highlight(text.slice(last, idx), query, `${keyBase}-t${i++}`));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(<strong key={`${keyBase}-${i++}`} className="font-semibold text-foreground">{highlight(tok.slice(2, -2), query, `${keyBase}-s${i}`)}</strong>);
    } else {
      out.push(<em key={`${keyBase}-${i++}`} className="italic">{highlight(tok.slice(1, -1), query, `${keyBase}-e${i}`)}</em>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(...highlight(text.slice(last), query, `${keyBase}-t${i++}`));
  return out;
}

/** Note text without Markdown markers, for copying as plain text. */
export function plainNote(body: string) {
  return body.replace(/\*\*([^*\n]+?)\*\*/g, "$1").replace(/\*([^*\s\n](?:[^*\n]*?[^*\s\n])?)\*/g, "$1").replace(/^\s*\*\s+/gm, "- ");
}

export function FormattedNote({ body, query, onToggleCheck }: { body: string; query?: string; onToggleCheck?: (line: number) => void }) {
  const lines = body.split("\n");
  const blocks: ReactNode[] = [];
  let list: Array<{ text: string; line: number; check?: boolean }> = [];
  let para: string[] = [];
  const flushList = () => {
    if (!list.length) return;
    const k = blocks.length;
    blocks.push(
      <ul key={`ul-${k}`} className="my-1 space-y-0.5 pl-1">
        {list.map((li, j) =>
          li.check === undefined ? (
            <li key={j} className="relative pl-4">
              <span className="absolute left-0.5 top-[0.7em] h-[3px] w-[3px] rounded-full bg-current opacity-60" />
              {inline(li.text, `li-${k}-${j}`, query)}
            </li>
          ) : (
            <li key={j} className="relative flex items-start gap-2.5 py-0.5">
              <button
                type="button"
                role="checkbox"
                aria-checked={li.check}
                aria-label={li.check ? "Untick" : "Tick"}
                onClick={(e) => { e.stopPropagation(); onToggleCheck?.(li.line); }}
                className="-m-2 flex shrink-0 items-center justify-center p-2"
                data-testid="note-check"
              >
                <span className={`flex h-[17px] w-[17px] items-center justify-center rounded-full border transition-all duration-300 ${li.check ? "border-primary bg-primary shadow-[0_0_10px_1px_hsl(39_84%_69%/0.45)]" : "border-primary/60"}`}>
                  {li.check && (
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-primary-foreground" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.2l2.2 2.2 4.8-4.8" /></svg>
                  )}
                </span>
              </button>
              <span className={`min-w-0 transition-colors duration-300 ${li.check ? "text-muted-foreground/60 line-through decoration-white/25" : ""}`}>
                {inline(li.text, `li-${k}-${j}`, query)}
              </span>
            </li>
          ),
        )}
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
            {inline(ln, `p-${k}-${j}`, query)}
          </Fragment>
        ))}
      </p>,
    );
    para = [];
  };
  lines.forEach((ln, line) => {
    const cm = ln.match(CHECK);
    if (cm) {
      flushPara();
      list.push({ text: ln.replace(CHECK, ""), line, check: cm[1] !== " " });
    } else if (BULLET.test(ln)) {
      flushPara();
      list.push({ text: ln.replace(BULLET, ""), line });
    } else if (ln.trim() === "") {
      flushList();
      flushPara();
      if (blocks.length) blocks.push(<div key={`sp-${blocks.length}`} className="h-2" />);
    } else {
      flushList();
      para.push(ln);
    }
  });
  flushList();
  flushPara();
  return <>{blocks}</>;
}

export function wordCount(text: string) {
  const plain = text.replace(/^\s*[-*]\s+\[( |x|X)\]/gm, " ").replace(/\*+/g, " ").replace(/^\s*[-*]\s+/gm, " ");
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

export type FormatKind = "bold" | "italic" | "bullet" | "check";

export function applyFormat(el: HTMLTextAreaElement, kind: FormatKind, setValue: (v: string) => void) {
  const v = el.value;
  const s = el.selectionStart;
  const e = el.selectionEnd;

  if (kind === "check") {
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    let le = v.indexOf("\n", e > s && v[e - 1] === "\n" ? e - 1 : e);
    if (le === -1) le = v.length;
    const block = v.slice(ls, le).split("\n");
    const allChecks = block.every((l) => CHECK.test(l) || l.trim() === "");
    const next = block
      .map((l) =>
        allChecks ? l.replace(CHECK, "")
        : l.trim() === "" && block.length > 1 ? l
        : CHECK.test(l) ? l
        : `- [ ] ${l.replace(BULLET, "")}`,
      )
      .join("\n");
    replaceRange(el, ls, le, next, setValue);
    requestAnimationFrame(() => {
      const caret = ls + next.length;
      el.setSelectionRange(s === e ? caret : ls, caret);
    });
    return;
  }

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
  const c = line.match(/^(\s*)([-*])\s+\[( |x|X)\]\s?/);
  if (c) {
    if (line.trim() === line.match(CHECK)![0].trim()) { replaceRange(el, ls, s, "", setValue); return true; }
    replaceRange(el, s, s, `\n${c[1]}${c[2]} [ ] `, setValue);
    return true;
  }
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
