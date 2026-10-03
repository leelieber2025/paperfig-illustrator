# Install — PaperFig for Illustrator

Version **1.0.0** · License **[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)**

Usage (EN + 中文): [`HOWTO.md`](HOWTO.md).

---

## Installer scripts / 安装脚本

Place the scripts next to the extension tree (any folder that contains `CSXS/manifest.xml`) **or** run them from inside the unzipped `paperfig/` folder (release asset `paperfig-1.0.0.zip` already uses that name). GitHub **Code → Download ZIP** / release **Source code** zipballs also work as-is: the extracted folder is often named `paperfig-illustrator-<tag>` (or `…-main`); do **not** rename it. Installers locate `CSXS/manifest.xml` from the script directory (`%~dp0` / `$0`). Re-running overwrites only the CEP `extensions/paperfig` install; other CEP extensions are left alone.

**Windows note:** `install.ps1` is UTF-8 with BOM so PowerShell on Chinese Windows (GBK/cp936) parses bilingual strings correctly. If you edit that file, keep the BOM.

| OS | Double-click / 双击 | Or run / 或执行 |
|----|---------------------|-----------------|
| **Windows** | `install.bat` | `powershell -ExecutionPolicy Bypass -File install.ps1` |
| **macOS** | `install.command` | `bash install.sh` |

Thin wrappers under [`install/`](install/) call the root installers.

The scripts:

1. Copy the extension to `%APPDATA%\Adobe\CEP\extensions\paperfig` (Windows) or `~/Library/Application Support/Adobe/CEP/extensions/paperfig` (macOS).
2. Set `PlayerDebugMode=1` for **CSXS.9–15** (this includes CEP 11 and CEP 12) so Illustrator loads this unsigned extension.
3. Print bilingual instructions: quit/reopen Illustrator → **Window → Extensions / Extensions (Legacy) → PaperFig for Illustrator**.

---

## English

### 1. Get the package

- **Preferred:** [`dist/paperfig-1.0.0.zip`](dist/paperfig-1.0.0.zip) in this repo, or the same **`paperfig-1.0.0.zip`** asset on GitHub Release v1.0.0 (top-level `paperfig/` folder).
- **Also fine:** GitHub **Code → Download ZIP** or the release **Source code (zip)** — unzip and run `install.bat` / `install.command` in the extracted folder (often `paperfig-illustrator-1.0.0/…`); no rename.
- Or clone this repository and use the extension folders (`CSXS`, `client`, `jsx`, …) directly.

### 2. Install the CEP extension

Use the installer scripts above, or install manually:

1. Quit Adobe Illustrator.
2. Unzip. Release asset `paperfig-1.0.0.zip` has a top-level **`paperfig/`** folder; GitHub source ZIP uses a folder like **`paperfig-illustrator-1.0.0/`**. Either way `CSXS/manifest.xml` sits beside the install scripts — **no rename**. Open that folder and double-click `install.bat` (Windows) or `install.command` (macOS).
3. Or copy that `paperfig` folder to:

| OS | Path |
|----|------|
| Windows | `%APPDATA%\Adobe\CEP\extensions\paperfig` |
| macOS | `~/Library/Application Support/Adobe/CEP/extensions/paperfig` |

Example Windows path:

`C:\Users\<you>\AppData\Roaming\Adobe\CEP\extensions\paperfig`

### 3. Allow unsigned extensions

This package is **not** a signed ZXP. Set PlayerDebugMode for the **CEP/CSXS runtime** Illustrator is using. That number is not the Illustrator product version.

The installer scripts set CSXS.9–15 automatically. That range includes **CSXS.9–13** (common Illustrator CEP hosts) plus 14–15 for newer runtimes. Manual example for **CEP 11**:

**Windows (Registry)**  
Key: `HKEY_CURRENT_USER\Software\Adobe\CSXS.11`  
String value: `PlayerDebugMode` = `1`

**macOS (Terminal)**

```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
```

If your host uses another CEP version, replace `11` accordingly. Adobe cookbook:

https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_11.x/Documentation/CEP%2011.1%20HTML%20Extension%20Cookbook.md#debugging-unsigned-extensions

### 4. Verify

1. Start Illustrator.
2. **Window → Extensions / Extensions (Legacy)** → **PaperFig for Illustrator**.
3. Confirm the panel footer shows **1.0.0**.
4. If Fiji is unset, complete or skip the **Configure Fiji** first-run screen.
### 0.10.1 notes

