/* Browser OFD preview. Files stay on the device. */
const $ = (id) => document.getElementById(id);

const state = {
  doc: null,
  page: 0,
  name: "document",
};

const drop = $("drop");
const canvas = $("canvas");
const ctx = canvas.getContext("2d");

drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const file = [...e.dataTransfer.files].find((f) => /\.ofd$/i.test(f.name));
  if (file) openFile(file);
});
$("file").addEventListener("change", () => {
  if ($("file").files[0]) openFile($("file").files[0]);
});
document.querySelectorAll("[data-sample]").forEach((btn) => {
  btn.addEventListener("click", () => openUrl(btn.dataset.sample, btn.textContent.trim()));
});
$("prev").onclick = () => showPage(state.page - 1);
$("next").onclick = () => showPage(state.page + 1);
$("ppm").onchange = () => { if (state.doc) showPage(state.page); };
$("png").onclick = () => exportPng();
$("pdf").onclick = () => exportPdf();
$("svg").onclick = () => exportSvg();

const params = new URLSearchParams(location.search);
if (params.get("sample")) {
  const name = params.get("sample");
  openUrl(`samples/${name}.ofd`, name);
}

async function openFile(file) {
  state.name = file.name.replace(/\.ofd$/i, "");
  await openBuffer(await file.arrayBuffer());
}

async function openUrl(url, label) {
  try {
    setStatus("正在加载示例…");
    const res = await fetch(url);
    if (!res.ok) throw new Error("示例加载失败");
    state.name = label || "sample";
    await openBuffer(await res.arrayBuffer());
  } catch (err) {
    console.error(err);
    setStatus("无法打开：" + (err.message || err));
  }
}

async function openBuffer(buf) {
  try {
    setStatus("正在解析 OFD…");
    await ensureWebFonts();
    const zip = await JSZip.loadAsync(buf);
    state.doc = await parseOfd(zip);
    state.page = 0;
    renderFontReport(state.doc);
    setExportEnabled(true);
    await showPage(0);
  } catch (err) {
    console.error(err);
    setStatus("无法打开：" + (err.message || err));
  }
}

function setStatus(text) { $("status").textContent = text; }
function setExportEnabled(on) {
  for (const id of ["png", "pdf", "svg", "prev", "next"]) $(id).disabled = !on;
}

async function ensureWebFonts() {
  await Promise.all([
    document.fonts.load('16px "LXGW WenKai"'),
    document.fonts.load('700 16px "LXGW WenKai"'),
    document.fonts.load('16px "Noto Serif SC"'),
    document.fonts.load('700 16px "Noto Serif SC"'),
    document.fonts.load('16px "Noto Sans SC"'),
    document.fonts.load('700 16px "Noto Sans SC"'),
  ]);
}

function mapFont(name) {
  const raw = name || "";
  const n = raw.toLowerCase();
  if (/courier/.test(n)) return { family: '"Courier New", "Noto Sans SC", monospace', label: "等宽字体" };
  if (/times|times new roman/.test(n)) return { family: '"Times New Roman", "Noto Serif SC", serif', label: "Times New Roman" };
  if (/楷|kaiti|stkaiti|kai\b/.test(raw) || /kaiti|stkaiti/.test(n)) {
    return { family: '"LXGW WenKai", "Kaiti SC", serif', label: "霞鹜文楷" };
  }
  if (/仿宋|fangsong/.test(raw) || /fangsong/.test(n)) {
    return { family: '"Noto Serif SC", serif', label: "Noto Serif SC（仿宋近似）" };
  }
  if (/宋|simsun|stsong|songti/.test(raw) || /simsun|stsong|songti/.test(n)) {
    return { family: '"Noto Serif SC", "Songti SC", serif', label: "Noto Serif SC" };
  }
  if (/黑|simhei|yahei|heiti|stheiti/.test(raw) || /simhei|yahei|heiti/.test(n)) {
    return { family: '"Noto Sans SC", "Heiti SC", sans-serif', label: "Noto Sans SC" };
  }
  if (/^simsun$|nsimsun/.test(n)) return { family: '"Noto Serif SC", serif', label: "Noto Serif SC" };
  return { family: '"Noto Sans SC", sans-serif', label: "Noto Sans SC（默认）" };
}

