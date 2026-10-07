const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// Exercise the actual TS module with a streaming Fetch implementation, without
// loading Expo's native runtime or adding a second test framework to the app.
const source = fs.readFileSync(path.join(__dirname, '../src/lib/readerPageSizes.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(fetch) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((name) => {
    assert.equal(name, 'expo/fetch');
    return { fetch };
  }, module, module.exports);
  return module.exports;
}

function webp(kind, width, height) {
  const length = kind === 'VP8L' ? 5 : 10;
  const out = Buffer.alloc(20 + length + length % 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(out.length - 8, 4);
  out.write('WEBP', 8);
  out.write(kind, 12);
  out.writeUInt32LE(length, 16);
  if (kind === 'VP8X') {
    out.writeUIntLE(width - 1, 24, 3);
    out.writeUIntLE(height - 1, 27, 3);
  } else if (kind === 'VP8L') {
    out[20] = 0x2f;
    out.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 21);
  } else {
    out.set([0x9d, 0x01, 0x2a], 23);
    out.writeUInt16LE(width, 26);
    out.writeUInt16LE(height, 28);
  }
  return out;
}
const page = (id) => ({ index: id, imageUrl: `https://cdn.example.test/${id}.webp?v=1` });
function response(chunks, { status = 206, range = 'bytes 0-4095/900000', cancel = () => {} } = {}) {
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel,
  }, { highWaterMark: 0 }), { status, headers: { 'content-range': range } });
}
function abortable(signal) {
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

test('reads lossy, lossless and extended WebP headers, including sliced buffers', () => {
  const api = load(() => assert.fail('No network expected'));
  for (const kind of ['VP8 ', 'VP8L', 'VP8X']) {
    const bytes = webp(kind, 900, 16000);
    assert.deepEqual(api.webpHeaderSize(bytes), { w: 900, h: 16000 });
    const padded = Buffer.concat([Buffer.alloc(7), bytes, Buffer.alloc(3)]);
    assert.deepEqual(api.webpHeaderSize(padded.subarray(7, 7 + bytes.length)), { w: 900, h: 16000 });
    for (let length = 0; length < (kind === 'VP8L' ? 25 : 30); length++) {
      assert.equal(api.webpHeaderSize(bytes.subarray(0, length)), undefined);
    }
  }
});

test('skips padded chunks and rejects invalid data without inventing sizes', () => {
  const api = load(() => assert.fail());
  const bytes = webp('VP8 ', 800, 15000);
  const junk = Buffer.alloc(10);
  junk.write('JUNK');
  junk.writeUInt32LE(1, 4);
  assert.deepEqual(api.webpHeaderSize(Buffer.concat([bytes.subarray(0, 12), junk, bytes.subarray(12)])), { w: 800, h: 15000 });
  assert.equal(api.webpHeaderSize(Buffer.from('<html>Cloudflare error</html>')), undefined);
  assert.equal(api.webpHeaderSize(webp('VP8 ', 0, 15000)), undefined);
  const corrupt = webp('VP8L', 800, 15000);
  corrupt[20] = 0;
  assert.equal(api.webpHeaderSize(corrupt), undefined);
});

test('handles fragmented bodies, forwards image headers, cancels and caches the result', async () => {
  const bytes = webp('VP8 ', 800, 13470);
  let calls = 0, cancelled = false, requestSignal;
  const api = load(async (_, options) => {
    calls++;
    requestSignal = options.signal;
    assert.equal(options.headers.Range, 'bytes=0-4095');
    assert.equal(options.headers.Referer, 'https://asurascans.com/');
    return response([bytes.subarray(0, 3), bytes.subarray(3, 19), bytes.subarray(19), new Uint8Array(4096)], {
      cancel: () => { cancelled = true; },
    });
  });
  const input = { ...page(1), headers: { Referer: 'https://asurascans.com/' } };
  assert.deepEqual(await api.probePageSize(input, new AbortController().signal), { w: 800, h: 13470 });
  assert.equal(cancelled, true);
  assert.equal(requestSignal.aborted, true);
  assert.deepEqual(await api.probePageSize(input, new AbortController().signal), { w: 800, h: 13470 });
  assert.equal(calls, 1);
  assert.equal(input.width, undefined, 'Provider/query data must remain unchanged');
});

test('accepts servers ignoring Range but cancels the remaining image download', async () => {
  let cancelled = false;
  const api = load(async () => response([webp('VP8X', 900, 16000), new Uint8Array(50000)], {
    status: 200, cancel: () => { cancelled = true; },
  }));
  assert.deepEqual(await api.probePageSize(page(2), new AbortController().signal), { w: 900, h: 16000 });
  assert.equal(cancelled, true);
});

test('rejects wrong ranges and error pages; failed probes remain retryable', async () => {
  let calls = 0;
  const api = load(async () => {
    calls++;
    if (calls === 1) return response([webp('VP8 ', 900, 16000)], { range: 'bytes 4000-8095/900000' });
    if (calls === 2) return response([Buffer.from('server unavailable')], { status: 503 });
    return response([webp('VP8 ', 900, 16000)]);
  });
  assert.equal(await api.probePageSize(page(3), new AbortController().signal), undefined);
  assert.equal(await api.probePageSize(page(3), new AbortController().signal), undefined);
  assert.deepEqual(await api.probePageSize(page(3), new AbortController().signal), { w: 900, h: 16000 });
});

test('stops after its bounded header budget when no size can be found', async () => {
  let cancelled = false, pulls = 0;
  const bytes = Buffer.alloc(4096);
  bytes.write('RIFF', 0); bytes.write('WEBP', 8);
  const api = load(async () => new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(bytes); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 })));
  assert.equal(await api.probePageSize(page(4), new AbortController().signal), undefined);
  assert.equal(pulls, 1);
  assert.equal(cancelled, true);
});

