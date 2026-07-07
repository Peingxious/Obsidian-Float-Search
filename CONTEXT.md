# CONTEXT.md

Obsidian Float Search 插件的领域词表（glossary）。新功能/重构请沿用这些术语，不要自行造词。

## 两套搜索界面（Search surfaces）

1. **主浮窗 / 原生搜索视图（Main Float Search）**
   完整搜索视图，封装 Obsidian 内置 `search` 视图。理解 `tag:`、`path:`、`file:`、`[property:]` 等**全部**搜索语法，结果走核心索引，已较快。
2. **CMDK 极速框（Quick Search / CMDK）**
   双击触发键打开的极速查找框（`FloatSearchCmdkModal`）。用自有模糊/子串引擎扫文件名、标题、正文；**不识别** Obsidian 搜索运算符（如 `tag:`、`[prop:]`）。

## 术语

- **Float Search（浮窗搜索）** — 本插件整体：把搜索包进可悬浮面板（modal / 侧栏 / split / tab / window）。
- **预设搜索（Saved Search / Preset）** — 用户储存的 `{ 名称, 查询 }` 对。查询可以是属性（`[status:: 进行中]`）、标签（`tag:#项目`）或任意 Obsidian 搜索语法。
- **排除项（Exclusion）** — 从搜索中剔除的文件夹路径，或文件路径 / 扩展名。
- **胶囊（Pill / Chip）** — 设置页里展示排除项（及可选展示预设）的可点删除小标签 UI；点一下即移除，回车即添加。