function renderFontReport(doc) {
  const box = $("fonts");
  const rows = Object.values(doc.fonts);
  if (!rows.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = "<div><b>字体</b></div>" + rows.map((f) => {
    const how = f.embedded
      ? "使用文件内嵌字体"
      : f.embedFailed
        ? `内嵌字体浏览器无法解析，已改用 ${f.mapped.label}`
        : `映射为 ${f.mapped.label}`;
    return `<div>${escapeHtml(f.name || ("#" + f.id))} → ${escapeHtml(how)}</div>`;
  }).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function showPage(index) {
  const doc = state.doc;
  if (!doc) return;
  state.page = Math.max(0, Math.min(doc.pages.length - 1, index));
  const page = doc.pages[state.page];
  const ppm = previewPpm(page);
  const rendered = await renderPage(doc, page, ppm);
  canvas.width = rendered.width;
  canvas.height = rendered.height;
  ctx.drawImage(rendered, 0, 0);
  $("view").classList.add("has-doc");
  $("pageLabel").textContent = `${state.page + 1} / ${doc.pages.length}`;
  $("prev").disabled = state.page === 0;
  $("next").disabled = state.page + 1 >= doc.pages.length;
  setStatus(`${state.name} · 第 ${state.page + 1} 页 · ${page.widthMm.toFixed(1)} × ${page.heightMm.toFixed(1)} mm`);
}

function previewPpm(page) {
  const maxW = Math.max(320, $("view").clientWidth - 32);
  return Math.min(Number($("ppm").value), maxW / page.widthMm);
}

function exportPpm() { return Number($("ppm").value); }

async function renderPage(doc, page, ppm) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(page.widthMm * ppm));
  c.height = Math.max(1, Math.round(page.heightMm * ppm));
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.scale(ppm, ppm);
  const layers = [];
  if (page.template && page.templateZ !== "Foreground") layers.push(...page.template.layers);
  layers.push(...page.layers);
  if (page.template && page.templateZ === "Foreground") layers.push(...page.template.layers);
  for (const layer of layers) {
    const param = resolveDrawParam(layer.drawParam, doc.drawParams);
    for (const obj of layer.objects) await drawObject(g, doc, obj, param);
  }
  return c;
}

async function drawObject(g, doc, obj, layerParam) {
  const param = { ...layerParam, ...resolveDrawParam(obj.drawParam, doc.drawParams) };
  g.save();
  g.translate(obj.boundary.x, obj.boundary.y);
  if (obj.ctm) g.transform(...obj.ctm);
  if (obj.kind === "text") drawText(g, doc, obj, param);
  else if (obj.kind === "path") drawPath(g, obj, param);
  else if (obj.kind === "image" && obj.image) {
    g.drawImage(obj.image, 0, 0, obj.boundary.w, obj.boundary.h);
  }
  g.restore();
}

function drawText(g, doc, obj, param) {
  const font = doc.fonts[obj.fontId];
  const family = font ? font.family : mapFont("").family;
  const weight = obj.weight >= 700 ? 700 : 400;
  const fill = obj.fillColor || param.fill || "#111";
  const size = obj.size || 3;
  g.fillStyle = fill;
  g.font = `${weight} ${size}px ${family}`;
  g.textBaseline = "alphabetic";
  for (const code of obj.codes) {
    const deltas = parseDelta(code.deltaX);
    let x = code.x;
    const y = code.y;
    const chars = [...code.text];
    chars.forEach((ch, i) => {
      g.save();
      g.translate(x, y);
      if (obj.hScale && obj.hScale !== 1) g.scale(obj.hScale, 1);
      g.fillText(ch, 0, 0);
      g.restore();
      x += deltas[i] != null ? deltas[i] : size;
    });
  }
}

function drawPath(g, obj, param) {
  const stroke = obj.stroke !== false;
  const fill = obj.fill === true;
  g.beginPath();
  let i = 0;
  const t = obj.ops;
  const num = () => Number(t[i++]);
  while (i < t.length) {
    const op = t[i++];
    if (op === "M") g.moveTo(num(), num());
    else if (op === "L") g.lineTo(num(), num());
    else if (op === "Q") g.quadraticCurveTo(num(), num(), num(), num());
    else if (op === "B") g.bezierCurveTo(num(), num(), num(), num(), num(), num());
    else if (op === "C") g.closePath();
    else if (op === "A") {
      i += 5;
      g.lineTo(num(), num());
    } else if (!Number.isNaN(Number(op))) {
      i -= 1;
      break;
    }
  }
  g.lineWidth = obj.lineWidth || param.lineWidth || 0.35;
  g.lineJoin = "miter";
  if (fill) {
    g.fillStyle = obj.fillColor || param.fill || "#111";
    g.fill();
  }
  if (stroke) {
    g.strokeStyle = obj.strokeColor || param.stroke || (fill ? obj.fillColor : "#111") || "#111";
    g.stroke();
  }
}

