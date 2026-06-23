import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ReaderMode = 'vertical' | 'paged';
export type ReadingDirection = 'ltr' | 'rtl';

type ReaderState = {
  /** vertical scroll (webtoon) or horizontal paged (book). */
  mode: ReaderMode;
  /** Page turn direction for paged mode. RTL = Japanese manga. */
  direction: ReadingDirection;
  /** Gap between pages in vertical mode (px). */
  pageGap: number;
  /** 0.2–1: dim overlay over the pages (1 = full brightness). */
  brightness: number;
  keepAwake: boolean;
  setMode: (mode: ReaderMode) => void;
  setDirection: (d: ReadingDirection) => void;
  setPageGap: (gap: number) => void;
  setBrightness: (b: number) => void;
  setKeepAwake: (v: boolean) => void;
};

export const useReaderSettings = create<ReaderState>()(
  persist(
    (set) => ({
      mode: 'vertical',
      direction: 'ltr',
      pageGap: 8,
      brightness: 1,
      keepAwake: true,
      setMode: (mode) => set({ mode }),
      setDirection: (direction) => set({ direction }),
      setPageGap: (pageGap) => set({ pageGap }),
      setBrightness: (brightness) => set({ brightness }),
      setKeepAwake: (keepAwake) => set({ keepAwake }),
    }),
    {
      name: 'mangaapp-reader',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
