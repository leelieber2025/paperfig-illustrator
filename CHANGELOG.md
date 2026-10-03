# Changelog

## [1.0.0] — 2026-10-03

First release. GPL-3.0. Install from `dist/paperfig-1.0.0.zip`. Panel footer reads **1.0.0**.

## [0.10.3] — 2026-10-02

### License

- Relicensed to **GPL-3.0**. [`LICENSE`](LICENSE) is the GNU GPL v3 text.

### Fixes

- **Pick reference endpoints:** a left click records an endpoint. The hand cursor still pans until that button is pressed. Space or the middle button still pans while picking.
- **Inset ratio:** Free, 1:1, 4:3, and 16:9 follow the menu choice. The preview rectangle uses the same scale on both axes as the width and height fields. The preview stage is a block, and the box width and height are pinned, so CEP cannot stretch a 16:9 marquee into the stage. Crop uses that placement too.
- **Startup and clicks:** the panel binds first, then loads the host script. Selection polling no longer reads the linked file header, and a click runs ahead of a queued poll.
- **macOS install:** the new folder is copied and checked before the old install is moved aside. A failed copy leaves the previous install in place. README and INSTALL download names come from the package version.
- **Source stamp:** a legacy `size:mtime` record is not treated as unchanged when the file size matches. The panel asks to reconfirm the source and then stores SHA-256.
- **Raw records:** JSON is written to a temporary file and renamed into place. The panel separates “image replaced” from “record save failed”, and retries a failed record the next time it opens. Source hashing and raw rendering report read, process, and write progress.
- **Scale bar:** the architecture note states there is no automatic tracking. Scaling the image later does not move the bar.
- **Calibration after crop:** a saved µm/px stays with the image after a crop. The scale bar uses that value. A confirm appears only when the pixel size changed and there is no crop record to explain it.
- **Inset ratio:** the marquee stays in preview pixels. It is no longer clamped to file width and height, which clipped each side separately and turned 16:9 into a square.

## [0.10.2] — 2026-10-02

### Fixes

- **CI / integration tests:** mock `window.confirm` in the Node VM for scientific-integration so `reuseLastCalibration` after a source-pixel size mismatch persists calibration (origin + applied pixels asserted). Release packaging includes the current PolyForm Noncommercial 1.0.0 LICENSE.

## [0.10.1] — 2026-10-01

### Docs

- Relicensed documentation and package metadata to **PolyForm Noncommercial 1.0.0** (LICENSE replaced with the official text). Version stays 0.10.1.

### Features

- **Compare scale bars:** Scale tab **Compare selection** reads every linked image in the Illustrator selection and lists µm/px, file pixel width, and how many pixels the current bar length covers. A relative µm/px gap above 0.5%, or a missing calibration, is marked. Nothing is copied between images.

### Fixes

- **Geometry color swatches:** frame and leader color inputs use the same 28×16 swatch as Scale and Adjust, instead of a full-width color block.
- **Control rhythm:** every color input (Adjust, Raw, Scale, Geometry) is the same 28×16 swatch. Text, number, and select fields share a 26px height. Selects no longer carry an extra left margin. Standalone section buttons span the group width.

## [0.10.0] — 2026-10-01

### Fixed

- **Inset Apply after the marquee split:** `applyInset` called panel-local `W.channelsDefault()`. `W` is not in `bitmap-panel-marquee.js`, so Geometry → Magnifier → Apply threw `W is not defined` and never placed the inset. It now calls `window.SciBitmapWorkflow.channelsDefault()`. The panel also forwards `onCropPointerMove` and `getDisplayedImageClientRect`.

### Features

- **Named scale presets (JSON files):** Scale tab **Save** / **Load** use native OS dialogs starting in Downloads (choose any folder). Save writes calibration µm/px + bar style as JSON and overwrites if the chosen file already exists. A legacy `sci_scale_global_v1` entry still migrates into `~/paperfig/scales` on first open if that folder is empty. Per-image calibration and **Reuse last** are unchanged.
- **Original file px crop mode:** Geometry crop ratio menu adds **Original file px** (`source-px`) alongside existing Free / ratios / Fixed px. It locks W×H to unscaled linked-file pixel size only (no artboard/display-size fallback), so the same W×H crop stays consistent across PlacedItems that were placed at different display sizes. Existing crop modes are unchanged.

