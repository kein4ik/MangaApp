import { create } from 'zustand';

/**
 * Live progress of in-flight chapter downloads (not persisted — a completed
 * download lands in SQLite; anything else is gone on restart, by design).
 * Keyed `${sourceId}:${chapterId}`.
 */
type Progress = { done: number; total: number };

type DownloadsState = {
  active: Record<string, Progress>;
  start: (key: string, total: number) => void;
  tick: (key: string, done: number, total: number) => void;
  clear: (key: string) => void;
};

export const useDownloadProgress = create<DownloadsState>((set) => ({
  active: {},
  start: (key, total) => set((s) => ({ active: { ...s.active, [key]: { done: 0, total } } })),
  tick: (key, done, total) => set((s) => ({ active: { ...s.active, [key]: { done, total } } })),
  clear: (key) =>
    set((s) => {
      const { [key]: _gone, ...rest } = s.active;
      return { active: rest };
    }),
}));

export const downloadKey = (sourceId: string, chapterId: string) => `${sourceId}:${chapterId}`;
