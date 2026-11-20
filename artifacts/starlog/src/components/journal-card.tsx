import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSkyQueryKey,
  getGetSkyStatsQueryKey,
  getListStarNotesQueryKey,
  useCreateNote,
  useListStarNotes,
  useUpdateNote,
  ApiError,
  type Note,
  type Sky,
  type Star,
} from "@workspace/api-client-react";
import { Bold, Check, ChevronDown, Copy, Italic, Link2, List, MoreHorizontal, Orbit, Palette, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DEFAULT_STAR, PALETTE, constellationTint, formatStamp, formatStampShort, type ConstellationView } from "@/lib/sky";
import { TaskComposer, TaskList } from "@/components/task-list";
import { FormattedNote, applyFormat, formatKeyDown, matchesQuery, plainNote, wordCount, type FormatKind } from "@/lib/note-format";
import { clearDraftIfSent, draftKeys, readDraft, useDraft, writeDraft } from "@/lib/save-safety";
import { toast } from "@/hooks/use-toast";

const NO_BASE = "none";
const NOTE_MAX = 100_000;
const isoOrNull = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
/** The stored starting version of an unsent edit: undefined if none was stored. */
const readBase = (key: string): string | null | undefined => {
  const v = readDraft(key);
  return v ? (v === NO_BASE ? null : v) : undefined;
};
import { formatDue, orderedOpenTasks } from "@/lib/tasks";
import { scheduleDelete, usePendingDeletes } from "@/lib/pending-deletes";
import type { SkyActions } from "@/hooks/use-sky-actions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useKeyboardInset, useSheetDrag } from "@/components/bottom-sheet";

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function FormatBar({ target, setValue, words, children }: { target: React.RefObject<HTMLTextAreaElement | null>; setValue: (v: string) => void; words: number; children?: React.ReactNode }) {
  const btn = (kind: FormatKind, label: string, icon: React.ReactNode, kbd?: string) => (
    <button
      type="button"
      title={kbd ? `${label} (${kbd})` : label}
      aria-label={label}
      // Keep focus (and the selection) in the text box.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => target.current && applyFormat(target.current, kind, setValue)}
      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-white/[0.07] hover:text-foreground"
      data-testid={`button-format-${kind}`}
    >
      {icon}
    </button>
  );
  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "Cmd" : "Ctrl";
  return (
    <div className="flex items-center gap-0.5">
      {btn("bold", "Bold", <Bold className="h-3.5 w-3.5" />, `${mod}+B`)}
      {btn("italic", "Italic", <Italic className="h-3.5 w-3.5" />, `${mod}+I`)}
      {btn("bullet", "Bullet list", <List className="h-3.5 w-3.5" />)}
      <span className="ml-2 text-[11px] tabular-nums text-muted-foreground/60" data-testid="text-word-count">
        {words} {words === 1 ? "word" : "words"}
      </span>
      {children}
    </div>
  );
}

/** Menu item style shared by the note's hold menu and the star's ⋯ panels. */
const MENU_ITEM = "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13.5px] text-foreground/90 outline-none hover:bg-white/[0.06] focus-visible:bg-white/[0.06] md:min-h-9";
const HOLD_MS = 500;

