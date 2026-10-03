// PaperFig for Illustrator panel proxy template (reference). Runtime generates a temp .ijm
// with concrete paths. Original; now AGPL-3.0.
// Purpose (0.2.8): LAST resort when Canvas cannot open (complex TIFF) and AI imageCapture
// both fail — or for complex (16-bit / multi-channel) sources. Order is
// file→Canvas → AI capture → Fiji proxy. Preferred simple path: CEP reads
// linked PNG/JPEG/GIF/BMP bytes into Image (status Canvas).
// Order: open → Size max-edge ~800 (constrain, Bilinear, average) → saveAs PNG → close.
// Cache key in panel: source path + mtime. Crop overlay still uses full source
// pixel size (lastImageSize); pointer map uses object-fit contain of that aspect.
// Panel uses bitmap-panel.js generatePanelProxyMacro().
print("SCI_BITMAP_PANEL_PROXY_TEMPLATE");
