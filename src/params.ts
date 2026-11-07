// Copyright (C) 2026 leolee9086 and 织. AGPL-3.0-or-later.
export const PARAM_VERSION = 1;
export const MAP_NAMES = ['basecolor', 'roughness', 'height', 'normal'] as const;
export type MapName = typeof MAP_NAMES[number];
export type RGB = [number, number, number];

export interface MarbleParams {
  seed: number;
  cells: number;
  veinWidth: number;
  veinContrast: number;
  fineVeins: number;
  warp: number;
  cloud: number;
  grain: number;
  roughness: number;
  relief: number;
  normalStrength: number;
  baseColor: string;
  veinColor: string;
  mineralColor: string;
}

export interface Preset {
  id: string;
  name: string;
  note: string;
  params: MarbleParams;
}

export const DEFAULT_PARAMS: MarbleParams = {
  seed: 42671, cells: 9, veinWidth: 0.009, veinContrast: 0.7,
  fineVeins: 0.96, warp: 0.95, cloud: 0.78, grain: 0.34,
  roughness: 0.22, relief: 0.08, normalStrength: 0.35,
  baseColor: '#918b90', veinColor: '#cfcdc8', mineralColor: '#68686d',
};

export const PRESETS: Preset[] = [
  { id: 'silver-grey', name: '银灰碎脉', note: '细白脉 · 灰色矿物底', params: { ...DEFAULT_PARAMS } },
  { id: 'mist', name: '雾白细脉', note: '浅灰底 · 柔和脉络', params: { ...DEFAULT_PARAMS, seed: 18302, cells: 5, baseColor: '#cececa', veinColor: '#f1ede5', mineralColor: '#999b9a', veinContrast: 0.45, fineVeins: 0.5, cloud: 0.31 } },
  { id: 'graphite', name: '石墨银线', note: '深石墨 · 银白结晶', params: { ...DEFAULT_PARAMS, seed: 71238, baseColor: '#343a3d', veinColor: '#c5ceca', mineralColor: '#20262b', veinWidth: 0.013, veinContrast: 0.85, cloud: 0.65, roughness: 0.19 } },
  { id: 'warm', name: '暖灰云石', note: '暖灰褐 · 米白脉络', params: { ...DEFAULT_PARAMS, seed: 31107, cells: 6, baseColor: '#9c9085', veinColor: '#ded6c6', mineralColor: '#726b67', warp: 0.8, roughness: 0.3 } },
];

export const RANGES = {
  seed: [0, 999999, 1], cells: [3, 18, 1], veinWidth: [0.004, 0.06, 0.001],
  veinContrast: [0, 1, 0.01], fineVeins: [0, 1, 0.01], warp: [0, 1.5, 0.01],
  cloud: [0, 1, 0.01], grain: [0, 1, 0.01], roughness: [0.06, 0.9, 0.01],
  relief: [0, 1, 0.01], normalStrength: [0, 3, 0.05],
} as const;
export type NumericKey = keyof typeof RANGES;

export function validateParams(input: unknown): MarbleParams {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('预设参数必须是对象。');
  const value = input as Record<string, unknown>;
  const result = {} as MarbleParams;
  for (const [key, limits] of Object.entries(RANGES)) {
    const n = value[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < limits[0] || n > limits[1]) {
      throw new Error(`参数 ${key} 超出有效范围 ${limits[0]}–${limits[1]}。`);
    }
    if ((key === 'seed' || key === 'cells') && !Number.isInteger(n)) throw new Error(`${key} 必须是整数。`);
    (result as unknown as Record<string, unknown>)[key] = n;
  }
  for (const key of ['baseColor', 'veinColor', 'mineralColor'] as const) {
    if (typeof value[key] !== 'string' || !/^#[\da-f]{6}$/i.test(value[key])) throw new Error(`颜色 ${key} 无效。`);
    result[key] = value[key] as string;
  }
  return result;
}

export function decodePreset(text: string): MarbleParams {
  const doc = JSON.parse(text);
  if (doc?.schema !== 'marble-web/preset' || doc.version !== PARAM_VERSION) throw new Error('不支持的石脉预设格式或版本。');
  return validateParams(doc.params);
}

export function presetJSON(params: MarbleParams): string {
  return JSON.stringify({ schema: 'marble-web/preset', version: PARAM_VERSION, params: validateParams(params) }, null, 2);
}

export function hexRGB(hex: string): RGB {
  return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255) as RGB;
}

/** 6个vec4，保持WGSL uniform的16字节对齐。颜色按sRGB数值写入底色PNG。 */
export function packParams(params: MarbleParams, size: number, diagnostic = false): Float32Array<ArrayBuffer> {
  const p = validateParams(params);
  if (!Number.isInteger(size) || size < 16 || size > 4096) throw new Error('分辨率必须在16–4096之间。');
  return new Float32Array([
    size, p.seed, p.cells, p.veinWidth,
    p.warp, p.fineVeins, p.cloud, p.grain,
    ...hexRGB(p.baseColor), p.veinContrast,
    ...hexRGB(p.veinColor), p.roughness,
    ...hexRGB(p.mineralColor), p.relief,
    p.normalStrength, diagnostic ? 1 : 0, 0, 0,
  ]);
}