### Fixes

- **Original file px without Illustrator metadata:** When linked PlacedItem pixel size is not available from host metadata, the panel probes the linked file on disk (`Core.readMetadata` / PNG·JPEG·TIFF·GIF·BMP headers) and JSX `sciBitmapItemInfo` also reports `pixelWidth`/`pixelHeight` from that file probe. Source-px no longer requires a Refresh that only hopes metadata appears.

## [0.9.8] — 2026-10-01

### Features

- **In-panel RGB color picker:** native `<input type=color>` opened behind the CEP panel; replaced with an in-panel RGB/SV picker (`color-picker.js`) that stays above the UI.
- **Fiji / ImageJ Merge Channels presets in picker:** red, green, blue, gray, cyan, magenta, yellow swatches live **inside** the opened color-picker popup (not as empty row swatches). Free RGB picker retained. Adjust (R/G/B) and Raw channel rows.

### Fixes

- **Panel open channel colors:** remapping / channel colors always start from fresh defaults on panel open (no stale `settings.channels` restore). Per-image draft/saved recipes still restore via selection. Matches existing crop reset-on-open behavior.
- **Default R/G/B swatch colors:** `channelsToUi` + CSS (`appearance:none`, hide native swatch) paint correct red/green/blue fills on panel open.
- **Color picker open/close:** opening a channel swatch no longer closes immediately (mousedown/click toggle race, CEP blur/focus, and early outside-close).
- **Empty Fiji preset fills:** clear global `button` gradient (`background-image: none`) so R/G/B/gray/cyan/magenta/yellow fills show inside the color-picker popup.
- **Fiji preset click apply:** popup no longer capture-`stopPropagation`s mousedown (that blocked child preset/OK/SV handlers). Clicking a Fiji swatch updates RGB/hex/preview immediately; OK commits to the channel color input.




## [0.9.7] — 2026-10-01

### Features

- **Fiji / ImageJ Merge Channels color presets:** quick swatches beside each channel Color control (red, green, blue, gray, cyan, magenta, yellow). Free RGB picker unchanged. Available on Adjust (R/G/B) and Raw channel rows. EN+ZH i18n.
- **Panel dark selects:** custom dropdown (`.pf-dd-menu`) for `<select>` open lists so CEP no longer shows a white frame/background.
- **Presets:** name field + **Save current** stores the current Adjust settings as a new preset; Load / Overwrite / Delete manage the selection.
- **Geometry / Straighten:** draw a line on the preview; image rotates so that line becomes horizontal.
- **Artboard preview tools:** Preview on artboard / Cancel / Hold=original collapsed by default into one expandable row.

### Interface / i18n

- Leftover hardcoded Chinese defaults wired to `data-i18n`; status/notice strings remap on language toggle; `t()` no longer prefers Chinese when UI language is English.

### macOS install gatekeep (static; no live Illustrator on this release machine)

- `install.sh` / `install.command`: LF endings (`.gitattributes`); `install.command` execs `bash ./install.sh` (bash fallback).
- Installer copies to `~/Library/Application Support/Adobe/CEP/extensions/paperfig` and clears `com.apple.quarantine` via `xattr` when available.
- Sets `PlayerDebugMode=1` for **CSXS.9–15** (covers the requested CSXS.9–13 range plus newer hosts).
- Release zip `paperfig-0.9.7.zip` is built with Python `zipfile` so `*.sh` / `*.command` carry Unix mode **0755**.

### Residual risks (macOS / CEP)

