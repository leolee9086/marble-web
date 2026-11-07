// Copyright (C) 2026 leolee9086 and 织. AGPL-3.0-or-later.
import './style.css';
import { MarbleGPU, type ViewOptions } from './gpu';
import { DEFAULT_PARAMS, MAP_NAMES, PRESETS, RANGES, decodePreset, presetJSON, type MarbleParams, type MapName, type NumericKey } from './params';
import { download, mapPNG, materialZIP } from './export';

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`找不到界面元素 ${selector}`);
  return element;
};
const icon = (name: string) => {
  const paths: Record<string, string> = {
    download: '<path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/>',
    shuffle: '<path d="m3 5 4 0 10 14h4m-4-4 4 4-4 4M3 19h4L17 5h4m-4-4 4 4-4 4"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    reset: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-16-2 20"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};
const labels: Record<NumericKey, string> = {
  seed: '随机种子', cells: '主脉密度', veinWidth: '脉络宽度', veinContrast: '脉络亮度',
  fineVeins: '细脉层次', warp: '自然曲折', cloud: '矿物云雾', grain: '结晶颗粒',
  roughness: '表面粗糙度', relief: '微表面起伏', normalStrength: '法线强度',
};
const mapLabels: Record<MapName, string> = { basecolor: '底色', roughness: '粗糙度', height: '高度', normal: '法线' };
const mapNotes: Record<MapName, string> = { basecolor: 'sRGB · 无光照底色', roughness: 'Linear · 白色更粗糙', height: 'Linear · 16-bit PNG', normal: 'Linear · OpenGL +Y' };
let params = { ...DEFAULT_PARAMS };
let presetId = 'silver-grey';
let referenceURL: string | undefined;
let referenceBitmap: ImageBitmap | undefined;
let storageNotice = '';
try {
  const saved = localStorage.getItem('marble-web:preset:v1');
  if (saved) { params = decodePreset(saved); presetId = ''; }
} catch { storageNotice = '上次保存的预设无法读取，已载入银灰碎脉。'; }

function sliders(keys: NumericKey[]): string {
  return keys.map(key => {
    const [min, max, step] = RANGES[key];
    return `<label class="slider-row" for="${key}"><span>${labels[key]}</span><output id="${key}-value">${params[key]}</output><input data-param="${key}" id="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${params[key]}" /></label>`;
  }).join('');
}

$('#app').innerHTML = `
  <header class="app-header">
    <a class="brand" href="./" aria-label="石脉首页"><span class="brand-mark">石</span><span>石脉 <small>MARBLE LAB</small></span></a>
    <span class="header-caption">程序化石材工作台 <span class="divider">/</span> 01</span>
    <div class="header-right"><span class="local-pill"><i></i> 本地生成</span><button id="about" class="text-button">${icon('code')} 开源</button></div>
  </header>
  <main class="workspace">
    <aside class="controls">
      <div class="panel-intro"><span class="eyebrow">MATERIAL LIBRARY</span><h1>让石纹，自然生长。</h1><p>从一组参数，生成独属于你的石材。</p></div>
      <fieldset id="parameter-controls">
        <section class="control-section"><div class="section-title"><h2>材质起点</h2><span>01</span></div>
          <div class="presets">${PRESETS.map(p => `<button class="preset ${p.id === presetId ? 'active' : ''}" data-preset="${p.id}" aria-pressed="${p.id === presetId}"><span class="preset-swatch" style="--stone:${p.params.baseColor};--vein:${p.params.veinColor}"></span><span>${p.name}<small>${p.note}</small></span></button>`).join('')}</div>
          <div class="seed-row"><label for="seed">种子</label><input id="seed" data-param="seed" type="number" min="0" max="999999" step="1" value="${params.seed}" /><button id="random" class="icon-button" title="生成新的石纹" aria-label="生成新的石纹">${icon('shuffle')}</button></div>
        </section>
        <section class="control-section"><div class="section-title"><h2>矿物色彩</h2><span>02</span></div>
          <div class="colors">${(['baseColor', 'veinColor', 'mineralColor'] as const).map((key, i) => `<label><input type="color" id="${key}" data-color="${key}" value="${params[key]}" aria-label="${['石材底色', '白色脉络', '深色矿物'][i]}" /><span>${['底色', '脉络', '矿物'][i]}</span><small id="${key}-value">${params[key]}</small></label>`).join('')}</div>
          <details class="reference"><summary>从参考照片取色 <span>＋</span></summary><p>上传后点击照片，选取石材底色。照片保留在本机。</p><label class="upload-label">选择参考照片<input type="file" id="reference-file" accept="image/png,image/jpeg,image/webp" /></label><canvas id="reference-canvas" aria-label="点击参考照片选取底色" hidden></canvas></details>
        </section>
        <section class="control-section"><div class="section-title"><h2>纹理生长</h2><span>03</span></div>${sliders(['cells', 'veinWidth', 'veinContrast', 'fineVeins', 'warp', 'cloud', 'grain'])}</section>
        <section class="control-section"><div class="section-title"><h2>表面质感</h2><span>04</span></div>${sliders(['roughness', 'relief', 'normalStrength'])}<p class="hint">抛光效果在材质预览中查看。</p></section>
        <div class="preset-actions"><button id="save-preset" class="text-button">保存参数</button><label class="text-button import-label">载入参数<input id="import-preset" type="file" accept=".json,application/json" /></label><button id="reset" class="icon-button" aria-label="恢复银灰碎脉默认参数" title="恢复默认">${icon('reset')}</button></div>
      </fieldset>
    </aside>
    <section class="studio" aria-label="石材预览工作区">
      <div class="studio-heading"><div><span class="eyebrow">YOUR MATERIAL</span><h2 id="material-title">银灰碎脉 <span>/ Silver grey</span></h2></div><span class="seamless-badge">↔ 无缝循环</span></div>
      <div class="preview-toolbar"><div class="segmented" role="group" aria-label="预览方式"><button data-view="single" class="active" aria-pressed="true">单张</button><button data-view="tile" aria-pressed="false">${icon('grid')} 四方平铺</button><button data-view="slab" aria-pressed="false">抛光面</button><button data-view="sphere" aria-pressed="false">材质球</button></div><label class="resolution">预览<select id="preview-size" aria-label="预览分辨率"><option value="512">512</option><option value="1024" selected>1K</option><option value="2048">2K</option></select></label></div>
      <div class="canvas-area"><div class="canvas-frame"><canvas id="preview" aria-label="实时无缝石材预览"></canvas><div id="canvas-placeholder">正在准备 WebGPU…</div><div id="tile-guides" hidden><i></i><i></i></div></div><div class="canvas-caption"><span id="preview-caption">底色贴图 · 无烘焙光照</span><span id="dimensions">1024 × 1024</span></div></div>
      <div class="map-strip" role="group" aria-label="材质通道">${MAP_NAMES.map((map, i) => `<button data-map="${map}" class="map-card ${i === 0 ? 'active' : ''}" aria-pressed="${i === 0}"><canvas width="96" height="96" id="thumb-${map}" aria-hidden="true"></canvas><span>${mapLabels[map]}<small>${['BASE COLOR', 'ROUGHNESS', 'HEIGHT · 16 BIT', 'NORMAL · +Y'][i]}</small></span><span class="map-index">0${i + 1}</span></button>`).join('')}</div>
      <footer class="studio-status"><span id="status" role="status" aria-live="polite">正在连接显卡</span><span id="gpu-name">WEBGPU ENGINE</span></footer>
      <div id="error" role="alert" hidden></div>
    </section>
    <aside class="export-panel"><span class="eyebrow">TAKE IT WITH YOU</span><h2>带进你的场景</h2><p class="export-description">同一组石纹，四张互相对应的材质贴图。</p>
      <label class="field-label" for="export-size">导出分辨率</label><select id="export-size"><option value="1024">1K · 1024 × 1024</option><option value="2048" selected>2K · 2048 × 2048</option><option value="4096">4K · 4096 × 4096</option></select>
      <div class="export-spec"><span>格式</span><b>PNG / ZIP</b><span>平铺方式</span><b>横纵双向循环</b><span>金属度</span><b>0 · 非金属</b></div>
      <button id="export-pack" class="primary-button" disabled>${icon('download')} 导出 PBR 材质包</button><button id="export-map" class="secondary-button" disabled>下载当前底色贴图</button>
      <p class="export-tip" id="export-tip">底色使用 sRGB，其他通道使用线性数据。高度图为 16 位，法线为 OpenGL +Y。</p>
      <div class="divider-line"></div><h3>为真实材质留出光线</h3><p class="quiet">贴图保留石材的颜色和脉络。灯光、高光与反射，由你的场景决定。</p>
      <div class="preview-note"><span class="mini-orbit">◌</span><p>在抛光面或材质球上移动鼠标，改变预览光线。</p></div>
      <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer" class="license-link">AGPL-3.0-or-later ↗</a>
    </aside>
  </main>
  <dialog id="about-dialog"><form method="dialog"><button class="dialog-close" aria-label="关闭">×</button></form><span class="eyebrow">OPEN SOURCE</span><h2>石脉 · Marble Lab</h2><p>一个在浏览器本地运行的 WebGPU 无缝石材生成器。</p><p>Copyright © 2026 leolee9086 & 织。源码采用 AGPL-3.0-or-later。程序化生成的贴图可自由用于个人和商业项目。</p><p>采用周期晶胞、域扭曲与多尺度矿物纹理。生成无需远程服务；参考照片仅用于本地取色。</p><p><a href="https://github.com/leolee9086/marble-web" target="_blank" rel="noreferrer">查看源码与运行说明 ↗</a> · <a href="https://github.com/leolee9086/marble-web/archive/refs/heads/main.zip">下载源码</a></p><a href="./LICENSE" target="_blank">查看许可证与无担保声明 ↗</a></dialog>
`;

let gpu: MarbleGPU | undefined;
let generating = false;
let exporting = false;
let pending = false;
let debounce: ReturnType<typeof setTimeout> | undefined;
let currentView = 'single';
let currentMap: MapName = 'basecolor';
let renderTime = 0;

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function showError(error: unknown): void {
  const element = $('#error');
  element.hidden = false;
  element.textContent = errorText(error);
  $('#status').textContent = '需要处理上面的提示';
}
function clearError(): void { $('#error').hidden = true; }
function updateButtons(): void {
  const disabled = !gpu?.textures || gpu.lost || generating || exporting || pending;
  $<HTMLButtonElement>('#export-map').disabled = disabled;
  $<HTMLButtonElement>('#export-pack').disabled = disabled;
  $<HTMLFieldSetElement>('#parameter-controls').disabled = exporting;
  $<HTMLSelectElement>('#preview-size').disabled = exporting;
  $<HTMLSelectElement>('#export-size').disabled = exporting;
}
function updateInputs(): void {
  for (const key of Object.keys(RANGES) as NumericKey[]) {
    $<HTMLInputElement>(`#${key}`).value = String(params[key]);
    const output = document.getElementById(`${key}-value`);
    if (output) output.textContent = String(params[key]);
  }
  for (const key of ['baseColor', 'veinColor', 'mineralColor'] as const) {
    $<HTMLInputElement>(`#${key}`).value = params[key];
    $(`#${key}-value`).textContent = params[key].toUpperCase();
  }
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => {
    const active = button.dataset.preset === presetId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function persist(): void {
  try { localStorage.setItem('marble-web:preset:v1', presetJSON(params)); }
  catch { showError('浏览器无法保存参数，请使用“保存参数”下载JSON文件。'); }
}
function schedule(): void {
  clearTimeout(debounce);
  pending = true;
  updateButtons();
  debounce = setTimeout(() => void drain(), 160);
}
async function thumbnails(): Promise<void> {
  if (!gpu?.textures) return;
  const size = gpu.textures.size;
  for (const map of MAP_NAMES) {
    const values = await gpu.readMap(map);
    const target = $<HTMLCanvasElement>(`#thumb-${map}`);
    const ctx = target.getContext('2d');
    if (!ctx) continue;
    const image = ctx.createImageData(96, 96);
    // 缩略图不参与导出；直接抽样GPU结果，避免创建四个全尺寸2D画布。
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      const from = Math.min(size - 1, Math.floor((y + 0.5) / 96 * size)) * size + Math.min(size - 1, Math.floor((x + 0.5) / 96 * size));
      const to = (y * 96 + x) * 4;
      for (let c = 0; c < 3; c++) image.data[to + c] = map === 'height' ? Math.round((values as Float32Array)[from] * 255) : (values as Uint8Array)[from * 4 + c];
      image.data[to + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
}
async function drain(): Promise<void> {
  if (!gpu || generating || exporting) return;
  generating = true;
  updateButtons();
  try {
    while (pending) {
      pending = false;
      clearError();
      $('#status').textContent = '正在生成石纹…';
      const snapshot = { ...params };
      const size = Number($<HTMLSelectElement>('#preview-size').value);
      renderTime = await gpu.generate(snapshot, size);
      if (!pending) {
        $('#canvas-placeholder').hidden = true;
        $('#dimensions').textContent = `${size} × ${size}`;
        await thumbnails();
        $('#status').textContent = `已生成 · 种子 ${snapshot.seed} · ${Math.round(renderTime)} ms`;
        persist();
      }
    }
  } catch (error) { pending = false; showError(error); }
  finally { generating = false; updateButtons(); }
}
function setView(view: string): void {
  currentView = view;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  });
  $('#tile-guides').hidden = view !== 'tile';
  if (gpu) {
    gpu.view.mode = view === 'sphere' ? 'sphere' : view === 'slab' ? 'slab' : 'map';
    gpu.view.repeat = view === 'tile' ? 2 : 1;
    gpu.view.map = currentMap;
    gpu.render();
  }
  $('#preview-caption').textContent = view === 'sphere' || view === 'slab' ? '材质照明预览 · 移动鼠标调整光线' : `${mapLabels[currentMap]}贴图 · ${mapNotes[currentMap]}${view === 'tile' ? ' · 2 × 2 平铺' : ''}`;
}
function setMap(map: MapName): void {
  currentMap = map;
  document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(button => {
    button.classList.toggle('active', button.dataset.map === map);
    button.setAttribute('aria-pressed', String(button.dataset.map === map));
  });
  $('#export-map').textContent = `下载当前${mapLabels[map]}贴图`;
  setView(currentView === 'sphere' || currentView === 'slab' ? 'single' : currentView);
}

document.querySelectorAll<HTMLInputElement>('[data-param]').forEach(input => {
  input.addEventListener('input', () => {
    const key = input.dataset.param as NumericKey;
    const number = Number(input.value);
    if (input.value === '' || !input.validity.valid || !Number.isFinite(number)) return;
    params[key] = number;
    presetId = '';
    updateInputs();
    schedule();
  });
});
document.querySelectorAll<HTMLInputElement>('[data-color]').forEach(input => input.addEventListener('input', () => {
  params[input.dataset.color as 'baseColor' | 'veinColor' | 'mineralColor'] = input.value;
  presetId = '';
  updateInputs();
  schedule();
}));
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.addEventListener('click', () => {
  const preset = PRESETS.find(p => p.id === button.dataset.preset)!;
  params = { ...preset.params };
  presetId = preset.id;
  $('#material-title').textContent = preset.name;
  updateInputs();
  schedule();
}));
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view!)));
document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(button => button.addEventListener('click', () => setMap(button.dataset.map as MapName)));
$('#random').addEventListener('click', () => { params.seed = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000; updateInputs(); schedule(); });
$('#reset').addEventListener('click', () => { params = { ...DEFAULT_PARAMS }; presetId = 'silver-grey'; $('#material-title').textContent = '银灰碎脉'; updateInputs(); schedule(); });
$('#preview-size').addEventListener('change', schedule);
$('#save-preset').addEventListener('click', () => download(presetJSON(params), `marble_${params.seed}_preset.json`, 'application/json'));
$('#import-preset').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 100_000) throw new Error('预设文件过大，请选择石脉导出的JSON文件。');
    params = decodePreset(await file.text());
    presetId = '';
    $('#material-title').textContent = '我的石材';
    updateInputs();
    schedule();
  } catch (error) { showError(error); }
  finally { input.value = ''; }
});

