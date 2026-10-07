import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import type { UpdatesResult } from '@/data/queries';

/** Observe the last Updates result without starting a background source check. */
export function useUpdatesSnapshot() {
  const client = useQueryClient();
  const subscribe = useCallback((notify: () => void) => client.getQueryCache().subscribe(event => {
    if (event.query.queryKey[0] === 'updates') notify();
  }), [client]);
  const snapshot = useCallback(() => client.getQueryData<UpdatesResult>(['updates']), [client]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
