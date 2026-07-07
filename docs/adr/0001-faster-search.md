# ADR-0001: 提速（启动与搜索都更快）

- 状态：Proposed
- 日期：2026-07-07

## Context

用户反馈调起与搜索略卡，希望"随时能顺手调起，不卡"。插件有两套搜索界面，慢点不同：

- **CMDK 极速框**：每次按键（query ≥ 2 字）都异步遍历 `vault.getFiles()` 全部文件，并用 `vault.cachedRead` 逐一读取每个 md 全文做 `simpleSearch`。库大时必然卡顿；且 `updateSuggestions` 无输入防抖，每次按键都重扫。
- **主浮窗**：封装原生 `search` 视图，本身走核心索引较快；慢更可能来自打开/重建路径（`patchSearch` 中 `searchLeaf.rebuildView()`、modal `initSearchView` 连续两次 `setViewState`）。

## Decision

**CMDK 极速框**
1. 输入防抖（约 150ms）后再触发 `updateSuggestions`。
2. 文件内容缓存：首次 `cachedRead` 后按 `file.path` 缓存正文；监听 `vault` 的 `modify`/`rename`/`delete` 事件使对应缓存失效，跨次查询复用。
3. 维持"仅 query.length ≥ 2 才扫描正文"的门控（已有）。
4. 遵守 ADR-0002 的排除项，缩小扫描文件集。

**主浮窗**
5. 优化打开/重建路径：避免重复 `setViewState`/`rebuildView`；若已存在 search leaf 则复用而非重建；`patchSearch` 的去重逻辑确保只 patch 一次。

## Consequences

- 打字与启动明显跟手。
- 内容缓存占用内存，且失效逻辑必须正确（否则显示旧内容）。
- CMDK 仍有结果上限（标题 20 / 正文 20），与提速不冲突。
