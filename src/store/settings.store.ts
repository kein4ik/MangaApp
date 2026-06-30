import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type SettingsState = {
  selectedSourceId: string;
  language: string;
  /** Content languages the user reads in — sources are shown per these. */
  enabledLanguages: string[];
  /** Sources the user has temporarily hidden (e.g. broken ones). */
  hiddenSources: string[];
  setSource: (id: string) => void;
  setLanguage: (lang: string) => void;
  toggleLanguage: (code: string) => void;
  toggleHidden: (id: string) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      selectedSourceId: 'mangadex',
      language: 'en',
      enabledLanguages: ['en', 'ru'],
      hiddenSources: [],
      setSource: (selectedSourceId) => set({ selectedSourceId }),
      setLanguage: (language) => set({ language }),
      toggleLanguage: (code) =>
        set((s) => ({
          enabledLanguages: s.enabledLanguages.includes(code)
            ? s.enabledLanguages.filter((x) => x !== code)
            : [...s.enabledLanguages, code],
        })),
      toggleHidden: (id) =>
        set((s) => ({
          hiddenSources: s.hiddenSources.includes(id)
            ? s.hiddenSources.filter((x) => x !== id)
            : [...s.hiddenSources, id],
        })),
    }),
    {
      name: 'mangaapp-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
