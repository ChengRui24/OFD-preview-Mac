/* Browser OFD preview. Files stay on the device. */
const $ = (id) => document.getElementById(id);

const state = {
  doc: null,
  page: 0,
  name: "document",
  localFonts: null,
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
$("local").onclick = () => useLocalFonts();

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
    const zip = await JSZip.loadAsync(buf);
    state.doc = await parseOfd(zip);
    setStatus("正在装载字体…");
    await supplyFonts(state.doc);
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

const LOCAL_ALIASES = {
  kai: ["kaiti sc", "kaiti tc", "stkaiti", "楷体", "楷体-简", "华文楷体", "kaiti", "kai", "biaukai"],
  song: ["songti sc", "songti tc", "stsong", "simsun", "宋体", "华文宋体", "nsimsun", "songti"],
  hei: ["heiti sc", "heiti tc", "stheiti", "pingfang sc", "microsoft yahei", "微软雅黑", "黑体", "simhei", "华文黑体"],
  fang: ["stfangsong", "fangsong", "仿宋", "华文仿宋"],
  mono: ["courier new", "courier", "menlo", "sf mono"],
  serif: ["times new roman", "times", "noto serif"],
};

function mapFont(name) {
  const raw = name || "";
  const n = raw.toLowerCase();
  const pack = (kind, label, google, family) => ({ kind, label, google, family });
  if (/courier|mono/.test(n)) return pack("mono", "Noto Sans Mono", "Noto Sans Mono", '"Noto Sans Mono", ui-monospace, monospace');
  if (/times/.test(n) && !/宋|song/.test(raw)) return pack("serif", "Noto Serif", "Noto Serif", '"Times New Roman", "Noto Serif", serif');
  if (/楷|kaiti|stkaiti/.test(raw) || /kaiti|stkaiti/.test(n)) return pack("kai", "霞鹜文楷", null, '"LXGW WenKai", "Kaiti SC", serif');
  if (/仿宋|fangsong/.test(raw) || /fangsong/.test(n)) return pack("fang", "Noto Serif SC", "Noto Serif SC", '"Noto Serif SC", serif');
  if (/宋|simsun|stsong|songti/.test(raw) || /simsun|stsong|songti/.test(n)) return pack("song", "Noto Serif SC", "Noto Serif SC", '"Noto Serif SC", "Songti SC", serif');
  if (/黑|simhei|yahei|heiti|stheiti|pingfang/.test(raw) || /simhei|yahei|heiti|stheiti/.test(n)) return pack("hei", "Noto Sans SC", "Noto Sans SC", '"Noto Sans SC", "Heiti SC", sans-serif');
  return pack("hei", "Noto Sans SC", "Noto Sans SC", '"Noto Sans SC", sans-serif');
}

function renderFontReport(doc) {
  const box = $("fonts");
  const rows = Object.values(doc.fonts);
  if (!rows.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = "<div><b>字体</b></div>" + rows.map((f) => {
    return `<div>${escapeHtml(f.name || ("#" + f.id))} → ${escapeHtml(f.sourceLabel || f.mapped.label)}</div>`;
  }).join("");
}

function collectUsedText(doc) {
  const used = new Map();
  const take = (page) => {
    if (!page) return;
    for (const layer of page.layers) {
      for (const obj of layer.objects) {
        if (obj.kind !== "text") continue;
        const slot = used.get(obj.fontId) || { text: "", bold: false };
        for (const code of obj.codes) slot.text += code.text || "";
        if (obj.weight >= 700) slot.bold = true;
        used.set(obj.fontId, slot);
      }
    }
  };
  for (const page of doc.pages) {
    take(page);
    take(page.template);
  }
  return used;
}

async function supplyFonts(doc) {
  const used = collectUsedText(doc);
  for (const font of Object.values(doc.fonts)) {
    const slot = used.get(font.id) || { text: "", bold: false };
    const text = slot.text || " ";
    font.mapped = mapFont(font.name);
    if (font.bytes && await installEmbedded(font, text)) continue;
    if (state.localFonts && await installLocal(font)) continue;
    await installOnline(font, text, slot.bold);
    await document.fonts.load(`16px ${font.family}`, text);
    if (slot.bold) await document.fonts.load(`700 16px ${font.family}`, text);
  }
}

async function installEmbedded(font, text) {
  const raw = toArrayBuffer(font.bytes);
  let subset = null;
  try { subset = subsetSfnt(raw, text); } catch (err) { console.warn("subset", font.name, err); }
  if (subset && await installFace(font, subset, "文件内嵌（已按用字裁剪）")) return true;
  if (await installFace(font, raw, "文件内嵌")) return true;
  font.embedFailed = true;
  return false;
}

async function installLocal(font) {
  const aliases = new Set((LOCAL_ALIASES[font.mapped.kind] || []).map((s) => s.toLowerCase()));
  aliases.add((font.name || "").toLowerCase());
  const hit = state.localFonts.find((item) => {
    const names = [item.family, item.fullName, item.postscriptName].map((s) => (s || "").toLowerCase());
    return names.some((n) => aliases.has(n) || [...aliases].some((a) => a && n.includes(a)));
  });
  if (!hit) return false;
  const buf = await (await hit.blob()).arrayBuffer();
  return installFace(font, buf, `本机字体 ${hit.family}`);
}

async function installOnline(font, text, bold) {
  const family = `web-${font.id}`;
  let ok = false;
  if (font.mapped.kind === "kai") ok = await installLxgw(family, text, bold);
  if (!ok && font.mapped.google) ok = await installGoogle(family, font.mapped.google, text, bold);
  if (!ok && font.mapped.google !== "Noto Sans SC") ok = await installGoogle(family, "Noto Sans SC", text, bold);
  if (ok) {
    font.family = `"${family}", ${font.mapped.family}`;
    font.sourceLabel = font.embedFailed
      ? `内嵌字体无法直接用，已在线装入 ${font.mapped.label}`
      : `在线装入 ${font.mapped.label}（只下载用到的字）`;
    font.embedded = false;
    return;
  }
  font.family = font.mapped.family;
  font.sourceLabel = `映射为 ${font.mapped.label}`;
}

async function installFace(font, buffer, label) {
  try {
    const family = `face-${font.id}`;
    const face = new FontFace(family, toArrayBuffer(buffer));
    await face.load();
    document.fonts.add(face);
    font.family = `"${family}"`;
    font.sourceLabel = label;
    font.embedded = label.startsWith("文件内嵌");
    return true;
  } catch (err) {
    console.warn("FontFace", font.name, err);
    return false;
  }
}

async function installGoogle(family, googleFamily, text, bold) {
  const weights = bold ? [400, 700] : [400];
  let any = false;
  for (const weight of weights) {
    for (const chunk of chunkText(text, 80)) {
      const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(googleFamily)}:wght@${weight}&text=${encodeURIComponent(chunk)}`;
      const css = await fetch(url).then((r) => r.ok ? r.text() : "");
      const src = css.match(/url\(([^)]+)\)/);
      if (!src) continue;
      const buf = await fetch(src[1]).then((r) => r.arrayBuffer());
      const face = new FontFace(family, buf, { weight: String(weight), unicodeRange: unicodeRangeOf(chunk) });
      await face.load();
      document.fonts.add(face);
      any = true;
    }
  }
  return any;
}

let lxgwCss = null;
async function installLxgw(family, text, bold) {
  if (!lxgwCss) lxgwCss = await loadLxgwCss();
  const cps = new Set([...text].map((ch) => ch.codePointAt(0)));
  const files = lxgwCss.filter((face) => face.ranges.some((range) => [...cps].some((cp) => cp >= range[0] && cp <= range[1])));
  const chosen = files.filter((face) => !bold ? face.weight === 400 : true);
  if (!chosen.length) return false;
  for (const face of chosen) {
    const buf = await fetch(face.url).then((r) => r.arrayBuffer());
    const fontFace = new FontFace(family, buf, { weight: String(face.weight), unicodeRange: face.rangeText });
    await fontFace.load();
    document.fonts.add(fontFace);
  }
  return true;
}

async function loadLxgwCss() {
  const bases = [400, 700].map((weight) => ({
    weight,
    url: `https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/lxgwwenkai-${weight === 700 ? "bold" : "regular"}.css`,
  }));
  const faces = [];
  for (const base of bases) {
    const css = await fetch(base.url).then((r) => r.text());
    const blocks = css.split("@font-face").slice(1);
    for (const block of blocks) {
      const range = block.match(/unicode-range:\s*([^;]+);/);
      const src = block.match(/url\(([^)]+)\)/);
      if (!range || !src) continue;
      const ranges = parseUnicodeRanges(range[1]);
      if (!ranges.length) continue;
      faces.push({
        weight: base.weight,
        url: new URL(src[1].replace(/['"]/g, ""), base.url).href,
        ranges,
        rangeText: range[1].trim(),
      });
    }
  }
  return faces;
}

function parseUnicodeRanges(text) {
  const ranges = [];
  for (const part of text.split(",")) {
    const body = part.trim().replace(/^U\+/i, "");
    if (!body || body.includes("?")) continue;
    if (body.includes("-")) {
      const [a, b] = body.split("-").map((s) => parseInt(s, 16));
      if (!Number.isNaN(a) && !Number.isNaN(b)) ranges.push([a, b]);
    } else {
      const a = parseInt(body, 16);
      if (!Number.isNaN(a)) ranges.push([a, a]);
    }
  }
  return ranges;
}

function unicodeRangeOf(text) {
  const cps = [...new Set([...text].map((ch) => ch.codePointAt(0)))].sort((a, b) => a - b);
  if (!cps.length) return "U+0020";
  const parts = [];
  let start = cps[0];
  let prev = cps[0];
  for (let i = 1; i <= cps.length; i++) {
    const cp = cps[i];
    if (cp === prev + 1) { prev = cp; continue; }
    parts.push(start === prev ? `U+${start.toString(16)}` : `U+${start.toString(16)}-${prev.toString(16)}`);
    start = prev = cp;
  }
  return parts.join(", ");
}

function chunkText(text, size) {
  const chars = [...new Set([...text])];
  const chunks = [];
  for (let i = 0; i < chars.length; i += size) chunks.push(chars.slice(i, i + size).join(""));
  return chunks.length ? chunks : [" "];
}

function toArrayBuffer(buffer) {
  if (buffer instanceof ArrayBuffer) return buffer.slice(0);
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  return copy.buffer;
}

async function useLocalFonts() {
  if (!window.queryLocalFonts) {
    setStatus("这个浏览器不能读取本机字体，将继续使用在线字体。");
    return;
  }
  try {
    state.localFonts = await queryLocalFonts();
    if (!state.doc) { setStatus(`已读取 ${state.localFonts.length} 个本机字体，打开 OFD 后会优先使用。`); return; }
    setStatus("正在改用本机字体…");
    for (const font of Object.values(state.doc.fonts)) font.bytes = font.bytes && font.embedded ? font.bytes : font.bytes;
    await supplyFonts(state.doc);
    renderFontReport(state.doc);
    await showPage(state.page);
  } catch (err) {
    if (err && err.name === "NotAllowedError") setStatus("没有允许读取本机字体，继续使用在线字体。");
    else setStatus("读取本机字体失败：" + (err.message || err));
  }
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
    const mapped = mapFont(name);
    const info = { id, name, embedded: false, mapped, family: mapped.family, sourceLabel: `映射为 ${mapped.label}` };
    if (fileLoc) {
      const bytes = await readBytes(zip, candidates(resDir, docDir, fileLoc));
      if (bytes) info.bytes = bytes;
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
