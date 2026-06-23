import { SourceRegistry } from './sources/registry.js';
import type { SourceProvider } from './sources/SourceProvider.js';

/**
 * Source smoke test. Runs the full chain (trending → search → details →
 * chapters → pages) against every provider and prints a pass/fail report with
 * timings, so you can tell at a glance which source is healthy and which broke
 * (e.g. a site changed its markup or went down). Run with `npm run smoke`.
 */

const QUERY = 'solo leveling';

type StepResult = { name: string; ok: boolean; info: string; ms: number };

async function step(name: string, fn: () => Promise<string>): Promise<StepResult> {
  const started = Date.now();
  try {
    const info = await fn();
    return { name, ok: true, info, ms: Date.now() - started };
  } catch (err) {
    return {
      name,
      ok: false,
      info: err instanceof Error ? err.message : 'unknown error',
      ms: Date.now() - started,
    };
  }
}

async function checkProvider(p: SourceProvider): Promise<StepResult[]> {
  const steps: StepResult[] = [];

  steps.push(
    await step('trending', async () => {
      const r = await p.trending({ limit: 3 });
      if (!r.length) throw new Error('empty');
      return `${r.length} items`;
    }),
  );

  let firstId: string | undefined;
  steps.push(
    await step('search', async () => {
      const r = await p.search(QUERY, { limit: 5 });
      if (!r.length) throw new Error('no results');
      firstId = r[0].externalId;
      return `${r.length} results · top="${r[0].title.slice(0, 24)}"`;
    }),
  );

  if (firstId) {
    steps.push(
      await step('details', async () => {
        const d = await p.getMangaDetails(firstId!);
        return `"${d.title.slice(0, 24)}"`;
      }),
    );

    let firstChapterId: string | undefined;
    steps.push(
      await step('chapters', async () => {
        const ch = await p.getChapters(firstId!, 'en');
        // Test pages on the NEWEST chapter — very old chapters are sometimes
        // empty/removed on scraper sites, which isn't a provider bug.
        firstChapterId = ch[ch.length - 1]?.externalId;
        return `${ch.length} chapters`;
      }),
    );

    if (firstChapterId) {
      steps.push(
        await step('pages', async () => {
          const pages = await p.getChapterPages(firstChapterId!);
          if (!pages.length) throw new Error('no pages');
          return `${pages.length} pages`;
        }),
      );
    }
  }

  return steps;
}

async function main() {
  console.log(`\n🔎 Source smoke test (query="${QUERY}")\n`);
  let failures = 0;

  for (const provider of SourceRegistry.all()) {
    console.log(`── ${provider.name} (${provider.id}) ──`);
    const steps = await checkProvider(provider);
    for (const s of steps) {
      if (!s.ok) failures++;
      const icon = s.ok ? '✓' : '✗';
      console.log(`  ${icon} ${s.name.padEnd(9)} ${String(s.ms).padStart(5)}ms  ${s.info}`);
    }
    console.log('');
  }

  if (failures > 0) {
    console.log(`❌ ${failures} step(s) failed.\n`);
    process.exit(1);
  }
  console.log('✅ All sources healthy.\n');
}

main();
