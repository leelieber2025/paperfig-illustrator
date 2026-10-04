# PaperFig for Illustrator

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23073417.svg)](https://doi.org/10.5281/zenodo.23073417) [![License: GPL-3.0](https://img.shields.io/github/license/leelieber2025/paperfig-illustrator?style=plastic)](https://github.com/leelieber2025/paperfig-illustrator/blob/main/LICENSE) [![Release](https://img.shields.io/github/v/release/leelieber2025/paperfig-illustrator?style=plastic)](https://github.com/leelieber2025/paperfig-illustrator/releases/latest) [![Issues](https://img.shields.io/github/issues/leelieber2025/paperfig-illustrator?style=plastic)](https://github.com/leelieber2025/paperfig-illustrator/issues) [![Stars](https://img.shields.io/github/stars/leelieber2025/paperfig-illustrator?style=plastic)](https://github.com/leelieber2025/paperfig-illustrator/stargazers) [![Downloads](https://img.shields.io/github/downloads/leelieber2025/paperfig-illustrator/total?style=plastic)](https://github.com/leelieber2025/paperfig-illustrator/releases)

Adobe Illustrator CEP panel for scientific figure bitmaps.

PaperFig adjusts a placed bitmap in the panel and writes an **8-bit display file** for layout. It does not change the scientific or raw file on disk. It covers tone and channel mapping, uint8/uint16 preview, spatial calibration, and vector scale bars.

Copyright © 2026 Zhao Li. Licensed under **[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)** — see [`LICENSE`](LICENSE).

<table>
<tr>
<td width="50%" valign="top">

**Scale and crop demo / 标定与裁切演示** (1 min)

</td>
<td width="50%" valign="top">

**Brightness and channels demo / 亮度与通道演示** (35 sec)

</td>
</tr>
<tr>
<td width="50%" valign="top">

[![Scale and crop demo, click to watch](https://img.youtube.com/vi/wRnx4TTDYiI/mqdefault.jpg)](https://youtu.be/wRnx4TTDYiI)

[▶ Watch / 观看](https://youtu.be/wRnx4TTDYiI)

Calibrate, rotate, and crop, add a vector scale bar, make an inset, then add labels. 标定、旋转并裁切、加矢量标尺、做放大插图，再加标签。

</td>
<td width="50%" valign="top">

[![Brightness and channels demo, click to watch](https://img.youtube.com/vi/jVFhHXaDabA/mqdefault.jpg)](https://youtu.be/jVFhHXaDabA)

[▶ Watch / 观看](https://youtu.be/jVFhHXaDabA)

Raise brightness and contrast, emphasize one channel, then switch to a colorblind-friendly palette. Channel colors can be changed freely. 增加亮度和对比度，单独加强一个通道，再换成色盲友好配色。通道颜色可以随意改。

</td>
</tr>
</table>

---

## English

| Tab | What it does |
|-----|----------------|
| **Adjust** | Brightness, contrast, tone, color balance, grayscale, invert, blur, sharpen. Fluorescence recoloring and keep-channel. Presets. |
| **Scale** | Per-image calibration and a vector scale bar from µm/px. |
| **Geom** | Rotate, flip, and straighten on the artboard. |
| **Crop** | Crop in file pixels. |
| **Inset** | Make an enlarged inset (free, 1:1, 4:3, 16:9). |
| **Label** | Editable A/B/C panel labels and up to three colored staining labels, with saved font and placement styles. |
| **Raw** | uint8/uint16 planes from TIFF/OME, or from Fiji + Bio-Formats. Histograms, per-channel range and gamma. |
| **Export** | Optional batch apply and PNG/JPEG/TIFF format options. |
| **⚙ Settings** | Fixed at the right of the tab bar; show advanced tabs and configure Fiji when needed. |

Sliders change the panel preview. **Apply** writes the display file and relinks the artboard. Undo with Illustrator Ctrl/Cmd+Z.

Crop ratios: free, 1:1, 4:3, 3:4, 16:9, 3:2, custom W:H, fixed pixels, or **Original file px**. Inset ratios: free, 1:1, 4:3, 16:9. Left or right placement matches the main image height. Above or below, the inset width matches the main image width; its height follows the crop aspect ratio. The inset PNG is an unresampled crop, so µm/px stays the calibration value.

Calibration is stored per image. Crop does not clear it. **Reuse last** is the only copy from one image to another. **Save** and **Load** use `~/paperfig/scales` (`%USERPROFILE%\paperfig\scales` on Windows).

Each RGB Apply writes `<output>.json`. A separate `<output>.baseline.json` marks that file as the new baseline. Raw Apply writes `<output>.json` with schema `sci-raw-display` and does not write a baseline file. The raw file is not modified.

CEP IDs: `com.zhaoli.paperfig` / `com.zhaoli.paperfig.panel`  
Install folder: `%APPDATA%\Adobe\CEP\extensions\paperfig` (Windows) · `~/Library/Application Support/Adobe/CEP/extensions/paperfig` (macOS)

### Install

Download the ZIP from the [releases page](https://github.com/leelieber2025/paperfig-illustrator/releases). The zip’s top folder is `paperfig/`. Local builds are written to `dist/`. Double-click `install.bat` (Windows) or `install.command` (macOS) next to `CSXS/manifest.xml`. See [`INSTALL.md`](INSTALL.md).

Restart Illustrator. **Window → Extensions** or **Extensions (Legacy) → PaperFig for Illustrator**. The footer shows the installed package version.

The panel opens on **Scale**. Raw and Export are hidden by default; enable either under **Settings → Advanced features**. Fiji is optional: PaperFig asks for its path only when a file needs it, and the path can also be set under **Settings → Fiji setup**.

Usage: [`HOWTO.md`](HOWTO.md). Module notes: [`ARCHITECTURE.md`](ARCHITECTURE.md).

```bash
npm test
```

Tests run in Node. Cases that drive Illustrator need Illustrator. Cases that read raw files through Bio-Formats also need Fiji.

Host and JS entry points still use the `sciBitmap*` prefix.

---

## 中文

PaperFig 在面板里调节已置入的位图，并写出 **8 位展示图** 用于排版。不修改磁盘上的科学数据或原始文件。包括色调与通道、uint8/uint16 预览、空间标定和矢量标尺。

| 页 | 作用 |
|----|------|
| **调整** | 亮度、对比、色调、色彩平衡、灰度、反相、模糊、锐化。荧光换色与保留通道。预设。 |
| **标尺** | 按图标定，并由 µm/px 生成矢量标尺。 |
| **几何** | 在画板上旋转、翻转、拉平。 |
| **裁剪** | 按文件像素裁剪。 |
| **放大插图** | 放大插图（自由、1:1、4:3、16:9）。 |
| **标签** | 生成可编辑的 A/B/C 图版标签和最多三段彩色染色说明，并保存字体与位置样式。 |
| **原始** | 从 TIFF/OME 或 Fiji + Bio-Formats 读 uint8/uint16。直方图、逐通道范围与 gamma。 |
| **导出** | 可选的批量应用与 PNG/JPEG/TIFF 格式设置。 |
| **设置** | 显示高级页，需要时配置 Fiji。 |

滑块只改面板预览。**应用** 才写出展示图并重新链接。撤销用 Illustrator 的 Ctrl/Cmd+Z。

裁剪比例：自由、1:1、4:3、3:4、16:9、3:2、自定义 W:H、固定像素、**源文件像素**。插图比例：自由、1:1、4:3、16:9。放在左右时，高度与主图一致。放在上下时，插图宽度与原图一致，高度由裁切区域的宽高比决定。插图 PNG 不重采样，µm/px 与标定相同。

标定按图保存。裁剪不会清掉标定。只有 **复用上次标定** 会把一张图的标定抄到另一张。**保存** 和 **加载** 使用 `~/paperfig/scales`（Windows 为 `%USERPROFILE%\paperfig\scales`）。

每次 RGB **应用** 写 `<输出>.json`。`<输出>.baseline.json` 单独标记该文件已成为新基线。原始 **应用** 写 schema 为 `sci-raw-display` 的 `<输出>.json`，不写 baseline 文件，也不改原始文件。

安装：从 [发布页](https://github.com/leelieber2025/paperfig-illustrator/releases) 下载 ZIP。压缩包顶层是 `paperfig/`。在含 `CSXS/manifest.xml` 的目录双击 `install.bat`（Windows）或 `install.command`（macOS）。详见 [`INSTALL.md`](INSTALL.md)。

重启 Illustrator。**窗口 → 扩展** 或 **扩展（旧版）→ PaperFig for Illustrator**。页脚显示已安装包的版本。

面板默认进入 **标尺**。**原始** 和 **导出** 默认隐藏，可在 **设置 → 高级功能** 打开。Fiji 可选，需要时在 **设置 → Fiji 设置** 配置。

用法见 [`HOWTO.md`](HOWTO.md)。

---

## Citation / 引用

Cite every version with [10.5281/zenodo.23073417](https://doi.org/10.5281/zenodo.23073417). That DOI always opens the latest release. The latest record is [10.5281/zenodo.23137291](https://doi.org/10.5281/zenodo.23137291).

Zhao Li 李钊. (2026). *leelieber2025/paperfig-illustrator: PaperFig* [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.23137291

引用全部版本用 [10.5281/zenodo.23073417](https://doi.org/10.5281/zenodo.23073417)，它始终指向最新版。最新记录是[10.5281/zenodo.23137291](https://doi.org/10.5281/zenodo.23137291)。

```bibtex
@software{zhao_li_2026_23137291,
  author    = {Zhao Li 李钊},
  title     = {leelieber2025/paperfig-illustrator: PaperFig},
  month     = oct,
  year      = 2026,
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.23137291},
  url       = {https://doi.org/10.5281/zenodo.23137291}
}
```

## License / 许可

**[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html)**. SPDX: `GPL-3.0`.

Copyright © 2026 Zhao Li. 全文见 [`LICENSE`](LICENSE)。
