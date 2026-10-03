# Modules / 模块

## English

- `client/bitmap-panel.js` — RGB panel, selection, preview, Apply.
- `client/bitmap-panel-marquee.js` — crop and inset marquees. Inset drawing uses the crop pointer path and stores left, top, width, and height on the inset fields. `#insetOverlay` stays hidden. `#cropOverlay` draws the box.
- `client/bitmap-core.js` — crop math, metadata, blur, presets.
- `client/bitmap-workflow.js` — RGB recipe and baseline TIFF.
- `client/scientific-panel.js` — raw controls, calibration, scale presets, raw batch.
- `client/scientific-core.js` — uint8/uint16 mapping, histograms, TIFF/OME reader, calibration math.
- `client/histogram-view.js` — histogram drawing.
- `client/raw-bridge.js` — Fiji task queue. No TCP listener.
- `scripts/raw-service.groovy` — headless Bio-Formats, one plane, raw little-endian export.
- `jsx/bitmap.jsx` — host script. The tail after `/* Scientific geometry` is the same text as `jsx/science.jsx`.
- `jsx/science.jsx` — four-corner fit and vector lines. Edit it, then keep the host tail identical.

Apply writes an 8-bit display file. The raw file stays the source. A calibration is not copied just because a recipe is reused.

The bar is a vector group from the pixel width and µm/px at creation. A standalone image and bar are wrapped in one group; an image in a normal group gets the bar as a sibling. Whole-group transforms move both. Image-only crop, replacement, or scaling requires updating the bar. Clipped groups are rejected. Figure labels are independent editable text groups keyed to one placed image; selecting a group with one image positions the label from that image.

A legacy stamp `size:mtime` is not treated as the same content when only the byte size matches. The panel asks you to confirm the source, then stores `sha256:`. Raw JSON is written to a temporary file and renamed into place. If the image is already replaced and the record fails, the panel says so and retries the record the next time it opens.

Not in this panel: projection, CLAHE, raw spatial filters, multi-file datasets.

- https://bio-formats.readthedocs.io/en/stable/developers/file-reader.html
- https://ome-model.readthedocs.io/en/latest/ome-tiff/specification.html
- https://imagej.net/learn/headless
- https://ai-scripting.docsforadobe.dev/jsobjref/PlacedItem/

## 中文

- `client/bitmap-panel.js`：RGB 面板、选区、预览、应用。
- `client/bitmap-panel-marquee.js`：裁剪和放大插图的框。插图拖拽走裁剪的指针路径，左/上/宽/高写入插图字段。`#insetOverlay` 保持隐藏。框由 `#cropOverlay` 绘制。
- `client/bitmap-core.js`：裁剪计算、元数据、模糊、预设。
- `client/bitmap-workflow.js`：RGB 配方和基线 TIFF。
- `client/scientific-panel.js`：原始通道、标定、标尺预设、原始批量。
- `client/scientific-core.js`：uint8/uint16 映射、直方图、TIFF/OME 读取、标定计算。
- `client/histogram-view.js`：只负责画直方图。
- `client/raw-bridge.js`：Fiji 任务队列。没有 TCP 监听。
- `scripts/raw-service.groovy`：无界面 Bio-Formats，单平面，小端原始导出。
- `jsx/bitmap.jsx`：宿主脚本。`/* Scientific geometry` 之后的文本与 `jsx/science.jsx` 相同。
- `jsx/science.jsx`：四角贴合和矢量线。修改后须与宿主脚本的对应尾部保持一致。

应用写出 8 位展示图。原始文件仍是数据来源。复用配方不会顺便复制标定。

标尺在创建时按像素宽度和 µm/px 生成。独立图片与标尺组成一个组；已有普通组的图片则将标尺加入原组。整体变换会带动两者。单独裁剪、替换或缩放图片后需要更新标尺。剪切蒙版组不自动改动。图版标签是按单张置入图像标记的独立可编辑文字组；选中含一张图片的组时，标签仍按该图片定位。

旧记录 `size:mtime` 不能只凭文件大小相同就当作内容未变。面板会要求重新确认来源，确认后保存 `sha256:`。原始 JSON 先写入临时文件再替换。若图片已经替换而记录写入失败，面板会说明，并在下次打开时重试该记录。

本面板不做投影、CLAHE、原始数据的空间滤波，也不读多文件数据集。
