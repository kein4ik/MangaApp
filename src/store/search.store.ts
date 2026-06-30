import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const MAX = 12;

type SearchState = {
  recent: string[];
  addRecent: (q: string) => void;
  removeRecent: (q: string) => void;
  clearRecent: () => void;
};

export const useSearchHistory = create<SearchState>()(
  persist(
    (set) => ({
      recent: [],
      addRecent: (q) =>
        set((s) => {
          const query = q.trim();
          if (!query) return s;
          // Most-recent first, de-duplicated, capped.
          const recent = [query, ...s.recent.filter((x) => x.toLowerCase() !== query.toLowerCase())];
          return { recent: recent.slice(0, MAX) };
        }),
      removeRecent: (q) => set((s) => ({ recent: s.recent.filter((x) => x !== q) })),
      clearRecent: () => set({ recent: [] }),
    }),
    {
      name: 'mangaapp-search-history',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** Curated popular queries shown before the user types anything. */
export const POPULAR_SEARCHES = [
  'Solo Leveling',
  'Berserk',
  'One Piece',
  'Chainsaw Man',
  'Jujutsu Kaisen',
  'Omniscient Reader',
  'Vagabond',
  'Demon Slayer',
  'Attack on Titan',
  'The Beginning After the End',
  'The God of High School',
  'Tower of God',
];

/** Genre chips — tapping searches the keyword. */
export const GENRES = [
  'Action',
  'Romance',
  'Comedy',
  'Fantasy',
  'Horror',
  'Drama',
  'Sci-Fi',
  'Adventure',
  'Mystery',
  'Slice of Life',
  'Issekai',
  'Thriller',
  'Sports',
];