function parseDelta(str) {
  if (!str) return [];
  const tokens = str.trim().split(/\s+/);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "g" || tokens[i] === "G") {
      const count = Number(tokens[++i]);
      const value = Number(tokens[++i]);
      for (let k = 0; k < count; k++) out.push(value);
    } else out.push(Number(tokens[i]));
  }
  return out;
}

function resolveDrawParam(id, map, seen = new Set()) {
  if (!id || seen.has(id) || !map[id]) return {};
  seen.add(id);
  const item = map[id];
  return { ...resolveDrawParam(item.relative, map, seen), ...item.style };
}

async function parseOfd(zip) {
  const ofdXml = await readXml(zip, "OFD.xml");
  const docRoot = textOf(all(ofdXml, "DocRoot")[0]) || "Doc_0/Document.xml";
  const docDir = docRoot.includes("/") ? docRoot.slice(0, docRoot.lastIndexOf("/")) : "";
  const documentXml = await readXml(zip, docRoot);
  const root = documentXml.documentElement;
  const common = first(root, "CommonData");
  const area = first(common, "PageArea");
  const docBox = parseBox(textOf(first(area, "PhysicalBox"))) || { x: 0, y: 0, w: 210, h: 297 };

  const drawParams = {};
  const fonts = {};
  const images = {};
  for (const resLoc of ["PublicRes", "DocumentRes"].map((n) => textOf(first(common, n))).filter(Boolean)) {
    await loadRes(zip, docDir, resLoc, drawParams, fonts, images);
  }
  for (const font of Object.values(fonts)) {
    if (font.embedded) {
      font.family = font.embeddedFamily;
    } else {
      font.mapped = mapFont(font.name);
      font.family = font.mapped.family;
    }
  }

  const templates = {};
  for (const tpl of children(common, "TemplatePage")) {
    const id = attr(tpl, "ID");
    const loc = join(docDir, attr(tpl, "BaseLoc") || "");
    const xml = await readXml(zip, loc);
    templates[id] = parsePage(xml, docBox);
  }

  const pages = [];
  const pagesEl = first(root, "Pages");
  for (const p of children(pagesEl, "Page")) {
    const loc = join(docDir, attr(p, "BaseLoc") || "");
    const xml = await readXml(zip, loc);
    const page = parsePage(xml, docBox);
    const tplRef = first(xml.documentElement, "Template");
    if (tplRef) {
      const id = attr(tplRef, "TemplateID");
      page.template = templates[id];
      page.templateZ = attr(tplRef, "ZOrder") || "Background";
    }
    await hydrateImages(page, images);
    if (page.template) await hydrateImages(page.template, images);
    pages.push(page);
  }
  if (!pages.length) throw new Error("没有页面");
  return { pages, fonts, drawParams };
}

