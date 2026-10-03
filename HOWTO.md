# How to use PaperFig / 使用说明

**Version 1.1.0** · Adobe Illustrator CEP panel · License **[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)**

English, then the matching Chinese.

## 1. Install / 安装

The installer is in the folder that contains `CSXS/manifest.xml`.

安装脚本就在含 `CSXS/manifest.xml` 的目录里。

| OS / 系统 | Double-click / 双击 | Or run / 或执行 |
|-----------|---------------------|-----------------|
| Windows | `install.bat` | `powershell -ExecutionPolicy Bypass -File install.ps1` |
| macOS | `install.command` | `bash install.sh` |

Manual copy and `PlayerDebugMode`: [`INSTALL.md`](INSTALL.md).

手动复制和 `PlayerDebugMode` 见 [`INSTALL.md`](INSTALL.md)。

## 2. Open the panel / 打开面板

Quit and reopen Illustrator. **Window → Extensions** or **Extensions (Legacy) → PaperFig for Illustrator**. The footer reads **1.0.0**. Select a linked bitmap. The preview shows that image.

退出并重新打开 Illustrator。**窗口 → 扩展** 或 **扩展（旧版）→ PaperFig for Illustrator**。页脚为 **1.1.0**。选中链接的位图后，预览显示该图。

The panel opens on **Scale**. Raw and Export are hidden by default. Show either under **Settings → Advanced features**. PaperFig asks for the Fiji path only when a file needs it; you can also set it under **Settings → Fiji setup**.

面板默认进入 **标尺**。**原始** 和 **导出** 默认隐藏，可在 **设置 → 高级功能** 打开。只有文件需要 Fiji 时才会提示设置路径，也可在 **设置 → Fiji 设置** 中填写。

## 3. Tabs / 各页

The top stays put: preview, **Apply / Refresh / Reset**, **Artboard preview / Cancel preview / Hold = original**, and the notice.

顶部固定：预览、**应用 / 刷新 / 重置**、**画板预览 / 取消预览 / 按住=原图**，以及状态提示。

| Tab / 页 | Role / 作用 |
|----------|-------------|
| **Adjust / 调整** | RGB8 tone, color, filters, fluorescence keep-channel, presets. RGB8 色调、颜色、滤镜、荧光保留通道、预设。 |
| **Scale / 标尺** | Calibration and vector scale bar. 标定与矢量标尺。 |
| **Geom / 几何** | Rotate, flip, straighten. 旋转、翻转、拉平。 |
| **Crop / 裁剪** | Crop in file pixels. 按文件像素裁剪。 |
| **Inset / 放大插图** | Enlarged inset and source frame. 放大插图与原图框线。 |
| **Raw / 原始** | uint8/uint16 planes, histograms, group range lock. uint8/uint16、直方图、组范围锁定。 |
| **Export / 导出** | Optional batch and file format controls. 可选批量与格式设置。 |
| **⚙ Settings / 设置** | Fixed button at the right of the tab bar; advanced tabs and Fiji path. 标签栏右侧固定按钮；高级页开关和 Fiji 路径。 |

Sliders update the preview only. **Apply** writes a full-resolution 8-bit display file and relinks. Undo with Ctrl/Cmd+Z. Raw files on disk are not modified.

滑块只改预览。**应用** 写出全分辨率 8 位展示图并重新链接。撤销用 Ctrl/Cmd+Z。不修改磁盘上的原始文件。

## 4. Adjust / 调整

Set brightness, contrast, and black/white points, or use **Pick black**, **Pick white**, or **Auto levels**. Optional: color balance, grayscale, invert, blur, sharpen.

设置亮度、对比和黑白点，或使用取黑点、取白点、自动色阶。可选色彩平衡、灰度、反相、模糊、锐化。

Fluorescence is on this tab. Turn on recoloring, then **Keep** the planes you want (all, pairs, or one). Hidden planes are zero on preview and on Apply. Color swatches match Fiji / ImageJ Merge Channels. The RGB picker is still there.

荧光控件在本页。勾选 **启用换色**，再用 **保留** 留下要显示的平面。隐藏的平面在预览和应用时为零。色块与 Fiji / ImageJ 合并通道一致，仍可自选 RGB。

