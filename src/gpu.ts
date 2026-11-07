// Copyright (C) 2026 leolee9086 and 织. AGPL-3.0-or-later.
import materialSource from './shaders/material.wgsl?raw';
import normalSource from './shaders/normal.wgsl?raw';
import previewSource from './shaders/preview.wgsl?raw';
import { packParams, type MapName, type MarbleParams } from './params';

export interface TextureSet {
  size: number;
  basecolor: GPUTexture;
  roughness: GPUTexture;
  height: GPUTexture;
  normal: GPUTexture;
}
export interface ViewOptions { map: MapName; repeat: number; mode: 'map' | 'slab' | 'sphere'; exposure: number }

export class MarbleGPU {
  readonly device: GPUDevice;
  readonly adapterName: string;
  readonly canvas: HTMLCanvasElement;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly paramsBuffer: GPUBuffer;
  private readonly viewBuffer: GPUBuffer;
  private readonly sampler: GPUSampler;
  private generation!: GPUComputePipeline;
  private normals!: GPUComputePipeline;
  private preview!: GPURenderPipeline;
  private viewGroup?: GPUBindGroup;
  textures?: TextureSet;
  lastParams?: MarbleParams;
  lost = false;
  onError: (message: string) => void = () => {};
  view: ViewOptions = { map: 'basecolor', repeat: 1, mode: 'map', exposure: 1.1 };
  light = [-0.65, 0.85];

  private constructor(device: GPUDevice, canvas: HTMLCanvasElement, name: string) {
    this.device = device;
    this.canvas = canvas;
    this.adapterName = name;
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('无法创建 WebGPU 画布。');
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.paramsBuffer = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.viewBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear' });
    device.lost.then(info => {
      this.lost = true;
      if (info.reason !== 'destroyed') this.onError(`显卡连接已中断：${info.message || info.reason}。请重新加载页面。`);
    });
    device.addEventListener('uncapturederror', event => this.onError(`WebGPU：${event.error.message}`));
  }

  static async create(canvas: HTMLCanvasElement): Promise<MarbleGPU> {
    if (!window.isSecureContext) throw new Error('请通过 localhost 或 HTTPS 打开，浏览器才会启用 WebGPU。');
    if (!navigator.gpu) throw new Error('此浏览器未启用 WebGPU。请使用开启硬件加速的新版 Chrome 或 Edge。');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('没有可用的 WebGPU 显卡适配器，请检查浏览器硬件加速和显卡驱动。');
    const device = await adapter.requestDevice();
    const info = adapter.info;
    const gpu = new MarbleGPU(device, canvas, [info.vendor, info.architecture, info.description].filter(Boolean).join(' · ') || 'WebGPU');
    try {
      await gpu.initPipelines();
      return gpu;
    } catch (error) {
      gpu.dispose();
      throw error;
    }
  }

  private async module(code: string, label: string): Promise<GPUShaderModule> {
    const module = this.device.createShaderModule({ code, label });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error(`${label}\n${errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n')}`);
    return module;
  }

