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
- 预设的查询**直接复用 Obsidian 原生搜索引擎**求值，因此支持**任意 Obsidian 搜索语法**（多标签组合、`-` 排除、`property:`、`line:`、`content:`、全文、路径等），与你在本体搜索里写的内容完全一致。

---

## New in 4.7.0

### Fixed tag filtering for chips (presets)
- Chip (preset) filters that target tags now resolve directly against Obsidian's **cached metadata** (`metadataCache`), so they match the native search exactly — including:
  - **Tags with emoji / special characters in the name** (e.g. a preset stored as `📬/笔记` correctly matches the real tag `#📬/笔记`, where the emoji is part of the tag).
  - **Nested tags** — a filter `#项目` also matches `#项目/子` and deeper levels.
- Previously tag chips fell back to fuzzy filename matching, so anything beyond a plain `tag:#x` would silently return zero results. Tag queries are now precomputed once into a match set and applied as an exact set membership test, which is also faster for multi-chip (AND) filtering.
- Non-tag queries (`path:`, `file:`, `name:`, plain text) still use the original lightweight `fileMatchesFilter` path.

### Unified `SearchFilter` module
All chip / preset matching now lives in a single `SearchFilter` class (`src/searchFilter.ts`). A filter string is split into space-separated **clauses**, each addressing one dimension, AND-ed together. Supported clause types:
- `tag:项目` / `#项目` — tag (nested-aware, emoji-safe; also matches tags stored in ANY frontmatter property, not just inline `#tag`).
- `path:Notes` — path prefix.
- `folder:Notes` — containing folder only.
- `file:foo` / `name:foo` — filename.
- `status::进行中` / `[status::进行中]` / `prop:status:进行中` — frontmatter / inline property (value optional → key existence).
- `line:文字` / `block:块ID` / `section:标题` / `content:正文` / `task:待办` — **content operators** (read the file body; matched in the async content phase).
- plain text — fuzzy on path, also tried as a tag (presets may omit `#`).
- `-` prefix negates any clause (`-tag:done`, `-path:Drafts`, `-"some phrase"`).
- `"quoted phrases"` — exact multi-word text.
- `OR` — OR between groups (space = AND within a group).

This is the **full Obsidian Query Language**: e.g. `tag:#📬/笔记 path:滴答清单 -tag:归档 OR content:会议纪要`. The float search input parses it **live** — no longer treated as a raw filename fuzzy string. (Saved chips / presets use the same engine.)

Chips are single-select (mutually exclusive): selecting one deactivates any other active chip, and clicking the active chip again clears it. (The planned *collection block* UI that would combine multiple filters at once is still future work.)

---

## 4.7.0 新功能

### 修复芯片（预设）的标签筛选
- 以标签为目标的芯片筛选现在直接基于 Obsidian 的**缓存元数据**（`metadataCache`）求值，与原生搜索完全一致，支持：
  - **标签名含 emoji / 特殊字符**（例如预设存为 `📬/笔记` 也能正确命中真实标签 `#📬/笔记`，其中 emoji 是标签名的一部分）。
  - **嵌套标签** —— 筛选 `#项目` 会同时命中 `#项目/子` 及更深层。
- 此前标签芯片会退化为模糊文件名匹配，任何非纯 `tag:#x` 的写法都会静默返回 0 结果。现在标签查询会一次性预计算成命中集合，并以精确的集合成员判断应用，多芯片（AND）筛选也更高效。
- 非标签查询（`path:`、`file:`、`name:`、纯文本）仍走原有的轻量 `fileMatchesFilter` 逻辑。

### 统一的 `SearchFilter` 模块
所有芯片 / 预设的匹配逻辑现已统一收进 `src/searchFilter.ts` 的 `SearchFilter` 类。一条筛选串会被切成空格分隔的**子句（clause）**，每个子句只对应一个维度，多个子句之间为 AND。支持的子句类型：
- `tag:项目` / `#项目` —— 标签（支持嵌套、emoji 安全；也匹配存在**任意 frontmatter 属性**里的标签，不限于行内 `#tag`）。
- `path:Notes` —— 路径前缀。
- `folder:Notes` —— 仅匹配所在文件夹。
- `file:foo` / `name:foo` —— 文件名。
- `status::进行中` / `[status::进行中]` / `prop:status:进行中` —— frontmatter / 行内属性（可只写 key 判存在）。
- `line:文字` / `block:块ID` / `section:标题` / `content:正文` / `task:待办` —— **内容类算子**（读取正文，在异步内容阶段匹配）。
- 纯文本 —— 路径模糊匹配，同时尝试当标签（预设可省略 `#`）。
- `-` 前缀 —— 取反任意子句（`-tag:done`、`-path:Drafts`、`-"某短语"`）。
- `"引号短语"` —— 多词精确文本。
- `OR` —— 组间「或」（组内空格为「与」）。

