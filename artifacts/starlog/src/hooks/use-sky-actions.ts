import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSkyQueryKey,
  getGetSkyStatsQueryKey,
  getListLabelsQueryKey,
  useCreateConnection,
  useCreateConstellation,
  useCreateLabel,
  useCreateStar,
  useDeleteConnection,
  useDeleteConstellation,
  useDeleteLabel,
  useUpdateConstellation,
  useUpdateLabel,
  useUpdateStar,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useSetTaskOrder,
  useCreateNote,
  getListStarNotesQueryKey,
  type Label,
  type Note,
  type Sky,
  type Star,
  type Task,
  type TaskInput,
  type TaskUpdate,
} from "@workspace/api-client-react";
import { todayStr } from "@/lib/tasks";
import { createElement } from "react";
import { toast } from "@/hooks/use-toast";
import { ToastAction, type ToastActionElement } from "@/components/ui/toast";
import { clearDraftIfSent, draftKeys } from "@/lib/save-safety";
import { scheduleDelete } from "@/lib/pending-deletes";

let tempId = -1;

export function useSkyActions() {
  const qc = useQueryClient();
  const patch = (fn: (s: Sky) => Sky) => qc.setQueryData<Sky>(getGetSkyQueryKey(), (old) => (old ? fn(old) : old));
  const refreshMeta = () => {
    qc.invalidateQueries({ queryKey: getGetSkyStatsQueryKey() });
    qc.invalidateQueries({ queryKey: getListLabelsQueryKey() });
  };
  const fail = (what: string) => () => {
    toast({ title: `Couldn't ${what}`, description: "The sky has been restored. Try again in a moment." });
    qc.invalidateQueries({ queryKey: getGetSkyQueryKey() });
  };

  const createStar = useCreateStar();
  const updateStar = useUpdateStar();
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();
  const createConnection = useCreateConnection();
  const deleteConnection = useDeleteConnection();
  const createConstellation = useCreateConstellation();
  const updateConstellation = useUpdateConstellation();
  const deleteConstellation = useDeleteConstellation();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const setTaskOrder = useSetTaskOrder();
  // The Today panel's "How did today go?" draft is cleared once the server has the note.
  const createNote = useCreateNote({ mutation: { onSuccess: (_n, v) => clearDraftIfSent(draftKeys.todayLog, v.data.body) } });

  const recountLabels = (s: Sky): Sky => ({
    ...s,
    labels: s.labels.map((l) => ({ ...l, starCount: s.stars.filter((st) => st.labelId === l.id).length })),
  });

  return {
    creating: createStar.isPending,
    createStar(x: number, y: number, onDone?: (s: Star) => void, extra?: { title?: string; labelId?: number | null }) {
      createStar.mutate(
        { data: { x, y, ...extra } },
        {
          onSuccess: (star) => {
            patch((s) => ({ ...s, stars: [...s.stars, star] }));
            refreshMeta();
            onDone?.(star);
          },
          onError: fail("place that star"),
        },
      );
    },
    moveStar(id: number, x: number, y: number) {
      patch((s) => ({ ...s, stars: s.stars.map((st) => (st.id === id ? { ...st, x, y } : st)) }));
      updateStar.mutate({ starId: id, data: { x, y } }, { onError: fail("move that star") });
    },
    renameStar(id: number, title: string) {
      patch((s) => ({ ...s, stars: s.stars.map((st) => (st.id === id ? { ...st, title, updatedAt: st.title === title ? st.updatedAt : new Date().toISOString() } : st)) }));
      updateStar.mutate({ starId: id, data: { title } }, { onError: fail("save the title") });
    },
    setStarLabel(id: number, labelId: number | null) {
      patch((s) => recountLabels({ ...s, stars: s.stars.map((st) => (st.id === id ? { ...st, labelId, updatedAt: new Date().toISOString() } : st)) }));
      updateStar.mutate({ starId: id, data: { labelId } }, { onSuccess: refreshMeta, onError: fail("change the label") });
    },
    /** Hides the star now and deletes it after the undo window. */
    removeStar(id: number, title: string) {
      scheduleDelete({ kind: "star", id, label: title }, () => {
        patch((s) =>
          recountLabels({
            ...s,
            stars: s.stars.filter((st) => st.id !== id),
            tasks: s.tasks.filter((t) => t.starId !== id),
            connections: s.connections.filter((c) => c.fromStarId !== id && c.toStarId !== id),
          }),
        );
        qc.invalidateQueries({ queryKey: getGetSkyQueryKey() });
        refreshMeta();
      });
    },
    /** Marks a star as just edited, so the recent list reorders right away. */
    touchStar(id: number, noteDelta = 0) {
      const now = new Date().toISOString();
      patch((s) => ({
        ...s,
        stars: s.stars.map((st) => (st.id === id ? { ...st, updatedAt: now, noteCount: Math.max(0, st.noteCount + noteDelta) } : st)),
      }));
    },
    addLabel(name: string, color: string, onDone?: (l: Label) => void) {
      createLabel.mutate(
        { data: { name, color } },
        {
          onSuccess: (label) => {
            patch((s) => ({ ...s, labels: [...s.labels, label] }));
            refreshMeta();
            onDone?.(label);
          },
          onError: fail("create that label"),
        },
      );
    },
    editLabel(id: number, data: { name?: string; color?: string }) {
      patch((s) => ({ ...s, labels: s.labels.map((l) => (l.id === id ? { ...l, ...data } : l)) }));
      updateLabel.mutate({ labelId: id, data }, { onSuccess: refreshMeta, onError: fail("update that label") });
    },
    removeLabel(id: number) {
      patch((s) => ({
        ...s,
        labels: s.labels.filter((l) => l.id !== id),
        stars: s.stars.map((st) => (st.labelId === id ? { ...st, labelId: null } : st)),
      }));
      deleteLabel.mutate({ labelId: id }, { onSettled: refreshMeta });
    },
    connect(a: number, b: number) {
      const sky = qc.getQueryData<Sky>(getGetSkyQueryKey());
      if (a === b) return;
      if (sky?.connections.some((c) => (c.fromStarId === a && c.toStarId === b) || (c.fromStarId === b && c.toStarId === a))) return;
      createConnection.mutate(
        { data: { fromStarId: a, toStarId: b } },
        {
          onSuccess: (c) => {
            patch((s) => ({ ...s, connections: [...s.connections, c] }));
            refreshMeta();
          },
          onError: fail("draw that line"),
        },
      );
    },
    disconnect(id: number) {
      patch((s) => ({ ...s, connections: s.connections.filter((c) => c.id !== id) }));
      deleteConnection.mutate({ connectionId: id }, { onSuccess: refreshMeta, onError: fail("remove that line") });
    },
    nameConstellation(name: string, anchorStarId: number) {
      createConstellation.mutate(
        { data: { name, anchorStarId } },
        {
          onSuccess: (c) => {
            patch((s) => ({ ...s, constellations: [...s.constellations, c] }));
            refreshMeta();
          },
          onError: fail("name the constellation"),
        },
      );
    },
    renameConstellation(id: number, name: string) {
      patch((s) => ({ ...s, constellations: s.constellations.map((c) => (c.id === id ? { ...c, name } : c)) }));
      updateConstellation.mutate({ constellationId: id, data: { name } }, { onError: fail("rename the constellation") });
    },
    /** Adds a task now (with a temporary id) and swaps in the saved one when the server answers. */
    addTask(starId: number, data: TaskInput, onDone?: (t: Task) => void) {
      const sky = qc.getQueryData<Sky>(getGetSkyQueryKey());
      const mine = sky?.tasks.filter((t) => t.starId === starId) ?? [];
      const temp: Task = {
        id: tempId--,
        starId,
        title: data.title,
        dueDate: data.dueDate ?? null,
        priority: data.priority ?? "normal",
        repeat: data.repeat ?? null,
        done: false,
        doneAt: null,
        position: mine.reduce((m, t) => Math.max(m, t.position), -1) + 1,
        createdAt: new Date().toISOString(),
      };
      patch((s) => ({ ...s, tasks: [...s.tasks, temp] }));
      createTask.mutate(
        { starId, data },
        {
          onSuccess: (t) => {
            patch((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === temp.id ? t : x)) }));
            onDone?.(t);
          },
          onError: () => {
            // Nothing typed is lost: the toast keeps the task and can send it again.
            patch((s) => ({ ...s, tasks: s.tasks.filter((x) => x.id !== temp.id) }));
            qc.invalidateQueries({ queryKey: getGetSkyQueryKey() });
            toast({
              title: "Couldn't save that task",
              description: `“${data.title}”`,
              duration: 30_000,
              action: createElement(ToastAction, { altText: "Try again", onClick: () => this.addTask(starId, data, onDone) }, "Try again") as unknown as ToastActionElement,
            });
          },
        },
      );
    },
    /** Edits or checks off a task. Checking off a repeating task brings in its next instance. */
    editTask(id: number, data: Omit<TaskUpdate, "today">) {
      if (id < 0) return;
      const doneAt = data.done === true ? new Date().toISOString() : data.done === false ? null : undefined;
      patch((s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...data, ...(doneAt !== undefined ? { doneAt } : {}) } as Task : t)),
      }));
      updateTask.mutate(
        { taskId: id, data: { ...data, today: todayStr() } },
        {
          onSuccess: ({ task, next }) => {
            patch((s) => ({
              ...s,
              tasks: [...s.tasks.map((t) => (t.id === task.id ? task : t)), ...(next && !s.tasks.some((t) => t.id === next.id) ? [next] : [])],
            }));
          },
          onError: fail("save that task"),
        },
      );
    },
    removeTask(id: number) {
      patch((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
      if (id > 0) deleteTask.mutate({ taskId: id }, { onError: fail("delete that task") });
    },
    /** Keeps a manual order for a star's tasks (ids in order), or null to sort by date again. */
    orderTasks(starId: number, order: number[] | null) {
      patch((s) => ({
        ...s,
        stars: s.stars.map((st) => (st.id === starId ? { ...st, taskOrder: order ? "manual" : "auto" } : st)),
        tasks: order ? s.tasks.map((t) => (t.starId === starId && order.includes(t.id) ? { ...t, position: order.indexOf(t.id) } : t)) : s.tasks,
      }));
      setTaskOrder.mutate({ starId, data: { order: order ? order.filter((id) => id > 0) : null } }, { onError: fail("keep that order") });
    },
    addNote(starId: number, body: string, onDone?: (n: Note) => void) {
      createNote.mutate(
        { starId, data: { body } },
        {
          onSuccess: (n) => {
            qc.setQueryData<Note[]>(getListStarNotesQueryKey(starId), (old) => (old ? [...old, n] : old));
            const now = new Date().toISOString();
            patch((s) => ({ ...s, stars: s.stars.map((st) => (st.id === starId ? { ...st, updatedAt: now, noteCount: st.noteCount + 1 } : st)) }));
            refreshMeta();
            onDone?.(n);
          },
          onError: fail("save that note"),
        },
      );
    },
    removeConstellation(id: number) {
      patch((s) => ({ ...s, constellations: s.constellations.filter((c) => c.id !== id) }));
      deleteConstellation.mutate({ constellationId: id }, { onSuccess: refreshMeta });
    },
  };
}

export type SkyActions = ReturnType<typeof useSkyActions>;
