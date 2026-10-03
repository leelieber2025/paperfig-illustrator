# PaperFig for Illustrator

**Version 1.0.0** · Adobe Illustrator CEP panel for scientific figure bitmaps.

PaperFig edits placed bitmaps in the panel and writes **8-bit display files** for layout. It does not modify scientific or raw files on disk. It handles tone and channel mapping, uint8/uint16 multi-channel preview, spatial calibration, and vector scale bars.

Copyright © 2026 Zhao Li. Licensed under **[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)** — see [`LICENSE`](LICENSE).

> Written for Illustrator CEP. Some workflow ideas overlap with discussions around *illustrator_sci_toolbox*. This repository does not include or redistribute that project's source.

---

## English

### What it does

| Area | Behavior |
|------|----------|
| **RGB8** | Brightness/contrast/global tone; **per-channel Low/High** + keep-channel (fluorescence R/G/B); remap; blur/sharpen; recipes + sidecars |
| **Raw** | uint8/uint16 planes via native TIFF/OME or Fiji + Bio-Formats; histograms; per-channel range and gamma; keep-channel by OME names |
| **Geometry** | Crop in file pixels, including on rotated artboards. Apply writes an upright placement and relinks. Rotate and flip change the artboard object immediately. **Inset (since 0.8.9):** draw a region (free, 1:1, 4:3, or 16:9). Place an unresampled crop. Left or right placement matches the main image height. Add a styled vector frame and optional leaders that do not cross. If µm/px is saved, the inset scale bar uses that value. |
| **Scale** | Per-image spatial calibration; vector scale bar from µm/px |
| **Preview** | Zoom and pan for precise scale-bar endpoint picks (wheel/pinch, −/+, Space or middle-drag pan) |
| **Batch** | Multi-selection apply; commit can be cancelled |

**Original file px** (`source-px`) is an additive crop mode that locks W×H to the linked file's pixels. If Illustrator metadata does not expose the size, PaperFig probes the linked PNG/JPEG/TIFF/GIF/BMP file on disk; existing crop modes are unchanged.

**0.10.1**: Scale **Save** and **Load** use the system file dialogs and share the same default folder, `~/paperfig/scales` (Windows: `%USERPROFILE%\paperfig\scales`). Save writes a named JSON preset containing calibration and bar style; Load opens that folder and applies a selected preset. **Compare selection** checks µm/px across the current selection.

Calibration is stored per PlacedItem. Crop does not clear µm/px. **Reuse last** is the only explicit cross-image copy.

Each **RGB Apply** writes a processing record `<output>.json` (source file, source stamp, recipe, crop, calibration, and a `parent` link when the input was itself a PaperFig output). Only the status field is updated after the file is linked. The panel's "this output is now the baseline" state is a separate `<output>.baseline.json`; deleting that marker never deletes the processing record. **Raw Apply** writes `<output>.json` with schema `sci-raw-display` and does **not** write `.baseline.json` or `parent`. The raw file on disk is not modified.

CEP IDs: `com.zhaoli.paperfig` / `com.zhaoli.paperfig.panel`  
Install folder: `%APPDATA%\Adobe\CEP\extensions\paperfig` (Windows) · `~/Library/Application Support/Adobe/CEP/extensions/paperfig` (macOS)

### Install

Double-click `install.bat` (Windows) or `install.command` (macOS) in the extension folder (the folder that contains `CSXS/manifest.xml`). Thin wrappers under [`install/`](install/) call the root installers.

Manual steps:

1. Download [`dist/paperfig-1.0.0.zip`](dist/paperfig-1.0.0.zip) or the `paperfig-1.0.0.zip` asset on the GitHub Release (preferred). GitHub **Code → Download ZIP** / release source zipball also works without renaming the extracted folder.
2. Unzip — release zip has top-level **`paperfig/`**; source ZIP is often **`paperfig-illustrator-…/`**. Either way, double-click `install.bat` / `install.command` beside `CSXS/manifest.xml` (no rename).
3. Or copy the `paperfig` folder to the CEP path above.
4. Enable unsigned extensions for your CEP/CSXS version (installers set CSXS.9–15; see [`INSTALL.md`](INSTALL.md)).
5. Restart Illustrator → **Window → Extensions** or **Extensions (Legacy)** → **PaperFig for Illustrator**. Confirm footer **1.0.0**.

