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
  useDeleteStar,
  useUpdateConstellation,
  useUpdateLabel,
  useUpdateStar,
  type Label,
  type Sky,
  type Star,
} from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";

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
  const deleteStar = useDeleteStar();
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();
  const createConnection = useCreateConnection();
  const deleteConnection = useDeleteConnection();
  const createConstellation = useCreateConstellation();
  const updateConstellation = useUpdateConstellation();
  const deleteConstellation = useDeleteConstellation();

  const recountLabels = (s: Sky): Sky => ({
    ...s,
    labels: s.labels.map((l) => ({ ...l, starCount: s.stars.filter((st) => st.labelId === l.id).length })),
  });

  return {
    creating: createStar.isPending,
    createStar(x: number, y: number, onDone?: (s: Star) => void) {
      createStar.mutate(
        { data: { x, y } },
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
      patch((s) => ({ ...s, stars: s.stars.map((st) => (st.id === id ? { ...st, title } : st)) }));
      updateStar.mutate({ starId: id, data: { title } }, { onError: fail("save the title") });
    },
    setStarLabel(id: number, labelId: number | null) {
      patch((s) => recountLabels({ ...s, stars: s.stars.map((st) => (st.id === id ? { ...st, labelId } : st)) }));
      updateStar.mutate({ starId: id, data: { labelId } }, { onSuccess: refreshMeta, onError: fail("change the label") });
    },
    removeStar(id: number) {
      patch((s) =>
        recountLabels({
          ...s,
          stars: s.stars.filter((st) => st.id !== id),
          connections: s.connections.filter((c) => c.fromStarId !== id && c.toStarId !== id),
        }),
      );
      deleteStar.mutate(
        { starId: id },
        {
          onSettled: () => {
            qc.invalidateQueries({ queryKey: getGetSkyQueryKey() });
            refreshMeta();
          },
        },
      );
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
    removeConstellation(id: number) {
      patch((s) => ({ ...s, constellations: s.constellations.filter((c) => c.id !== id) }));
      deleteConstellation.mutate({ constellationId: id }, { onSuccess: refreshMeta });
    },
  };
}

export type SkyActions = ReturnType<typeof useSkyActions>;
