# How to use PaperFig / 使用说明

**Version 1.0.0** · Adobe Illustrator CEP panel · License **[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)**

English first; Chinese under each section.

---

## 1. Install / 安装

### Installer scripts / 安装脚本

The installers already sit in the extension folder (the folder that contains `CSXS/manifest.xml`). Do not move them beside that folder. Works for the release `paperfig/` zip **and** for GitHub **Code → Download ZIP** / source zipball folders (no rename).

| OS | Double-click | Or run |
|----|--------------|--------|
| **Windows** | `install.bat` | `powershell -ExecutionPolicy Bypass -File install.ps1` |
| **macOS** | `install.command` | `bash install.sh` |

Thin wrappers under [`install/`](install/) call the root installers.

The scripts:

1. Copy the extension to `%APPDATA%\Adobe\CEP\extensions\paperfig` (Windows) or `~/Library/Application Support/Adobe/CEP/extensions/paperfig` (macOS).
2. Set `PlayerDebugMode=1` for **CSXS.9–15** (unsigned CEP).
3. Print quit/reopen Illustrator instructions.

Manual copy, registry, and `defaults`: [`INSTALL.md`](INSTALL.md).

### 中文

安装脚本就在含 `CSXS/manifest.xml` 的扩展目录里，不要再挪到该目录外面：

- **Windows：** 双击 `install.bat`，或运行 `install.ps1`
- **macOS：** 双击 `install.command`，或执行 `bash install.sh`

脚本会复制到 CEP `extensions/paperfig`，并写入 CSXS.9–15 的 `PlayerDebugMode`。完整说明见 [`INSTALL.md`](INSTALL.md)。

---

## 2. Open the panel / 打开面板

1. Quit and reopen **Adobe Illustrator** after install.
2. **Window → Extensions** (or **Extensions (Legacy)**) → **PaperFig for Illustrator**.
3. Confirm the panel footer shows **1.0.0**.
4. Select a linked bitmap on the artboard. The preview shows that image.

If Fiji is not configured, the first open shows a **Configure Fiji** screen (path / Detect / Test). Use **Skip for RGB-only** when you only need ordinary RGB JPG/PNG. Reopen setup anytime under **Export → Fiji setup**.

### 中文

安装后退出并重开 Illustrator。打开 **窗口 → 扩展／扩展（旧版）→ PaperFig for Illustrator**。页脚应为 **1.0.0**。在画板选中位图后，预览显示该图。

未配置 Fiji 时，首次打开会先出现 **配置 Fiji** 界面。仅用普通 RGB JPG/PNG 可选「稍后」。之后可在 **导出 Export → Fiji 设置** 中修改。

---

## 3. Tabs overview / 各页概要

The top of the panel stays on screen: preview, **Apply / Refresh / Reset**, **Artboard preview / Cancel preview / Hold = original**, and the notice. Tabs:

| Tab | Role |
|-----|------|
| **Adjust** | RGB8 brightness/contrast/tone, color balance, grayscale/invert/blur/sharpen, fluorescence keep-channel, presets |
| **Raw** | uint8/uint16 planes (native OME-TIFF or Fiji), per-channel range/gamma, group lock, histograms |
| **Scale** | Spatial calibration and vector scale bar |
| **Geom** | Live rotate/flip; exclusive crop / inset marquees; file-pixel crop |
| **Export** | Batch apply, PNG/JPEG/TIFF + DPI, **Fiji setup** |

Sliders update the **panel preview only**. **Apply** writes a full-resolution 8-bit display file and relinks the artboard. Undo with Illustrator **Ctrl/Cmd+Z**. Raw and scientific files on disk are not modified.

### 中文

顶部固定：预览、**应用 / 刷新 / 重置**、**画板预览 / 取消预览 / 按住=原图**，以及状态提示。五个标签页：**调整**（RGB8 色调与荧光通道）、**原始**（uint8/uint16）、**标尺**、**几何**、**导出**（批量、格式、Fiji）。滑块只改面板预览；**应用** 才写出全分辨率的 8 位展示图。撤销用 Illustrator **Ctrl/Cmd+Z**。

---

## 4. Adjust / 调整

1. Select an image; set Brightness / Contrast / Low–High (or Pick Black/White / Auto Levels).
2. Optional: color balance (C–R / M–G / Y–B), Grayscale, Invert, Soft blur, Sharpen.
3. **Fluorescence:** enable RGB recoloring; use Keep buttons (all / R+G / … / single channel). Hidden planes are zeroed on preview and on Apply. Solo grayscale in Preview mode is preview-only. Quick color swatches beside **Color** match Fiji / ImageJ Merge Channels (red/green/blue/gray/cyan/magenta/yellow); the free RGB picker remains.
4. Presets store intensity and RGB colors (not crop, rotation, or path).
5. Click **Apply** to write the display file and relink.

