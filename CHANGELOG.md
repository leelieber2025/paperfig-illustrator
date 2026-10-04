# Changelog / 变更记录

## Current / 当前

- Inset source frames default to red. The color picker now displays saved colors correctly, and Update inset regenerates the current region.
- Scale bars are grouped with their image and move with a whole-group transform.
- Panel labels: saved styles, installed fonts, signed offsets, and up to three colored staining labels with a separate font, style, size, and position.
- Inset controls now follow region, placement, frame, leader, and scale order; unused region buttons and Zoom were removed. Reset clears only the active Adjust, Crop, or Inset settings. Scale reads original pixel dimensions automatically and uses metadata or a known-length line for calibration. Its bar length has a separate unit control; opening Inset copies the current Scale bar style, including margin and text choice.
- 插图原图框线默认红色；颜色选择器正确显示已存颜色，并可点「更新插图」重新生成当前区域。
- 标尺与图片编组，整体变换时一起移动。
- 图版标签支持已存样式、已安装字体、可输入负值的偏移，以及最多三段可选字体、字形、字号和位置的彩色染色说明。
- 插图按区域、放置、框线、引线、标尺排序；移除了无效的区域按钮和“放大”设置。重置只清除当前调整、裁剪或插图页的内容。标尺页自动读取原图像素尺寸，标定使用元数据或已知长度线段，并移除了“核对选中图”。标尺长度有独立的单位选项；打开插图页会同步当前标尺样式，包括边距和文字开关。

## Previous / 此前

- Crop and Inset are separate tabs. Raw and Export stay hidden until Settings → Advanced features. Fiji is requested only when a file needs it. The panel opens on Scale.

- 裁剪和放大插图分成独立页。原始和导出默认隐藏，在设置里打开。只有文件需要 Fiji 时才提示配置。面板默认进入标尺。

## Initial release / 初始发布

First public release of PaperFig for Illustrator under GPL-3.0.

PaperFig for Illustrator 首次公开发布，采用 GPL-3.0 许可。
