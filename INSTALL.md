# Install / 安装 — PaperFig for Illustrator

License **[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)**

Usage / 用法: [`HOWTO.md`](HOWTO.md).

## Scripts / 脚本

Run the installer in the folder that contains `CSXS/manifest.xml`. The release zip already uses the folder name `paperfig/`. A GitHub source zip may use another top-level folder name. Do not rename it. The script finds the manifest from its own directory. Running it again replaces only `extensions/paperfig`.

在含 `CSXS/manifest.xml` 的目录里运行安装脚本。发布包顶层目录已是 `paperfig/`。GitHub 源码包顶层可能使用别的名字，不必改名。脚本从自身所在目录找清单。再次运行只替换 `extensions/paperfig`。

| OS / 系统 | Double-click / 双击 | Or run / 或执行 |
|-----------|---------------------|-----------------|
| Windows | `install.bat` | `powershell -ExecutionPolicy Bypass -File install.ps1` |
| macOS | `install.command` | `bash install.sh` |

[`install/`](install/) repeats those entry points.

The script copies the extension to `%APPDATA%\Adobe\CEP\extensions\paperfig` or `~/Library/Application Support/Adobe/CEP/extensions/paperfig`, and sets `PlayerDebugMode=1` for CSXS.9–15.

`install.ps1` is UTF-8 with a BOM so Windows PowerShell reads the bilingual text. Keep the BOM if you edit that file.

脚本把扩展复制到上述 CEP 目录，并为 CSXS.9–15 写入 `PlayerDebugMode=1`。`install.ps1` 带 UTF-8 BOM，改这个文件时请保留 BOM。

## Package / 安装包

- Release assets / 发布附件: [releases page](https://github.com/leelieber2025/paperfig-illustrator/releases)
- Local pack output / 本地打包输出: `dist/`
- Or clone this repository and run the installer in the repo root. / 或克隆本仓库，在仓库根目录运行安装脚本。

Quit Illustrator, unzip, and run the installer. Or copy the `paperfig` folder to the CEP path above.

先退出 Illustrator，解压后运行安装脚本。也可以把 `paperfig` 文件夹复制到上面的 CEP 路径。

| OS / 系统 | Path / 路径 |
|-----------|-------------|
| Windows | `%APPDATA%\Adobe\CEP\extensions\paperfig` |
| macOS | `~/Library/Application Support/Adobe/CEP/extensions/paperfig` |

## Unsigned extensions / 未签名扩展

This is not a signed ZXP. `PlayerDebugMode` follows the CEP/CSXS runtime, not the Illustrator product version. The installer sets CSXS.9–15. Example for CEP 11:

这不是已签名的 ZXP。`PlayerDebugMode` 对的是 CEP/CSXS 运行时，不是 Illustrator 的产品版本号。安装脚本写入 CSXS.9–15。以 CEP 11 为例：

Windows registry / 注册表: `HKEY_CURRENT_USER\Software\Adobe\CSXS.11`  
String / 字符串: `PlayerDebugMode` = `1`

```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
```

https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_11.x/Documentation/CEP%2011.1%20HTML%20Extension%20Cookbook.md#debugging-unsigned-extensions

## Check / 检查

Start Illustrator. **Window → Extensions** or **Extensions (Legacy) → PaperFig for Illustrator**. The footer shows the installed package version. The panel opens on **Scale** and asks for a Fiji path only if a file needs it.

启动 Illustrator。**窗口 → 扩展** 或 **扩展（旧版）→ PaperFig for Illustrator**。页脚显示已安装包的版本。默认进入 **标尺**；只有文件需要 Fiji 时才提示配置路径。

Fiji + Bio-Formats is optional, for files the native TIFF reader cannot open. Set the executable or the app folder (for example `Fiji.app`) under **Settings → Fiji setup**.

Fiji + Bio-Formats 是可选的，用于原生 TIFF 读不开的文件。在 **设置 → Fiji 设置** 填写可执行文件或应用目录（例如 `Fiji.app`）。

## macOS

`install.sh` and `install.command` use LF line endings. The release zip marks `*.sh` and `*.command` as executable. If Finder will not open `install.command`:

`install.sh` 和 `install.command` 使用 LF 换行。发布包把 `*.sh` 和 `*.command` 标为可执行。若 Finder 打不开 `install.command`：

```bash
cd /path/to/paperfig
chmod +x install.command install.sh install/install.command install/install.sh
xattr -dr com.apple.quarantine .
bash install.sh
```

## License / 许可

**[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)**. Copyright © 2026 Zhao Li. See [`LICENSE`](LICENSE).