async function loadRes(zip, docDir, loc, drawParams, fonts, images) {
  const path = join(docDir, loc);
  const xml = await readXml(zip, path);
  const base = attr(xml.documentElement, "BaseLoc") || "";
  const resDir = base ? join(docDir, base) : docDir;
  for (const dp of all(xml, "DrawParam")) {
    const style = {};
    const lineWidth = num(attr(dp, "LineWidth"));
    const stroke = colorOf(first(dp, "StrokeColor"));
    const fill = colorOf(first(dp, "FillColor"));
    if (lineWidth != null) style.lineWidth = lineWidth;
    if (stroke) style.stroke = stroke;
    if (fill) style.fill = fill;
    drawParams[attr(dp, "ID")] = { relative: attr(dp, "Relative"), style };
  }
  for (const font of all(xml, "Font")) {
    const id = attr(font, "ID");
    const name = attr(font, "FontName") || attr(font, "FamilyName") || "";
    const fileLoc = textOf(first(font, "FontFile"));
    const info = { id, name, embedded: false, mapped: mapFont(name), family: "" };
    if (fileLoc) {
      const bytes = await readBytes(zip, candidates(resDir, docDir, fileLoc));
      if (bytes) {
        try {
          const family = `ofd-font-${id}`;
          const face = new FontFace(family, bytes);
          await face.load();
          document.fonts.add(face);
          info.embedded = true;
          info.embeddedFamily = `"${family}"`;
        } catch (err) {
          info.embedFailed = true;
          console.warn("embedded font failed", name, err);
        }
      }
    }
    fonts[id] = info;
  }
  for (const media of all(xml, "MultiMedia")) {
    if ((attr(media, "Type") || "Image") !== "Image") continue;
    const id = attr(media, "ID");
    const fileLoc = textOf(first(media, "MediaFile"));
    if (!fileLoc) continue;
    const bytes = await readBytes(zip, candidates(resDir, docDir, fileLoc));
    if (!bytes) continue;
    const blob = new Blob([bytes]);
    images[id] = await createImageBitmap(blob);
  }
}

function parsePage(xml, fallbackBox) {
  const root = xml.documentElement;
  const box = parseBox(textOf(first(first(root, "Area"), "PhysicalBox"))) || fallbackBox;
  const layers = children(first(root, "Content"), "Layer").map(parseLayer);
  return { widthMm: box.w, heightMm: box.h, layers, template: null, templateZ: "Background" };
}

function parseLayer(el) {
  const objects = [];
  for (const child of el.children) {
    const obj = parseObject(child);
    if (obj) objects.push(obj);
  }
  return { drawParam: attr(el, "DrawParam"), objects };
}

function parseObject(el) {
  const kind = el.localName;
  if (!["TextObject", "PathObject", "ImageObject"].includes(kind)) return null;
  const boundary = parseBox(attr(el, "Boundary")) || { x: 0, y: 0, w: 0, h: 0 };
  const base = {
    kind: kind === "TextObject" ? "text" : kind === "PathObject" ? "path" : "image",
    boundary,
    drawParam: attr(el, "DrawParam"),
    ctm: parseCtm(attr(el, "CTM"), boundary),
    strokeColor: colorOf(first(el, "StrokeColor")),
    fillColor: colorOf(first(el, "FillColor")),
  };
  if (base.kind === "text") {
    return {
      ...base,
      fontId: attr(el, "Font"),
      size: num(attr(el, "Size")) || 3,
      hScale: num(attr(el, "HScale")) || 1,
      weight: num(attr(el, "Weight")) || 400,
      codes: children(el, "TextCode").map((c) => ({
        x: num(attr(c, "X")) || 0,
        y: num(attr(c, "Y")) || 0,
        deltaX: attr(c, "DeltaX") || "",
        text: c.textContent || "",
      })),
    };
  }
  if (base.kind === "path") {
    const data = textOf(first(el, "AbbreviatedData")) || "";
    return {
      ...base,
      ops: data.trim().split(/\s+/).filter(Boolean),
      lineWidth: num(attr(el, "LineWidth")),
      fill: attr(el, "Fill") === "true",
      stroke: attr(el, "Stroke") !== "false",
    };
  }
  return { ...base, resourceId: attr(el, "ResourceID"), image: null };
}

async function hydrateImages(page, images) {
  for (const layer of page.layers) {
    for (const obj of layer.objects) {
      if (obj.kind === "image") obj.image = images[obj.resourceId] || null;
    }
  }
}

function parseCtm(str, boundary) {
  if (!str) return null;
  const n = str.trim().split(/\s+/).map(Number);
  if (n.length < 6 || n.some((v) => Number.isNaN(v))) return null;
  const [a, b, c, d, e, f] = n;
  if (Math.abs(a - boundary.w) < 0.2 && Math.abs(d - boundary.h) < 0.2 && !b && !c && !e && !f) return null;
  return [a, b, c, d, e, f];
}

function parseBox(str) {
  if (!str) return null;
  const n = str.trim().split(/\s+/).map(Number);
  if (n.length < 4 || n.some((v) => Number.isNaN(v))) return null;
  return { x: n[0], y: n[1], w: n[2], h: n[3] };
}