- This release was **not** smoke-tested inside Adobe Illustrator on a Mac (no Mac / Illustrator available on the build agent). Verify footer **0.9.7** after install.
- Finder may still block unsigned `.command` after browser download even with 0755 in the zip — users may need `chmod +x` and `xattr -dr com.apple.quarantine .` (documented in INSTALL.md).
- Which CSXS plist Illustrator actually reads depends on the installed CEP runtime; 9–15 is set broadly, but a future host could need a higher key.
- Gatekeeper / Full Disk Access prompts are environment-specific and cannot be pre-cleared by the zip alone.

### Packaging

- CEP manifest, panel footer, and host script: **0.9.7**.
- Zip: `dist/paperfig-0.9.7.zip`. The top-level folder is `paperfig/`. Copy it to CEP `extensions/paperfig`.

## [0.9.6] — 2026-09-30

### Features

- **Vector scale bar text:** Create / update vector bar offers **Include length text** (checkbox). Unchecked draws only the bar line; checked keeps the µm/nm/mm label. Update replaces the prior group, so turning text off removes it and turning it on restores it. Preference is remembered in the panel.


### Fixes

- **Windows installer (Download ZIP):** `install.ps1` ships as UTF-8 **with BOM** so PowerShell on Chinese Windows (GBK) no longer fails with `The string is missing the terminator`. GitHub **Code → Download ZIP** / source zipball installs without renaming the extracted folder; docs clarify release `paperfig-*.zip` vs source zipball.
- **Inset above/below:** placement now width-matches the main image (left/right aligned), with height from crop/pixel aspect — analogous to left/right height-matching. User magnification no longer drives free region×mag sizing for above/below; effective magnification is derived from the matched width. Left/right height alignment, leaders, scale bar, and frame/content mapping are unchanged.
- **Action button width:** Top Apply / Refresh / Preview / Cancel rows no longer grow unbounded or wrap away neighbors (`flex` + ellipsis; busy labels always restore from i18n keys).
- **Panel width:** CEP preferred size **400×720** (about 1.5–2× Illustrator Properties). Min **280×120**, max width **480** so the panel cannot sprawl. Dense grids stack below ~360px.
- **Collapse control:** In-panel **Collapse / Expand** toggles a thin header (hides preview, actions, and tabs) and best-effort `resizeContent`. CEP cannot iconify like native Properties; use Illustrator's panel tab (double-click / icon mode) for dock iconify.
- **Sony / EXIF JPEG preview:** `W.profile` no longer treats JPEG EXIF Orientation (tags 2–8, e.g. Sony DSC portrait) as a TIFF top-left hard fail. Only TIFF-like metadata (photometric/compression/extraSamples) keeps that guard. Orientation=1 JPGs unchanged; EXIF-rotated JPGs use the existing bake path.

- **JPEG preview orientation:** Panel Canvas decode now reads JPEG EXIF Orientation (tags 1–8) and only bakes a transform when the preview aspect still disagrees with the artboard (Illustrator place matrix / geometry). Orientation=1 and JPGs that already match the artboard are unchanged. Crop L/T/W/H stay storage-file pixels with display↔file mapping when EXIF was applied; linked CSS matrix is not re-applied on top of a baked buffer. TIFF/PNG/raw and intentional rotate/flip workflows are unchanged.


## [0.9.5] — 2026-09-30

### Documentation

- Changelog is English only. README, INSTALL, and HOWTO stay bilingual (English and Chinese).
- HOWTO no longer tells users to place installers beside the extension folder; the scripts already live next to `CSXS/manifest.xml`.
- HOWTO and the panel no longer refer to a separate **Create inset / 生成插图** button. Inset mode uses **Apply**.
- HOWTO states that leaving the Geom tab exits inset mode and clears the inset rectangle, and that Apply returns to Crop mode.
- README distinguishes RGB processing records (`.json` plus `.baseline.json` and `parent`) from Raw Apply (`sci-raw-display` only; no baseline marker and no `parent`).
- Install steps name both **Window → Extensions** and **Extensions (Legacy)**. The first-run skip control is **Skip for RGB-only** / **稍后（仅 RGB）**.

### Interface

