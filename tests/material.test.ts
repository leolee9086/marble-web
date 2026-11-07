// Copyright (C) 2026 leolee9086 and 织. AGPL-3.0-or-later.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzlibSync } from 'fflate';
import { DEFAULT_PARAMS, PRESETS, decodePreset, packParams, presetJSON, validateParams } from '../src/params.ts';
import { crc32, heightPNG } from '../src/export.ts';

test('预设保存后能精确复现所有参数，拒绝损坏和未来版本', () => {
  for (const preset of PRESETS) assert.deepEqual(decodePreset(presetJSON(preset.params)), preset.params);
  assert.throws(() => decodePreset('{broken'), SyntaxError);
  assert.throws(() => decodePreset(JSON.stringify({ schema: 'marble-web/preset', version: 999, params: DEFAULT_PARAMS })), /版本/);
  assert.throws(() => validateParams({ ...DEFAULT_PARAMS, seed: -1 }), /seed/);
  assert.throws(() => validateParams({ ...DEFAULT_PARAMS, cells: 4.2 }), /整数/);
  assert.throws(() => validateParams({ ...DEFAULT_PARAMS, warp: NaN }), /warp/);
  assert.throws(() => validateParams({ ...DEFAULT_PARAMS, baseColor: '#xxyyzz' }), /颜色/);
});

test('GPU参数块符合16字节对齐并保留种子整数精度', () => {
  const packed = packParams({ ...DEFAULT_PARAMS, seed: 999999 }, 4096);
  assert.equal(packed.byteLength, 96);
  assert.equal(packed[0], 4096);
  assert.equal(packed[1], 999999);
  assert.equal(packed[21], 0);
  assert.equal(packParams(DEFAULT_PARAMS, 64, true)[21], 1);
  assert.throws(() => packParams(DEFAULT_PARAMS, 8192), /分辨率/);
});

test('高度PNG是真正16位灰度，解压后保留低于8位量化步长的变化', () => {
  const values = new Float32Array([0, 0.5, 0.5001, 1]);
  const png = heightPNG(values, 2);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer);
  assert.equal(view.getUint32(16), 2);
  assert.equal(view.getUint32(20), 2);
  assert.equal(png[24], 16);
  assert.equal(png[25], 0);
  let decoded: Uint8Array | undefined;
  for (let offset = 8; offset < png.length;) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    const chunkData = png.subarray(offset + 8, offset + 8 + length);
    assert.equal(crc32(png.subarray(offset + 4, offset + 8 + length)), view.getUint32(offset + 8 + length));
    if (type === 'IDAT') decoded = unzlibSync(chunkData);
    offset += length + 12;
  }
  assert.ok(decoded);
  const raw = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  assert.equal(raw.getUint16(1), 0);
  assert.equal(raw.getUint16(3), 32768);
  assert.equal(raw.getUint16(6), Math.round(values[2] * 65535));
  assert.equal(raw.getUint16(8), 65535);
  assert.notEqual(raw.getUint16(3), raw.getUint16(6));
  assert.throws(() => heightPNG(new Float32Array([NaN]), 1), /非有限值/);
});
