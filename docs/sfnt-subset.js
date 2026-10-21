/* Subset a TrueType font to the characters actually used.
   Browsers reject some OFD-embedded fonts (huge empty glyph arrays). */
(function (root) {
  function subsetSfnt(buffer, text) {
    const src = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (src.length < 12) throw new Error("font too small");
    const tag = String.fromCharCode(src[0], src[1], src[2], src[3]);
    if (tag === "ttcf" || tag === "OTTO") throw new Error("unsupported font");
    const tables = readTables(src);
    const cmap = tables.get("cmap");
    const loca = tables.get("loca");
    const glyf = tables.get("glyf");
    const head = tables.get("head");
    const maxp = tables.get("maxp");
    const hhea = tables.get("hhea");
    const hmtx = tables.get("hmtx");
    if (!cmap || !loca || !glyf || !head || !maxp || !hhea || !hmtx) throw new Error("missing table");

    const mapping = parseCmap(cmap);
    const glyphSet = new Set([0]);
    const charToOld = new Map();
    for (const ch of text || "") {
      const cp = ch.codePointAt(0);
      const gid = mapping.get(cp);
      if (gid) {
        glyphSet.add(gid);
        charToOld.set(cp, gid);
      }
    }
    expandComposites(glyf, loca, head, glyphSet);

    const oldIds = [...glyphSet].sort((a, b) => a - b);
    const newOf = new Map(oldIds.map((id, i) => [id, i]));
    const slices = oldIds.map((id) => remapComponents(glyphSlice(glyf, loca, head, id), newOf));

    const glyfParts = [];
    const locaOffsets = [0];
    let cursor = 0;
    for (const slice of slices) {
      glyfParts.push(slice);
      cursor += slice.length;
      if (cursor & 1) {
        glyfParts.push(new Uint8Array(1));
        cursor += 1;
      }
      locaOffsets.push(cursor);
    }
    const newGlyf = concat(glyfParts);
    const newLoca = new Uint8Array((locaOffsets.length) * 4);
    const locaView = new DataView(newLoca.buffer);
    locaOffsets.forEach((off, i) => locaView.setUint32(i * 4, off));

    const newHmtx = new Uint8Array(oldIds.length * 4);
    const hmtxView = new DataView(newHmtx.buffer);
    oldIds.forEach((id, i) => {
      const [adv, lsb] = metricsFor(hhea, hmtx, id);
      hmtxView.setUint16(i * 4, adv);
      hmtxView.setInt16(i * 4 + 2, lsb);
    });

    const newHead = new Uint8Array(head);
    new DataView(newHead.buffer).setInt16(50, 1);
    new DataView(newHead.buffer).setUint32(8, 0);

    const newMaxp = new Uint8Array(maxp);
    new DataView(newMaxp.buffer).setUint16(4, oldIds.length);

    const newHhea = new Uint8Array(hhea);
    new DataView(newHhea.buffer).setUint16(34, oldIds.length);

    const newCmap = buildCmap(charToOld, newOf);
    const outTables = new Map([
      ["OS/2", tables.get("OS/2")],
      ["cmap", newCmap],
      ["glyf", newGlyf],
      ["head", newHead],
      ["hhea", newHhea],
      ["hmtx", newHmtx],
      ["loca", newLoca],
      ["maxp", newMaxp],
      ["name", tables.get("name")],
      ["post", tables.get("post")],
    ]);
    for (const [k, v] of [...outTables]) if (!v) outTables.delete(k);
    return packSfnt(outTables);
  }

  function readTables(src) {
    const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
    const count = view.getUint16(4);
    const tables = new Map();
    for (let i = 0; i < count; i++) {
      const p = 12 + i * 16;
      const name = String.fromCharCode(src[p], src[p + 1], src[p + 2], src[p + 3]);
      const offset = view.getUint32(p + 8);
      const length = view.getUint32(p + 12);
      tables.set(name, src.slice(offset, offset + length));
    }
    return tables;
  }

  function parseCmap(cmap) {
    const view = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
    const n = view.getUint16(2);
    let offset = 0;
    for (let i = 0; i < n; i++) {
      const plat = view.getUint16(4 + i * 8);
      const enc = view.getUint16(6 + i * 8);
      const off = view.getUint32(8 + i * 8);
      if (plat === 3 && (enc === 1 || enc === 10) && view.getUint16(off) === 4) offset = off;
      if (plat === 0 && view.getUint16(off) === 4) offset = off;
    }
    if (!offset) throw new Error("no cmap");
    const segCount = view.getUint16(offset + 6) / 2;
    const endOff = offset + 14;
    const startOff = endOff + segCount * 2 + 2;
    const deltaOff = startOff + segCount * 2;
    const rangeOff = deltaOff + segCount * 2;
    const map = new Map();
    for (let i = 0; i < segCount; i++) {
      const end = view.getUint16(endOff + i * 2);
      const start = view.getUint16(startOff + i * 2);
      const delta = view.getUint16(deltaOff + i * 2);
      const range = view.getUint16(rangeOff + i * 2);
      if (start === 0xffff) continue;
      for (let cp = start; cp <= end; cp++) {
        let gid;
        if (range === 0) gid = (cp + delta) & 0xffff;
        else {
          const pos = rangeOff + i * 2 + range + (cp - start) * 2;
          gid = view.getUint16(pos);
          if (gid) gid = (gid + delta) & 0xffff;
        }
        if (gid) map.set(cp, gid);
      }
    }
    return map;
  }

  function locaOffset(loca, head, index) {
    const view = new DataView(loca.buffer, loca.byteOffset, loca.byteLength);
    const long = new DataView(head.buffer, head.byteOffset, head.byteLength).getInt16(50) === 1;
    return long ? view.getUint32(index * 4) : view.getUint16(index * 2) * 2;
  }

  function glyphSlice(glyf, loca, head, id) {
    const a = locaOffset(loca, head, id);
    const b = locaOffset(loca, head, id + 1);
    if (b < a || b > glyf.length) return new Uint8Array(0);
    return glyf.slice(a, b);
  }

  function expandComposites(glyf, loca, head, glyphSet) {
    const pending = [...glyphSet];
    while (pending.length) {
      const id = pending.pop();
      const slice = glyphSlice(glyf, loca, head, id);
      if (slice.length < 10) continue;
      const contours = new DataView(slice.buffer, slice.byteOffset, slice.byteLength).getInt16(0);
      if (contours >= 0) continue;
      for (const comp of componentGlyphs(slice)) {
        if (!glyphSet.has(comp)) {
          glyphSet.add(comp);
          pending.push(comp);
        }
      }
    }
  }

  function componentGlyphs(slice) {
    const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
    const ids = [];
    let p = 10;
    while (p + 4 <= slice.length) {
      const flags = view.getUint16(p);
      ids.push(view.getUint16(p + 2));
      p += 4;
      if (flags & 1) p += 4;
      else p += 2;
      if (flags & 8) p += 2;
      else if (flags & 64) p += 4;
      else if (flags & 128) p += 8;
      if (!(flags & 32)) break;
    }
    return ids;
  }

  function remapComponents(slice, newOf) {
    if (!slice.length) return slice;
    const out = new Uint8Array(slice);
    const view = new DataView(out.buffer);
    if (view.getInt16(0) >= 0) return out;
    let p = 10;
    while (p + 4 <= out.length) {
      const flags = view.getUint16(p);
      const mapped = newOf.get(view.getUint16(p + 2));
      if (mapped != null) view.setUint16(p + 2, mapped);
      p += 4;
      if (flags & 1) p += 4;
      else p += 2;
      if (flags & 8) p += 2;
      else if (flags & 64) p += 4;
      else if (flags & 128) p += 8;
      if (!(flags & 32)) break;
    }
    return out;
  }

  function metricsFor(hhea, hmtx, gid) {
    const hv = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength);
    const mv = new DataView(hmtx.buffer, hmtx.byteOffset, hmtx.byteLength);
    const n = hv.getUint16(34);
    if (gid < n) return [mv.getUint16(gid * 4), mv.getInt16(gid * 4 + 2)];
    const adv = mv.getUint16((n - 1) * 4);
    const lsb = mv.getInt16(n * 4 + (gid - n) * 2);
    return [adv, lsb];
  }

  function buildCmap(charToOld, newOf) {
    const pairs = [...charToOld].map(([cp, old]) => [cp, newOf.get(old)]).filter(([, gid]) => gid != null);
    pairs.sort((a, b) => a[0] - b[0]);
    const segs = [];
    for (const [cp, gid] of pairs) {
      const last = segs[segs.length - 1];
      if (last && cp === last.end + 1 && gid === last.startGid + (cp - last.start)) last.end = cp;
      else segs.push({ start: cp, end: cp, startGid: gid });
    }
    segs.push({ start: 0xffff, end: 0xffff, startGid: 0 });
    const segCount = segs.length;
    const size = 16 + segCount * 8;
    const buf = new Uint8Array(4 + 8 + size);
    const v = new DataView(buf.buffer);
    v.setUint16(0, 0);
    v.setUint16(2, 1);
    v.setUint16(4, 3);
    v.setUint16(6, 1);
    v.setUint32(8, 12);
    const o = 12;
    v.setUint16(o, 4);
    v.setUint16(o + 2, size);
    v.setUint16(o + 4, 0);
    v.setUint16(o + 6, segCount * 2);
    let pow = 1;
    let entry = 0;
    while (pow * 2 <= segCount) { pow *= 2; entry++; }
    const searchRange = pow * 2;
    v.setUint16(o + 8, searchRange);
    v.setUint16(o + 10, entry);
    v.setUint16(o + 12, segCount * 2 - searchRange);
    let p = o + 14;
    for (const s of segs) { v.setUint16(p, s.end); p += 2; }
    v.setUint16(p, 0); p += 2;
    for (const s of segs) { v.setUint16(p, s.start); p += 2; }
    for (const s of segs) { v.setUint16(p, (s.startGid - s.start) & 0xffff); p += 2; }
    for (let i = 0; i < segCount; i++) { v.setUint16(p, 0); p += 2; }
    return buf;
  }

  function packSfnt(tables) {
    const names = [...tables.keys()].sort();
    const count = names.length;
    let search = 1;
    let entry = 0;
    while (search * 2 <= count) { search *= 2; entry++; }
    const records = [];
    let offset = 12 + count * 16;
    for (const name of names) {
      const raw = tables.get(name);
      const padded = pad4(raw);
      records.push({ name, data: padded, offset, length: raw.length, checksum: checksum(padded) });
      offset += padded.length;
    }
    const out = new Uint8Array(offset);
    const v = new DataView(out.buffer);
    v.setUint32(0, 0x00010000);
    v.setUint16(4, count);
    v.setUint16(6, search * 16);
    v.setUint16(8, entry);
    v.setUint16(10, count * 16 - search * 16);
    records.forEach((rec, i) => {
      const p = 12 + i * 16;
      for (let k = 0; k < 4; k++) out[p + k] = rec.name.charCodeAt(k);
      v.setUint32(p + 4, rec.checksum);
      v.setUint32(p + 8, rec.offset);
      v.setUint32(p + 12, rec.length);
      out.set(rec.data, rec.offset);
    });
    const headRec = records.find((r) => r.name === "head");
    if (headRec) {
      v.setUint32(headRec.offset + 8, 0);
      const total = checksum(out);
      v.setUint32(headRec.offset + 8, (0xB1B0AFBA - total) >>> 0);
    }
    return out.buffer;
  }

  function pad4(bytes) {
    const n = (4 - (bytes.length % 4)) % 4;
    if (!n) return bytes;
    const out = new Uint8Array(bytes.length + n);
    out.set(bytes);
    return out;
  }

  function checksum(bytes) {
    const padded = pad4(bytes);
    const v = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
    let sum = 0;
    for (let i = 0; i < padded.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
    return sum;
  }

  function concat(parts) {
    const len = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  root.subsetSfnt = subsetSfnt;
})(typeof globalThis !== "undefined" ? globalThis : window);
