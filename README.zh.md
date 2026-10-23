# Papurr(论文文件夹管理)

*English: [README.md](README.md) · 日本語: [README.ja.md](README.ja.md)*

一个 Chrome 扩展:把论文集中放在**你自己选定的一个文件夹**里,并用它**自动生成的索引**来管理。
在你平时用的网络数据库里点击 PDF 链接:如果已经有这篇论文,就打开你本地的那份;没有的话,先保存到文件夹,再打开。扩展本身也可以离线使用。

## 理念

同一篇论文,下了一遍又一遍。\
分类很麻烦,于是就放在桌面或"下载"文件夹里。\
过一阵子整理,又删掉了。\
然后,又把同一篇论文下载了一遍。\
按项目分文件夹,同一篇论文就被复制得到处都是。\
这份副本里有批注,那份里却没有。

试着用了文献管理软件,功能太多,又用不明白。\
在同步的某个环节,不知为何有东西悄悄不见了。\
偶尔还会卡死。\
最后,找论文还是 INSPIRE 或 ADS 更方便,\
于是又把文献管理软件里已有的论文,再下载了一遍。

Papurr 要结束这个循环。
每篇论文在一个文件夹里只留一份。点击 PDF 链接:有就打开你本地的那份,没有就先保存再打开。项目的分类用标签,而不是复制。


## 主要功能

- **并排管理 arXiv 版和期刊版**(只有期刊版的论文、NASA ADS 的旧扫描版也可以)
- **文献库页面**:搜索、排序、筛选、标签,以及指向 arXiv / INSPIRE / NASA ADS 的链接
- **每篇论文一份笔记**(文件夹里的 Markdown 文件,公式会排版显示)
- **导入你手头已有的 PDF**:读取内容来识别,只对你同意的文件改名并加入文献库
- **今日 arXiv**:你关注的类别的最新论文,附摘要;有新的公布时可以通知你(可选)
- **INSPIRE 搜索**:通过 API 搜索 INSPIRE 的数据库,一键保存结果
- **AI 功能(可选)**:使用你自己的 Claude、ChatGPT 或 Kimi Code 套餐,按与你研究的相关度给今日 arXiv 排序,说明推荐理由,翻译并生成摘要
- **支持云同步的文件夹**;界面有英语、日语和简体中文;多种配色主题

## 安装

目前 Papurr 还不在 Chrome 网上应用店中,需要作为"已解压的扩展程序"加载。有两种方式。

### A. 交给 AI 助手来做(推荐)

如果你在用 Claude Code(`claude`)、Codex CLI(`codex`)或 Kimi Code CLI(`kimi`)这类 AI 命令行助手:

1. 在要存放 Papurr 的目录中获取仓库:`git clone https://github.com/atsuhisa-ota/papurr.git`
2. 用你的 AI 助手打开 Papurr,然后直接说:"**请按照 docs/INSTALL-AGENT.md 安装 Papurr。**"
3. 不过下面这些需要你自己来做:
   - 在 `chrome://extensions` 中,把助手告诉你的文件夹作为扩展程序加载,
   - 如果注册了辅助程序,重启 Chrome,
   - 在 Papurr 的设置中选择你的论文文件夹,
   - 使用 AI 功能时:登录你的 AI 套餐,并在设置中同意说明。
4. 点击工具栏上的 Papurr 图标,文献库就会打开。

助手不会未经询问就安装任何东西,不会登录或处理密码,也不会修改仓库中的文件。
以后要更新,在同一个文件夹中打开的对话里说:"请更新 Papurr。"

### B. 手动安装

1. 获取仓库(与 A 的第 1 步相同)。
2. 打开 `chrome://extensions`,打开**开发者模式**。
3. 点击**加载已解压的扩展程序**,选择本仓库的 `extension` 文件夹。
4. 点击工具栏上的 Papurr 图标,文献库就会打开。打开右上角的**设置**,**选择你的论文文件夹**。
5. 如果要使用外部 PDF 应用、"在文件夹中显示"或 AI 功能,需要在每台电脑上注册一次辅助程序(需要 Python 3),然后重启 Chrome:
   - Mac:双击 `native/Install helper (Mac).command`
   - Windows:双击 `native\Install helper (Windows).bat`
   - Linux:在本文件夹中运行 `python3 native/install.py`(请使用 Google 提供的 .deb / .rpm 版 Chrome;snap 或 Flatpak 版的 Chrome 无法启动辅助程序)
6. 更新时:先 `git pull`,然后在 `chrome://extensions` 中点击 Papurr 的更新按钮,并重新加载已打开的标签页。想收到新版本的通知,可以在 GitHub 页面使用 **Watch → Custom → Releases**。已安装的版本显示在设置和使用说明页面中。

## 注意事项
- **如果你的论文文件夹由云服务同步,请自己确认同步已经完成。** Papurr 不会检查同步状态。
  如果在文件还在同步时点击"更新索引",尚未同步的文件对应的条目可能会被移除。
- 重启 Chrome 后,如果它请求使用文件夹的权限,请选择**每次访问时允许**,以后就不会再被询问。
- 期刊 PDF 是用你自己浏览器的登录状态获取的,所以你需要有权访问它们(例如通过所在机构的网络)。
  如果无法获取,请用平常的方式打开它,保存到论文文件夹,再使用设置中的"识别并重命名……"。

## 使用方法

请打开屏幕右上角的**使用说明**。设置中每个部分旁边的 **?** 也会打开使用说明中对应的内容。

## 你的数据

Papurr 只会联系 arXiv、INSPIRE、OpenAlex、Crossref、NASA ADS(用来查询论文信息),以及你所点击的 PDF 所在的出版社网站。
PDF 文件不会被上传,也不会向作者发送任何东西。只有使用 AI 功能时,论文的相关信息才会通过你自己的 AI 命令发送给 AI 提供方
(详见使用说明和设置中的说明)。

## 仓库结构

| 文件夹 | 内容 |
| --- | --- |
| `extension/` | 扩展本体(在 Chrome 中加载的就是它)。 |
| `native/` | 可选的辅助程序,用于外部 PDF 应用和 AI 命令。 |
| `dev-tests/` | 自动检查。运行 `dev-tests/run-all.sh`(需要 `node`、`python3` 和 Google Chrome)。 |
| `docs/`、`CLAUDE.md`、`AGENTS.md` | 面向贡献者和 AI 助手的开发指南(英文):理念、架构、数据格式、规则。`docs/DATA-SOURCES.md`(英文)列出了 Papurr 会联系哪些地方以及原因。 |

## 现状与限制

- 在 macOS 和 Linux 的 Google Chrome 上开发和测试。Windows 的辅助程序还没有在真正的 Windows 电脑上试过。还没有上架 Chrome 网上应用店。
- 官方源码在 <https://github.com/atsuhisa-ota/papurr>。如果作者以后在 Chrome 网上应用店发布 Papurr,链接会放在这里;其他叫 Papurr 的扩展都不是作者做的。

## 许可证

[MIT](LICENSE) © 2026 Atsuhisa Ota。包含 [KaTeX](https://katex.org)(MIT,© Khan Academy and other contributors;`extension/vendor/katex/LICENSE`)。

MIT 许可证适用于代码。"Papurr"这个名称和图标(`extension/icons/`、`mark.svg`)没有授权用作其他项目的名称或标志:请给副本或分支另起名称、另换图标。

## 关于本项目

Designed by Atsuhisa Ota. Implemented by AI (Claude, by Anthropic, via Claude Code), under the author's direction and testing.
