// Copyright (C) 2026 leolee9086 and 织. AGPL-3.0-or-later.
import { zlibSync, zip, strToU8 } from 'fflate';
import { MAP_NAMES, presetJSON, type MapName, type MarbleParams } from './params';
import type { MarbleGPU } from './gpu';

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(strToU8(type), 4);
  out.set(data, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}

/** 16位灰度PNG：网络字节序，线性数值，不写sRGB标签。 */
export function heightPNG(values: Float32Array, size: number): Uint8Array {
  if (values.length !== size * size) throw new Error('高度图数据长度与尺寸不一致。');
  const raw = new Uint8Array(size * (1 + size * 2));
  const rawView = new DataView(raw.buffer);
  for (let y = 0; y < size; y++) {
    const offset = y * (size * 2 + 1);
    raw[offset] = 0; // PNG filter: None
    for (let x = 0; x < size; x++) {
      const value = values[y * size + x];
      if (!Number.isFinite(value)) throw new Error('高度图包含非有限值。');
      rawView.setUint16(offset + 1 + x * 2, Math.round(Math.max(0, Math.min(1, value)) * 65535));
    }
  }
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, size);
  headerView.setUint32(4, size);
  header[8] = 16;
  header[9] = 0;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array())];
  const total = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { total.set(part, offset); offset += part.length; }
  return total;
}

export async function rgbaPNG(bytes: Uint8Array, size: number): Promise<Uint8Array> {
  if (bytes.length !== size * size * 4) throw new Error('贴图数据长度与尺寸不一致。');
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建PNG编码画布。');
  const copy = new Uint8ClampedArray(bytes.length);
  copy.set(bytes);
  context.putImageData(new ImageData(copy, size, size), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function mapPNG(gpu: MarbleGPU, name: MapName): Promise<Uint8Array> {
  if (!gpu.textures) throw new Error('材质尚未生成。');
  const pixels = await gpu.readMap(name);
  return name === 'height'
    ? heightPNG(pixels as Float32Array, gpu.textures.size)
    : rgbaPNG(pixels as Uint8Array, gpu.textures.size);
}

export function download(data: Uint8Array | string, filename: string, type: string): void {
  const bytes = typeof data === 'string' ? data : new Uint8Array(data);
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function materialZIP(gpu: MarbleGPU, params: MarbleParams, progress: (map: MapName) => void): Promise<Uint8Array> {
  if (!gpu.textures) throw new Error('材质尚未生成。');
  const size = gpu.textures.size;
  const stem = `marble_${params.seed}_${size}`;
  const files: Record<string, Uint8Array> = {};
  for (const map of MAP_NAMES) {
    progress(map);
    files[`${stem}_${map}${map === 'height' ? '_16bit' : map === 'normal' ? '_OpenGL' : ''}.png`] = await mapPNG(gpu, map);
  }
  files['preset.json'] = strToU8(presetJSON(params));
  files['material.json'] = strToU8(JSON.stringify({
    generator: 'marble-web', generatorVersion: '0.1.0', size,
    periodic: true, sampling: 'pixel-center', metalness: 0,
    maps: {
      basecolor: { file: `${stem}_basecolor.png`, colorSpace: 'sRGB', bitDepth: 8 },
      roughness: { file: `${stem}_roughness.png`, colorSpace: 'linear', bitDepth: 8, channel: 'R', white: 'rough' },
      normal: { file: `${stem}_normal_OpenGL.png`, colorSpace: 'linear', bitDepth: 8, convention: 'OpenGL +Y', flipGreenForDirectX: true },
      height: { file: `${stem}_height_16bit.png`, colorSpace: 'linear', bitDepth: 16, neutral: 0.5, units: 'relative; choose displacement amplitude in your renderer' },
    },
  }, null, 2));
  return new Promise((resolve, reject) => zip(files, { level: 0 }, (error, bytes) => error ? reject(error) : resolve(bytes)));
}
