# Obsidian Float Search

You can use search view in modal now.

![float-search.png](media/img.png)

- Set hotkey for open float search quickly.


## 使用说明 | Usage

1. **Three main commands**:
    - `Search Obsidian Globally`: Searches all global content, and the characters entered will be cleared automatically after each search;
    - `Search Obsidian Globally (With Last State)`: Searches all global content, and the characters entered will be cleared 30 seconds after each search;
    - `Search In Current File`: Searches the content of the current file;
2. **When the cursor is focused on the search input box**:
    - Use the up and down arrow keys to switch between search results;
    - When a search result is selected, hold the Shift key and press the up or down arrow keys to expand the results upwards or downwards; when focused on a file name, you can collapse the search results under the current file name;
    - When a search result is selected,
        - Press Enter to open the file in the background;
        - Press Ctrl+Enter to open a new page in the background and open the file;
        - Press Alt+Enter to open the file and close the popup;
        - Press Ctrl+Shift+Alt+Enter to open the file in a new window and close the popup;
    - When a search result is selected, press Tab to preview the corresponding file in the current popup's right side, and Shift+Tab to close the preview;
    - When a search result is focused, press Ctrl+Shift+C to copy the selected search result content;
    - When a file is being previewed, press Ctrl+E to toggle the file's reading mode;
    - When a file is being previewed, press Ctrl+G to jump from the input box to the content of the previewed file, or from the previewed file content back to the input box;
    - When a file is being previewed, press Tab twice to jump into the content of the previewed file, or use Ctrl+Tab to switch back to the input box from the previewed file.
3. **Mouse click behavior**:
    - When a file is being previewed:
        - Clicking a new search result with the mouse will not automatically close the popup, but instead switch the file in the preview window;
        - Use Alt+mouse click to open the file and close the popup;
    - When no file is being previewed:
        - Clicking a search result with the mouse will automatically close the popup and navigate to the file, and other behavior is the same as Obsidian's default behavior;
4. **The right-click context menu can quickly search the selected text**;
5. **There is a default `obsidian://fs?query=xxxxxx` URI command, which you can use to invoke Float search from external sources**;
6. **When you click to navigate within the previewed file page, the current previewed file page will be automatically replaced**.

---

1. **三个主要命令**：
    - `Search Obsidian Globally`：用于搜索全局的所有内容，每次搜索后的字符都会自动清空；
    - `Search Obsidian Globally (With Last State)`：用于搜索全局的所有内容，每次搜索后的字符都会在三十秒后清空；
    - `Search In Current File`：用于搜索当前文件的内容；
2. **当光标聚焦在搜索输入框的时候**：
    - 按上下方向键来切换选择结果；
    - 当有一个搜索结果被选择时，按住 Shift 键再按上下方向键来向上展开或者向下展开结果；当聚焦在文件名上的时候，可以折叠当前文件名下的搜索结果；
    - 当有一个搜索结果被选择时，
        - 按 Enter 来在背景中打开文件；
        - 按 Ctrl+Enter 则是在背景中打开新页面且打开文件；
        - 按 Alt+Enter 则是打开该文件且关闭弹窗；
        - 按 Ctrl+Shift+Alt+Enter 则是用新窗口打开该文件，且关闭弹窗；
    - 当有一个搜索结果被选择时，按 Tab 来在当前弹窗的右侧预览对应的文件，Shift+Tab 则是关闭预览；
    - 当有一个搜索结果被聚焦时，按 Ctrl+Shift+C 来复制选中的搜索结果内容；
    - 当有一个文件正在被预览时，按 Ctrl+E 来切换文件的阅读模式；
    - 当有一个文件正在被预览时，按 Ctrl+G 来从输入框跳转到预览文件的内容中，或从预览文件内容中跳转回输入框；
    - 当有一个文件正在被预览时，按两次 Tab 来跳转到预览文件的内容中，或用 Ctrl+Tab 从预览文件中跳转回输入框；
3. **鼠标点击的行为**：
    - 当存在文件在预览中时：
        - 用鼠标点击新的搜索结果不会再自动关闭弹窗，而是在切换预览文件窗口的文件；
        - 用 Alt+鼠标来打开文件且关闭弹窗；
    - 当不存在文件在预览中时：
        - 用鼠标点击搜索结果自动关闭弹窗且跳转文件夹，其它与 Obsidian 的默认行为一样；
4. **右键菜单可以快速搜索选中的文本**；
5. **有一个默认的 `obsidian://fs?query=xxxxxx` 的 URI 命令，你可以用这个命令来从外部唤起 Float search**
6. **当你在预览文件页面中点击跳转时，会自动覆盖当前的预览文件页面**。

---

## New in 4.4.0

### Faster CMDK search
- The quick-search palette (CMDK) is now debounced (~150ms) and caches file content by path + modification time, so unchanged files are not re-read. This makes repeated and partial typing much more responsive.
- The main float search no longer runs a duplicate search on open — it applies the query once and only adjusts the caret.

