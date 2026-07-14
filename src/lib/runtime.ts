import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * True when running inside Expo Go, where native modules like expo-notifications
 * and expo-background-task are absent (removed from Expo Go in SDK 53+). We gate
 * all notification/background code on this so the app runs fine in Expo Go for
 * quick testing — those features light up only in a dev/EAS build.
 */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