  private async initPipelines(): Promise<void> {
    const d = this.device;
    const [material, normal, preview] = await Promise.all([
      this.module(materialSource, '石材生成'), this.module(normalSource, '周期法线'), this.module(previewSource, '材质预览'),
    ]);
    this.generation = await d.createComputePipelineAsync({ layout: 'auto', compute: { module: material, entryPoint: 'generate' } });
    // r32float在没有float32-filterable扩展时也可工作；此处只做textureLoad。
    const normalLayout = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
    ] });
    this.normals = await d.createComputePipelineAsync({ layout: d.createPipelineLayout({ bindGroupLayouts: [normalLayout] }), compute: { module: normal, entryPoint: 'derive' } });
    const previewLayout = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ...[2, 3, 4].map(binding => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' as const } })),
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
    ] });
    this.preview = await d.createRenderPipelineAsync({
      layout: d.createPipelineLayout({ bindGroupLayouts: [previewLayout] }),
      vertex: { module: preview, entryPoint: 'vertex' },
      fragment: { module: preview, entryPoint: 'fragment', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  private newTextures(size: number): TextureSet {
    const create = (format: GPUTextureFormat) => this.device.createTexture({
      size: [size, size], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    return { size, basecolor: create('rgba8unorm'), roughness: create('rgba8unorm'), height: create('r32float'), normal: create('rgba8unorm') };
  }

  /** 调用方串行生成，保留旧贴图直到新一轮成功，避免失败后出现空画布。 */
  async generate(params: MarbleParams, size: number, diagnostic = false): Promise<number> {
    if (this.lost) throw new Error('WebGPU 设备已断开，请重新加载。');
    const packed = packParams(params, size, diagnostic);
    if (size > this.device.limits.maxTextureDimension2D) throw new Error('此显卡不支持该贴图尺寸。');
    const start = performance.now();
    const d = this.device;
    d.pushErrorScope('validation');
    d.pushErrorScope('out-of-memory');
    const textures = this.newTextures(size);
    let submittedError: unknown;
    try {
      d.queue.writeBuffer(this.paramsBuffer, 0, packed);
      const generationGroup = d.createBindGroup({ layout: this.generation.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: textures.basecolor.createView() },
        { binding: 2, resource: textures.roughness.createView() },
        { binding: 3, resource: textures.height.createView() },
      ] });
      const normalGroup = d.createBindGroup({ layout: this.normals.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: textures.height.createView() },
        { binding: 2, resource: textures.normal.createView() },
      ] });
      const encoder = d.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.generation);
      pass.setBindGroup(0, generationGroup);
      pass.dispatchWorkgroups(Math.ceil(size / 8), Math.ceil(size / 8));
      pass.end();
      const normalPass = encoder.beginComputePass();
      normalPass.setPipeline(this.normals);
      normalPass.setBindGroup(0, normalGroup);
      normalPass.dispatchWorkgroups(Math.ceil(size / 8), Math.ceil(size / 8));
      normalPass.end();
      d.queue.submit([encoder.finish()]);
      await d.queue.onSubmittedWorkDone();
    } catch (error) { submittedError = error; }
    const memoryError = await d.popErrorScope();
    const validationError = await d.popErrorScope();
    if (submittedError || memoryError || validationError || this.lost) {
      this.destroyTextures(textures);
      throw new Error(String(submittedError || memoryError?.message || validationError?.message || '显卡已断开。'));
    }
    const old = this.textures;
    this.textures = textures;
    this.lastParams = { ...params };
    this.viewGroup = d.createBindGroup({ layout: this.preview.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.viewBuffer } },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: textures.basecolor.createView() },
      { binding: 3, resource: textures.roughness.createView() },
      { binding: 4, resource: textures.normal.createView() },
      { binding: 5, resource: textures.height.createView() },
    ] });
    if (old) this.destroyTextures(old);
    this.render();
    return performance.now() - start;
  }

  render(): void {
    if (!this.viewGroup || this.lost) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    const map = { basecolor: 0, roughness: 1, height: 2, normal: 3 }[this.view.map];
    const mode = { map: 0, slab: 1, sphere: 2 }[this.view.mode];
    this.device.queue.writeBuffer(this.viewBuffer, 0, new Float32Array([map, this.view.repeat, mode, this.view.exposure, width, height, ...this.light]));
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.09, g: 0.1, b: 0.11, a: 1 } }] });
    pass.setPipeline(this.preview);
    pass.setBindGroup(0, this.viewGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /** GPU回读对齐到256字节行距，再去除填充；高度保持32位浮点到PNG编码前。 */
  async readMap(name: MapName): Promise<Uint8Array | Float32Array> {
    const textures = this.textures;
    if (!textures) throw new Error('请先生成材质。');
    const { size } = textures;
    const bytesPerRow = Math.ceil(size * 4 / 256) * 256;
    const buffer = this.device.createBuffer({ size: bytesPerRow * size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: textures[name] }, { buffer, bytesPerRow }, [size, size]);
      this.device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const raw = new Uint8Array(buffer.getMappedRange());
      const contiguous = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) contiguous.set(raw.subarray(y * bytesPerRow, y * bytesPerRow + size * 4), y * size * 4);
      return name === 'height' ? new Float32Array(contiguous.buffer) : contiguous;
    } finally { buffer.unmap(); buffer.destroy(); }
  }

  private destroyTextures(textures: TextureSet): void {
    for (const key of ['basecolor', 'roughness', 'height', 'normal'] as const) textures[key].destroy();
  }

  dispose(): void {
    if (this.textures) this.destroyTextures(this.textures);
    this.paramsBuffer.destroy();
    this.viewBuffer.destroy();
    this.context.unconfigure();
    this.device.destroy();
  }
}
