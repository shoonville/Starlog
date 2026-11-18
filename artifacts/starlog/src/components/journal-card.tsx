import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSkyQueryKey,
  getGetSkyStatsQueryKey,
  getListStarNotesQueryKey,
  useCreateNote,
  useListStarNotes,
  useUpdateNote,
  type Note,
  type Sky,
  type Star,
} from "@workspace/api-client-react";
import { Bold, Check, ChevronDown, Italic, Link2, List, MoreHorizontal, Plus, Search, Trash2, X } from "lucide-react";
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
import { DEFAULT_STAR, PALETTE, formatStamp } from "@/lib/sky";
import { FormattedNote, applyFormat, formatKeyDown, wordCount, type FormatKind } from "@/lib/note-format";
import { scheduleDelete, usePendingDeletes } from "@/lib/pending-deletes";
import type { SkyActions } from "@/hooks/use-sky-actions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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

function NoteRow({ note, focused, onDelete, onSaved }: { note: Note; focused: boolean; onDelete: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const update = useUpdateNote();
  const mutateRef = useRef(update.mutate);
  mutateRef.current = update.mutate;
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;
  const [body, setBody] = useState(note.body);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number>(0);
  const pending = useRef<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

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
    mutateRef.current(
      { noteId: note.id, data: { body: v } },
      {
        onSuccess: (n) => {
          qc.setQueryData<Note[]>(getListStarNotesQueryKey(note.starId), (old) =>
            old ? old.map((x) => (x.id === n.id ? n : x)) : old,
          );
          savedRef.current();
          setSaved(true);
          window.setTimeout(() => setSaved(false), 1400);
        },
      },
    );
  };
  useEffect(() => () => { clearTimeout(timer.current); flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (v: string) => {
    setBody(v);
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 700);
  };

  return (
    <li
      className={`group relative rounded-xl pl-5 transition-[background-color,box-shadow] duration-1000 soft-ease ${focused ? "note-glow" : ""}`}
      data-note-id={note.id}
      data-testid={`note-${note.id}`}
    >
      <span className="absolute left-0 top-[9px] h-1.5 w-1.5 rounded-full bg-[hsl(36_72%_82%/0.55)]" />
      <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground/80">
        <span data-testid={`text-note-time-${note.id}`}>{formatStamp(note.createdAt)}</span>
        {note.editedAt && <span className="opacity-70">· edited {formatStamp(note.editedAt)}</span>}
        <span className={`text-[hsl(150_30%_74%)] transition-opacity duration-700 soft-ease ${saved ? "opacity-100" : "opacity-0"}`}>
          <Check className="inline h-3 w-3" />
        </span>
        <button
          onClick={onDelete}
          className="ml-auto rounded-md p-1 text-muted-foreground/60 opacity-0 transition-all duration-300 hover:bg-white/5 hover:text-[hsl(350_62%_74%)] group-hover:opacity-100 focus:opacity-100 max-md:opacity-60"
          aria-label="Delete note"
          data-testid={`button-delete-note-${note.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {editing ? (
        <div>
          <textarea
            ref={taRef}
            rows={1}
            value={body}
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
          className="cursor-text text-[14px] leading-relaxed text-foreground/90 outline-none"
          title="Click to edit"
          data-testid={`text-note-${note.id}`}
        >
          {body.trim() ? <FormattedNote body={body} /> : <span className="text-muted-foreground/60">Empty note</span>}
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
};

export default function JournalCard({ star, sky, roots, actions, onClose, onStartConnect, sheetHeight, onSheetHeightChange, narrow, focusNoteId }: Props) {
  const qc = useQueryClient();
  const notesKey = getListStarNotesQueryKey(star.id);
  const notesQ = useListStarNotes(star.id, { query: { enabled: !!star.id, queryKey: notesKey } });
  const createNote = useCreateNote();

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

  const [draft, setDraft] = useState("");
  const [composerOpen, setComposerOpen] = useState(() => !window.matchMedia("(max-width: 767px)").matches);
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

  const sheetStartY = useRef<number | null>(null);
  const onSheetHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    sheetStartY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onSheetHandleUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (sheetStartY.current == null) return;
    const dy = e.clientY - sheetStartY.current;
    sheetStartY.current = null;
    if (dy > 60) {
      if (sheetHeight === "full" && dy < 180) onSheetHeightChange("half");
      else onClose();
    } else if (dy < -60) {
      onSheetHeightChange("full");
    }
  };
  const [connectPickerOpen, setConnectPickerOpen] = useState(false);
  const [connectQuery, setConnectQuery] = useState("");
  const connectableStars = useMemo(() => {
    const connected = new Set(sky.connections.flatMap((c) => c.fromStarId === star.id ? [c.toStarId] : c.toStarId === star.id ? [c.fromStarId] : []));
    const q = connectQuery.trim().toLocaleLowerCase();
    return sky.stars
      .filter((candidate) => candidate.id !== star.id && !connected.has(candidate.id) && (!q || candidate.title.toLocaleLowerCase().includes(q)))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [sky.stars, sky.connections, star.id, connectQuery]);

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
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const label = sky.labels.find((l) => l.id === star.labelId) ?? null;

  // constellation
  const root = roots.get(star.id);
  const members = useMemo(() => sky.stars.filter((s) => roots.get(s.id) === root), [sky.stars, roots, root]);
  const constellation = sky.constellations.find((c) => roots.get(c.anchorStarId) === root) ?? null;
  const [cName, setCName] = useState(constellation?.name ?? "");
  useEffect(() => setCName(constellation?.name ?? ""), [constellation?.id, constellation?.name]);
  const saveConstellation = () => {
    const n = cName.trim();
    if (!n) return;
    if (constellation) { if (n !== constellation.name) actions.renameConstellation(constellation.id, n); }
    else actions.nameConstellation(n, star.id);
  };

  const [confirm, setConfirm] = useState(false);
  const hiddenNotes = useMemo(() => new Set(pendingDeletes.filter((p) => p.kind === "note").map((p) => p.id)), [pendingDeletes]);
  const notes = useMemo(() => (notesQ.data ?? []).filter((n) => !hiddenNotes.has(n.id)), [notesQ.data, hiddenNotes]);

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

  return (
    <div className="sky-glass flex h-full max-h-full flex-col overflow-hidden rounded-[22px]" data-testid="card-journal">
      <div
        className="relative flex items-start gap-3 px-5 pb-3 pt-5 md:px-6 md:pt-6"
      >
        <div
          className="absolute left-1/2 top-2.5 z-10 hidden h-4 w-12 -translate-x-1/2 touch-none items-center justify-center max-md:flex"
          onPointerDown={onSheetHandleDown}
          onPointerUp={onSheetHandleUp}
          onPointerCancel={() => { sheetStartY.current = null; }}
          data-testid="sheet-drag-handle"
        >
          <span className="h-1 w-10 rounded-full bg-white/20" />
        </div>
        <span className="mt-[11px] h-2.5 w-2.5 shrink-0 transition-colors duration-700" style={{ background: dot, boxShadow: `0 0 14px ${dot}` }} />
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            pendingTitle.current = e.target.value;
            clearTimeout(titleTimer.current);
            const id = star.id;
            titleTimer.current = window.setTimeout(() => flushTitle(id), 600);
          }}
          maxLength={200}
          placeholder="Name this star"
          className="quiet-input min-w-0 flex-1 text-[21px] font-medium tracking-[-0.015em] text-foreground"
          data-testid="input-star-title"
        />
        <button
          onClick={() => onStartConnect(star.id)}
          className="mt-1 hidden h-8 shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-2.5 text-[11.5px] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground max-md:flex"
          aria-label="Connect this star"
          data-testid="button-connect-from-card"
        >
          <Link2 className="h-3.5 w-3.5" /><span>Connect</span>
        </button>
        <Popover open={connectPickerOpen} onOpenChange={setConnectPickerOpen}>
          <PopoverTrigger asChild>
            <button
              className="mt-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground max-md:flex"
              aria-label="Connect to another star"
              data-testid="button-connect-to"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="sky-glass w-[min(20rem,84vw)] rounded-2xl border-0 p-2.5">
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-white/[0.05] px-3 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground/70" />
              <input
                autoFocus
                value={connectQuery}
                onChange={(e) => setConnectQuery(e.target.value)}
                placeholder="Connect to…"
                aria-label="Search stars to connect"
                className="quiet-input min-w-0 flex-1 text-[13px]"
                data-testid="input-connect-search"
              />
            </div>
            <ul className="thin-scroll max-h-52 overflow-y-auto">
              {connectableStars.length ? connectableStars.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    onClick={() => { actions.connect(star.id, candidate.id); setConnectPickerOpen(false); setConnectQuery(""); }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] text-foreground/85 hover:bg-white/[0.06] hover:text-foreground"
                    data-testid={`button-connect-star-${candidate.id}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: candidate.labelId == null ? DEFAULT_STAR : sky.labels.find((l) => l.id === candidate.labelId)?.color ?? DEFAULT_STAR }} />
                    <span className="truncate">{candidate.title}</span>
                  </button>
                </li>
              )) : <li className="px-3 py-3 text-[12px] text-muted-foreground/75">{connectQuery ? "No matching stars." : "All other stars are already connected."}</li>}
            </ul>
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="mt-1 hidden rounded-full p-1.5 text-muted-foreground/75 hover:bg-white/5 hover:text-foreground max-md:block" aria-label="More star actions" data-testid="button-star-menu">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="sky-glass min-w-36 rounded-xl border-0 p-1.5">
            <DropdownMenuItem
              onSelect={() => setConfirm(true)}
              className="rounded-lg text-[13px] text-[hsl(350_62%_78%)] focus:text-[hsl(350_62%_78%)]"
              data-testid="menu-delete-star"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete star
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button onClick={onClose} className="mt-1 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground" aria-label="Close" data-testid="button-close-card">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="px-6 pb-4 text-[11.5px] text-muted-foreground/80">
        Lit {formatStamp(star.createdAt)} · {star.noteCount} {star.noteCount === 1 ? "note" : "notes"}
      </div>

      {/* label picker */}
      <div className="px-5 pb-3 md:px-6 md:pb-4">
        {narrow ? <Popover open={labelPickerOpen} onOpenChange={setLabelPickerOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.045] px-3 py-1.5 text-[12px] text-foreground/85 transition-colors hover:bg-white/[0.08]" data-testid="button-current-label">
              <span className="h-2 w-2 rounded-full" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
              <span>{label?.name ?? "Unlabeled"}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" className="sky-glass w-64 rounded-2xl border-0 p-2">
            <div className="mb-1 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">Choose a label</div>
            <button
              onClick={() => { actions.setStarLabel(star.id, null); setLabelPickerOpen(false); }}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12.5px] text-foreground/85 hover:bg-white/[0.06]"
              data-testid="button-label-none"
            >
              <span className="h-2 w-2 rounded-full bg-[#e4dff0]" /> Unlabeled
            </button>
            {sky.labels.map((l) => (
              <button
                key={l.id}
                onClick={() => { actions.setStarLabel(star.id, l.id); setLabelPickerOpen(false); }}
                className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12.5px] hover:bg-white/[0.06] ${star.labelId === l.id ? "text-foreground" : "text-foreground/80"}`}
                data-testid={`button-label-${l.id}`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
                {l.name}
              </button>
            ))}
            {!newLabel && (
              <button
                onClick={() => setNewLabel({ name: "", color: PALETTE[sky.labels.length % PALETTE.length].hex })}
                className="mt-1 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[12px] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
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
                  actions.addLabel(newLabel.name.trim(), newLabel.color, (l) => { actions.setStarLabel(star.id, l.id); setLabelPickerOpen(false); });
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
                  className={`h-5 w-5 rounded-full transition-transform duration-300 soft-ease ${newLabel.color === p.hex ? "scale-110 ring-2 ring-white/50 ring-offset-2 ring-offset-[#1d1534]" : "hover:scale-110"}`}
                  style={{ background: p.hex }}
                />
              ))}
              <div className="ml-auto flex gap-1">
                <button onClick={() => setNewLabel(null)} className="rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground">Cancel</button>
                <button
                  disabled={!newLabel.name.trim()}
                  onClick={() => {
                    actions.addLabel(newLabel.name.trim(), newLabel.color, (l) => { actions.setStarLabel(star.id, l.id); setLabelPickerOpen(false); });
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
          </PopoverContent>
        </Popover> : (
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
                      className={`h-5 w-5 rounded-full transition-transform duration-300 soft-ease ${newLabel.color === p.hex ? "scale-110 ring-2 ring-white/50 ring-offset-2 ring-offset-[#1d1534]" : "hover:scale-110"}`}
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
        )}
      </div>

      <div className="mx-6 h-px bg-white/[0.06]" />

      {/* notes */}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
              <NoteRow key={n.id} note={n} focused={glowNote === n.id} onDelete={() => setConfirmNote(n)} onSaved={() => actions.touchStar(star.id)} />
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

      {/* footer: constellation + delete */}
      <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] px-6 py-3.5 text-[12px]">
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
          <span className="flex-1 text-muted-foreground/60">Drag from a star's halo to connect it.</span>
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
              className="rounded-full bg-[hsl(350_55%_68%)] text-[hsl(258_40%_10%)] hover:bg-[hsl(350_55%_72%)]"
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
              className="rounded-full bg-[hsl(350_55%_68%)] text-[hsl(258_40%_10%)] hover:bg-[hsl(350_55%_72%)]"
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
