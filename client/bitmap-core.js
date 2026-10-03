/* PaperFig for Illustrator 0.6.0 — small, independently testable helpers. See LICENSE. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.SciBitmapCore = api; }
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';


  // Map EXIF/TIFF Orientation (1-8) to transformRgbaBuffer: flipH then CCW quarter turns.
  // swap=true when display W/H are transposed vs storage SOF/IFD size.
  function exifOrientationTransform(orientation) {
    var o = Number(orientation) || 1;
    if (o < 1 || o > 8) { o = 1; }
    switch (o) {
      case 2: return { turns: 0, flipH: true, swap: false };
      case 3: return { turns: 2, flipH: false, swap: false };
      case 4: return { turns: 2, flipH: true, swap: false };
      case 5: return { turns: 1, flipH: true, swap: true };
      case 6: return { turns: 3, flipH: false, swap: true };
      case 7: return { turns: 3, flipH: true, swap: true };
      case 8: return { turns: 1, flipH: false, swap: true };
      default: return { turns: 0, flipH: false, swap: false };
    }
  }

  // Read Orientation from a JPEG APP1 Exif segment. segOff points at the 2-byte length field.
  function readJpegExifOrientation(read, segOff, segLen) {
    var payloadLen, head, tiffStart, le, u16, u32, ifd0, count, i, entry, tag, type, n, unit, valueOff, b, value;
    if (!(segLen >= 16)) { return 0; }
    payloadLen = segLen - 2;
    if (payloadLen < 14) { return 0; }
    /* Peek only the Exif + TIFF header (14B) so large non-Exif APP1 pads stay cheap. */
    head = read(segOff + 2, 14);
    if (head.length < 14) { return 0; }
    if (head.toString('ascii', 0, 4) !== 'Exif' || head[4] !== 0 || head[5] !== 0) { return 0; }
    tiffStart = segOff + 2 + 6;
    le = head[6] === 73 && head[7] === 73;
    if (!le && !(head[6] === 77 && head[7] === 77)) { return 0; }
    u16 = function (buf, p) { return le ? buf.readUInt16LE(p) : buf.readUInt16BE(p); };
    u32 = function (buf, p) { return le ? buf.readUInt32LE(p) : buf.readUInt32BE(p); };
    if (u16(head, 8) !== 42) { return 0; }
    ifd0 = tiffStart + u32(head, 10);
    try {
      count = u16(read(ifd0, 2), 0);
      if (count < 1 || count > 512) { return 0; }
      for (i = 0; i < count; i += 1) {
        entry = read(ifd0 + 2 + i * 12, 12);
        tag = u16(entry, 0);
        if (tag !== 274) { continue; }
        type = u16(entry, 2); n = u32(entry, 4);
        unit = type === 3 ? 2 : (type === 4 ? 4 : (type === 1 ? 1 : 0));
        if (!unit || n < 1) { return 0; }
        valueOff = unit * n > 4 ? (tiffStart + u32(entry, 8)) : (ifd0 + 2 + i * 12 + 8);
        b = read(valueOff, unit);
        value = type === 3 ? u16(b, 0) : (type === 4 ? u32(b, 0) : b[0]);
        if (value >= 1 && value <= 8) { return value; }
        return 0;
      }
    } catch (ignore) { return 0; }
    return 0;
  }

  // Read only requested ranges. TIFF IFDs and JPEG SOF need not be near byte zero.
  function readMetadata(fs, filePath, BufferType) {
    var fd = fs.openSync(filePath, 'r');
    var st = fs.fstatSync(fd);
    var bytesRead = 0;
    function read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > st.size || length > 1048576) {
        throw new Error('Invalid image metadata range');
      }
      var b = BufferType.alloc(length);
      var done = 0, n;
      while (done < length) {
        n = fs.readSync(fd, b, done, length - done, offset + done);
        if (!n) { throw new Error('Truncated image metadata'); }
        done += n;
      }
      bytesRead += done;
      if (bytesRead > 2097152) { throw new Error('Image metadata exceeds scan budget'); }
      return b;
    }
    try {
      var h = read(0, Math.min(32, st.size)), meta = null, off, i, b, marker, length;
      if (h.length >= 24 && h.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
        meta = { width: h.readUInt32BE(16), height: h.readUInt32BE(20), bitsPerSample: h[24] || 8, colorKind: [0,4].indexOf(h[25])>=0?'GRAY':([2,6].indexOf(h[25])>=0?'RGB':'INDEXED') };
      } else if (h.length >= 2 && h[0] === 255 && h[1] === 216) {
        off = 2;
        var jpegOrient = 0;
        for (i = 0; i < 4096 && off + 2 <= st.size; i += 1) {
          b = read(off, 2);
          if (b[0] !== 255) { break; }
          if (b[1] === 255) { off += 1; continue; }
          marker = b[1]; off += 2;
          if (marker === 217 || marker === 218) { break; }
          if (marker === 1 || (marker >= 208 && marker <= 215)) { continue; }
          length = read(off, 2).readUInt16BE(0);
          if (length < 2 || off + length > st.size) { break; }
          if (marker === 225 && !jpegOrient) {
            jpegOrient = readJpegExifOrientation(read, off, length) || 0;
          }
          if ([192,193,194,195,197,198,199,201,202,203,205,206,207].indexOf(marker) !== -1) {
            b = read(off, Math.min(length, 8));
            if (b.length < 8) { break; }
            meta = { width: b.readUInt16BE(5), height: b.readUInt16BE(3), bitsPerSample: b[2], samplesPerPixel: b[7], colorKind: b[7]===3?'RGB':(b[7]===1?'GRAY':'OTHER'), orientation: jpegOrient || 1 };
            break;
          }
          off += length;
        }
      } else if (h.length >= 10 && /^GIF8[79]a/.test(h.toString('ascii', 0, 6))) {
        meta = { width: h.readUInt16LE(6), height: h.readUInt16LE(8), bitsPerSample: 8 };
      } else if (h.length >= 26 && h[0] === 66 && h[1] === 77) {
        meta = h.readUInt32LE(14) === 12
          ? { width: h.readUInt16LE(18), height: h.readUInt16LE(20) }
          : { width: Math.abs(h.readInt32LE(18)), height: Math.abs(h.readInt32LE(22)) };
      } else if (h.length >= 8 && (h.toString('ascii', 0, 2) === 'II' || h.toString('ascii', 0, 2) === 'MM')) {
        var le = h[0] === 73;
        function u16(buf, p) { return le ? buf.readUInt16LE(p) : buf.readUInt16BE(p); }
        function u32(buf, p) { return le ? buf.readUInt32LE(p) : buf.readUInt32BE(p); }
        if (u16(h, 2) !== 42) { return null; } // BigTIFF requires a dedicated decoder.
        off = u32(h, 4);
        var count = u16(read(off, 2), 0), entry, tag, type, n, value, valueOff, unit;
        if (count > 4096) { return null; }
        meta = {};
        for (i = 0; i < count; i += 1) {
          entry = read(off + 2 + i * 12, 12);
          tag = u16(entry, 0);
          if ([256,257,258,277,262,259,274,338].indexOf(tag) === -1) { continue; }
          type = u16(entry, 2); n = u32(entry, 4);
          unit = type === 3 ? 2 : (type === 4 ? 4 : (type === 1 ? 1 : 0));
          if (!unit || n < 1) { continue; }
          valueOff = unit * n > 4 ? u32(entry, 8) : off + 2 + i * 12 + 8;
          b = read(valueOff, unit);
          value = type === 3 ? u16(b, 0) : (type === 4 ? u32(b, 0) : b[0]);
          if(tag===258 && n>1) { var all=read(valueOff,unit*n); for(var bi=0;bi<n;bi++) { if(u16(all,bi*unit)!==value) { value=-1; break; } } }
          meta[{256:'width',257:'height',258:'bitsPerSample',277:'samplesPerPixel',262:'photometric',259:'compression',274:'orientation',338:'extraSamples'}[tag]] = value;
        }
        meta.hasMoreImages=u32(read(off+2+count*12,4),0)!==0;
        if(!meta.samplesPerPixel)meta.samplesPerPixel=1;
      }
      if (!meta || !(meta.width > 0 && meta.height > 0)) { return null; }
      meta.mtimeMs = st.mtimeMs != null ? Number(st.mtimeMs) : Number(st.mtime);
      meta.fileSize = st.size;
      meta.bytesRead = bytesRead;
      return meta;
    } finally { fs.closeSync(fd); }
  }

  function cropRect(opts, width, height) {
    var left = Math.max(0, Math.round(Number(opts.cropLeft) || 0));
    var top = Math.max(0, Math.round(Number(opts.cropTop) || 0));
    var w = Math.max(0, Math.round(Number(opts.cropWidth) || 0));
    var h = Math.max(0, Math.round(Number(opts.cropHeight) || 0));
    if (!w || !h) { return {left:0, top:0, width:width, height:height}; }
    if (left >= width || top >= height) { throw new Error('Crop starts outside the source image. Reset crop or choose a smaller region.'); }
    return {left:left, top:top, width:Math.min(w, width-left), height:Math.min(h, height-top)};
  }

  // Exact separable 3x3 box blur: floating-point intermediate prevents double rounding.
  function boxBlur3(image, scratch) {
    var w=image.width, h=image.height, data=image.data, size=data.length;
    scratch = scratch || {};
    if (!scratch.horizontal || scratch.horizontal.length !== size) { scratch.horizontal = new Float32Array(size); }
    if (!scratch.output || scratch.output.length !== size) { scratch.output = new Uint8ClampedArray(size); }
    var tmp=scratch.horizontal, out=scratch.output, x,y,c,p,n,a,b;
    for(y=0;y<h;y+=1) { for(x=0;x<w;x+=1) {
      p=(y*w+x)*4; a=Math.max(0,x-1); b=Math.min(w-1,x+1); n=b-a+1;
      for(c=0;c<4;c+=1) {
        tmp[p+c]=(data[(y*w+a)*4+c]+(b>a?data[(y*w+a+1)*4+c]:0)+(b>a+1?data[(y*w+b)*4+c]:0))/n;
      }
    }}
    for(y=0;y<h;y+=1) { a=Math.max(0,y-1); b=Math.min(h-1,y+1); n=b-a+1;
      for(x=0;x<w;x+=1) { p=(y*w+x)*4;
        for(c=0;c<4;c+=1) { out[p+c]=(tmp[(a*w+x)*4+c]+(b>a?tmp[((a+1)*w+x)*4+c]:0)+(b>a+1?tmp[(b*w+x)*4+c]:0))/n; }
      }
    }
    data.set(out); return scratch;
  }

  /* Aspect W/H (>0) or 0 = free. mode: free|1:1|4:3|3:4|16:9|3:2|custom|fixed|source-px */
  function cropAspectRatio(mode, customW, customH) {
    var m = String(mode || 'free');
    var cw, ch;
    if (m === 'free' || m === 'fixed' || m === 'source-px') { return 0; }
    if (m === '1:1') { return 1; }
    if (m === '4:3') { return 4 / 3; }
    if (m === '3:4') { return 3 / 4; }
    if (m === '16:9') { return 16 / 9; }
    if (m === '3:2') { return 3 / 2; }
    if (m === 'custom') {
      cw = Math.max(0, Number(customW) || 0);
      ch = Math.max(0, Number(customH) || 0);
      return (cw > 0 && ch > 0) ? (cw / ch) : 0;
    }
    /* Generic W:H so inset/crop menus are not stuck if a token is not listed above. */
    var token = m.match(/^(\d+(?:\.\d+)?)[:\/xX\u00d7](\d+(?:\.\d+)?)$/);
    if (token) {
      cw = Number(token[1]);
      ch = Number(token[2]);
      if (cw > 0 && ch > 0) { return cw / ch; }
    }
    return 0;
  }

  function clampCropBox(left, top, width, height, iw, ih) {
    left = Math.round(left);
    top = Math.round(top);
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    /* Prefer shifting the box over shrinking it (avoids "pin to corner" on move). */
    if (iw > 0) {
      if (width > iw) { width = iw; }
      if (left < 0) { left = 0; }
      if (left + width > iw) { left = Math.max(0, iw - width); }
    } else {
      left = Math.max(0, left);
    }
    if (ih > 0) {
      if (height > ih) { height = ih; }
      if (top < 0) { top = 0; }
      if (top + height > ih) { top = Math.max(0, ih - height); }
    } else {
      top = Math.max(0, top);
    }
    return { left: left, top: top, width: width, height: height };
  }

  /* Free translate: never change W×H; only clamp position inside iw×ih. */
  function moveCropBox(left, top, width, height, iw, ih) {
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    if (iw > 0 && width > iw) { width = iw; }
    if (ih > 0 && height > ih) { height = ih; }
    left = Math.round(left);
    top = Math.round(top);
    if (iw > 0) { left = Math.max(0, Math.min(iw - width, left)); }
    else { left = Math.max(0, left); }
    if (ih > 0) { top = Math.max(0, Math.min(ih - height, top)); }
    else { top = Math.max(0, top); }
    return { left: left, top: top, width: width, height: height };
  }

  /* Largest aspect-locked rect with one corner at (ax,ay) toward (bx,by), inside iw×ih. */
  function constrainDrawRect(ax, ay, bx, by, aspect, iw, ih) {
    var dx = bx - ax, dy = by - ay;
    var signX = dx < 0 ? -1 : 1, signY = dy < 0 ? -1 : 1;
    var w = Math.abs(dx), h = Math.abs(dy), left, top;
    if (!(aspect > 0)) {
      return clampCropBox(Math.min(ax, bx), Math.min(ay, by), Math.max(1, w), Math.max(1, h), iw, ih);
    }
    if (w < 1 && h < 1) { w = 1; h = Math.max(1, Math.round(1 / aspect)); }
    if (h < 1 || w / Math.max(1, h) > aspect) {
      h = Math.max(1, Math.round(w / aspect));
    } else {
      w = Math.max(1, Math.round(h * aspect));
    }
    /* Keep inside image from the anchor corner. */
    if (signX > 0 && ax + w > iw) { w = Math.max(1, iw - Math.round(ax)); h = Math.max(1, Math.round(w / aspect)); }
    if (signX < 0 && ax - w < 0) { w = Math.max(1, Math.round(ax)); h = Math.max(1, Math.round(w / aspect)); }
    if (signY > 0 && ay + h > ih) { h = Math.max(1, ih - Math.round(ay)); w = Math.max(1, Math.round(h * aspect)); }
    if (signY < 0 && ay - h < 0) { h = Math.max(1, Math.round(ay)); w = Math.max(1, Math.round(h * aspect)); }
    /* Re-clamp after interdependent shrink. */
    if (signX > 0 && ax + w > iw) { w = Math.max(1, iw - Math.round(ax)); }
    if (signX < 0 && ax - w < 0) { w = Math.max(1, Math.round(ax)); }
    if (signY > 0 && ay + h > ih) { h = Math.max(1, ih - Math.round(ay)); }
    if (signY < 0 && ay - h < 0) { h = Math.max(1, Math.round(ay)); }
    h = Math.max(1, Math.round(w / aspect));
    if (signY > 0 && ay + h > ih) { h = Math.max(1, ih - Math.round(ay)); w = Math.max(1, Math.round(h * aspect)); }
    if (signY < 0 && ay - h < 0) { h = Math.max(1, Math.round(ay)); w = Math.max(1, Math.round(h * aspect)); }
    left = signX >= 0 ? ax : ax - w;
    top = signY >= 0 ? ay : ay - h;
    /* clampCropBox clips width and height separately, so a 4:3 dragged to the
       edge of a square image becomes 1:1. Keep the ratio inside the image. */
    return fitAspectRect(left, top, w, h, aspect, iw, ih);
  }

  /* Resize with fixed opposite corner (corners) or opposite edge (sides); aspect locked. */
  function constrainResizeRect(orig, handle, dx, dy, aspect, iw, ih) {
    var left = orig.left, top = orig.top, right = orig.left + orig.width, bottom = orig.top + orig.height;
    var w, h, cx, cy, hdl = String(handle || '');
    if (!(aspect > 0)) {
      if (hdl.indexOf('w') !== -1) { left = orig.left + dx; }
      if (hdl.indexOf('e') !== -1) { right = orig.left + orig.width + dx; }
      if (hdl.indexOf('n') !== -1) { top = orig.top + dy; }
      if (hdl.indexOf('s') !== -1) { bottom = orig.top + orig.height + dy; }
      if (right < left + 1) { if (hdl.indexOf('w') !== -1) left = right - 1; else right = left + 1; }
      if (bottom < top + 1) { if (hdl.indexOf('n') !== -1) top = bottom - 1; else bottom = top + 1; }
      return clampCropBox(left, top, right - left, bottom - top, iw, ih);
    }
    /* Corner: opposite corner fixed. */
    if (hdl === 'se' || hdl === 'nw' || hdl === 'ne' || hdl === 'sw') {
      var ax, ay, bx, by;
      if (hdl === 'se') { ax = orig.left; ay = orig.top; bx = orig.left + orig.width + dx; by = orig.top + orig.height + dy; }
      else if (hdl === 'nw') { ax = orig.left + orig.width; ay = orig.top + orig.height; bx = orig.left + dx; by = orig.top + dy; }
      else if (hdl === 'ne') { ax = orig.left; ay = orig.top + orig.height; bx = orig.left + orig.width + dx; by = orig.top + dy; }
      else { ax = orig.left + orig.width; ay = orig.top; bx = orig.left + dx; by = orig.top + orig.height + dy; }
      return constrainDrawRect(ax, ay, bx, by, aspect, iw, ih);
    }
    /* Edge: opposite edge fixed; center on the free axis. */
    if (hdl === 'e' || hdl === 'w') {
      if (hdl === 'e') { right = orig.left + orig.width + dx; left = orig.left; }
      else { left = orig.left + dx; right = orig.left + orig.width; }
      w = Math.max(1, right - left);
      if (left < 0) { left = 0; w = right; }
      if (right > iw) { right = iw; w = right - left; left = right - w; }
      h = Math.max(1, Math.round(w / aspect));
      cy = orig.top + orig.height / 2;
      top = Math.round(cy - h / 2);
      if (top < 0) { top = 0; }
      if (top + h > ih) { top = Math.max(0, ih - h); h = Math.min(h, ih - top); w = Math.max(1, Math.round(h * aspect));
        if (hdl === 'e') { left = Math.max(0, Math.min(orig.left, iw - w)); }
        else { left = Math.max(0, Math.min(right - w, iw - w)); }
      }
      return fitAspectRect(left, top, w, h, aspect, iw, ih);
    }
    if (hdl === 'n' || hdl === 's') {
      if (hdl === 's') { bottom = orig.top + orig.height + dy; top = orig.top; }
      else { top = orig.top + dy; bottom = orig.top + orig.height; }
      h = Math.max(1, bottom - top);
      if (top < 0) { top = 0; h = bottom; }
      if (bottom > ih) { bottom = ih; h = bottom - top; top = bottom - h; }
      w = Math.max(1, Math.round(h * aspect));
      cx = orig.left + orig.width / 2;
      left = Math.round(cx - w / 2);
      if (left < 0) { left = 0; }
      if (left + w > iw) { left = Math.max(0, iw - w); w = Math.min(w, iw - left); h = Math.max(1, Math.round(w / aspect));
        if (hdl === 's') { top = Math.max(0, Math.min(orig.top, ih - h)); }
        else { top = Math.max(0, Math.min(bottom - h, ih - h)); }
      }
      return fitAspectRect(left, top, w, h, aspect, iw, ih);
    }
    return fitAspectRect(orig.left, orig.top, orig.width, orig.height, aspect, iw, ih);
  }

  /* Sync W↔H when ratio locked. changed: 'width'|'height'. */
  function syncSizeWithAspect(left, top, width, height, changed, aspect, iw, ih) {
    var w = Math.max(0, Math.round(width));
    var h = Math.max(0, Math.round(height));
    if (!(aspect > 0)) { return clampCropBox(left, top, Math.max(1, w || 1), Math.max(1, h || 1), iw, ih); }
    if (changed === 'height') {
      h = Math.max(1, h);
      w = Math.max(1, Math.round(h * aspect));
    } else {
      w = Math.max(1, w);
      h = Math.max(1, Math.round(w / aspect));
    }
    return clampCropBox(left, top, w, h, iw, ih);
  }

  /* Like syncSizeWithAspect, but a square bound must not squash 4:3 / 16:9 into 1:1.
     Shrink one side, then the other, and keep W/H = aspect. */
  function fitAspectRect(left, top, width, height, aspect, iw, ih) {
    var w;
    var h;
    if (!(aspect > 0)) {
      return clampCropBox(left, top, Math.max(1, Math.round(width) || 1), Math.max(1, Math.round(height) || 1), iw, ih);
    }
    w = Math.max(1, Math.round(width));
    h = Math.max(1, Math.round(w / aspect));
    if (iw > 0 && w > iw) {
      w = Math.max(1, Math.floor(iw));
      h = Math.max(1, Math.round(w / aspect));
    }
    if (ih > 0 && h > ih) {
      h = Math.max(1, Math.floor(ih));
      w = Math.max(1, Math.round(h * aspect));
    }
    if (iw > 0 && w > iw) {
      w = Math.max(1, Math.floor(iw));
      h = Math.max(1, Math.round(w / aspect));
    }
    /* Shift only. moveCropBox would clip each side to the image and square the box. */
    left = Math.round(left);
    top = Math.round(top);
    if (iw > 0 && left + w > iw) { left = Math.max(0, iw - w); }
    if (ih > 0 && top + h > ih) { top = Math.max(0, ih - h); }
    if (left < 0) { left = 0; }
    if (top < 0) { top = 0; }
    return { left: left, top: top, width: w, height: h };
  }

  function placeFixedRect(left, top, fw, fh, iw, ih) {
    fw = Math.max(1, Math.round(fw));
    fh = Math.max(1, Math.round(fh));
    if (iw > 0) { fw = Math.min(fw, iw); }
    if (ih > 0) { fh = Math.min(fh, ih); }
    return clampCropBox(left, top, fw, fh, iw, ih);
  }

  /*
   * Hit-test crop interaction in the SAME pixel space as (x,y) and crop rect
   * (display space when preview is artboard-oriented). handleSlop is half-size
   * of the handle hit box in that space. Returns { mode:'resize'|'move'|'draw', handle? }.
   */
  function hitTestCrop(x, y, crop, handleSlop, allowResize) {
    var L, T, R, B, s, i, hx, hy;
    var handles;
    if (!crop || !(crop.width > 0 && crop.height > 0)) {
      return { mode: 'draw' };
    }
    L = Number(crop.left) || 0;
    T = Number(crop.top) || 0;
    R = L + (Number(crop.width) || 0);
    B = T + (Number(crop.height) || 0);
    s = Math.max(1, Number(handleSlop) || 8);
    if (allowResize !== false) {
      handles = [
        { id: 'nw', x: L, y: T }, { id: 'n', x: (L + R) / 2, y: T }, { id: 'ne', x: R, y: T },
        { id: 'e', x: R, y: (T + B) / 2 },
        { id: 'se', x: R, y: B }, { id: 's', x: (L + R) / 2, y: B }, { id: 'sw', x: L, y: B },
        { id: 'w', x: L, y: (T + B) / 2 }
      ];
      for (i = 0; i < handles.length; i += 1) {
        hx = handles[i].x;
        hy = handles[i].y;
        if (Math.abs(x - hx) <= s && Math.abs(y - hy) <= s) {
          return { mode: 'resize', handle: handles[i].id };
        }
      }
    }
    if (x >= L && x <= R && y >= T && y <= B) {
      return { mode: 'move' };
    }
    return { mode: 'draw' };
  }

  /* Linear 2x2 affine: m = [a,b,c,d] maps (x,y) -> (a*x+c*y, b*x+d*y). */
  function applyAffine2(m, x, y) {
    m = m || [1, 0, 0, 1];
    return {
      x: (Number(m[0]) || 0) * x + (Number(m[2]) || 0) * y,
      y: (Number(m[1]) || 0) * x + (Number(m[3]) || 0) * y
    };
  }

  function invertAffine2(m) {
    var a = Number(m && m[0]) || 0;
    var b = Number(m && m[1]) || 0;
    var c = Number(m && m[2]) || 0;
    var d = Number(m && m[3]) || 0;
    var det = a * d - b * c;
    if (!isFinite(det) || Math.abs(det) < 1e-12) { return [1, 0, 0, 1]; }
    return [d / det, -b / det, -c / det, a / det];
  }

  function affineIsIdentity(m) {
    if (!m || m.length < 4) { return true; }
    return Math.abs((Number(m[0]) || 0) - 1) < 1e-9 &&
      Math.abs(Number(m[1]) || 0) < 1e-9 &&
      Math.abs(Number(m[2]) || 0) < 1e-9 &&
      Math.abs((Number(m[3]) || 0) - 1) < 1e-9;
  }

  /*
   * Map an axis-aligned rect through linear m about image center, return the
   * axis-aligned bounding box in the same iw×ih space. Used so a flat (screen-
   * upright) crop overlay can track a CSS-transformed preview, and so a flat
   * screen selection maps back to source-file L/T/W/H via the inverse.
   */
  function mapRectAABBThroughAffine(rect, iw, ih, m) {
    var L = Number(rect && rect.left) || 0;
    var T = Number(rect && rect.top) || 0;
    var W = Math.max(0, Number(rect && rect.width) || 0);
    var H = Math.max(0, Number(rect && rect.height) || 0);
    var R = L + W;
    var B = T + H;
    var cx = (Number(iw) || 0) / 2;
    var cy = (Number(ih) || 0) / 2;
    var corners = [[L, T], [R, T], [R, B], [L, B]];
    var xs = [];
    var ys = [];
    var i;
    var p;
    var left;
    var top;
    var right;
    var bottom;
    if (!(iw > 0 && ih > 0) || !(W > 0 && H > 0)) {
      return { left: L, top: T, width: W, height: H };
    }
    if (affineIsIdentity(m)) {
      return clampCropBox(L, T, W, H, iw, ih);
    }
    for (i = 0; i < 4; i += 1) {
      p = applyAffine2(m, corners[i][0] - cx, corners[i][1] - cy);
      xs.push(p.x + cx);
      ys.push(p.y + cy);
    }
    left = Math.min.apply(null, xs);
    top = Math.min.apply(null, ys);
    right = Math.max.apply(null, xs);
    bottom = Math.max.apply(null, ys);
    return clampCropBox(left, top, right - left, bottom - top, iw, ih);
  }

  function sourceRectToScreenAABB(rect, iw, ih, m) {
    return mapRectAABBThroughAffine(rect, iw, ih, m);
  }

  function screenRectToSourceAABB(rect, iw, ih, m) {
    return mapRectAABBThroughAffine(rect, iw, ih, invertAffine2(m));
  }


  /* Dash patterns in points: solid / dashed / dotted / dash-dot. */
  function strokeDashArray(style) {
    var s = String(style || 'solid');
    if (s === 'dashed') { return [6, 4]; }
    if (s === 'dotted') { return [1, 2.5]; }
    if (s === 'dash-dot') { return [8, 3, 1, 3]; }
    return [];
  }

  /* Frame or leader stroke. Throws on a bad color; clamps weight and corner radius. */
  function insetStrokeStyle(input, fallbackWeight) {
    var src = input || {};
    var dash = String(src.dash || 'solid');
    var corner = String(src.corner || 'miter');
    var weight = Number(src.weight);
    var radius = Number(src.radius);
    var color = String(src.color || '#ffffff');
    if (dash !== 'solid' && dash !== 'dashed' && dash !== 'dotted' && dash !== 'dash-dot') { dash = 'solid'; }
    if (corner !== 'miter' && corner !== 'round' && corner !== 'bevel') { corner = 'miter'; }
    if (!(weight > 0 && weight <= 20)) { weight = fallbackWeight > 0 ? fallbackWeight : 1; }
    if (!/^#[0-9a-f]{6}$/i.test(color)) { throw new Error('Invalid inset stroke color'); }
    if (!(radius >= 0) || !isFinite(radius)) { radius = 0; }
    if (radius > 40) { radius = 40; }
    return {
      weight: weight,
      color: color.toLowerCase(),
      dash: dash,
      dashes: strokeDashArray(dash),
      corner: corner,
      radius: radius
    };
  }

  /* Normalized rect on the current linked file (same L/T/W/H space as crop). */
  function insetNormFromRect(rect, spaceW, spaceH) {
    var w = Number(spaceW);
    var h = Number(spaceH);
    var left;
    var top;
    var width;
    var height;
    var nx;
    var ny;
    var nw;
    var nh;
    if (!(w > 0 && h > 0)) { throw new Error('Inset region is empty'); }
    left = Number(rect && rect.left) || 0;
    top = Number(rect && rect.top) || 0;
    width = Number(rect && rect.width) || 0;
    height = Number(rect && rect.height) || 0;
    if (!(width > 0 && height > 0)) { throw new Error('Inset region is empty'); }
    nx = left / w;
    ny = top / h;
    nw = width / w;
    nh = height / h;
    if (nx < 0) { nw += nx; nx = 0; }
    if (ny < 0) { nh += ny; ny = 0; }
    if (nx + nw > 1) { nw = 1 - nx; }
    if (ny + nh > 1) { nh = 1 - ny; }
    if (!(nw > 1e-6 && nh > 1e-6)) { throw new Error('Inset region is empty'); }
    return { x: nx, y: ny, w: nw, h: nh };
  }

  /* corners: TL, TR, BR, BL in document points (Y-up), same order as sciBitmapCorners. */
  function insetFrameQuad(corners, norm) {
    var x0 = Number(norm.x) || 0;
    var y0 = Number(norm.y) || 0;
    var x1 = x0 + (Number(norm.w) || 0);
    var y1 = y0 + (Number(norm.h) || 0);
    function P(nx, ny) {
      var ux = corners[1][0] - corners[0][0];
      var uy = corners[1][1] - corners[0][1];
      var vx = corners[3][0] - corners[0][0];
      var vy = corners[3][1] - corners[0][1];
      return [corners[0][0] + nx * ux + ny * vx, corners[0][1] + nx * uy + ny * vy];
    }
    return [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
  }

  function insetPointSize(corners, norm, magnification, anchor, pixelSize) {
    var mag = Number(magnification);
    var frameW;
    var frameH;
    var sizeW;
    var sizeH;
    var name = String(anchor || '');
    var nw;
    var nh;
    var pw = pixelSize && Number(pixelSize.width) || 0;
    var ph = pixelSize && Number(pixelSize.height) || 0;
    var cropAspect;
    if (!(mag >= 1 && mag <= 20)) { throw new Error('Invalid inset settings'); }
    frameW = Math.sqrt(Math.pow(corners[1][0] - corners[0][0], 2) + Math.pow(corners[1][1] - corners[0][1], 2));
    frameH = Math.sqrt(Math.pow(corners[3][0] - corners[0][0], 2) + Math.pow(corners[3][1] - corners[0][1], 2));
    /* Left/right: match main height, width from crop/pixel aspect.
       Above/below: match main width, height from crop/pixel aspect. */
    nw = Number(norm.w) || 0;
    nh = Number(norm.h) || 0;
    if (pw > 0 && ph > 0) {
      cropAspect = pw / ph;
    } else if (nh > 0 && frameH > 0) {
      cropAspect = (nw / nh) * (frameW / frameH);
    } else {
      cropAspect = 0;
    }
    if (name === 'left' || name === 'right') {
      if (!(nh > 0) && !(pw > 0 && ph > 0)) { throw new Error('Inset region is empty'); }
      if (!(cropAspect > 0)) { throw new Error('Inset region is empty'); }
      sizeH = frameH;
      sizeW = sizeH * cropAspect;
      return { width: sizeW, height: sizeH, magnification: mag, effectiveMagnification: (nh > 0 && frameH > 0) ? (sizeH / (nh * frameH)) : mag };
    }
    if (name === 'above' || name === 'below') {
      if (!(nw > 0) && !(pw > 0 && ph > 0)) { throw new Error('Inset region is empty'); }
      if (!(cropAspect > 0)) { throw new Error('Inset region is empty'); }
      sizeW = frameW;
      sizeH = sizeW / cropAspect;
      return { width: sizeW, height: sizeH, magnification: mag, effectiveMagnification: (nw > 0 && frameW > 0) ? (sizeW / (nw * frameW)) : mag };
    }
    sizeW = nw * frameW * mag;
    sizeH = nh * frameH * mag;
    return { width: sizeW, height: sizeH, magnification: mag, effectiveMagnification: mag };
  }

  /* bounds: Illustrator geometricBounds [left, top, right, bottom], top > bottom. position is top-left. */
  function insetAnchorPosition(bounds, size, gap, anchor) {
    var g = Number(gap);
    var left = Number(bounds[0]);
    var top = Number(bounds[1]);
    var right = Number(bounds[2]);
    var bottom = Number(bounds[3]);
    var name = String(anchor || 'right');
    if (!(g >= 0) || !isFinite(g) || g > 400) { g = 12; }
    if (name !== 'left' && name !== 'right' && name !== 'above' && name !== 'below') { name = 'right'; }
    if (name === 'left') { return { x: left - g - size.width, y: top, anchor: name, gap: g }; }
    if (name === 'above') { return { x: left, y: top + g + size.height, anchor: name, gap: g }; }
    if (name === 'below') { return { x: left, y: bottom - g, anchor: name, gap: g }; }
    return { x: right + g, y: top, anchor: name, gap: g };
  }

  function insetLeaders(frameQuad, insetPos, insetSize) {
    var inset = [
      [insetPos.x, insetPos.y],
      [insetPos.x + insetSize.width, insetPos.y],
      [insetPos.x + insetSize.width, insetPos.y - insetSize.height],
      [insetPos.x, insetPos.y - insetSize.height]
    ];
    var fc = [0, 0];
    var ic = [0, 0];
    var i;
    var dx;
    var dy;
    var fScore = [];
    var iScore = [];
    var fA;
    var fB;
    var iA;
    var iB;
    var pairA;
    var pairB;
    function dist2(a, b) {
      var x = a[0] - b[0];
      var y = a[1] - b[1];
      return x * x + y * y;
    }
    function segmentsCross(a, b) {
      function cross(o, p, q) {
        return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
      }
      var d1 = cross(a[0], a[1], b[0]);
      var d2 = cross(a[0], a[1], b[1]);
      var d3 = cross(b[0], b[1], a[0]);
      var d4 = cross(b[0], b[1], a[1]);
      return d1 * d2 < 0 && d3 * d4 < 0;
    }
    for (i = 0; i < 4; i += 1) {
      fc[0] += frameQuad[i][0];
      fc[1] += frameQuad[i][1];
      ic[0] += inset[i][0];
      ic[1] += inset[i][1];
    }
    fc[0] /= 4;
    fc[1] /= 4;
    ic[0] /= 4;
    ic[1] /= 4;
    dx = ic[0] - fc[0];
    dy = ic[1] - fc[1];
    for (i = 0; i < 4; i += 1) {
      fScore.push({ i: i, s: (frameQuad[i][0] - fc[0]) * dx + (frameQuad[i][1] - fc[1]) * dy });
      iScore.push({ i: i, s: (inset[i][0] - ic[0]) * -dx + (inset[i][1] - ic[1]) * -dy });
    }
    fScore.sort(function (a, b) { return b.s - a.s; });
    iScore.sort(function (a, b) { return b.s - a.s; });
    fA = frameQuad[fScore[0].i];
    fB = frameQuad[fScore[1].i];
    iA = inset[iScore[0].i];
    iB = inset[iScore[1].i];
    /* Prefer non-crossing pairing; if tied, shorter total length (avoids X leaders). */
    pairA = [[fA, iA], [fB, iB]];
    pairB = [[fA, iB], [fB, iA]];
    if (segmentsCross(pairA[0], pairA[1]) && !segmentsCross(pairB[0], pairB[1])) { return pairB; }
    if (segmentsCross(pairB[0], pairB[1]) && !segmentsCross(pairA[0], pairA[1])) { return pairA; }
    if (dist2(fA, iA) + dist2(fB, iB) <= dist2(fA, iB) + dist2(fB, iA)) { return pairA; }
    return pairB;
  }


  /* fileNy 0 = top of raster. When corner[0..1] sit below corner[2..3] (BL-first
     PlacedItem UV), invert so frame/artboard mapping keeps file top at visual top. */
  function insetFileNyToCornerNy(corners, fileNy) {
    var topEdge = (corners[0][1] + corners[1][1]) * 0.5;
    var botEdge = (corners[2][1] + corners[3][1]) * 0.5;
    if (topEdge >= botEdge) { return fileNy; }
    return 1 - fileNy;
  }

  /* Axis-aligned: file UV → artboard via geometricBounds [L,T,R,B] (Y-up).
     Rotated: corner UV with BL-first remap. fileCorners = TL,TR,BR,BL (file y=0 top). */
  function insetFileNormQuad(boundsOrNull, corners, fileCorners) {
    var i, nx, ny, out = [], b = boundsOrNull, L, T, R, Btm, ux, uy, vx, vy;
    var axis = true;
    for (i = 0; i < 4; i += 1) {
      if (Math.min(Math.abs(corners[(i + 1) % 4][0] - corners[i][0]), Math.abs(corners[(i + 1) % 4][1] - corners[i][1])) > 0.75) {
        axis = false; break;
      }
    }
    if (axis && b && isFinite(b[0]) && isFinite(b[1]) && isFinite(b[2]) && isFinite(b[3])) {
      L = b[0]; T = b[1]; R = b[2]; Btm = b[3];
      for (i = 0; i < 4; i += 1) {
        nx = Number(fileCorners[i].x); ny = Number(fileCorners[i].y);
        out.push([L + nx * (R - L), T - ny * (T - Btm)]);
      }
      return out;
    }
    ux = corners[1][0] - corners[0][0]; uy = corners[1][1] - corners[0][1];
    vx = corners[3][0] - corners[0][0]; vy = corners[3][1] - corners[0][1];
    for (i = 0; i < 4; i += 1) {
      nx = Number(fileCorners[i].x);
      ny = insetFileNyToCornerNy(corners, Number(fileCorners[i].y));
      out.push([corners[0][0] + nx * ux + ny * vx, corners[0][1] + nx * uy + ny * vy]);
    }
    return out;
  }

  function sourceNormAtPoint(corners, x, y) {
    var ux = corners[1][0] - corners[0][0];
    var uy = corners[1][1] - corners[0][1];
    var vx = corners[3][0] - corners[0][0];
    var vy = corners[3][1] - corners[0][1];
    var dx = x - corners[0][0];
    var dy = y - corners[0][1];
    var det = ux * vy - uy * vx;
    if (!isFinite(det) || Math.abs(det) < 1e-12) { throw new Error('Singular artwork transform'); }
    return { x: (dx * vy - vx * dy) / det, y: (ux * dy - uy * dx) / det };
  }

  /* Map artboard points (on or over the placed image) into source-file pixels. */
  function regionFromDocPoints(corners, points, sourceW, sourceH) {
    var i;
    var n;
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    var sw = Number(sourceW);
    var sh = Number(sourceH);
    if (!(sw > 0 && sh > 0)) { throw new Error('Inset region is empty'); }
    if (!points || points.length < 2) { throw new Error('Select the image and a rectangle to read an artboard region'); }
    for (i = 0; i < points.length; i += 1) {
      n = sourceNormAtPoint(corners, Number(points[i][0]), Number(points[i][1]));
      if (n.x < minX) { minX = n.x; }
      if (n.y < minY) { minY = n.y; }
      if (n.x > maxX) { maxX = n.x; }
      if (n.y > maxY) { maxY = n.y; }
    }
    return clampCropBox(minX * sw, minY * sh, (maxX - minX) * sw, (maxY - minY) * sh, sw, sh);
  }

  return {readMetadata:readMetadata, exifOrientationTransform:exifOrientationTransform, cropRect:cropRect, boxBlur3:boxBlur3,
    cropAspectRatio:cropAspectRatio, clampCropBox:clampCropBox, moveCropBox:moveCropBox, constrainDrawRect:constrainDrawRect,
    constrainResizeRect:constrainResizeRect, syncSizeWithAspect:syncSizeWithAspect, fitAspectRect:fitAspectRect, placeFixedRect:placeFixedRect,
    hitTestCrop:hitTestCrop, applyAffine2:applyAffine2, invertAffine2:invertAffine2, affineIsIdentity:affineIsIdentity,
    mapRectAABBThroughAffine:mapRectAABBThroughAffine, sourceRectToScreenAABB:sourceRectToScreenAABB,
    screenRectToSourceAABB:screenRectToSourceAABB,
    strokeDashArray:strokeDashArray, insetStrokeStyle:insetStrokeStyle, insetNormFromRect:insetNormFromRect,
    insetFrameQuad:insetFrameQuad, insetPointSize:insetPointSize, insetAnchorPosition:insetAnchorPosition,
    insetLeaders:insetLeaders, sourceNormAtPoint:sourceNormAtPoint, regionFromDocPoints:regionFromDocPoints,
    insetFileNyToCornerNy:insetFileNyToCornerNy, insetFileNormQuad:insetFileNormQuad};
}));