### 中文

选图后设置亮度、对比和黑白点（或取黑点、取白点、自动色阶）。可选色彩平衡、灰度、反相、模糊、锐化。荧光控件在 **调整** 页（不是单独一页）：勾选 **启用换色**，再用 **保留** 留下 1～3 个显示平面。预设不含裁剪和旋转。然后点 **应用**，写出展示图并重新链接。

---

## 5. Raw / 原始

1. Set **Raw source** to the scientific file (or use the current link) → **Load channels**.
2. Prefer native uncompressed OME-TIFF; otherwise configure Fiji (Export tab) + Bio-Formats.
3. Choose Series / Z / T (0-based). Keep 1–2 channels if needed; set Low/High, color, and gamma.
4. Optional: **Lock group ranges** for multi-image consistency (no per-image autoscale).
5. **Apply** still writes an 8-bit display file; the raw file is not overwritten.

### 中文

选择原始数据集 → **加载通道**。优先原生未压缩 OME-TIFF；否则在 Export 页配置 Fiji + Bio-Formats。选择 Series/Z/T，勾选保留通道并设定范围。组锁定固定范围，不做逐图拉伸。Apply 只写出 8 位展示图，不改原文件。

---

## 6. Scale — calibrate & bar / 标尺标定与矢量标尺

### Calibration methods / 标定方式

- **Raw metadata** — µm/px from OME/physical size when available.
- **Known full-source field width** — enter the full-image field size (not the crop W×H).
- **Two points on an existing horizontal bar** — pick two endpoints on the preview with a known reference length.

### Pick endpoints + zoom / pan / 端点拾取与缩放平移

1. Open **Scale** → choose **Two points…** → set reference length and units.
2. Click **Pick reference endpoints**.
3. **Zoom the preview** for precision: mouse wheel / pinch, or − / +; **Fit** resets. **Space-drag** or **middle-button drag** pans while zoomed. Changing selection resets to Fit.
4. Click two endpoints on the preview (coordinates are **full-source file pixels**).
5. **Save calibration**. Then set bar length/style → **Create / update vector bar**.

### Per-image persistence / 按图持久化

- Each image (`objectKey`) stores its own calibration in `localStorage` (`sci_calibrations_v1`).
- Selecting another **uncalibrated** image clears Scale fields; it does **not** apply the previous image’s µm/px.
- **Reuse last** copies the last saved calibration onto the current image only.
- **Clear** removes only this image’s saved calibration.
- Refresh / Apply / reopen keep the saved calibration; place-replace after Apply migrates it to the new object.
### Named scale presets

After saving calibration, set the bar length/style and click **Save**. The Save dialog (ExtendScript `File.saveDlg`, seeded in `~/paperfig/scales`) starts in `~/paperfig/scales` (Windows: `%USERPROFILE%\paperfig\scales`); choose a file name and PaperFig writes a JSON preset. **Load** opens the native file picker in that same folder and applies the selected calibration and bar style. These presets are separate from per-image calibration; **Reuse last** remains the explicit cross-image copy.

### Crop does not clear calibration / 裁剪不清除标定

- µm/px and endpoints are in **full-source** file space (`coordSpace: 'full-source'`), independent of crop L/T/W/H.
- Drawing a crop, resizing it, or **Use full image** does **not** clear or rewrite calibration.
- The vector bar uses current display pixel width × µm/px, so the same calibration works before and after crop. Update the bar after crop/resize if needed; it does not auto-track.

Do **not** use print DPI as spatial calibration.

### 中文

**两点标定：** 在 Scale 页选「已有水平标尺两端」→ **拾取参考端点** → 用滚轮/捏合或 −/+ **放大预览**，空格拖或中键拖 **平移** → 在预览上点两端 → **保存标定** → 创建矢量标尺。

标定按图保存在本机；换到未标定图不会沿用上一张。只有使用 **复用上次标定** 才会把上一张的标定复制到当前图。裁剪或「使用全图」**不会**清除 µm/px 与端点（全图文件像素坐标）。勿用打印 DPI 作为空间标定。

---

## 7. Geom / 几何