async function exportMaterial(pack: boolean): Promise<void> {
  if (!gpu?.textures || generating || exporting || pending) return;
  exporting = true;
  updateButtons();
  clearError();
  const snapshot = { ...params };
  const map = currentMap;
  const oldSize = gpu.textures.size;
  const size = Number($<HTMLSelectElement>('#export-size').value);
  let succeeded = false;
  try {
    $('#status').textContent = `正在计算 ${size} × ${size} 导出…`;
    await gpu.generate(snapshot, size);
    if (pack) {
      const bytes = await materialZIP(gpu, snapshot, name => { $('#status').textContent = `正在打包${mapLabels[name]}贴图…`; });
      download(bytes, `marble_${snapshot.seed}_${size}_PBR.zip`, 'application/zip');
    } else {
      const bytes = await mapPNG(gpu, map);
      download(bytes, `marble_${snapshot.seed}_${size}_${map}${map === 'height' ? '_16bit' : map === 'normal' ? '_OpenGL' : ''}.png`, 'image/png');
    }
    succeeded = true;
    $('#status').textContent = `已导出 ${size} × ${size} ${pack ? 'PBR 材质包' : mapLabels[map] + '贴图'}`;
  } catch (error) { showError(error); }
  finally {
    try { if (!gpu.lost && gpu.textures?.size !== oldSize) await gpu.generate(snapshot, oldSize); }
    catch (error) { showError(error); }
    exporting = false;
    updateButtons();
    if (succeeded) document.dispatchEvent(new CustomEvent('marble-export-complete'));
  }
}
$('#export-pack').addEventListener('click', () => void exportMaterial(true));
$('#export-map').addEventListener('click', () => void exportMaterial(false));
$('#about').addEventListener('click', () => $<HTMLDialogElement>('#about-dialog').showModal());

