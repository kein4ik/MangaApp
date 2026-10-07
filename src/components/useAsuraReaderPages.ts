import { useEffect, useMemo, useState } from 'react';

import type { ChapterPage } from '@/data/sources/types';
import { knownPageSize, needsPageSize, pageSizeWindow, preparePageSizes } from '@/lib/readerPageSizes';

type PageStore = { page: () => number; subscribe: (listener: () => void) => () => void };
type Prepared = {
  input: ChapterPage[];
  pages: ChapterPage[];
  pending: ReadonlySet<number>;
  starting: boolean;
};
const NONE: ReadonlySet<number> = new Set();

/** UI-local metadata: never replaces query URLs, downloaded files or page indices. */
export function useAsuraReaderPages(
  input: ChapterPage[] | undefined,
  store: PageStore,
  enabled: boolean,
) {
  const base = useMemo(() => enabled ? input?.map((page) => {
    const size = knownPageSize(page);
    return size && (!page.width || !page.height) ? { ...page, width: size.w, height: size.h } : page;
  }) : input, [input, enabled]);
  const missing = useMemo(() => enabled
    ? new Set(base?.flatMap((page, index) => needsPageSize(page) ? [index] : []))
    : NONE, [base, enabled]);
  const [prepared, setPrepared] = useState<Prepared>();

  useEffect(() => {
    if (!base?.length || missing.size === 0) return;
    let pages = base;
    const pending = new Set(missing);
    // Wait only for the opening page and its neighbour, never the entire chapter.
    const opening = new Set(pageSizeWindow(store.page(), base.length).slice(0, 2).filter((i) => pending.has(i)));
    let controller: AbortController | undefined;
    let lastPage = -1;
    let disposed = false;
    const publish = () => setPrepared({ input: base, pages, pending: new Set(pending), starting: opening.size > 0 });
    const run = () => {
      const current = Math.max(0, Math.min(store.page(), base.length - 1));
      if (lastPage === current) return;
      lastPage = current;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const indices = pageSizeWindow(current, base.length).filter((i) => pending.has(i));
      void preparePageSizes(pages, indices, request.signal, (index, size) => {
        if (disposed || request.signal.aborted) return;
        pending.delete(index);
        opening.delete(index);
        if (size) {
          pages = pages.map((page, i) => i === index ? { ...page, width: size.w, height: size.h } : page);
        }
        publish();
      });
    };
    publish();
    run();
    const unsubscribe = store.subscribe(run);
    return () => {
      disposed = true;
      unsubscribe();
      controller?.abort();
    };
  }, [base, missing, store]);

  if (!base || missing.size === 0) return { pages: base, pendingSizes: NONE, isPreparing: false };
  if (prepared?.input !== base) {
    const isPreparing = pageSizeWindow(store.page(), base.length).slice(0, 2).some((i) => missing.has(i));
    return { pages: base, pendingSizes: missing, isPreparing };
  }
  return { pages: prepared.pages, pendingSizes: prepared.pending, isPreparing: prepared.starting };
}
