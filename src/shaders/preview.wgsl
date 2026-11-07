// Copyright (C) 2026 leolee9086 and 织. AGPL-3.0-or-later.
struct View { options: vec4f, viewport: vec4f } // map, repeat, mode, exposure / width,height,lightX,lightY
@group(0) @binding(0) var<uniform> v: View;
@group(0) @binding(1) var texSampler: sampler;
@group(0) @binding(2) var baseMap: texture_2d<f32>;
@group(0) @binding(3) var roughMap: texture_2d<f32>;
@group(0) @binding(4) var normalMap: texture_2d<f32>;
@group(0) @binding(5) var heightMap: texture_2d<f32>;
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertex(@builtin(vertex_index) index: u32) -> VertexOut {
  let points = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VertexOut;
  o.position = vec4f(points[index], 0.0, 1.0);
  o.uv = vec2f(points[index].x * 0.5 + 0.5, 0.5 - points[index].y * 0.5);
  return o;
}
fn base(uv: vec2f) -> vec3f { return textureSampleLevel(baseMap, texSampler, uv, 0.0).rgb; }
fn rough(uv: vec2f) -> f32 { return textureSampleLevel(roughMap, texSampler, uv, 0.0).r; }
fn normal(uv: vec2f) -> vec3f { return textureSampleLevel(normalMap, texSampler, uv, 0.0).xyz * 2.0 - 1.0; }
fn height(uv: vec2f) -> f32 {
  let size = vec2i(textureDimensions(heightMap));
  let pixel = vec2i(fract(uv) * vec2f(size));
  return textureLoad(heightMap, pixel, 0).r;
}
fn displayMap(uv: vec2f) -> vec3f {
  if (v.options.x < 0.5) { return base(uv); }
  if (v.options.x < 1.5) { return vec3f(rough(uv)); }
  if (v.options.x < 2.5) { return vec3f(height(uv)); }
  return normal(uv) * 0.5 + 0.5;
}
// 预览用GGX近似照明。灯光只作用于此渲染通道，生成的底色不包含反射。
fn illuminate(uv: vec2f, geoNormal: vec3f, tangent: vec3f, bitangent: vec3f) -> vec3f {
  let sampledNormal = normal(uv);
  let n = normalize(tangent * sampledNormal.x + bitangent * sampledNormal.y + geoNormal * sampledNormal.z);
  let view = vec3f(0.0, 0.0, 1.0);
  let l = normalize(vec3f(v.viewport.z, v.viewport.w, 1.5));
  let halfway = normalize(l + view);
  let nv = max(dot(n, view), 0.001);
  let nl = max(dot(n, l), 0.0);
  let nh = max(dot(n, halfway), 0.0);
  let vh = max(dot(view, halfway), 0.0);
  let r = max(rough(uv), 0.07);
  let a = r * r;
  let a2 = a * a;
  let den = nh * nh * (a2 - 1.0) + 1.0;
  let distribution = a2 / max(3.141593 * den * den, 0.00001);
  let k = (r + 1.0) * (r + 1.0) / 8.0;
  let geometry = nv / (nv * (1.0 - k) + k) * nl / (nl * (1.0 - k) + k);
  let fresnel = 0.04 + 0.96 * pow(1.0 - vh, 5.0);
  let specular = distribution * geometry * fresnel / max(4.0 * nv * nl, 0.001);
  let albedo = pow(base(uv), vec3f(2.2));
  let environment = vec3f(0.52, 0.56, 0.59) * (0.45 + 0.25 * n.y);
  let rim = pow(1.0 - nv, 4.0) * vec3f(0.18, 0.23, 0.25);
  let color = (albedo * (environment + vec3f(nl * 0.85)) + vec3f(specular * nl * 1.5) + rim) * v.options.w;
  return pow(max(color, vec3f(0.0)), vec3f(1.0 / 2.2));
}
@fragment fn fragment(in: VertexOut) -> @location(0) vec4f {
  let uv = in.uv;
  if (v.options.z > 1.5) {
    let pos = (uv * 2.0 - 1.0) * vec2f(v.viewport.x / v.viewport.y, -1.0) * 1.12;
    let radius = dot(pos, pos);
    let bg = mix(vec3f(0.095, 0.113, 0.118), vec3f(0.16, 0.175, 0.18), uv.y);
    if (radius >= 1.0) { return vec4f(bg, 1.0); }
    let n = vec3f(pos, sqrt(1.0 - radius));
    let spherical = vec2f(atan2(n.x, n.z) / 6.283185 + 0.5, acos(n.y) / 3.141593);
    let tangent = normalize(vec3f(n.z, 0.0, -n.x));
    let bitangent = normalize(cross(n, tangent));
    let color = illuminate(spherical * 2.0, n, tangent, bitangent);
    let alpha = 1.0 - smoothstep(0.995, 1.0, radius);
    return vec4f(mix(bg, color, alpha), 1.0);
  }
  if (v.options.z > 0.5) {
    return vec4f(illuminate(uv * v.options.y, vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0)), 1.0);
  }
  return vec4f(displayMap(uv * v.options.y), 1.0);
}
