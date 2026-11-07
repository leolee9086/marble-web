// Copyright (C) 2026 leolee9086 and 织. AGPL-3.0-or-later.
// 在真实浏览器和GPU上验证，测试失败时保留截图与JSON便于定位。
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';

const url = process.env.MARBLE_TEST_URL || 'http://127.0.0.1:8150/?verify';
const output = resolve('artifacts');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.MARBLE_BROWSER || 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, acceptDownloads: true });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
let report: Record<string, unknown> = {};
const ready = async () => {
  await page.waitForFunction(() => {
    const app = (window as any).marbleLab;
    return app && !app.isBusy() && app.gpu.textures;
  }, undefined, { timeout: 60_000 });
  assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent() || '错误提示');
};

try {
  await page.goto(url);
  await ready();
  report = await page.evaluate(async () => {
    const app = (window as any).marbleLab;
    const gpu = app.gpu;
    const params = app.getParams();
    const metrics: Record<string, any> = { adapter: gpu.adapterName };
    const size = 257; // 非256整倍数覆盖GPU回读的行填充。
    await gpu.generate(params, size, true);
    metrics.periodic = {};
    for (const map of ['basecolor', 'roughness', 'height']) {
      const a = await gpu.readMap(map);
      let max = 0, total = 0, count = 0;
      const channels = map === 'height' ? 1 : 4;
      for (let i = 0; i < size; i++) for (let c = 0; c < (channels === 1 ? 1 : 3); c++) {
        const dx = Math.abs(a[(i * size) * channels + c] - a[(i * size + size - 1) * channels + c]);
        const dy = Math.abs(a[i * channels + c] - a[((size - 1) * size + i) * channels + c]);
        max = Math.max(max, dx, dy); total += dx + dy; count += 2;
      }
      metrics.periodic[map] = { max, mean: total / count };
    }
    await gpu.generate(params, size);
    const a = await gpu.readMap('basecolor') as Uint8Array;
    const h = await gpu.readMap('height') as Float32Array;
    const normal = await gpu.readMap('normal') as Uint8Array;
    // 包含边缘像素：核对周期中心差分、OpenGL绿色方向与单位法线。
    let maxNormalError = 0, minHeight = 1, maxHeight = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      minHeight = Math.min(minHeight, h[i]); maxHeight = Math.max(maxHeight, h[i]);
      const left = h[y * size + (x - 1 + size) % size];
      const right = h[y * size + (x + 1) % size];
      const above = h[((y - 1 + size) % size) * size + x];
      const below = h[((y + 1) % size) * size + x];
      const nx = -(right - left) * size * 0.5 * params.normalStrength;
      const ny = (below - above) * size * 0.5 * params.normalStrength;
      const length = Math.hypot(nx, ny, 1);
      [nx / length, ny / length, 1 / length].forEach((n, c) => {
        maxNormalError = Math.max(maxNormalError, Math.abs(normal[i * 4 + c] - Math.round((n * 0.5 + 0.5) * 255)));
      });
    }
    metrics.normals = { maxByteError: maxNormalError, minHeight, maxHeight };
    await gpu.generate(params, size);
    const b = await gpu.readMap('basecolor') as Uint8Array;
    metrics.sameSeedByteIdentical = a.every((v, i) => v === b[i]);
    await gpu.generate({ ...params, seed: params.seed + 1 }, size);
    const c = await gpu.readMap('basecolor') as Uint8Array;
    metrics.newSeedChangedFraction = a.reduce((n, v, i) => n + Number(v !== c[i]), 0) / a.length;
    const times: Record<string, number> = {};
    for (const resolution of [1024, 2048, 4096]) times[resolution] = await gpu.generate(params, resolution);
    metrics.timingsMs = times;
    await gpu.generate(params, 1024);
    return metrics;
  });
  const metrics = report as any;
  assert.ok(metrics.periodic.basecolor.max <= 1, '底色周期端点不连续');
  assert.ok(metrics.periodic.roughness.max <= 1, '粗糙度周期端点不连续');
  assert.ok(metrics.periodic.height.max < 0.00001, '高度周期端点不连续');
  assert.ok(metrics.normals.maxByteError <= 1, '法线与周期高度导数不一致');
  assert.ok(metrics.normals.maxHeight > metrics.normals.minHeight, '高度图为空');
  assert.equal(metrics.sameSeedByteIdentical, true);
  assert.ok(metrics.newSeedChangedFraction > 0.2, '改变种子没有有效改变纹理');

  for (const id of ['mist', 'graphite', 'warm', 'silver-grey']) {
    await page.locator(`[data-preset="${id}"]`).click();
    await ready();
    assert.equal(await page.locator(`[data-preset="${id}"]`).getAttribute('aria-pressed'), 'true');
  }
  await page.locator('[data-view="slab"]').click();
  await page.locator('#preview').hover({ position: { x: 220, y: 150 } });
  for (const map of ['roughness', 'normal', 'height', 'basecolor']) {
    await page.locator(`[data-map="${map}"]`).click();
    assert.equal(await page.locator(`[data-map="${map}"]`).getAttribute('aria-pressed'), 'true');
  }
  await page.locator('[data-view="tile"]').click();
  await page.screenshot({ path: resolve(output, 'seamless-2x2.png') });
  await page.locator('[data-view="sphere"]').click();
  await page.locator('#preview').hover({ position: { x: 170, y: 170 } });
  await page.screenshot({ path: resolve(output, 'material-sphere.png') });
  await page.locator('[data-view="single"]').click();
  await page.screenshot({ path: resolve(output, 'studio.png') });
  await page.locator('#preview').screenshot({ path: resolve(output, 'preview-texture.png') });

  await page.locator('#export-size').selectOption('2048');
  const packageDownload = page.waitForEvent('download', { timeout: 60_000 });
  await page.locator('#export-pack').click();
  const pack = await packageDownload;
  const packPath = resolve(output, pack.suggestedFilename());
  await pack.saveAs(packPath);
  await ready();
  const files = unzipSync(new Uint8Array(await readFile(packPath)));
  const manifest = JSON.parse(strFromU8(files['material.json']));
  assert.equal(manifest.size, 2048);
  assert.equal(manifest.maps.normal.convention, 'OpenGL +Y');
  for (const map of ['basecolor', 'roughness', 'height', 'normal']) {
    const entry = manifest.maps[map];
    const bytes = files[entry.file];
    assert.ok(bytes, `导出包缺少${map}`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(16), 2048);
    assert.equal(view.getUint32(20), 2048);
    assert.equal(bytes[24], map === 'height' ? 16 : 8);
    await writeFile(resolve(output, entry.file), bytes);
  }
  report.export = { archive: pack.suggestedFilename(), files: Object.keys(files), width: 2048, heightBitDepth: 16 };
  await page.locator('[data-map="height"]').click();
  await page.locator('#export-size').selectOption('4096');
  const heightDownload = page.waitForEvent('download', { timeout: 60_000 });
  await page.locator('#export-map').click();
  const height = await heightDownload;
  const heightPath = resolve(output, height.suggestedFilename());
  await height.saveAs(heightPath);
  await ready();
  const heightBytes = await readFile(heightPath);
  assert.equal(heightBytes.readUInt32BE(16), 4096);
  assert.equal(heightBytes[24], 16);

  // JSON恢复与损坏文件的可读错误。
  const presetDownload = page.waitForEvent('download');
  await page.locator('#save-preset').click();
  const savedPreset = await presetDownload;
  const presetPath = resolve(output, savedPreset.suggestedFilename());
  await savedPreset.saveAs(presetPath);
  await page.locator('#random').click();
  await ready();
  await page.locator('#import-preset').setInputFiles(presetPath);
  await ready();
  assert.equal(await page.locator('#seed').inputValue(), '42671');
  await page.locator('#import-preset').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"bad":true}') });
  assert.equal(await page.locator('#error').isVisible(), true);
  assert.match(await page.locator('#error').textContent() || '', /格式或版本/);
  await page.locator('#reset').click();
  await ready();

  // 照片取色本地完成，直接用本程序导出的底色PNG覆盖这条交互路径。
  await page.locator('.reference summary').click();
  const baseName = manifest.maps.basecolor.file;
  await page.locator('#reference-file').setInputFiles(resolve(output, baseName));
  await page.locator('#reference-canvas').waitFor({ state: 'visible' });
  await page.locator('#reference-canvas').click({ position: { x: 25, y: 25 } });
  await ready();
  assert.notEqual(await page.locator('#baseColor').inputValue(), '#918b90');
  await page.locator('#reset').click();
  await ready();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '手机布局横向溢出');
  assert.deepEqual(errors, [], '浏览器出现错误');
  report.ui = { presets: true, mapViews: true, importExport: true, referenceColor: true, mobileOverflow: false, consoleErrors: errors };
  report.success = true;
  report.time = new Date().toISOString();
  await writeFile(resolve(output, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.success = false;
  report.error = String(error);
  report.consoleErrors = errors;
  report.status = await page.locator('#status').textContent().catch(() => null);
  report.pageError = await page.locator('#error').textContent().catch(() => null);
  await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(resolve(output, 'verification.json'), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally { await browser.close(); }
