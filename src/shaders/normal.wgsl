// Copyright (C) 2026 leolee9086 and 织. AGPL-3.0-or-later.
struct Params { shape: vec4f, detail: vec4f, base: vec4f, vein: vec4f, mineral: vec4f, extra: vec4f }
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var heights: texture_2d<f32>;
@group(0) @binding(2) var normalOut: texture_storage_2d<rgba8unorm, write>;
fn h(pos: vec2i, size: i32) -> f32 {
  // 周期邻域：边缘法线也从对侧取样，不能clamp到边界。
  let q = ((pos % size) + size) % size;
  return textureLoad(heights, q, 0).r;
}
@compute @workgroup_size(8, 8)
fn derive(@builtin(global_invocation_id) id: vec3u) {
  let size = i32(p.shape.x);
  if (id.x >= u32(size) || id.y >= u32(size)) { return; }
  let q = vec2i(id.xy);
  let dx = (h(q + vec2i(1, 0), size) - h(q - vec2i(1, 0), size)) * f32(size) * 0.5;
  let dy = (h(q + vec2i(0, 1), size) - h(q - vec2i(0, 1), size)) * f32(size) * 0.5;
  // 图片Y向下、UV的V向上，因此绿色通道取+dy，得到OpenGL +Y切线空间法线。
  let normal = normalize(vec3f(-dx * p.extra.x, dy * p.extra.x, 1.0));
  textureStore(normalOut, id.xy, vec4f(normal * 0.5 + 0.5, 1.0));
}
