import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type SettingsState = {
  selectedSourceId: string;
  language: string;
  setSource: (id: string) => void;
  setLanguage: (lang: string) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      selectedSourceId: 'mangadex',
      language: 'en',
      setSource: (selectedSourceId) => set({ selectedSourceId }),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'mangaapp-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