### Exclusions (folders / files)
- New **Exclusions** section in the plugin settings with two pill inputs:
  - **Exclude folders**: folders that are skipped in CMDK and the main search.
  - **Exclude files**: specific files to skip.
- Instead of typing the path by hand, a **vault-backed picker** filters real folders/files as you type (powered by Obsidian's own vault API) — pick one and it becomes a pill. Click a pill to remove it.
- Excluded items are filtered from CMDK results and injected as `-path:"folder/"` / `-path:"file"` into the main search query (automatically stripped before saving, so your stored query stays clean).

### Saved searches (presets)
- New **Saved searches** section in the settings: store a `name + query` pair using any Obsidian search syntax (`tag:#项目`, `[status:: 进行中]`, `path:Notes`, etc.).
- Each saved search is exposed three ways:
  1. **CMDK launcher** — open the palette with an empty query to see your presets at the top; pick one to run it immediately.
  2. **Generated command** — a `Saved search: <name>` command is auto-registered for every preset (usable from the command palette and hotkeys).
  3. **Save current** — in CMDK, with a non-empty query, choose *"Save current search as preset"*, give it a name, and it is stored on the fly.

---

## 4.4.0 新功能

### 更快的 CMDK 搜索
- 极速搜索框（CMDK）现已加入约 150ms 防抖，并按「路径 + 修改时间」缓存文件正文，未改动的文件不再重复读取，连续输入与部分输入更跟手。
- 主浮窗打开时不再重复执行一次搜索——只应用一次查询并调整光标位置。

### 排除（文件夹 / 文件）
- 插件设置新增「Exclusions」区，含两组胶囊输入：
  - **排除文件夹**：在 CMDK 与主搜索中跳过的文件夹。
  - **排除文件**：需跳过的指定文件。
- 不再手动输入路径，而是用**仓库原生选择器**：输入时实时筛选真实的文件夹/文件（基于 Obsidian 官方 vault 接口），选中即生成胶囊，点一下删除。
- 被排除项会从 CMDK 结果中滤除，并作为 `-path:"文件夹/"` / `-path:"文件"` 注入主搜索查询（保存前自动剥离，不污染你存储的查询）。

### 预设搜索（Saved searches）
- 设置页新增「Saved searches」区：用任意 Obsidian 搜索语法（`tag:#项目`、`[status:: 进行中]`、`path:Notes` 等）存储「名称 + 查询」。
- 每条预设有三种使用入口：
  1. **CMDK 启动器**——空查询打开极速框时，预设列在顶部，点选即立即执行。
  2. **自动命令**——每条预设会自动注册一条 `Saved search: <名称>` 命令（可用于命令面板与快捷键）。
  3. **随手保存**——在 CMDK 中输入非空查询后，选择「Save current search as preset」，起个名字即可当场存为预设。

---

## New in 4.5.0

### Localization (i18n)
- All plugin UI (settings, prompts, CMDK labels, generated command names) now follows **Obsidian's own language setting**. There is no separate language option — switch Obsidian's language and the plugin follows automatically.
- Currently ships English and 简体中文.

---

## 4.5.0 新功能

### 多语言（i18n）
- 插件所有界面（设置、弹窗、CMDK 标签、自动生成的命令名称）现已**跟随 Obsidian 自身的语言设置**，不再单独提供语言开关——切换 Obsidian 语言，插件自动切换。
- 当前内置英文与简体中文。

---

## 4.6.0 新功能

### 预设搜索 = 筛选芯片（合并）
- 「预设搜索」与「筛选按钮」已合并为**同一功能**：在设置页「预设搜索」中保存一个名称 + 查询条件（如 `Plugin` → `tag:#Plugin`，`Obsidian` → `path:2-输出/5-软件相关/Obsidian`），它就会作为一枚**芯片**出现在 CMDK 结果列表上方。
- 点击芯片即在该 CMDK 界面内**就地筛选**结果，不再跳转到原生搜索；再次点击取消激活。可多选（AND 逻辑）。
- 在 CMDK 输入任意查询后，会出现「保存当前搜索为预设」项，保存后该条件即成为一枚芯片。
- 命令面板中仍会为每个预设生成一条命令（`预设搜索：{名称}`），运行后直接打开 CMDK 并以该预设作为激活筛选。
- 支持的查询语法：`tag:xxx` / `#xxx`、`path:xxx`、`file:xxx` / `name:xxx`，或纯文本（模糊路径匹配）。

---

## Support

If you are enjoying this plugin then please support my work and enthusiasm by buying me a coffee
on [https://www.buymeacoffee.com/boninall](https://www.buymeacoffee.com/boninall).

<a href="https://www.buymeacoffee.com/boninall"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=boninall&button_colour=6495ED&font_colour=ffffff&font_family=Lato&outline_colour=000000&coffee_colour=FFDD00"></a>

