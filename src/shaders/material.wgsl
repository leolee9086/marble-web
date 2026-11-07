// Copyright (C) 2026 leolee9086 and 织. AGPL-3.0-or-later.
// 所有空间函数使用整数周期：域扭曲也周期化，不能对旋转坐标直接fract再噪声。
struct Params {
  shape: vec4f,       // 分辨率、种子、主晶胞数、脉络宽度
  detail: vec4f,      // 扭曲、细脉、云雾、颗粒
  base: vec4f,        // 底色RGB、脉络对比
  vein: vec4f,        // 脉络RGB、粗糙度
  mineral: vec4f,     // 矿物RGB、相对高度
  extra: vec4f,       // 法线强度、周期诊断标记
}
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var baseOut: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var roughOut: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var heightOut: texture_storage_2d<r32float, write>;

fn hash(v: vec2i, salt: u32) -> f32 {
  var h = (u32(v.x) * 1597334677u) ^ (u32(v.y) * 3812015801u) ^ (salt * 2798796415u);
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  return f32(h ^ (h >> 16u)) / 4294967295.0;
}
fn wrap(v: vec2i, n: i32) -> vec2i { return ((v % n) + n) % n; }
fn noise(uv: vec2f, period: i32, salt: u32) -> f32 {
  let q = uv * f32(period);
  let cell = vec2i(floor(q));
  let f = fract(q);
  let s = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = hash(wrap(cell, period), salt);
  let b = hash(wrap(cell + vec2i(1, 0), period), salt);
  let c = hash(wrap(cell + vec2i(0, 1), period), salt);
  let d = hash(wrap(cell + vec2i(1, 1), period), salt);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}
fn fbm(uv: vec2f, period: i32, salt: u32) -> f32 {
  var value = 0.0;
  var amplitude = 0.533333;
  var n = period;
  for (var i = 0u; i < 4u; i++) {
    value += amplitude * noise(uv, n, salt + i * 29u);
    n *= 2;
    amplitude *= 0.5;
  }
  return value;
}
// 周期Voronoi的F2-F1给出相互连通的矿物边界；种子仅包裹哈希，距离仍用展开坐标。
fn cells(uv: vec2f, period: i32, salt: u32) -> vec2f {
  let q = uv * f32(period);
  let cell = vec2i(floor(q));
  let f = fract(q);
  var first = 100.0;
  var second = 100.0;
  var mineral = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let offset = vec2i(x, y);
      let key = wrap(cell + offset, period);
      let site = vec2f(0.2) + 0.6 * vec2f(hash(key, salt), hash(key, salt + 71u));
      let delta = vec2f(offset) + site - f;
      let d = dot(delta, delta);
      if (d < first) {
        second = first;
        first = d;
        mineral = hash(key, salt + 113u);
      } else if (d < second) { second = d; }
    }
  }
  return vec2f(sqrt(second) - sqrt(first), mineral);
}

@compute @workgroup_size(8, 8)
fn generate(@builtin(global_invocation_id) id: vec3u) {
  let size = u32(p.shape.x);
  if (id.x >= size || id.y >= size) { return; }
  // 常规输出在像素中心采样。诊断输出精确采样0与1，用于验证周期函数本身。
  var uv = (vec2f(id.xy) + 0.5) / f32(size);
  if (p.extra.y > 0.5) { uv = vec2f(id.xy) / f32(size - 1u); }
  let seed = u32(p.shape.y);
  let n = i32(p.shape.z);
  let flow = vec2f(fbm(uv, 3, seed + 5u), fbm(uv, 3, seed + 37u)) - 0.5;
  let ripple = vec2f(fbm(uv, 17, seed + 83u), fbm(uv, 17, seed + 137u)) - 0.5;
  let fracture = vec2f(noise(uv, 93, seed + 157u), noise(uv, 93, seed + 181u)) - 0.5;
  let q = uv + flow * p.detail.x * 0.38 + ripple * p.detail.x * 0.065 + fracture * p.detail.x * 0.004;
  let mainCell = cells(q, n, seed);
  let smallCell = cells(q + vec2f(0.213, 0.432), n * 3, seed + 291u);
  let hairCell = cells(q, n * 7, seed + 571u);
  let cloud = fbm(q, 5, seed + 787u);
  let dust = fbm(q, 35, seed + 887u);
  let grain = noise(uv, 320, seed + 911u);
  // 宽度随空间变化，主脉和细脉相互叠加，避免匀粗的蜂窝描边。
  let irregular = 0.4 + fbm(q, 19, seed + 199u) * 1.5;
  let w = p.shape.w * irregular;
  let aa = max(0.001, f32(n) / f32(size) * (0.2 + p.detail.x * 0.35));
  let mainVein = 1.0 - smoothstep(w * 0.15, w + aa, mainCell.x);
  let halo = 1.0 - smoothstep(w, w * 5.0 + aa, mainCell.x);
  let broken = smoothstep(0.25, 0.72, noise(q, n * 2, seed + 771u));
  let secondary = (1.0 - smoothstep(w * 0.15, w * 1.1 + aa * 2.0, smallCell.x)) * p.detail.y * (0.4 + 0.6 * broken);
  let hair = (1.0 - smoothstep(0.001, w * 0.8 + aa * 3.0, hairCell.x)) * p.detail.y * 0.72;
  let vein = clamp(mainVein * (0.55 + 0.45 * broken) + secondary * 0.9 + hair * 0.7, 0.0, 1.0);
  let mineralMix = clamp(0.28 + (cloud - 0.5) * 2.4 * p.detail.z + (mainCell.y - 0.5) * 0.12, 0.0, 0.85);
  var base = mix(p.base.rgb, p.mineral.rgb, mineralMix);
  base += vec3f((dust - 0.5) * 0.23 * p.detail.z + (grain - 0.5) * p.detail.w * 0.14);
  base = mix(base, p.vein.rgb, clamp(vein * p.base.a + halo * p.base.a * 0.12, 0.0, 1.0));
  let roughness = clamp(p.vein.a + (dust - 0.5) * 0.08 + grain * p.detail.w * 0.035 - vein * 0.045, 0.03, 1.0);
  // 相对高度，不表示从照片测得的实际毫米。抛光材料只保留轻微矿物起伏。
  let height = 0.5 + p.mineral.a * ((cloud - 0.5) * 0.035 + (dust - 0.5) * 0.018 + vein * 0.006 + (grain - 0.5) * p.detail.w * 0.003);
  textureStore(baseOut, id.xy, vec4f(clamp(base, vec3f(0.0), vec3f(1.0)), 1.0));
  textureStore(roughOut, id.xy, vec4f(vec3f(roughness), 1.0));
  textureStore(heightOut, id.xy, vec4f(height, 0.0, 0.0, 1.0));
}
