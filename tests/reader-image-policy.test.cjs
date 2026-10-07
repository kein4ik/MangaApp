const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/lib/readerImagePolicy.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const policy = { exports: {} };
new Function('module', 'exports', compiled)(policy, policy.exports);
const { asuraDecodeSize } = policy.exports;

test('Nano Machine 332 / Barbarian 163: narrow 16k strips no longer decode at 58 MB', () => {
  const original = Object.freeze({ w: 900, h: 16000 });
  const decoded = asuraDecodeSize(original);
  assert.deepEqual(decoded, { w: 460, h: 8192 });
  assert.ok(decoded.w * decoded.h * 4 < 16 * 1024 * 1024);
  assert.ok(Math.abs(decoded.w / decoded.h - original.w / original.h) < 0.0001);
  assert.deepEqual(original, { w: 900, h: 16000 });
});

test('Estate 223: tall strips are capped, the header and short tail stay full resolution', () => {
  for (const h of [12020, 13470, 13750, 15000]) {
    const decoded = asuraDecodeSize({ w: 800, h });
    assert.equal(decoded.h, 8192);
    assert.ok(decoded.w * decoded.h * 4 < 24_000_000);
  }
  assert.equal(asuraDecodeSize({ w: 1200, h: 800 }), undefined);
  assert.equal(asuraDecodeSize({ w: 800, h: 1417 }), undefined);
  assert.equal(asuraDecodeSize({ w: 1532, h: 2200 }), undefined);
});

test('wide/square scans also obey the bitmap budget without growing either edge', () => {
  for (const original of [{ w: 6000, h: 6000 }, { w: 16000, h: 900 }, { w: 1532, h: 16000 }]) {
    const decoded = asuraDecodeSize(original);
    assert.ok(decoded.w <= original.w && decoded.h <= original.h);
    assert.ok(decoded.w <= 8192 && decoded.h <= 8192);
    assert.ok(decoded.w * decoded.h <= 6_000_000);
  }
});

test('unknown or invalid dimensions use the existing load fallback', () => {
  for (const input of [undefined, { w: 0, h: 100 }, { w: NaN, h: 100 }, { w: 100, h: Infinity }, { w: -1, h: 10 }]) {
    assert.equal(asuraDecodeSize(input), undefined);
  }
});
