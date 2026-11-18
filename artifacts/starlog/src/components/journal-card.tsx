import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSkyQueryKey,
  getGetSkyStatsQueryKey,
  getListStarNotesQueryKey,
  useCreateNote,
  useDeleteNote,
  useListStarNotes,
  useUpdateNote,
  type Note,
  type Sky,
  type Star,
} from "@workspace/api-client-react";
import { Check, Plus, Trash2, X } from "lucide-react";
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
import type { SkyActions } from "@/hooks/use-sky-actions";

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function NoteRow({ note, onDelete }: { note: Note; onDelete: () => void }) {
  const qc = useQueryClient();
  const update = useUpdateNote();
  const mutateRef = useRef(update.mutate);
  mutateRef.current = update.mutate;
  const [body, setBody] = useState(note.body);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number>(0);
  const pending = useRef<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => autosize(taRef.current), [body]);

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
          setSaved(true);
          window.setTimeout(() => setSaved(false), 1400);
        },
      },
    );
  };
  useEffect(() => () => { clearTimeout(timer.current); flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <li className="group relative pl-5" data-testid={`note-${note.id}`}>
      <span className="absolute left-0 top-[9px] h-1.5 w-1.5 rounded-full bg-[hsl(36_72%_82%/0.55)]" />
      <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground/80">
        <span data-testid={`text-note-time-${note.id}`}>{formatStamp(note.createdAt)}</span>
        {note.editedAt && <span className="opacity-70">· edited {formatStamp(note.editedAt)}</span>}
        <span className={`text-[hsl(150_30%_74%)] transition-opacity duration-700 soft-ease ${saved ? "opacity-100" : "opacity-0"}`}>
          <Check className="inline h-3 w-3" />
        </span>
        <button
          onClick={onDelete}
          className="ml-auto rounded-md p-1 text-muted-foreground/60 opacity-0 transition-all duration-300 hover:bg-white/5 hover:text-[hsl(350_62%_74%)] group-hover:opacity-100 focus:opacity-100"
          aria-label="Delete note"
          data-testid={`button-delete-note-${note.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <textarea
        ref={taRef}
        rows={1}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          pending.current = e.target.value;
          clearTimeout(timer.current);
          timer.current = window.setTimeout(flush, 700);
        }}
        className="quiet-input w-full resize-none overflow-hidden text-[14px] leading-relaxed text-foreground/90"
        data-testid={`input-note-${note.id}`}
      />
    </li>
  );
}

type Props = {
  star: Star;
  sky: Sky;
  roots: Map<number, number>;
  actions: SkyActions;
  onClose: () => void;
};

export default function JournalCard({ star, sky, roots, actions, onClose }: Props) {
  const qc = useQueryClient();
  const notesKey = getListStarNotesQueryKey(star.id);
  const notesQ = useListStarNotes(star.id, { query: { enabled: !!star.id, queryKey: notesKey } });
  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();

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
  const draftRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => autosize(draftRef.current), [draft]);
  const listEnd = useRef<HTMLDivElement>(null);

  const patchCount = (d: number) =>
    qc.setQueryData<Sky>(getGetSkyQueryKey(), (old) =>
      old ? { ...old, stars: old.stars.map((s) => (s.id === star.id ? { ...s, noteCount: Math.max(0, s.noteCount + d) } : s)) } : old,
    );

  const addNote = () => {
    const body = draft.trim();
    if (!body) return;
    createNote.mutate(
      { starId: star.id, data: { body } },
      {
        onSuccess: (n) => {
          qc.setQueryData<Note[]>(notesKey, (old) => [...(old ?? []), n]);
          patchCount(1);
          qc.invalidateQueries({ queryKey: getGetSkyStatsQueryKey() });
          setDraft("");
          window.setTimeout(() => listEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 60);
        },
      },
    );
  };
  const removeNote = (id: number) => {
    qc.setQueryData<Note[]>(notesKey, (old) => old?.filter((n) => n.id !== id));
    patchCount(-1);
    deleteNote.mutate({ noteId: id }, { onSettled: () => qc.invalidateQueries({ queryKey: getGetSkyStatsQueryKey() }) });
  };

  // labels
  const [newLabel, setNewLabel] = useState<{ name: string; color: string } | null>(null);
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
  const notes = notesQ.data ?? [];
  const dot = label?.color ?? DEFAULT_STAR;

  return (
    <div className="sky-glass flex h-full max-h-full flex-col overflow-hidden rounded-[22px]" data-testid="card-journal">
      <div className="flex items-start gap-3 px-6 pb-3 pt-6">
        <span className="mt-[11px] h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-700" style={{ background: dot, boxShadow: `0 0 14px ${dot}` }} />
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
        <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground" aria-label="Close" data-testid="button-close-card">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-6 pb-4 text-[11.5px] text-muted-foreground/80">
        Lit {formatStamp(star.createdAt)} · {star.noteCount} {star.noteCount === 1 ? "note" : "notes"}
      </div>

      {/* label picker */}
      <div className="flex flex-wrap items-center gap-1.5 px-6 pb-4">
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
              <NoteRow key={n.id} note={n} onDelete={() => removeNote(n.id)} />
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
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(); } }}
            placeholder="Write something down..."
            className="quiet-input thin-scroll max-h-48 w-full resize-none text-[14px] leading-relaxed"
            data-testid="input-new-note"
          />
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-muted-foreground/60">Ctrl + Enter to add</span>
            <button
              onClick={addNote}
              disabled={!draft.trim() || createNote.isPending}
              className="rounded-full bg-primary px-3.5 py-1.5 text-[12.5px] font-medium text-primary-foreground transition-all duration-300 hover:brightness-105 disabled:opacity-30"
              data-testid="button-add-note"
            >
              Add note
            </button>
          </div>
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
        <button
          onClick={() => setConfirm(true)}
          className="flex items-center gap-1.5 text-muted-foreground/70 transition-colors hover:text-[hsl(350_62%_74%)]"
          data-testid="button-delete-star"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="sky-glass max-w-sm rounded-2xl border-0">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-medium">Let this star go?</AlertDialogTitle>
            <AlertDialogDescription>
              "{star.title}" and its {star.noteCount} {star.noteCount === 1 ? "note" : "notes"} will be removed from your sky, along with its lines.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-white/10 bg-transparent">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-[hsl(350_55%_68%)] text-[hsl(258_40%_10%)] hover:bg-[hsl(350_55%_72%)]"
              onClick={() => { actions.removeStar(star.id); onClose(); }}
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