function NoteRow({ note, focused, onDelete, onSaved, onTogglePin, query }: {
  note: Note;
  focused: boolean;
  onDelete: () => void;
  onSaved: () => void;
  onTogglePin: () => void;
  /** Search text from the card's search: matches are highlighted, other notes dimmed. */
  query?: string;
}) {
  const qc = useQueryClient();
  // Edits are backed up until the server has them, so a failed save or a reload never loses them.
  const editKey = draftKeys.noteEdit(note.id);
  const baseKey = draftKeys.noteEditBase(note.id);
  // Saves to one note go out one at a time, in order, so an older retry can't land after a newer save.
  const update = useUpdateNote({
    mutation: {
      scope: { id: `note-${note.id}` },
      meta: { quiet409: true },
      onSuccess: (_n, v) => {
        if (v.data.body != null) clearDraftIfSent(editKey, v.data.body);
        if (!readDraft(editKey)) writeDraft(baseKey, "");
      },
    },
  });
  const copyNote = useCreateNote();
  // The version of the note this edit started from. The server refuses the save if the note
  // was changed on another device since, and the text here is kept as a separate note instead.
  const base = useRef<string | null>(readBase(baseKey) ?? isoOrNull(note.editedAt));
  const mutateRef = useRef(update.mutate);
  mutateRef.current = update.mutate;
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;
  const [body, setBody] = useState(() => readDraft(editKey) || note.body);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number>(0);
  const pending = useRef<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Press and hold (or right-click) opens Pin / Edit / Delete.
  const [menuOpen, setMenuOpen] = useState(false);
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  useEffect(() => cancelHold, []);
  const searching = !!query?.trim();
  const dim = searching && !matchesQuery(body, query);

  useEffect(() => autosize(taRef.current), [body, editing]);
  useEffect(() => {
    if (editing && taRef.current) {
      const el = taRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const flush = () => {
    const v = pending.current;
    if (v == null) return;
    pending.current = null;
    const notesKey = getListStarNotesQueryKey(note.starId);
    mutateRef.current(
      { noteId: note.id, data: { body: v, baseEditedAt: base.current } },
      {
        onSuccess: (n) => {
          base.current = isoOrNull(n.editedAt);
          qc.setQueryData<Note[]>(notesKey, (old) =>
            old ? old.map((x) => (x.id === n.id ? n : x)) : old,
          );
          savedRef.current();
          setSaved(true);
          window.setTimeout(() => setSaved(false), 1400);
        },
        onError: (err) => {
          if (!(err instanceof ApiError) || err.status !== 409) return;
          // Changed on another device: keep both. The newer text stays, this one becomes its own note.
          const theirs = (err.data as { note?: Note } | undefined)?.note;
          copyNote.mutate(
            { starId: note.starId, data: { body: v } },
            {
              onSuccess: (copy) => {
                writeDraft(editKey, "");
                writeDraft(baseKey, "");
                qc.setQueryData<Note[]>(notesKey, (old) => {
                  const list = (old ?? []).map((x) => (theirs && x.id === theirs.id ? theirs : x));
                  return [...list, copy];
                });
                if (theirs) { base.current = isoOrNull(theirs.editedAt); setBody(theirs.body); }
                setEditing(false);
                toast({
                  title: "Kept both versions",
                  description: "This note was changed on another device, so your edit was saved as a new note below it.",
                });
              },
            },
          );
        },
      },
    );
  };
  useEffect(() => {
    // An edit that never reached the server: send it again (against the version it started from).
    const backup = readDraft(editKey);
    if (backup && backup !== note.body) { pending.current = backup; flush(); }
    else if (backup) { writeDraft(editKey, ""); writeDraft(baseKey, ""); }
    return () => { clearTimeout(timer.current); flush(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pick up newer text from the server when this note isn't being edited here.
  useEffect(() => {
    if (editing || pending.current != null || readDraft(editKey)) return;
    setBody(note.body);
    base.current = isoOrNull(note.editedAt);
  }, [note.body, note.editedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (v: string) => {
    setBody(v);
    if (!readDraft(editKey)) writeDraft(baseKey, base.current ?? NO_BASE);
    writeDraft(editKey, v);
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 700);
  };

  return (
    <li
      className={`group relative rounded-xl pl-5 transition-[background-color,box-shadow,opacity] duration-1000 soft-ease ${focused ? "note-glow" : ""} ${dim ? "opacity-35 !duration-300" : ""} ${menuOpen ? "bg-white/[0.035]" : ""}`}
      data-note-id={note.id}
      data-match={searching && !dim ? "true" : undefined}
      data-testid={`note-${note.id}`}
      onPointerDown={(e) => {
        if (editing || e.pointerType === "mouse" || (e.target as HTMLElement).closest("button,a")) return;
        cancelHold();
        hold.current = {
          x: e.clientX, y: e.clientY,
          timer: window.setTimeout(() => {
            hold.current = null;
            swallowClick.current = true;
            navigator.vibrate?.(8);
            setMenuOpen(true);
          }, HOLD_MS),
        };
      }}
      onPointerMove={(e) => {
        if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 8) cancelHold();
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onClickCapture={(e) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
      onContextMenu={(e) => {
        if (editing) return;
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <span className="absolute left-0 top-[9px] h-1.5 w-1.5 rounded-full bg-primary/55" />
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverAnchor asChild>
      <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground/80">
        {note.pinned && <Pin className="h-3 w-3 shrink-0 rotate-45 text-muted-foreground" aria-label="Pinned" data-testid={`icon-note-pinned-${note.id}`} />}
        <span data-testid={`text-note-time-${note.id}`}>{formatStamp(note.createdAt)}</span>
        {note.editedAt && <span className="opacity-70">· edited {formatStamp(note.editedAt)}</span>}
        <span className={`text-[hsl(150_30%_74%)] transition-opacity duration-700 soft-ease ${saved ? "opacity-100" : "opacity-0"}`}>
          <Check className="inline h-3 w-3" />
        </span>
        <button
          onClick={onDelete}
          className="ml-auto rounded-md p-1 text-muted-foreground/60 opacity-0 transition-all duration-300 hover:bg-white/5 hover:text-[hsl(350_62%_74%)] group-hover:opacity-100 focus:opacity-100 max-md:hidden"
          aria-label="Delete note"
          data-testid={`button-delete-note-${note.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="sky-glass w-48 rounded-xl border-0 p-1.5"
        data-testid={`menu-note-${note.id}`}
      >
        <button className={MENU_ITEM} onClick={() => { setMenuOpen(false); onTogglePin(); }} data-testid={`button-pin-note-${note.id}`}>
          {note.pinned ? <PinOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Pin className="h-3.5 w-3.5 text-muted-foreground" />}
          {note.pinned ? "Unpin" : "Pin"}
        </button>
        <button className={MENU_ITEM} onClick={() => { setMenuOpen(false); window.setTimeout(() => setEditing(true), 60); }} data-testid={`button-edit-note-${note.id}`}>
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" /> Edit
        </button>
        <button className={`${MENU_ITEM} text-[hsl(350_62%_78%)]`} onClick={() => { setMenuOpen(false); onDelete(); }} data-testid={`button-menu-delete-note-${note.id}`}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </PopoverContent>
      </Popover>
      {editing ? (
        <div>
          <textarea
            ref={taRef}
            rows={1}
            value={body}
            maxLength={NOTE_MAX}
            onChange={(e) => change(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.stopPropagation(); e.currentTarget.blur(); return; }
              formatKeyDown(e, change);
            }}
            onBlur={() => { clearTimeout(timer.current); flush(); setEditing(false); }}
            className="quiet-input w-full resize-none overflow-hidden text-[14px] leading-relaxed text-foreground/90"
            data-testid={`input-note-${note.id}`}
          />
          <div className="mt-1 pb-1">
            <FormatBar target={taRef} setValue={change} words={wordCount(body)} />
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) setEditing(true); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setEditing(true); } }}
          className="cursor-text text-[14px] leading-relaxed text-foreground/90 outline-none max-md:select-none"
          style={{ WebkitTouchCallout: "none" }}
          title="Click to edit"
          data-testid={`text-note-${note.id}`}
        >
          {body.trim() ? <FormattedNote body={body} query={query} /> : <span className="text-muted-foreground/60">Empty note</span>}
        </div>
      )}
    </li>
  );
}

type Props = {
  star: Star;
  sky: Sky;
  roots: Map<number, number>;
  actions: SkyActions;
  onClose: () => void;
  onStartConnect: (starId: number) => void;
  sheetHeight: "full" | "half";
  onSheetHeightChange: (height: "full" | "half") => void;
  narrow: boolean;
  /** A note to scroll to and briefly highlight (e.g. from "On this day"). */
  focusNoteId?: number | null;
  tab: CardTab;
  onTabChange: (tab: CardTab) => void;
  /** Opens another star (from the constellation chips). */
  onSwitchStar: (id: number) => void;
  /** Named constellations, for the switcher above the chips. */
  constellations: ConstellationView[];
  onPickConstellation: (cv: ConstellationView) => void;
  /** After "Move to constellation" places the star in its new home, so the view can follow it. */
  onStarMoved: (star: Star) => void;
  /** A one-time tip shown just under the Notes / Tasks tabs. */
  tip?: React.ReactNode;
};

export type CardTab = "notes" | "tasks";

/** Chips for the stars in this star's constellation, current one highlighted. */
function StarSwitcher({ members, currentId, colorOf, onPick }: { members: Star[]; currentId: number; colorOf: (s: Star) => string; onPick: (id: number) => void }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = row.current?.querySelector<HTMLElement>(`[data-chip-id="${currentId}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [currentId]);
  return (
    <div ref={row} className="no-scrollbar flex gap-1.5 overflow-x-auto px-5 pt-1 max-md:pt-0 md:px-6" data-testid="star-switcher">
      {members.map((m) => {
        const c = colorOf(m);
        const current = m.id === currentId;
        return (
          <button
            key={m.id}
            data-chip-id={m.id}
            onClick={() => !current && onPick(m.id)}
            aria-current={current ? "true" : undefined}
            className="group flex h-8 max-w-[10rem] shrink-0 items-center outline-none max-md:h-11 max-md:max-w-[9rem]"
            data-testid={`chip-star-${m.id}`}
          >
            <span className={`flex h-8 min-w-0 items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors duration-300 group-focus-visible:ring-1 group-focus-visible:ring-white/20 ${current ? "border-white/[0.14] bg-white/[0.09] text-foreground" : "border-white/[0.06] text-muted-foreground group-hover:bg-white/[0.05] group-hover:text-foreground"}`}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c, boxShadow: current ? `0 0 8px ${c}` : undefined }} />
              <span className="truncate">{m.title}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * One thin line naming this star's constellation, tinted like its name on the sky. It opens a list of
 * all constellations to fly to, plus naming actions; renaming happens in place on the same line.
 */
function ConstellationSwitcher({ name, tint, all, currentId, tintOf, onPick, onRename, onRemoveName, className = "" }: {
  name: string | null;
  tint: [number, number, number];
  all: ConstellationView[];
  currentId: number | null;
  tintOf: (cv: ConstellationView) => [number, number, number];
  onPick: (cv: ConstellationView) => void;
  /** Saves a new name (or the first name of an unnamed constellation). */
  onRename: (name: string) => void;
  onRemoveName: () => void;
  className?: string;
}) {
  const rgb = tint.join(",");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const skipSave = useRef(false);
  useEffect(() => {
    if (!editing) return;
    // Wait for the menu to finish closing before taking focus.
    const t = window.setTimeout(() => { input.current?.focus(); input.current?.select(); }, 30);
    return () => clearTimeout(t);
  }, [editing]);
  const finish = () => {
    if (!skipSave.current) {
      const n = draft.trim();
      if (n && n !== name) onRename(n);
    }
    skipSave.current = false;
    setEditing(false);
  };

  if (editing) {
    return (
      <div className={`flex h-11 min-w-0 items-center md:h-8 ${className}`}>
        <input
          ref={input}
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); input.current?.blur(); }
            if (e.key === "Escape") { e.stopPropagation(); skipSave.current = true; input.current?.blur(); }
          }}
          placeholder="Name this constellation"
          aria-label="Constellation name"
          className="quiet-input min-w-0 flex-1 border-b border-white/15 pb-0.5 text-[12px] font-medium uppercase tracking-[0.14em] placeholder:normal-case placeholder:tracking-normal"
          style={{ color: `rgb(${rgb})` }}
          data-testid="input-constellation-rename"
        />
      </div>
    );
  }
  return (
    <div className={`min-w-0 ${className}`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="-mx-1 flex h-11 max-w-full items-center gap-1.5 rounded-lg px-1 text-[11px] font-medium uppercase tracking-[0.16em] outline-none transition-opacity hover:opacity-100 focus-visible:ring-1 focus-visible:ring-white/20 md:h-8"
            style={{ color: `rgba(${rgb},${name ? 0.85 : 0.5})` }}
            aria-label={name ? `Constellation ${name}. Switch or rename` : "Unnamed constellation. Switch or name"}
            data-testid="button-constellation-switcher"
          >
            <span className="truncate">{name ?? "Unnamed constellation"}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-80" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={4}
          className="sheet-panel max-h-[50dvh] w-64 overflow-y-auto rounded-2xl p-1.5"
          data-testid="menu-constellations"
        >
          <div className="px-3 pb-1 pt-1 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/70">Constellations</div>
          {all.length ? all.map((cv) => {
            const c = tintOf(cv).join(",");
            const current = cv.id === currentId;
            return (
              <DropdownMenuItem
                key={cv.id}
                onSelect={() => { if (!current) onPick(cv); }}
                className={`min-h-11 gap-3 rounded-lg px-3 text-[13.5px] md:min-h-9 ${current ? "text-foreground" : "text-foreground/80"}`}
                data-testid={`menu-constellation-${cv.id}`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: `rgb(${c})`, boxShadow: current ? `0 0 8px rgb(${c})` : undefined }} />
                <span className="flex-1 truncate">{cv.name}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground/70">{current ? "Here" : cv.members.length}</span>
              </DropdownMenuItem>
            );
          }) : (
            <div className="px-3 py-2.5 text-[12.5px] text-muted-foreground/75">No named constellations yet.</div>
          )}
          <DropdownMenuSeparator className="my-1 bg-white/[0.07]" />
          <DropdownMenuItem
            onSelect={() => { setDraft(name ?? ""); skipSave.current = false; setEditing(true); }}
            className="min-h-11 gap-3 rounded-lg px-3 text-[13.5px] text-foreground/85 md:min-h-9"
            data-testid="menu-constellation-rename"
          >
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" /> {name ? "Rename" : "Name"}
          </DropdownMenuItem>
          {name && (
            <DropdownMenuItem
              onSelect={onRemoveName}
              className="min-h-11 gap-3 rounded-lg px-3 text-[13.5px] text-foreground/85 md:min-h-9"
              data-testid="menu-constellation-remove-name"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" /> Remove name
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default function JournalCard({ star, sky, roots, actions, onClose, onStartConnect, sheetHeight, onSheetHeightChange, narrow, focusNoteId, tab, onTabChange, onSwitchStar, constellations, onPickConstellation, onStarMoved, tip }: Props) {
  const qc = useQueryClient();
  const notesKey = getListStarNotesQueryKey(star.id);
  const notesQ = useListStarNotes(star.id, { query: { enabled: !!star.id, queryKey: notesKey } });
  const createNote = useCreateNote({ mutation: { onSuccess: (_n, v) => clearDraftIfSent(draftKeys.note(v.starId), v.data.body) } });

  const [title, setTitle] = useState(star.title);
  const titleTimer = useRef<number>(0);
  const pendingTitle = useRef<string | null>(null);
  const renameRef = useRef(actions.renameStar);
  renameRef.current = actions.renameStar;
  const flushTitle = (id: number) => {
    const v = pendingTitle.current;
    if (v == null) return;
    pendingTitle.current = null;
    renameRef.current(id, v.trim() || "Untitled star");
  };
  useEffect(() => {
    setTitle(star.title);
    const id = star.id;
    return () => { clearTimeout(titleTimer.current); flushTitle(id); };
  }, [star.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The note being written is kept as a draft for this star until it's saved.
  const [draft, setDraft] = useDraft(draftKeys.note(star.id));
  const [composerOpen, setComposerOpen] = useState(() => !window.matchMedia("(max-width: 767px)").matches || !!readDraft(draftKeys.note(star.id)));
  const composerExpanded = !narrow || composerOpen;
  const draftRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => autosize(draftRef.current), [draft]);
  const listEnd = useRef<HTMLDivElement>(null);
  const scrolledStar = useRef<number | null>(null);
  useEffect(() => {
    if (focusNoteId != null || !notesQ.data || scrolledStar.current === star.id) return;
    scrolledStar.current = star.id;
    if (window.matchMedia("(max-width: 767px)").matches) {
      const t = window.setTimeout(() => listEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 100);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [star.id, notesQ.data, focusNoteId]);

  const { onSheetHandleDown, onSheetHandleMove, onSheetHandleUp, onSheetHandleCancel } = useSheetDrag(sheetHeight, onSheetHeightChange, onClose);
  const titleRef = useRef<HTMLInputElement>(null);
  /** A panel opened from the ⋯ menu, shown next to it. */
  const [menuPanel, setMenuPanel] = useState<"move" | null>(null);

  // Search within this star's notes and tasks.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setSearchOpen(false); setQuery(""); setMenuPanel(null); }, [star.id]);
  const closeSearch = () => { setSearchOpen(false); setQuery(""); };

  const pendingDeletes = usePendingDeletes();

  const addNote = () => {
    const body = draft.trim();
    if (!body) return;
    createNote.mutate(
      { starId: star.id, data: { body } },
      {
        onSuccess: (n) => {
          qc.setQueryData<Note[]>(notesKey, (old) => [...(old ?? []), n]);
          actions.touchStar(star.id, 1);
          qc.invalidateQueries({ queryKey: getGetSkyStatsQueryKey() });
          setDraft("");
          setComposerOpen(false);
          window.setTimeout(() => listEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 60);
        },
      },
    );
  };
  const [confirmNote, setConfirmNote] = useState<Note | null>(null);
  const removeNote = (n: Note) => {
    const starId = star.id;
    const snippet = n.body.replace(/[*\n]+/g, " ").trim();
    scheduleDelete(
      { kind: "note", id: n.id, starId, label: snippet ? `Note "${snippet.length > 28 ? snippet.slice(0, 27) + "…" : snippet}"` : "Note" },
      () => {
        qc.setQueryData<Note[]>(getListStarNotesQueryKey(starId), (old) => old?.filter((x) => x.id !== n.id));
        qc.setQueryData<Sky>(getGetSkyQueryKey(), (old) =>
          old
            ? { ...old, stars: old.stars.map((s) => (s.id === starId ? { ...s, noteCount: Math.max(0, s.noteCount - 1), updatedAt: new Date().toISOString() } : s)) }
            : old,
        );
        qc.invalidateQueries({ queryKey: getGetSkyStatsQueryKey() });
      },
    );
  };

  // labels
  const [newLabel, setNewLabel] = useState<{ name: string; color: string } | null>(null);
  const [dotPickerOpen, setDotPickerOpen] = useState(false);
  const label = sky.labels.find((l) => l.id === star.labelId) ?? null;

  // constellation
  const root = roots.get(star.id);
  const members = useMemo(() => sky.stars.filter((s) => roots.get(s.id) === root), [sky.stars, roots, root]);
  const colorOfStar = (s: Star) => (s.labelId == null ? DEFAULT_STAR : sky.labels.find((l) => l.id === s.labelId)?.color ?? DEFAULT_STAR);
  const starTasks = useMemo(() => sky.tasks.filter((t) => t.starId === star.id), [sky.tasks, star.id]);
  const doneCount = starTasks.filter((t) => t.done).length;
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  useEffect(() => setOpenTaskId(null), [star.id]);
  const constellation = sky.constellations.find((c) => roots.get(c.anchorStarId) === root) ?? null;
  const starById = useMemo(() => new Map(sky.stars.map((s) => [s.id, s])), [sky.stars]);
  const tintOf = (ids: number[]) => constellationTint(ids.map((id) => starById.get(id)).filter((s): s is Star => !!s).map(colorOfStar));
  const [cName, setCName] = useState(constellation?.name ?? "");
  useEffect(() => setCName(constellation?.name ?? ""), [constellation?.id, constellation?.name]);
  const saveConstellation = () => {
    const n = cName.trim();
    if (!n) return;
    if (constellation) { if (n !== constellation.name) actions.renameConstellation(constellation.id, n); }
    else actions.nameConstellation(n, star.id);
  };

  const renameConstellation = (n: string) => {
    if (constellation) actions.renameConstellation(constellation.id, n);
    else actions.nameConstellation(n, star.id);
  };

  // Phone: while the keyboard is up, the constellation line and chips step aside.
  const keyboard = useKeyboardInset();
  const typing = narrow && keyboard.inset > 0 && !document.activeElement?.matches("[data-testid=input-constellation-rename]");

  const [confirm, setConfirm] = useState(false);
  const hiddenNotes = useMemo(() => new Set(pendingDeletes.filter((p) => p.kind === "note").map((p) => p.id)), [pendingDeletes]);
  // Pinned notes stay at the top of the thread (oldest pin first); the rest keep their order.
  const notes = useMemo(() => {
    const all = (notesQ.data ?? []).filter((n) => !hiddenNotes.has(n.id));
    return [...all.filter((n) => n.pinned), ...all.filter((n) => !n.pinned)];
  }, [notesQ.data, hiddenNotes]);
  const updateNote = useUpdateNote();
  const togglePin = (n: Note) => {
    const key = getListStarNotesQueryKey(n.starId);
    const pinned = !n.pinned;
    qc.setQueryData<Note[]>(key, (old) => old?.map((x) => (x.id === n.id ? { ...x, pinned } : x)));
    updateNote.mutate(
      { noteId: n.id, data: { pinned } },
      {
        onError: () => {
          qc.setQueryData<Note[]>(key, (old) => old?.map((x) => (x.id === n.id ? { ...x, pinned: !pinned } : x)));
          toast({ title: "Couldn't pin that note", description: "Please try again." });
        },
      },
    );
  };

  const q = query.trim();
  const noteHits = q ? notes.filter((n) => matchesQuery(n.body, q)).length : 0;
  const taskHits = q ? starTasks.filter((t) => matchesQuery(t.title, q)).length : 0;
  // Bring the first match into view, switching tabs when only the other one has matches.
  useEffect(() => {
    if (!q) return;
    if (tab === "notes" && !noteHits && taskHits) onTabChange("tasks");
    else if (tab === "tasks" && !taskHits && noteHits) onTabChange("notes");
    const t = window.setTimeout(() => {
      document.querySelector("[data-testid=card-journal] .search-hit")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => clearTimeout(t);
  }, [q, noteHits, taskHits]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The star's title, notes and tasks as plain text. */
  const copyAsText = async () => {
    const lines: string[] = [title.trim() || star.title];
    const meta = [label?.name, constellation?.name].filter(Boolean);
    if (meta.length) lines.push(meta.join(" · "));
    if (notes.length) {
      lines.push("", "Notes");
      for (const n of notes) lines.push("", `${formatStamp(n.createdAt)}${n.pinned ? " (pinned)" : ""}`, plainNote(n.body).trim());
    }
    if (starTasks.length) {
      lines.push("", "Tasks");
      const open = orderedOpenTasks(starTasks, star.taskOrder);
      for (const t of [...open, ...starTasks.filter((x) => x.done)]) {
        const due = t.dueDate && !t.done ? ` (${formatDue(t.dueDate)})` : "";
        lines.push(`[${t.done ? "x" : " "}] ${t.title}${due}`);
      }
    }
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) { toast({ title: "Couldn't copy", description: "Your browser blocked the clipboard." }); return; }
    }
    toast({ title: "Copied as text" });
  };

  /** Detaches this star from its lines, places it beside the nearest star of another constellation and connects them. */
  const moveTo = (cv: ConstellationView) => {
    const targets = cv.members.map((id) => starById.get(id)).filter((m): m is Star => !!m && m.id !== star.id);
    if (!targets.length) return;
    const near = targets.reduce((best, m) => (Math.hypot(m.x - star.x, m.y - star.y) < Math.hypot(best.x - star.x, best.y - star.y) ? m : best));
    const mine = sky.connections.filter((c) => c.fromStarId === star.id || c.toStarId === star.id);
    // If this star holds the current constellation's name, hand the name to a neighbour that stays behind.
    if (constellation && constellation.anchorStarId === star.id && members.length > 2) {
      const neighbour = mine.map((c) => (c.fromStarId === star.id ? c.toStarId : c.fromStarId))[0];
      actions.removeConstellation(constellation.id);
      if (neighbour != null) actions.nameConstellation(constellation.name, neighbour);
    }
    for (const c of mine) actions.disconnect(c.id);
    // Choose the open direction around the target star.
    const others = sky.stars.filter((o) => o.id !== star.id && o.id !== near.id);
    let spot = { x: near.x + 110, y: near.y };
    let room = -1;
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2;
      const p = { x: near.x + Math.cos(ang) * 110, y: near.y + Math.sin(ang) * 110 };
      const r = others.reduce((m, o) => Math.min(m, Math.hypot(o.x - p.x, o.y - p.y)), Infinity);
      if (r > room) { room = r; spot = p; }
    }
    const x = Math.round(spot.x), y = Math.round(spot.y);
    actions.moveStar(star.id, x, y);
    actions.connect(star.id, near.id);
    onStarMoved({ ...star, x, y });
    toast({ title: `Moved to ${cv.name}` });
  };


  // Scroll to and briefly highlight a requested note.
  const [glowNote, setGlowNote] = useState<number | null>(null);
  useEffect(() => {
    if (focusNoteId == null || !notes.some((n) => n.id === focusNoteId)) return;
    setGlowNote(focusNoteId);
    const t1 = window.setTimeout(() => {
      document.querySelector(`[data-note-id="${focusNoteId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    const t2 = window.setTimeout(() => setGlowNote(null), 3200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [focusNoteId, notes.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const dot = label?.color ?? DEFAULT_STAR;

  /** Label list + new-label form, shared by the color dot and the phone label chip. */
  const labelMenu = (close: () => void) => (
    <>
      <div className="mb-1 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">Choose a label</div>
      <button
        onClick={() => { actions.setStarLabel(star.id, null); close(); }}
        className="flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12.5px] text-foreground/85 hover:bg-white/[0.06]"
        data-testid="button-label-none"
      >
        <span className="h-2 w-2 rounded-full" style={{ background: DEFAULT_STAR }} /> Unlabeled
      </button>
      {sky.labels.map((l) => (
        <button
          key={l.id}
          onClick={() => { actions.setStarLabel(star.id, l.id); close(); }}
          className={`flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12.5px] hover:bg-white/[0.06] ${star.labelId === l.id ? "text-foreground" : "text-foreground/80"}`}
          data-testid={`button-label-${l.id}`}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
          {l.name}
        </button>
      ))}
      {!newLabel && (
        <button
          onClick={() => setNewLabel({ name: "", color: PALETTE[sky.labels.length % PALETTE.length].hex })}
          className="mt-1 flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[12px] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
          data-testid="button-new-label-inline"
        >
          <Plus className="h-3 w-3" /> New label
        </button>
      )}
      {newLabel && (
        <div className="mt-1 rounded-xl bg-white/[0.04] p-3">
          <input
            autoFocus
            value={newLabel.name}
            maxLength={40}
            onChange={(e) => setNewLabel({ ...newLabel, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newLabel.name.trim()) {
                actions.addLabel(newLabel.name.trim(), newLabel.color, (l) => { actions.setStarLabel(star.id, l.id); close(); });
                setNewLabel(null);
              }
              if (e.key === "Escape") { e.stopPropagation(); setNewLabel(null); }
            }}
            placeholder="Label name"
            className="quiet-input mb-2.5 w-full text-[13px]"
            data-testid="input-new-label-name"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {PALETTE.map((p) => (
              <button
                key={p.hex}
                title={p.name}
                onClick={() => setNewLabel({ ...newLabel, color: p.hex })}
                className={`h-5 w-5 rounded-full transition-transform duration-300 soft-ease ${newLabel.color === p.hex ? "scale-110 ring-2 ring-white/50 ring-offset-2 ring-offset-[#111114]" : "hover:scale-110"}`}
                style={{ background: p.hex }}
              />
            ))}
            <div className="ml-auto flex gap-1">
              <button onClick={() => setNewLabel(null)} className="rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground">Cancel</button>
              <button
                disabled={!newLabel.name.trim()}
                onClick={() => {
                  actions.addLabel(newLabel.name.trim(), newLabel.color, (l) => { actions.setStarLabel(star.id, l.id); close(); });
                  setNewLabel(null);
                }}
                className="rounded-md bg-primary/90 px-2.5 py-1 text-[12px] font-medium text-primary-foreground disabled:opacity-40"
                data-testid="button-create-label-inline"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const closeButton = (
    <button onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground md:-mr-2 md:h-9 md:w-9" aria-label="Close" data-testid="button-close-card">
      <X className="h-4 w-4" />
    </button>
  );

  return (
    <div className="sky-glass relative flex h-full max-h-full flex-col overflow-hidden rounded-[22px]" data-testid="card-journal">
      {narrow && (
        <div
          className="flex h-6 w-full shrink-0 touch-none items-center justify-center"
          onPointerDown={onSheetHandleDown}
          onPointerMove={onSheetHandleMove}
          onPointerUp={onSheetHandleUp}
          onPointerCancel={onSheetHandleCancel}
          data-testid="sheet-drag-handle"
        >
          <span className="h-1 w-10 rounded-full bg-white/20" />
        </div>
      )}
      {(() => {
        const switcher = (
          <ConstellationSwitcher
            name={constellation?.name ?? null}
            tint={tintOf(members.map((m) => m.id))}
            all={constellations}
            currentId={constellation?.id ?? null}
            tintOf={(cv) => tintOf(cv.members)}
            onPick={onPickConstellation}
            onRename={renameConstellation}
            onRemoveName={() => { if (constellation) actions.removeConstellation(constellation.id); }}
            className={narrow ? "flex-1" : "px-6"}
          />
        );
        const chips = <StarSwitcher members={members} currentId={star.id} colorOf={colorOfStar} onPick={onSwitchStar} />;
        if (!narrow) return members.length > 1 ? <div className="pt-3">{switcher}{chips}</div> : null;
        // Phone: the constellation line carries the close button; it steps aside while the keyboard is up.
        if (typing) return null;
        return (
          <div data-testid="card-top">
            <div className="flex items-center gap-2 pl-5 pr-3">
              {members.length > 1 ? switcher : (
                <button
                  onClick={() => onStartConnect(star.id)}
                  className="-mx-1 flex h-11 min-w-0 flex-1 items-center rounded-lg px-1 text-left text-[12.5px] text-muted-foreground/70 outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-white/20"
                  data-testid="button-start-constellation"
                >
                  <span className="truncate">Connect to a star to start a constellation.</span>
                </button>
              )}
              {closeButton}
            </div>
            {members.length > 1 && chips}
          </div>
        );
      })()}
      <div
        className={narrow ? "relative flex items-center gap-0.5 py-0.5 pl-5 pr-3" : `relative flex items-center gap-0.5 px-6 pb-3 ${members.length > 1 ? "pt-3" : "pt-5"}`}
        data-testid="card-title-row"
      >
        <Popover open={dotPickerOpen} onOpenChange={(o) => { setDotPickerOpen(o); if (!o) setNewLabel(null); }}>
          <PopoverTrigger asChild>
            <button
              className="-ml-2 flex h-11 w-7 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-white/25 md:h-9"
              aria-label={`Label and color: ${label?.name ?? "Unlabeled"}. Change`}
              title="Change label and color"
              data-testid="button-star-color"
            >
              <span className="h-2.5 w-2.5 rounded-full transition-colors duration-700" style={{ background: dot, boxShadow: `0 0 10px ${dot}` }} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" className="sky-glass w-64 rounded-2xl border-0 p-2">
            {labelMenu(() => setDotPickerOpen(false))}
          </PopoverContent>
        </Popover>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            pendingTitle.current = e.target.value;
            clearTimeout(titleTimer.current);
            const id = star.id;
            titleTimer.current = window.setTimeout(() => flushTitle(id), 600);
          }}
          ref={titleRef}
          maxLength={200}
          placeholder="Name this star"
          className={`quiet-input min-w-0 flex-1 font-medium tracking-[-0.015em] text-foreground ${narrow ? "text-[20px]" : "text-[21px]"}`}
          data-testid="input-star-title"
        />
        {narrow && (
          <button
            onClick={() => onStartConnect(star.id)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground md:h-9 md:w-9"
            aria-label="Connect this star"
            title="Connect"
            data-testid="button-connect-from-card"
          >
            <Link2 className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => { if (searchOpen) closeSearch(); else { setSearchOpen(true); window.setTimeout(() => searchRef.current?.focus(), 30); } }}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground md:h-9 md:w-9 ${searchOpen ? "bg-white/[0.07] text-foreground" : ""}`}
          aria-label="Search this star"
          aria-pressed={searchOpen}
          title="Search notes and tasks"
          data-testid="button-search-star"
        >
          <Search className="h-4 w-4" />
        </button>
        <Popover open={menuPanel != null} onOpenChange={(o) => { if (!o) setMenuPanel(null); }}>
          <DropdownMenu>
            <PopoverAnchor asChild>
              <DropdownMenuTrigger asChild>
                <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground md:h-9 md:w-9" aria-label="More star actions" data-testid="button-star-menu">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
            </PopoverAnchor>
            <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()} className="sky-glass min-w-52 rounded-xl border-0 p-1.5" data-testid="menu-star">
              <DropdownMenuItem
                onSelect={() => window.setTimeout(() => { titleRef.current?.focus(); titleRef.current?.select(); }, 30)}
                className="min-h-11 gap-2.5 rounded-lg text-[13.5px] text-foreground/90 md:min-h-9"
                data-testid="menu-rename-star"
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => window.setTimeout(() => setDotPickerOpen(true), 30)}
                className="min-h-11 gap-2.5 rounded-lg text-[13.5px] text-foreground/90 md:min-h-9"
                data-testid="menu-change-label"
              >
                <Palette className="h-3.5 w-3.5 text-muted-foreground" /> Change color or label
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => { void copyAsText(); }}
                className="min-h-11 gap-2.5 rounded-lg text-[13.5px] text-foreground/90 md:min-h-9"
                data-testid="menu-copy-star"
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" /> Copy as text
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => window.setTimeout(() => setMenuPanel("move"), 30)}
                className="min-h-11 gap-2.5 rounded-lg text-[13.5px] text-foreground/90 md:min-h-9"
                data-testid="menu-move-star"
              >
                <Orbit className="h-3.5 w-3.5 text-muted-foreground" /> Move to constellation
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1 bg-white/[0.07]" />
              <DropdownMenuItem
                onSelect={() => setConfirm(true)}
                className="min-h-11 gap-2.5 rounded-lg text-[13.5px] text-[hsl(350_62%_78%)] focus:text-[hsl(350_62%_78%)] md:min-h-9"
                data-testid="menu-delete-star"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete star
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <PopoverContent side="bottom" align="end" onOpenAutoFocus={(e) => e.preventDefault()} className="sky-glass w-[min(18rem,84vw)] rounded-2xl border-0 p-1.5" data-testid="panel-move-star">
            <div className="px-2 pb-1 pt-1.5 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/70">Move to constellation</div>
            {(() => {
              const others = constellations.filter((cv) => !cv.members.includes(star.id));
              if (!others.length) return <div className="px-2 py-2.5 text-[12.5px] text-muted-foreground/75">No other named constellations yet.</div>;
              return (
                <ul className="thin-scroll max-h-60 overflow-y-auto">
                  {others.map((cv) => {
                    const c = tintOf(cv.members).join(",");
                    return (
                      <li key={cv.id}>
                        <button
                          onClick={() => { setMenuPanel(null); moveTo(cv); }}
                          className={MENU_ITEM}
                          data-testid={`button-move-to-${cv.id}`}
                        >
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: `rgb(${c})` }} />
                          <span className="flex-1 truncate">{cv.name}</span>
                          <span className="text-[11px] tabular-nums text-muted-foreground/70">{cv.members.length}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
          </PopoverContent>
        </Popover>
        {!narrow && closeButton}
      </div>

      {searchOpen && (
        <div className={narrow ? "px-4 pb-2" : "px-5 pb-3"} data-testid="star-search">
          <div className="flex h-10 items-center gap-2 rounded-xl bg-white/[0.05] pl-3 pr-1 transition-colors focus-within:bg-white/[0.07] max-md:h-11">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeSearch(); } }}
              placeholder="Search notes and tasks"
              aria-label="Search this star's notes and tasks"
              enterKeyHint="search"
              className="quiet-input min-w-0 flex-1 text-[13.5px]"
              data-testid="input-star-search"
            />
            {q && (
              <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground" data-testid="text-search-count">
                {noteHits + taskHits === 0
                  ? "No matches"
                  : [noteHits && `${noteHits} ${noteHits === 1 ? "note" : "notes"}`, taskHits && `${taskHits} ${taskHits === 1 ? "task" : "tasks"}`].filter(Boolean).join(" · ")}
              </span>
            )}
            <button onClick={closeSearch} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11" aria-label="Close search" data-testid="button-close-star-search">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {!narrow && (
        <>
          <div className="px-6 pb-4 text-[11.5px] text-muted-foreground/80">
            Lit {formatStamp(star.createdAt)} · {star.noteCount} {star.noteCount === 1 ? "note" : "notes"}
          </div>
          {/* label picker */}
          <div className="px-6 pb-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => actions.setStarLabel(star.id, null)}
              className={`rounded-full px-2.5 py-1 text-[12px] transition-all duration-300 ${star.labelId == null ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"}`}
              data-testid="button-label-none"
            >
              Unlabeled
            </button>
            {sky.labels.map((l) => (
              <button
                key={l.id}
                onClick={() => actions.setStarLabel(star.id, l.id)}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-all duration-300 ${star.labelId === l.id ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"}`}
                data-testid={`button-label-${l.id}`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
                {l.name}
              </button>
            ))}
            {!newLabel && (
              <button
                onClick={() => setNewLabel({ name: "", color: PALETTE[sky.labels.length % PALETTE.length].hex })}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] text-muted-foreground/80 hover:bg-white/5 hover:text-foreground"
                data-testid="button-new-label-inline"
              >
                <Plus className="h-3 w-3" /> Label
              </button>
            )}
            {newLabel && (
              <div className="mt-2 w-full rounded-xl bg-white/[0.04] p-3">
                <input
                  autoFocus
                  value={newLabel.name}
                  maxLength={40}
                  onChange={(e) => setNewLabel({ ...newLabel, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newLabel.name.trim()) {
                      actions.addLabel(newLabel.name.trim(), newLabel.color, (l) => actions.setStarLabel(star.id, l.id));
                      setNewLabel(null);
                    }
                    if (e.key === "Escape") { e.stopPropagation(); setNewLabel(null); }
                  }}
                  placeholder="Label name"
                  className="quiet-input mb-2.5 w-full text-[13px]"
                  data-testid="input-new-label-name"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {PALETTE.map((p) => (
                    <button
                      key={p.hex}
                      title={p.name}
                      onClick={() => setNewLabel({ ...newLabel, color: p.hex })}
                      className={`h-5 w-5 rounded-full transition-transform duration-300 soft-ease ${newLabel.color === p.hex ? "scale-110 ring-2 ring-white/50 ring-offset-2 ring-offset-[#111114]" : "hover:scale-110"}`}
                      style={{ background: p.hex }}
                    />
                  ))}
                  <div className="ml-auto flex gap-1">
                    <button onClick={() => setNewLabel(null)} className="rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground">Cancel</button>
                    <button
                      disabled={!newLabel.name.trim()}
                      onClick={() => {
                        actions.addLabel(newLabel.name.trim(), newLabel.color, (l) => actions.setStarLabel(star.id, l.id));
                        setNewLabel(null);
                      }}
                      className="rounded-md bg-primary/90 px-2.5 py-1 text-[12px] font-medium text-primary-foreground disabled:opacity-40"
                      data-testid="button-create-label-inline"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          </div>
        </>
      )}

      {/* tabs */}
      <div className={`relative flex items-end border-b border-white/[0.06] ${narrow ? "" : "gap-3 px-5"}`} role="tablist">
        {tip}
        {(["notes", "tasks"] as const).map((t) => {
          const count = t === "tasks"
            ? (starTasks.length > 0 ? `${doneCount}/${starTasks.length}` : null)
            : (narrow && star.noteCount > 0 ? String(star.noteCount) : null);
          return (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => onTabChange(t)}
              className={`relative -mb-px flex min-h-11 items-center gap-1.5 border-b-2 pb-2.5 pt-2 text-[13px] transition-colors duration-300 ${narrow ? "flex-1 justify-center" : "px-1"} ${tab === t ? "text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              style={tab === t ? { borderColor: dot } : undefined}
              data-testid={`tab-${t}`}
            >
              {t === "notes" ? "Notes" : "Tasks"}
              {count && <span className="tabular-nums text-muted-foreground/80" data-testid={`text-${t === "tasks" ? "task" : "note"}-count`}>{count}</span>}
            </button>
          );
        })}
      </div>

      {tab === "tasks" ? (
        <>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-6">
            <TaskList star={star} tasks={starTasks} color={dot} actions={actions} narrow={narrow} query={q} openTaskId={openTaskId} onOpenTask={(id) => { setOpenTaskId(id); if (narrow && id != null) onSheetHeightChange("full"); }} />
          </div>
          <div className="px-4 pb-3">
            <TaskComposer starId={star.id} actions={actions} />
          </div>
        </>
      ) : (
      <>
      {/* notes */}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {narrow && (
          <div className="mb-4 text-[11.5px] text-muted-foreground/70" data-testid="text-star-lit">Lit {formatStampShort(star.createdAt)}</div>
        )}
        {notesQ.isLoading ? (
          <div className="space-y-5">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-2.5 w-32 rounded-full bg-white/[0.06] breathe" />
                <div className="h-3 w-full rounded-full bg-white/[0.05] breathe" />
                <div className="h-3 w-2/3 rounded-full bg-white/[0.05] breathe" />
              </div>
            ))}
          </div>
        ) : notesQ.isError ? (
          <div className="text-[13px] text-muted-foreground">
            The notes didn't arrive.{" "}
            <button className="text-primary underline-offset-4 hover:underline" onClick={() => notesQ.refetch()}>Try again</button>
          </div>
        ) : notes.length === 0 ? (
          <p className="text-[13.5px] leading-relaxed text-muted-foreground/90">
            Nothing written here yet. Start the thread below; every note keeps its moment.
          </p>
        ) : (
          <ul className="space-y-6">
            {notes.map((n) => (
              <NoteRow key={n.id} note={n} focused={glowNote === n.id} onDelete={() => setConfirmNote(n)} onSaved={() => actions.touchStar(star.id)} onTogglePin={() => togglePin(n)} query={q} />
            ))}
          </ul>
        )}
        <div ref={listEnd} />
      </div>

      {/* composer */}
      <div className="px-4 pb-3">
        <div className="rounded-2xl bg-white/[0.045] px-4 py-3 transition-colors duration-500 focus-within:bg-white/[0.07]">
          <textarea
            ref={draftRef}
            rows={composerExpanded ? 2 : 1}
            value={draft}
            maxLength={NOTE_MAX}
            onFocus={() => setComposerOpen(true)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(); return; }
              formatKeyDown(e, setDraft);
            }}
            placeholder="Write something down..."
            className={`quiet-input thin-scroll w-full resize-none text-[14px] leading-relaxed ${composerExpanded ? "max-h-[38vh]" : "max-h-[1.8rem] overflow-hidden"}`}
            data-testid="input-new-note"
          />
          {composerExpanded && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <FormatBar target={draftRef} setValue={setDraft} words={wordCount(draft)}>
                <span className="ml-2 text-[11px] text-muted-foreground/40 max-sm:hidden">· Ctrl + Enter to add</span>
              </FormatBar>
              <button
                onClick={addNote}
                disabled={!draft.trim() || createNote.isPending}
                className="rounded-full bg-primary px-3.5 py-1.5 text-[12.5px] font-medium text-primary-foreground transition-all duration-300 hover:brightness-105 disabled:opacity-30"
                data-testid="button-add-note"
              >
                Add note
              </button>
            </div>
          )}
        </div>
      </div>
      </>
      )}

      {/* footer (desktop): constellation name + delete */}
      <div className={`${narrow ? "hidden" : "flex"} flex-wrap items-center gap-3 border-t border-white/[0.06] px-6 py-3.5 text-[12px]`}>
        {members.length > 1 ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-muted-foreground/70">{members.length} stars ·</span>
            <input
              value={cName}
              maxLength={60}
              onChange={(e) => setCName(e.target.value)}
              onBlur={saveConstellation}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              placeholder="Name this constellation"
              className="quiet-input min-w-0 flex-1 text-[12.5px] tracking-[0.06em] text-[hsl(258_60%_86%)]"
              data-testid="input-constellation-name"
            />
            {constellation && (
              <button
                onClick={() => actions.removeConstellation(constellation.id)}
                className="shrink-0 text-muted-foreground/70 hover:text-foreground"
                data-testid="button-remove-constellation"
              >
                Unname
              </button>
            )}
          </div>
        ) : (
          <span className="flex-1 text-muted-foreground/60">{narrow ? "Hold a star in the sky to connect it." : "Drag from a star's halo to connect it."}</span>
        )}
        {!narrow && (
          <button
            onClick={() => setConfirm(true)}
            className="flex items-center gap-1.5 text-muted-foreground/70 transition-colors hover:text-[hsl(350_62%_74%)]"
            data-testid="button-delete-star"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        )}
      </div>

      <AlertDialog open={confirmNote != null} onOpenChange={(o) => { if (!o) setConfirmNote(null); }}>
        <AlertDialogContent className="sky-glass max-w-sm rounded-2xl border-0">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-medium">Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmNote ? `Written ${formatStamp(confirmNote.createdAt)}. You'll have a few seconds to undo.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-white/10 bg-transparent">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-[hsl(350_55%_68%)] text-[hsl(35_45%_9%)] hover:bg-[hsl(350_55%_72%)]"
              onClick={() => { if (confirmNote) removeNote(confirmNote); setConfirmNote(null); }}
              data-testid="button-confirm-delete-note"
            >
              Delete note
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="sky-glass max-w-sm rounded-2xl border-0">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-medium">Let this star go?</AlertDialogTitle>
            <AlertDialogDescription>
              "{star.title}" and its {star.noteCount} {star.noteCount === 1 ? "note" : "notes"} will be removed from your sky, along with its lines. You'll have a few seconds to undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-white/10 bg-transparent">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-[hsl(350_55%_68%)] text-[hsl(35_45%_9%)] hover:bg-[hsl(350_55%_72%)]"
              onClick={() => { actions.removeStar(star.id, star.title); onClose(); }}
              data-testid="button-confirm-delete-star"
            >
              Delete star
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
