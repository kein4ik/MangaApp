import { SourceManager } from './registry';
import type { SourceStatus } from './types';

export type DiagStep = { name: string; ok: boolean; ms: number; info?: string };
export type SourceDiag = { status: SourceStatus; ms: number; steps: DiagStep[] };

async function run(name: string, fn: () => Promise<string>): Promise<DiagStep> {
  const t0 = Date.now();
  try {
    const info = await fn();
    return { name, ok: true, ms: Date.now() - t0, info };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, info: e instanceof Error ? e.message : 'error' };
  }
}

/** Probe a source end-to-end so the user can see exactly what works. */
export async function testSource(id: string): Promise<SourceDiag> {
  const p = SourceManager.require(id);
  const steps: DiagStep[] = [];
  const t0 = Date.now();

  steps.push(
    await run('trending', async () => {
      const r = await p.trending({ limit: 3 });
      if (!r.length) throw new Error('empty');
      return `${r.length} items`;
    }),
  );

  let firstId: string | undefined;
  steps.push(
    await run('search', async () => {
      const r = await p.search('berserk', { limit: 5 });
      if (!r.length) throw new Error('no results');
      firstId = r[0].externalId;
      return `${r.length} results`;
    }),
  );

  if (firstId) {
    steps.push(
      await run('details', async () => {
        await p.getMangaDetails(firstId!);
        return 'ok';
      }),
    );
    let chId: string | undefined;
    steps.push(
      await run('chapters', async () => {
        const ch = await p.getChapters(firstId!, 'en');
        chId = ch[ch.length - 1]?.externalId;
        return `${ch.length}`;
      }),
    );
    if (chId) {
      steps.push(
        await run('pages', async () => {
          const pg = await p.getChapterPages(chId!);
          if (!pg.length) throw new Error('no pages');
          return `${pg.length}`;
        }),
      );
    }
  }

  const ms = Date.now() - t0;
  // "Reachable" = trending or search works. Per-step ✗ on a single title (e.g. a
  // removed manga) is shown but doesn't mark the whole source down.
  const reachable = steps[0]?.ok || steps[1]?.ok;
  const status: SourceStatus = !reachable ? 'broken' : ms > 7000 ? 'slow' : 'online';
  return { status, ms, steps };
}