Scale **Save** and **Load** use native system dialogs with the same default folder, `~/paperfig/scales` (Windows: `%USERPROFILE%\paperfig\scales`). Geometry adds **Original file px** (`source-px`); when host metadata lacks dimensions, the panel probes linked PNG/JPEG/TIFF/GIF/BMP files on disk. **Compare selection** checks µm/px across the current Illustrator selection.

Optional: Fiji + Bio-Formats for layouts the native TIFF reader cannot open. Path can also be set under **Export → Fiji setup** (executable or app folder, e.g. `Fiji.app` or a directory containing `ImageJ-win64.exe`). See [`HOWTO.md`](HOWTO.md).

---

## 中文

### 1. 获取安装包

- **推荐：** 仓库内 [`dist/paperfig-1.0.0.zip`](dist/paperfig-1.0.0.zip)，或 GitHub Release v1.0.0 上的 **`paperfig-1.0.0.zip`** 附件（顶层 `paperfig/`）。
- **也可：** GitHub **Code → Download ZIP** 或 Release 的 **Source code (zip)** —— 解压后在提取目录（常为 `paperfig-illustrator-1.0.0/…`）中运行 `install.bat` / `install.command`，**无需改名**。
- 也可直接克隆本仓库，使用其中的扩展目录。

### 2. 安装 CEP 扩展

使用上方安装脚本，或按下列步骤手动安装：

1. 退出 Illustrator。
2. 解压。Release 附件 `paperfig-1.0.0.zip` 顶层为 **`paperfig/`**；GitHub 源码 ZIP 常为 **`paperfig-illustrator-1.0.0/`**。两者都是 `CSXS/manifest.xml` 与安装脚本同目录——**无需改名**。进入该目录双击 `install.bat`（Windows）或 `install.command`（macOS）。
3. 或将该 `paperfig` 文件夹复制到：

| 系统 | 路径 |
|------|------|
| Windows | `%APPDATA%\Adobe\CEP\extensions\paperfig` |
| macOS | `~/Library/Application Support/Adobe/CEP/extensions/paperfig` |

### 3. 允许未签名扩展

本包不是已签名 ZXP。按当前 Illustrator 使用的 **CEP/CSXS 版本**设置 `PlayerDebugMode`。这个号不是 Illustrator 的产品版本号。安装脚本写入 CSXS.9–15。

以 **CEP 11** 为例：

- Windows：注册表 `HKEY_CURRENT_USER\Software\Adobe\CSXS.11`，字符串 `PlayerDebugMode` = `1`
- macOS：`defaults write com.adobe.CSXS.11 PlayerDebugMode 1`

### 4. 验证

重启 Illustrator → **窗口 → 扩展／扩展（旧版）** → **PaperFig for Illustrator** → 页脚应为 **1.0.0**。若尚未配置 Fiji，按首次打开的 **配置 Fiji** 界面完成或跳过。

可选：原生 TIFF 无法打开的布局需 Fiji + Bio-Formats。亦可在 **导出 Export → Fiji 设置** 中填写可执行文件**或应用目录**（如 `Fiji.app`）。详见 [`HOWTO.md`](HOWTO.md)。

---


## macOS notes / macOS 说明

Static review checklist (this release was packed on Windows; Illustrator was not run on a Mac):

1. **Path:** installer copies to `~/Library/Application Support/Adobe/CEP/extensions/paperfig` (space in `Application Support` is quoted in the script).
2. **PlayerDebugMode:** sets `com.adobe.CSXS.9` through `com.adobe.CSXS.15`, then refreshes `cfprefsd`.
3. **Line endings:** `install.sh` / `install.command` are LF (`.gitattributes`).
4. **Execute bit:** `paperfig-1.0.0.zip` marks `*.sh` / `*.command` as Unix mode `0755`. If Finder still will not open `install.command` after download:

```bash
cd /path/to/paperfig
chmod +x install.command install.sh install/install.command install/install.sh
xattr -dr com.apple.quarantine .   # if Gatekeeper blocks a browser download
bash install.sh                    # always works without +x
```

5. **No rename:** unzip → open the `paperfig/` folder → run the installer (folder already named `paperfig`).

Residual risks we could not verify here: Illustrator menu visibility after install, CEP host version newer than 13, and Gatekeeper prompts on specific macOS versions.

## License

PaperFig for Illustrator is licensed under **[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)**. See [`LICENSE`](LICENSE). Copyright © 2026 Zhao Li.
