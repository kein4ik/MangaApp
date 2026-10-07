import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { isRemovedSource } from '@/data/sources/removed';

type SettingsState = {
  selectedSourceId: string;
  language: string;
  /** Content languages the user reads in — sources are shown per these. */
  enabledLanguages: string[];
  /** Sources the user has temporarily hidden (e.g. broken ones). */
  hiddenSources: string[];
  /** Notify when library titles get new chapters (background check). */
  notifyChapters: boolean;
  setSource: (id: string) => void;
  setLanguage: (lang: string) => void;
  toggleLanguage: (code: string) => void;
  toggleHidden: (id: string) => void;
  setNotifyChapters: (on: boolean) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      selectedSourceId: 'mangadex',
      language: 'en',
      enabledLanguages: ['en', 'ru'],
      hiddenSources: [],
      notifyChapters: false,
      setSource: (selectedSourceId) => set({ selectedSourceId }),
      setLanguage: (language) => set({ language }),
      toggleLanguage: (code) =>
        set((s) => {
          if (!s.enabledLanguages.includes(code)) {
            return { enabledLanguages: [...s.enabledLanguages, code] };
          }
          // Never zero languages: every source would become unusable.
          if (s.enabledLanguages.length === 1) return s;
          return { enabledLanguages: s.enabledLanguages.filter((x) => x !== code) };
        }),
      toggleHidden: (id) =>
        set((s) => ({
          hiddenSources: s.hiddenSources.includes(id)
            ? s.hiddenSources.filter((x) => x !== id)
            : [...s.hiddenSources, id],
        })),
      setNotifyChapters: (notifyChapters) => set({ notifyChapters }),
    }),
    {
      name: 'mangaapp-settings',
      storage: createJSONStorage(() => AsyncStorage),
      // A source taken out of the app can't stay picked: Home would load nothing.
      merge: (persisted, current) => {
        const s = { ...current, ...(persisted as Partial<SettingsState>) };
        return {
          ...s,
          selectedSourceId: isRemovedSource(s.selectedSourceId)
            ? current.selectedSourceId
            : s.selectedSourceId,
          hiddenSources: s.hiddenSources.filter((id) => !isRemovedSource(id)),
        };
      },
    },
  ),
);