test('known sizes, offline files and non-WebP pages do not issue requests', async () => {
  const api = load(() => assert.fail('Unexpected network request'));
  const signal = new AbortController().signal;
  assert.deepEqual(await api.probePageSize({ ...page(5), width: 900, height: 16000 }, signal), { w: 900, h: 16000 });
  assert.equal(await api.probePageSize({ ...page(6), imageUrl: 'file:///downloads/6.webp' }, signal), undefined);
  assert.equal(await api.probePageSize({ ...page(7), imageUrl: 'https://cdn.example.test/7.jpg' }, signal), undefined);
  const aborted = new AbortController(); aborted.abort();
  assert.equal(await api.probePageSize(page(8), aborted.signal), undefined);
});

test('cancels in-flight requests without caching failed results', async () => {
  let calls = 0;
  const api = load(async (_, { signal }) => {
    calls++;
    if (calls === 1) return abortable(signal);
    return response([webp('VP8 ', 900, 16000)]);
  });
  const controller = new AbortController();
  const pending = api.probePageSize(page(9), controller.signal);
  controller.abort();
  assert.equal(await pending, undefined);
  assert.deepEqual(await api.probePageSize(page(9), new AbortController().signal), { w: 900, h: 16000 });
});

test('timeout also covers a body that stalls after response headers', async () => {
  const api = load(async (_, { signal }) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(new DOMException('Cancelled', 'AbortError')));
    },
  })));
  const start = Date.now();
  assert.equal(await api.probePageSize(page(10), new AbortController().signal), undefined);
  assert.ok(Date.now() - start < 3000, 'A stalled body must not block reading indefinitely');
});

test('window follows the original index for resume, backwards reading and chapter edges', () => {
  const api = load(() => assert.fail());
  assert.deepEqual(api.pageSizeWindow(0, 21), [0, 1, 2]);
  assert.deepEqual(api.pageSizeWindow(10, 21), [10, 11, 12, 9]);
  assert.deepEqual(api.pageSizeWindow(999, 21), [20, 19]);
  assert.deepEqual(api.pageSizeWindow(-2, 1), [0]);
  assert.deepEqual(api.pageSizeWindow(0, 0), []);
});

test('limits concurrent probes to two and stops queued probes on exit', async () => {
  let active = 0, peak = 0, calls = 0;
  const api = load(async (_, { signal }) => {
    calls++; active++; peak = Math.max(peak, active);
    try { return await abortable(signal); } finally { active--; }
  });
  const controller = new AbortController();
  const pending = api.preparePageSizes([page(11), page(12), page(13), page(14)], [0, 1, 2, 3], controller.signal, () => assert.fail('No late result expected'));
  assert.equal(calls, 2);
  controller.abort();
  await pending;
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.equal(calls, 2);
});

test('prepares a successful window without mutating URLs, indices or query pages', async () => {
  const api = load(async () => response([webp('VP8 ', 800, 13470)]));
  const pages = [page(15), page(16), page(17)];
  const before = structuredClone(pages);
  const results = [];
  await api.preparePageSizes(pages, [1, 2], new AbortController().signal, (index, size) => results.push({ index, size }));
  assert.deepEqual(results.map(r => r.index).sort(), [1, 2]);
  assert.ok(results.every(r => r.size.w === 800 && r.size.h === 13470));
  assert.deepEqual(pages, before);
});