这等同于 **Obsidian 完整 Query 语法**：例如 `tag:#📬/笔记 path:滴答清单 -tag:归档 OR content:会议纪要`。浮窗**输入框**会实时解析——不再被当作一整串文件名模糊串。保存的芯片 / 预设用的是同一套引擎。

芯片为**单选互斥**：选中一枚会取消其它已激活的芯片，再次点击已激活的芯片则取消。 （计划中的、可同时组合多个筛选的**区块（collection block）** UI 仍是后续工作。）

---

## New in 4.8.0

### Saved searches: inline edit & polish
- **Inline editing** — each saved search row now has an **Edit** button that turns the row into `name` / `query` inputs inline; **Save** commits, **Cancel** discards. No more delete-and-re-create to fix a typo.
- **Mutually exclusive chips** — in the float search / CMDK filter bar the chips are now single-select: picking one deactivates the others, and clicking the active chip clears it. (See the 4.7.0 note above.)
- **Right-aligned actions** — the Edit / Delete buttons on each saved-search row now sit on the right edge instead of being centered.
- **No scroll jump on save** — adding / editing / deleting a saved search now re-renders only the list, so the settings page no longer scrolls back to the top.

### Performance (load & read faster)
- **Parse each filter once** — `SearchFilter` now memoises parsed queries, so chip / preset matching no longer re-parses the same query for every file (was N×F redundant parses on large vaults).
- **Chip matching snapshots metadata once** — `buildMatchSets` now reads each file's cached metadata a single time (N lookups) instead of N×F, which was the dominant cost of chip filtering on big vaults.
- **Warm, plugin-scoped content cache** — the file-body cache is no longer cleared on every CMDK open and is shared across all openings; it is invalidated per-path on vault changes and capped with a simple LRU. Repeated opens almost never re-read bodies.
- **Cached candidate file set** — the scanned + exclusion-filtered file list is built once and reused across keystrokes (exclusion lists normalised a single time), rebuilt lazily on vault changes.
- **No duplicate metadata test** — the heading search phase reuses the metadata pass-set computed in the main scan instead of re-evaluating `matchMetadata` per file.
- **Lazy prototype patches** — the search-view monkeypatches are now installed on first use, not at every startup.

---

## 4.8.0 新功能

### 预设搜索：内联编辑与细节打磨
- **内联编辑** —— 每条预设后方新增「编辑」按钮，点击后该行就地变为「名称 / 查询」输入框，「保存」提交、「取消」放弃，不必再删了重建来改错别字。
- **芯片互斥单选** —— 浮窗 / CMDK 筛选栏里的芯片改为单选：选一枚会取消其它已选项，点击已激活的芯片则取消（见上方 4.7.0 说明）。
- **操作按钮靠右** —— 预设列表每行的「编辑 / 删除」按钮现统一靠右对齐，不再居中。
- **保存不再回滚** —— 新增 / 编辑 / 删除预设现在只局部重渲染列表，设置页不会跳回顶部。

### 性能（加载更快 / 读取更快）
- **筛选串只解析一次** —— `SearchFilter` 现在缓存解析结果，芯片 / 预设匹配不再对每个文件重复解析同一条查询（大库下原先是 N×F 次冗余解析）。
- **芯片匹配只取一次元数据** —— `buildMatchSets` 现在每个文件只读取一次缓存元数据（N 次），而非 N×F 次，这是大库下芯片筛选的主要开销来源。
- **温热且插件级的正文缓存** —— 正文缓存不再在每次打开 CMDK 时清空，而是跨多次打开共享；按路径在 vault 变更时失效，并用简单 LRU 限容。反复调起几乎不再重读正文。
- **候选文件集缓存** —— 扫描 + 排除过滤后的文件集只构建一次并在按键间复用（排除项也只归一化一次），vault 变更时惰性重建。
- **不再重复元数据判定** —— 标题搜索阶段复用主扫描已算出的"通过元数据"集合，不再对每个文件重跑 `matchMetadata`。
- **原型补丁懒加载** —— 搜索视图的 monkeypatch 改为首次使用时安装，而非每次启动都装。

---

## Support

If you are enjoying this plugin then please support my work and enthusiasm by buying me a coffee
on [https://www.buymeacoffee.com/boninall](https://www.buymeacoffee.com/boninall).

<a href="https://www.buymeacoffee.com/boninall"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=boninall&button_colour=6495ED&font_colour=ffffff&font_family=Lato&outline_colour=000000&coffee_colour=FFDD00"></a>