- **Rotate / Flip** apply immediately on the artboard (geometry, not pixel resample). Angle resets after each live rotate.
- **Marquee mode (0.9.2+):** Geom → **Crop / Inset**. Only one preview marquee is active. Switching clears the other selection. Leaving the Geom tab also exits inset mode and **clears the inset L/T/W/H**.
- **Crop** L/T/W/H are **file pixels**. Ratios: free, 1:1, 4:3, 3:4, 16:9, 3:2, custom W:H, or fixed pixels. In Crop mode, draw on the preview (handles resize; drag inside moves; outside draws a new box). W/H = 0 means full image (**Use full image**).
- **Original file px** (`source-px`) is an additive mode that locks crop W×H to the linked file's unscaled pixel dimensions. If host metadata is unavailable, PaperFig probes the linked PNG/JPEG/TIFF/GIF/BMP file on disk; Free, ratio, and Fixed px modes are unchanged.
- On Apply with a crop, the placed item is written upright. Its aspect ratio equals the cropped pixel size. After Apply the panel returns to Crop mode and clears the inset rectangle.
- **Inset:** switch to **Inset** (or **Draw region**), then drag a region, type L/T/W/H, or **Read artboard rectangle** with the image and a rectangle both selected. Inset ratios: free, 1:1, 4:3, 16:9. The PNG is a 1:1 crop of the linked file, so µm/px matches calibration. Place left/right: inset height matches the main image and width follows the crop aspect. Place above/below: **Zoom** multiplies the region size. **Apply** (not a separate create button) places the crop, a vector frame, and non-crossing leaders if **Draw leaders** is on. Stroke weight, color, and dash (solid / dashed / dotted / dash-dot) are separate for the frame and the leaders. Corners: miter, round, or bevel; round with radius > 0 uses a rounded rectangle when the box is axis-aligned. A saved calibration adds a vector scale bar on the inset (**Add scale bar when calibrated**).

### 中文

旋转/翻转立即改画板几何。**预览框选工具**先选 **裁剪** 或 **放大框**（同时只能一种；互相切换会清掉另一种选区）。离开 **几何** 页也会退出放大框，并清掉插图的 L/T/W/H。裁剪 L/T/W/H 为文件像素；比例还有 3:4、3:2、自定义 W:H 和固定像素。W/H 为 0 或点 **使用全图** 表示不裁剪。带裁剪的 **应用** 按直立方向写入并重新链接，宽高比等于裁剪像素；完成后回到裁剪模式，并清掉插图区域。

**放大插图：** 切到 **放大框**（或点 **框选区域**），再拖选区域（或填写 L/T/W/H，或把图像与矩形一起选中后点 **读取画板矩形**）。插图比例只有：自由、1:1、4:3、16:9。放大倍数只改变画板上的尺寸，PNG 是链接文件的 1:1 裁切，µm/px 与标定一致。左右放置时高度与主图对齐；上下放置时 **放大** 乘以区域尺寸。点顶部 **应用**（没有单独的「生成插图」按钮）放置子图、原图矢量框，以及在勾选 **绘制引线** 时的互不交叉引线。框线与引线可分别设线宽、颜色、线型（实线/虚线/点线/点划线）；拐角可选尖角、圆角、斜角（圆角且半径 > 0、且框轴对齐时用圆角矩形）。勾选 **已标定则添加标尺** 且已保存标定时，插图上会加矢量标尺。

---

## 8. Export & Fiji / 导出与 Fiji

- **Batch:** multi-select in Illustrator → **1 · Review selection** → **2 · Apply checked** (one recipe; no crop or rotation; embedded images are skipped). **Stop** cancels the commit.
- **Format:** PNG, JPEG, or uncompressed RGBA8 TIFF. DPI is print metadata, not spatial calibration.
- **Fiji setup** (for formats the native reader cannot open):
  - Set the path to the Fiji/ImageJ **executable** *or* the **app folder** (e.g. `Fiji.app` on macOS, or a folder that contains `ImageJ-win64.exe` / nested `Fiji.app`).
  - **Detect** / **Test Connection**. Install Bio-Formats in Fiji when needed.
  - Fiji is not required for ordinary RGB JPG/PNG or many simple TIFFs.

### 中文

批量：在 Illustrator 里多选，点 **1 · 审查选区**，再点 **2 · 应用勾选**。同一组参数，不裁剪、不旋转；嵌入图跳过。**停止** 可取消正在提交的这一批。格式为 PNG、JPEG 或未压缩 RGBA8 TIFF。DPI 只写入打印元数据。Fiji：在 **导出** 页填写可执行文件或应用目录（例如 macOS 的 `Fiji.app`，或含 `ImageJ-win64.exe` 的文件夹），然后点 **检测** 或 **测试连接**。需要 Bio-Formats 时在 Fiji 里安装。普通 RGB JPG/PNG 不必配置 Fiji。

---

## 9. Notes / 说明

- Panel edits use **source orientation**; the artboard preview keeps Illustrator rotation/flip.
- Embedded art: Apply writes a display PNG and converts to a link — original microscopy data is not recovered.
- Zoom enlarges the bitmap in the preview stage (not only the % label). Use it before picking scale endpoints.
- See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the module map and design notes.

### 中文

嵌入图经 Apply 后变为链接的展示 PNG，无法还原原始显微数据。精确拾取标尺端点前请先放大预览。设计说明见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。
