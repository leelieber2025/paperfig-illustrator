# Changelog / 变更记录

## 1.2.6

- The Adjust page puts fluorescence and photo controls above presets. macOS shows a scrollbar on long panes. Selection checks run only while the PaperFig panel is open and in front, so the artboard does not flash when another panel is active.
- 调整页把荧光和普通照片控件放在预设上面。macOS 上长页面显示滚动条。只有 PaperFig 面板打开并在前台时才检查选中的图，其它面板在前时画板不再闪。

## 1.2.5

- The Scale page keeps the loaded preset name at the top until you recalibrate or load another preset. Scale bars use the original µm/px and the current file’s pixel width. Apply on the Scale page creates or updates the scale bar. Apply on the Label page creates or updates the figure label.
- 标尺页顶部会一直显示已加载的预设名，直到重新标定或加载另一个预设。标尺用原标定的 µm/px 和当前文件的像素宽度。标尺页的「应用」创建或更新标尺。标签页的「应用」创建或更新图版标签。

## 1.2.4

- Labels list each installed font face. The default font is Arial, including scale-bar text. A missing bold or italic face uses faux bold or faux italic instead of failing. Empty dropdown choices keep an empty value.
- 标签列出每个已安装的字体。默认字体是 Arial，标尺文字也是。没有粗体或斜体时使用仿粗体或仿斜体，不再报错。下拉框的空选项会保持空值。

## 1.2.3

- Long tabs show a real scrollbar in Illustrator on macOS. The wheel scrolls the tab, batch list, and dropdown under the pointer. Dropdowns stay inside the panel.
- macOS 上的 Illustrator 里，长标签页显示固定滚动条。滚轮滚动指针下的标签页、批量列表和下拉菜单。下拉菜单保持在面板内。

## 1.2.2

- Adjust has two subpages. Fluorescence is the default: per-channel Low/High plus an overall Low/High after the composite. Photo has brightness, contrast, black/white points, color balance, grayscale, invert, blur, and sharpen.
- 调整页分为两个子页。默认是荧光照片：各通道低/高，另有一组作用在合成之后的整体低/高。普通照片有亮度、对比、黑白点、色彩平衡、灰度、反相、模糊和锐化。

## 1.2.1

- Inset source frames default to red. The color picker shows saved colors correctly. Update inset regenerates the current region.
- Panel labels can include up to three colored staining labels, each with its own font, style, size, and position.
- Reset clears only the active Adjust, Crop, or Inset page. Scale reads the original pixel size and gives bar length its own unit. Opening Inset copies the current Scale bar style, including margin and text.
- 插图原图框线默认红色。颜色选择器正确显示已存颜色。更新插图按当前区域重新生成。
- 图版标签可加最多三段彩色染色说明，各自有字体、字形、字号和位置。
- 重置只清除当前调整、裁剪或插图页。标尺自动读取原图像素尺寸，长度有独立单位。打开插图页会同步当前标尺样式，包括边距和文字开关。

## 1.2.0

- Scale bars are grouped with their image and move with a whole-group transform.
- Panel labels: saved styles, installed fonts, black or white presets, and signed horizontal and vertical offsets.
- 标尺与图片编组，整体变换时一起移动。
- 图版标签支持已存样式、已安装字体、黑白颜色预设，以及可输入负值的左右和上下偏移。

## 1.1.0

- Crop and Inset are separate tabs. Raw and Export stay hidden until Settings → Advanced features. Fiji is requested only when a file needs it. The panel opens on Scale.
- 裁剪和放大插图分成独立页。原始和导出默认隐藏，在设置里打开。只有文件需要 Fiji 时才提示配置。面板默认进入标尺。

## 1.0.0

First public release of PaperFig for Illustrator under GPL-3.0.

PaperFig for Illustrator 首次公开发布，采用 GPL-3.0 许可。