$('#reference-file').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 30 * 1024 * 1024) throw new Error('参考照片请小于30MB。');
    const bitmap = await createImageBitmap(file);
    referenceBitmap?.close();
    referenceBitmap = bitmap;
    if (referenceURL) URL.revokeObjectURL(referenceURL);
    referenceURL = URL.createObjectURL(file);
    const canvas = $<HTMLCanvasElement>('#reference-canvas');
    canvas.width = 600;
    canvas.height = Math.max(1, Math.round(600 / bitmap.width * bitmap.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法读取参考照片。');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    canvas.hidden = false;
  } catch (error) { showError(error); }
  finally { input.value = ''; }
});
$('#reference-canvas').addEventListener('click', event => {
  if (exporting) return;
  const canvas = event.currentTarget as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  const x = Math.min(canvas.width - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * canvas.width)));
  const y = Math.min(canvas.height - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * canvas.height)));
  const pixel = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
  params.baseColor = '#' + Array.from(pixel.slice(0, 3)).map(n => n.toString(16).padStart(2, '0')).join('');
  presetId = '';
  updateInputs();
  schedule();
});
const canvas = $<HTMLCanvasElement>('#preview');
canvas.addEventListener('pointermove', event => {
  if (!gpu || currentView === 'single' || currentView === 'tile') return;
  const rect = canvas.getBoundingClientRect();
  gpu.light = [(event.clientX - rect.left) / rect.width * 4 - 2, 2 - (event.clientY - rect.top) / rect.height * 4];
  gpu.render();
});
const resizeObserver = new ResizeObserver(() => gpu?.render());
resizeObserver.observe(canvas);
window.addEventListener('beforeunload', () => { resizeObserver.disconnect(); gpu?.dispose(); referenceBitmap?.close(); if (referenceURL) URL.revokeObjectURL(referenceURL); });

async function init(): Promise<void> {
  try {
    gpu = await MarbleGPU.create(canvas);
    gpu.onError = error => { showError(error); updateButtons(); };
    $('#gpu-name').textContent = gpu.adapterName;
    $('#gpu-name').title = gpu.adapterName;
    pending = true;
    await drain();
    if (storageNotice) showError(storageNotice);
    // 开发/显式验证模式提供真实GPU测试入口，不创建CPU模拟实现。
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('verify')) {
      Object.assign(window, { marbleLab: { gpu, getParams: () => ({ ...params }), isBusy: () => generating || exporting || pending, setParams: (p: MarbleParams) => { params = decodePreset(presetJSON(p)); updateInputs(); schedule(); }, setView: (v: Partial<ViewOptions>) => { Object.assign(gpu!.view, v); gpu!.render(); } } });
    }
  } catch (error) {
    $('#canvas-placeholder').textContent = 'WebGPU 暂不可用';
    showError(error);
    updateButtons();
  }
}
void init();
