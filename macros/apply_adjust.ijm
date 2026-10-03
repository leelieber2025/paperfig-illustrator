// PaperFig for Illustrator apply / preview template (reference). Runtime generates a temp .ijm
// with concrete paths. Original; now AGPL-3.0.
// Order: open → crop → [preview: Scale max-edge] → color balance (RGB multiply) →
//        grayscale → tone (Low/High black/white points override B/C) →
//        Invert → Soft Gaussian (sigma 0.8) → light Unsharp Mask →
//        LUT → DPI props → TIFF → close.
// Rotate / Flip are NOT done in Fiji — Illustrator item.rotate / item.resize
// (live on button click in 0.2.4+, and optionally after replace on Apply if UI ≠ 0).
// Artboard preview (0.2.4): same ops, downscale max edge ~1500, save *_preview_*.tif,
// temporary relink; Cancel restores original source path.
// Panel preview/Apply (0.2.8): Canvas for JPG/PNG/GIF/BMP (no Fiji); Fiji only when Canvas cannot open
// (open→Size~800→PNG; see panel_proxy.ijm); status Canvas / AI capture / Fiji.
// Cache by source path+mtime. No artboard relink for panel canvas.
// Low/High: setMinAndMax(low, high); defaults 0–255 (B/C used if non-zero instead).
// Auto Levels (panel): Low/High ≈ 0.5% / 99.5% luminance percentiles on preview.
// Pick Black/White (panel): neighborhood mean L → Low or High; color-cast nudge:
//   cyanRed=(L-R)/2.55, magentaGreen=(L-G)/2.55, yellowBlue=(L-B)/2.55 (clamped ±100).
// B/C when Low/High at defaults:
//   center=127.5-(B/100)*127.5; halfSpan=max(1,127.5*(1-(C/100)*0.9));
// Color balance midtones (C–R / M–G / Y–B in [-100,100]) → RGB Stack
//      Multiply gains, then RGB Color. Skipped if all zero or not RGB.
// Panel uses bitmap-panel.js generateApplyMacro().
print("SCI_BITMAP_APPLY_TEMPLATE");