Presets store intensity and RGB colors. They do not store crop, rotation, or paths. **Apply** writes the display file.

预设保存强度和 RGB 颜色，不含裁剪、旋转或路径。**应用** 写出展示图。

## 5. Raw / 原始

Set **Raw source** and click **Load channels**. Use an uncompressed OME-TIFF when you can. Otherwise set Fiji on the Settings tab and use Bio-Formats.

设置原始文件并点 **加载通道**。能用未压缩 OME-TIFF 就用它。否则在设置页配置 Fiji，通过 Bio-Formats 读取。

Choose series, Z, and T (starting at 0). Keep one or two channels if you need to. Set low, high, color, and gamma. **Lock group ranges** uses one range for the batch and does not autoscale each image.

选择 Series、Z、T（从 0 起）。需要时只保留一到两个通道。设定下限、上限、颜色和 gamma。**锁定组范围** 整批共用一个范围，不按单张自动拉伸。

**Apply** writes an 8-bit display file. The raw file stays as it is.

**应用** 只写 8 位展示图，原始文件保持原样。

## 6. Scale / 标尺

Methods / 方式:

- **Raw metadata · µm/px** / **原始元数据 · µm/px**
- **Known full-source field width** / **已知全图视场宽** — the full image, not the crop width. 填的是全图视场，不是裁剪宽。
- **Two points on a known-length line (any direction)** / **已知长度线段的两端（任意方向）**

Pick / 拾取:

1. Choose the two-point method and enter the length and unit. 选择两点方式，填写长度和单位。
2. Click **Pick reference endpoints**. 点 **拾取参考端点**。
3. Zoom with the wheel, pinch, or − / +. **Fit** resets. Space-drag or middle-drag pans. A new selection returns to Fit. 用滚轮、捏合或 − / + 放大。**适合** 复位。空格拖或中键拖可平移。换选区后回到适合大小。
4. Click the two endpoints. Coordinates are full-source file pixels. 在预览上点两端。坐标是全图文件像素。
5. **Save calibration**, then set the bar and click **Create / update vector bar**. **保存标定**，再设置标尺并点 **创建/更新矢量标尺**。

Each image keeps its own calibration. Selecting an uncalibrated image clears the fields and does not reuse the previous µm/px. **Reuse last** copies the last saved calibration onto the current image. **Clear** removes only this image’s calibration.

每张图单独保存标定。选中未标定的图会清空字段，不会沿用上一张的 µm/px。**复用上次标定** 才把上次保存的标定抄到当前图。**清除** 只删这张图的标定。

**Save** writes a JSON preset through the system dialog, starting in `~/paperfig/scales` (Windows: `%USERPROFILE%\paperfig\scales`). **Load** opens that folder and applies the calibration and bar style. **Compare selection** checks µm/px across the linked images you selected.

**保存** 用系统对话框把 JSON 预设写到 `~/paperfig/scales`（Windows 为 `%USERPROFILE%\paperfig\scales`）。**加载** 从同一文件夹读入标定和标尺样式。**核对选中图** 比较当前选中链接图的 µm/px。

Crop, resize, and **Use full image** do not clear calibration. The bar uses display width times µm/px. It does not follow if you scale the placed image later. Create the bar again after that. Do not use print DPI as spatial calibration.

裁剪、改大小和 **使用全图** 不会清除标定。标尺按显示宽度乘以 µm/px 计算。之后若单独缩放图片，标尺不会跟着变，需要重新创建。不要把打印 DPI 当作空间标定。

## 7. Geom, Crop, Inset / 几何、裁剪、放大插图

**Rotate**, **Flip**, and **Straighten** change the artboard object immediately. They do not resample pixels. The angle field resets after a live rotate. **Straighten**: drag a line that should be horizontal; release rotates to that line. Esc cancels.

**旋转**、**翻转** 和 **拉平水平** 立即改画板对象，不重采样像素。实时旋转后角度归零。**拉平水平**：在预览上拖一条应成为水平的线，松开后按该线旋转。Esc 取消。

**Crop** and **Inset** cannot both be active. Switching clears the other. Leaving Inset exits inset mode and clears the inset left, top, width, and height.