On first open, if Fiji is not configured, the panel shows a **Configure Fiji** screen (path, Detect, Test). Ordinary RGB JPG/PNG can use **Skip for RGB-only**; change the path later under **Export → Fiji setup**.

### Documentation

| File | Contents |
|------|----------|
| [`HOWTO.md`](HOWTO.md) | Usage (EN + 中文): tabs, zoom/pan, calibration |
| [`INSTALL.md`](INSTALL.md) | Install and PlayerDebugMode (EN + 中文) |
| [`CHANGELOG.md`](CHANGELOG.md) | Release notes |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Module map and design notes |
| [`LICENSE`](LICENSE) | [GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html) |

### Development

```bash
# Regression tests (Node; Adobe host not required)
node tests/regression.js
# or: npm test
```

回归测试在 Node 里跑，不需要本机安装 Illustrator。真正操作 Illustrator 的用例需要本机有 Illustrator；经 Bio-Formats 读原始文件的用例还需要 Fiji。

Tests that drive Illustrator need Illustrator on this machine. Cases that read raw files through Bio-Formats also need Fiji.

Host and JS APIs still use the `sciBitmap*` prefix. The names stayed when the panel was renamed from SCI Bitmap.

---

## 中文

### 用途

PaperFig 在面板里调节画板上已置入的位图，并写出 **8 位展示图** 供排版。它不改磁盘上的原始文件和科学数据文件。功能包括色调与通道映射、uint8/uint16 多通道预览、空间标定和矢量标尺。

| 模块 | 说明 |
|------|------|
| **RGB8** | 亮度、对比、全局色阶；荧光 **分通道 Low/High** + 保留通道；换色；模糊/锐化；预设与配方 sidecar |
| **原始 Raw** | 原生 TIFF/OME 或 Fiji + Bio-Formats 读入 uint8/uint16；直方图；逐通道范围与 gamma |
| **几何** | 按文件像素裁剪，包括旋转画板。Apply 按直立方向写入像素并重新链接。旋转和翻转直接改画板对象。**放大插图（自 0.8.9）：** 框选区域（自由 / 1:1 / 4:3 / 16:9）。放置未重采样的裁切图；左右放置时高度与主图对齐。另加矢量框，以及可选、互不交叉的引线。已保存 µm/px 时，插图标尺使用该值。 |
| **标尺 Scale** | 按图空间标定；由 µm/px 生成矢量标尺 |
| **预览** | 缩放与平移，用于精确拾取标尺端点 |
| **批量** | 多选应用；提交过程可取消 |

标定按 PlacedItem 持久化；裁剪不清除 µm/px。跨图复制只能通过 **复用上次**。

每次 **RGB Apply** 都会写出处理记录 `<输出>.json`（原始文件、时间戳、配方、裁剪、标定；若输入本身是 PaperFig 输出，还会有 `parent` 链接）。链接成功后只会更新记录里的状态字段。「该输出已成为新基线」单独写在 `<输出>.baseline.json`，删掉这个标记不会删掉处理记录。**原始 Raw 的 Apply** 会写 schema 为 `sci-raw-display` 的 `<输出>.json`，**不会**写 `.baseline.json`，也**不会**写 `parent`。磁盘上的原始文件不会被修改。

### 安装

在含 `CSXS/manifest.xml` 的扩展目录中双击 `install.bat`（Windows）或 `install.command`（macOS）。[`install/`](install/) 下为调用根目录安装脚本的薄封装。

也可以解压 [`dist/paperfig-1.0.0.zip`](dist/paperfig-1.0.0.zip)（GitHub Release 上有同名附件；zip 内已是 `paperfig/` 目录，无需改名）到 CEP `extensions/paperfig`，或在解压出的 `paperfig` 目录中双击安装脚本。按 [`INSTALL.md`](INSTALL.md) 打开未签名扩展。重启 Illustrator，打开 **窗口 → 扩展** 或 **扩展（旧版）→ PaperFig for Illustrator**。页脚应为 **1.0.0**。

首次打开且未配置 Fiji 时，面板会先显示 **配置 Fiji**。只处理普通 RGB JPG/PNG 时，点 **稍后（仅 RGB）**。之后可在 **导出 → Fiji 设置** 修改路径。

使用说明见 [`HOWTO.md`](HOWTO.md)。

---

## License

**[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html)**. SPDX: `GPL-3.0`.

Copyright © 2026 Zhao Li.

See [`LICENSE`](LICENSE) for the full terms.
