import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { checkForNewChapters } from './chapterCheck';
import { isNotifyEnabled } from './notifyPrefs';
import { isExpoGo } from './runtime';

/**
 * Periodic (OS-scheduled, ~hourly on Android) background check for new chapters
 * of library titles. Runs headless, so it only touches SQLite + providers +
 * expo-notifications — no React. The task is DEFINED at module load (side-effect
 * import from the root layout); registration is toggled from Settings.
 *
 * All no-ops in Expo Go (the native background-task module isn't available there).
 */
export const CHAPTER_CHECK_TASK = 'mangaapp-chapter-check';

if (!isExpoGo) {
  TaskManager.defineTask(CHAPTER_CHECK_TASK, async () => {
    try {
      if (!(await isNotifyEnabled())) return BackgroundTask.BackgroundTaskResult.Success;
      await checkForNewChapters(true);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerChapterCheck(): Promise<void> {
  if (isExpoGo) return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(CHAPTER_CHECK_TASK)) return;
    await BackgroundTask.registerTaskAsync(CHAPTER_CHECK_TASK, { minimumInterval: 60 });
  } catch {
    // Unsupported platform (e.g. web) — silently no-op.
  }
}

export async function unregisterChapterCheck(): Promise<void> {
  if (isExpoGo) return;
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(CHAPTER_CHECK_TASK))) return;
    await BackgroundTask.unregisterTaskAsync(CHAPTER_CHECK_TASK);
  } catch {
    // ignore
  }
}