**裁剪** 和 **放大框** 不能同时使用。切换会清掉另一种选区。离开放大插图页会退出放大框，并清掉插图的左、上、宽、高。

Crop left/top/width/height are file pixels. Width and height of 0, or **Use full image**, means no crop. **Original file px** locks width and height to the linked file’s pixel size. If Illustrator does not report that size, PaperFig reads PNG, JPEG, TIFF, GIF, or BMP on disk.

裁剪的左/上/宽/高是文件像素。宽和高为 0，或点 **使用全图**，表示不裁剪。**源文件像素** 把宽高锁到链接文件的像素尺寸。若 Illustrator 没有给出尺寸，PaperFig 会读磁盘上的 PNG、JPEG、TIFF、GIF 或 BMP。

**Apply** with a crop writes an upright image. Its aspect ratio is the cropped pixel size. The panel then returns to crop mode and clears the inset rectangle.

带裁剪的 **应用** 按直立方向写入。宽高比等于裁剪后的像素。完成后回到裁剪模式，并清掉插图区域。

**Inset:** open the **Inset** tab and choose **Draw region**. Drag a box, type left/top/width/height, or select the image and a rectangle and click **Read artboard rectangle**. Ratios are free, 1:1, 4:3, and 16:9. The PNG is a 1:1 crop of the linked file. Left/right: the inset height matches the main image. Above/below: **Zoom** multiplies the region. **Apply** places the crop, a frame on the source, and leaders when **Draw leaders** is on. Frame and leaders have their own weight, color, and dash (solid, dashed, dotted, dash-dot). Corners are miter, round, or bevel. Round with a radius above 0 uses a rounded rectangle when the box is axis-aligned. **Add scale bar when calibrated** adds a vector bar on the inset when a calibration exists.

**放大插图：** 打开 **放大插图** 页，点 **框选区域**。拖选、填写左/上/宽/高，或同时选中图像和矩形后点 **读取画板矩形**。比例为自由、1:1、4:3、16:9。PNG 是链接文件的 1:1 裁切。放在左右时，高度与主图一致。放在上下时，**放大** 乘以区域尺寸。点顶部 **应用** 放置子图和原图框；勾选 **绘制引线** 时加上互不交叉的引线。框和引线各自有线宽、颜色和线型（实线、虚线、点线、点划线）。拐角为尖角、圆角或斜角。圆角且半径大于 0、框又与轴对齐时，用圆角矩形。已有标定且勾选 **已标定则添加标尺** 时，插图上会加矢量标尺。

## 8. Export / 导出

Select several images. Click **1 · Review selection**, then **2 · Apply checked**. One recipe, no crop, no rotation. Embedded images are skipped. **Stop** cancels the batch that is running.

多选图像。点 **1 · 审查选区**，再点 **2 · 应用勾选**。同一组参数，不裁剪、不旋转。嵌入图跳过。**停止** 取消正在提交的这一批。

Formats: PNG, JPEG, or uncompressed RGBA8 TIFF. DPI is print metadata, not spatial calibration.

格式为 PNG、JPEG 或未压缩 RGBA8 TIFF。DPI 只写入打印元数据，不是空间标定。

**Fiji setup (Settings tab):** path to the executable or the app folder, then **Detect** or **Test connection**. Install Bio-Formats in Fiji when a file needs it. Ordinary RGB JPG/PNG and many simple TIFFs do not need Fiji.

**Fiji 设置（设置页）：** 填写可执行文件或应用目录，然后点 **检测** 或 **测试连接**。需要时在 Fiji 里安装 Bio-Formats。普通 RGB JPG/PNG 和许多简单 TIFF 不必配置 Fiji。

## 9. Notes / 说明

The panel edits source orientation. The artboard preview keeps Illustrator’s rotation and flip. After Apply, an embedded image becomes a linked display PNG. That step does not recover the original microscopy file. Zoom the preview before picking scale endpoints.

面板按源方向编辑。画板预览保留 Illustrator 的旋转和翻转。嵌入图经应用后变成链接的展示 PNG，这一步不能还原原始显微文件。拾取标尺端点前先放大预览。

Module notes: [`ARCHITECTURE.md`](ARCHITECTURE.md).

模块说明见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。