- Inset Apply tooltip no longer says the action is the same as the removed Create inset button.
- Marquee hint states that leaving Geom clears the inset region.
- Raw Series/Z/T labels are translated (they were hardcoded as `Z (0-based)` / `T (0-based)` in Chinese mode).
- Batch summary uses the language table.

### Package

- CEP manifest, panel footer, and host script: **0.9.5**.
- Zip: `dist/paperfig-0.9.5.zip`. The top-level folder is `paperfig/`. Copy it to CEP `extensions/paperfig`.
- Install scripts set `PlayerDebugMode` for **CSXS.9–15** (Illustrator 2024 uses 11, Illustrator 2025 uses 12). A locked install folder now prints a bilingual “quit Illustrator and retry” error instead of a raw stack trace. macOS clears the download quarantine flag on the installed folder. `.tools` is not copied into the CEP folder.

## [0.9.4] — 2026-09-30

### Fixes

- **Scale bar:** bottom-left / bottom-right placement uses Illustrator Y-up `geometricBounds` (axis-aligned) or BL-first-aware UV `yBottom` so the bar sits in the correct corner on rotated artboards.
- **Inset / Geometry:** leaving the Geometry tab (or any non-geometry tab) auto-exits inset/magnifier marquee mode so the crop/inset box does not linger.
- **Adjust — enable recolor:** turning remapping on no longer requires a live Illustrator selection. It uses the associated `previewBase` on Adjust even if a Raw dataset is still loaded. The checkbox remains the intentional enable gate.

### Package

- CEP manifest, panel footer, and host script: **0.9.4**.
- Zip: `dist/paperfig-0.9.4.zip`. The top-level folder is `paperfig/`. Copy it to CEP `extensions/paperfig`.
- Pack script excludes local `.tools/` (bundled Node toolchain) from the release zip.

## [0.9.3] — 2026-09-30

### Fixes

- **Windows:** `install.bat` ships with **CRLF** (via `.gitattributes`) so `cmd.exe` no longer splits lines.
- **Install docs:** no longer ask to delete `sci-bitmap-clean` or rename the unzipped folder — release zip top-level is already `paperfig/`.
- **macOS release zip:** pack script now writes Unix mode **0755** on `install.sh` / `install.command` (and `install/*` wrappers) so double-click / `./install.command` works after unzip on Mac. Fallback documented: `bash install.sh` or `chmod +x`.

### Package

- CEP manifest, panel footer, and host script: **0.9.3**.
- Zip: `dist/paperfig-0.9.3.zip`. The top-level folder is `paperfig/`. Copy it to CEP `extensions/paperfig`.

## [0.9.2] — 2026-09-30

First public release of PaperFig for Illustrator, a CEP panel for scientific figure bitmaps.

### License

- **[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)** (not an OSI open-source license). SPDX: `PolyForm-Noncommercial-1.0.0`.
- Noncommercial use is free under that license; commercial use needs a separate license from Zhao Li (`leelieber@gmail.com`).
- Full terms: [`LICENSE`](LICENSE).

### Changes

- **RGB and Raw.** Tone, per-channel Low/High, keep-channel, and remap. uint8/uint16 preview from native TIFF/OME, or from Fiji + Bio-Formats.
- **Geometry.** Crop in file pixels, including on rotated artboards. Crop and inset (magnifier) marquees are exclusive: one is active, and switching clears the other.
- **Inset.** In inset mode, **Apply** places an unresampled crop, a styled frame, optional leaders, and a scale bar when um/px is saved.
- **Scale.** um/px is stored per image. The vector bar uses that value. Crop does not clear it.
- Preview zoom and pan. UI languages: Chinese and English. Each Apply writes one processing record, with a parent link when the input is a PaperFig output. Batch apply. Install scripts for Windows and macOS.

### Package

- CEP manifest, panel footer, and host script: **0.9.2**.
- Zip: `dist/paperfig-0.9.2.zip`. The top-level folder is `paperfig/`. Copy it to CEP `extensions/paperfig`.