function colorOf(el) {
  if (!el) return null;
  const v = attr(el, "Value");
  if (!v) return null;
  const [r, g, b] = v.trim().split(/\s+/).map(Number);
  const alpha = attr(el, "Alpha");
  const a = alpha == null ? 1 : Number(alpha) / 255;
  return `rgba(${r},${g},${b},${a})`;
}

function children(el, name) {
  if (!el) return [];
  return [...el.children].filter((c) => c.localName === name);
}
function first(el, name) { return children(el, name)[0] || null; }
function all(el, name) {
  const out = [];
  const walk = (n) => {
    if (n.localName === name) out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(el.documentElement || el);
  return out;
}
function attr(el, name) { return el ? el.getAttribute(name) : null; }
function textOf(el) { return el ? (el.textContent || "").trim() : ""; }
function num(v) { return v == null || v === "" ? null : Number(v); }
function join(dir, loc) {
  const clean = String(loc || "").replace(/\\/g, "/").replace(/^\//, "");
  if (!dir) return clean;
  if (!clean) return dir;
  if (clean.startsWith(dir + "/")) return clean;
  return `${dir}/${clean}`.replace(/\/+/g, "/");
}
function candidates(resDir, docDir, loc) {
  const clean = String(loc).replace(/\\/g, "/").replace(/^\//, "");
  return [...new Set([join(resDir, clean), join(docDir, clean), clean])];
}

async function zipEntry(zip, path) {
  const norm = path.replace(/^\//, "");
  if (zip.file(norm)) return zip.file(norm);
  const hit = Object.keys(zip.files).find((k) => k.replace(/^\//, "").toLowerCase() === norm.toLowerCase());
  return hit ? zip.file(hit) : null;
}
async function readXml(zip, path) {
  const file = await zipEntry(zip, path);
  if (!file) throw new Error("缺少 " + path);
  const text = await file.async("string");
  return new DOMParser().parseFromString(text, "application/xml");
}
async function readBytes(zip, paths) {
  for (const path of paths) {
    const file = await zipEntry(zip, path);
    if (file) return file.async("arraybuffer");
  }
  return null;
}

async function exportPng() {
  const page = state.doc.pages[state.page];
  const rendered = await renderPage(state.doc, page, exportPpm());
  const blob = await canvasBlob(rendered, "image/png");
  const suffix = state.doc.pages.length > 1 ? `-${String(state.page + 1).padStart(3, "0")}` : "";
  await saveBlob(blob, `${state.name}${suffix}.png`, "image/png", ".png");
}

async function exportPdf() {
  setStatus("正在生成 PDF…");
  const pdf = await PDFLib.PDFDocument.create();
  for (const page of state.doc.pages) {
    const rendered = await renderPage(state.doc, page, exportPpm());
    const png = await canvasBlob(rendered, "image/png");
    const img = await pdf.embedPng(await png.arrayBuffer());
    const w = page.widthMm * 72 / 25.4;
    const h = page.heightMm * 72 / 25.4;
    const sheet = pdf.addPage([w, h]);
    sheet.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  const bytes = await pdf.save();
  await saveBlob(new Blob([bytes], { type: "application/pdf" }), `${state.name}.pdf`, "application/pdf", ".pdf");
  setStatus("PDF 已生成");
}

async function exportSvg() {
  const page = state.doc.pages[state.page];
  const ppm = exportPpm();
  const rendered = await renderPage(state.doc, page, ppm);
  const png = await canvasBlob(rendered, "image/png");
  const href = await blobToDataUrl(png);
  const w = page.widthMm;
  const h = page.heightMm;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${rendered.width} ${rendered.height}">\n  <image href="${href}" width="${rendered.width}" height="${rendered.height}"/>\n</svg>\n`;
  const suffix = state.doc.pages.length > 1 ? `-${String(state.page + 1).padStart(3, "0")}` : "";
  await saveBlob(new Blob([svg], { type: "image/svg+xml" }), `${state.name}${suffix}.svg`, "image/svg+xml", ".svg");
}

function canvasBlob(canvasEl, type) {
  return new Promise((resolve) => canvasEl.toBlob(resolve, type));
}
function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function saveBlob(blob, filename, mime, ext) {
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: ext.slice(1).toUpperCase(), accept: { [mime]: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus("已保存 " + filename);
      return;
    }
  } catch (err) {
    if (err && err.name === "AbortError") { setStatus("已取消保存"); return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setStatus("已开始下载 " + filename);
}
