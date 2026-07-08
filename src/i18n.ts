import { TFolder, TFile, prepareFuzzySearch } from "obsidian";

/**
 * Localization that follows Obsidian's own language setting.
 * No dedicated language option is exposed — we read the app's locale.
 */

type Lang = "zh" | "en";

let cachedLang: Lang | null = null;

function detectLang(): Lang {
	if (cachedLang) return cachedLang;
	let lang = "";
	const app = (window as any).app;
	try {
		lang =
			app?.vault?.getConfig?.("appearance:language") ??
			(window as any).localStorage?.getItem?.("language") ??
			"";
	} catch {
		lang =
			(window as any).localStorage?.getItem?.("language") ?? "";
	}
	cachedLang = lang && lang.toLowerCase().startsWith("zh") ? "zh" : "en";
	return cachedLang;
}

export function isZh(): boolean {
	return detectLang() === "zh";
}

export function locale(): Lang {
	return detectLang();
}

const dict: Record<string, { en: string; zh: string }> = {
	// Settings tab
	settingsTitle: {
		en: "Float Search Settings",
		zh: "浮窗搜索设置",
	},
	quickSearchTrigger: {
		en: "Quick search trigger",
		zh: "极速搜索触发键",
	},
	quickSearchTriggerDesc: {
		en: "Double-tap this key to open the quick search modal (CMDK).",
		zh: "双击此按键打开极速搜索弹窗（CMDK）。",
	},
	doubleTapInterval: {
		en: "Double-tap interval (ms)",
		zh: "双击间隔（毫秒）",
	},
	doubleTapIntervalDesc: {
		en: "Maximum time between two key presses to trigger quick search. Default: 300ms.",
		zh: "两次按键之间触发极速搜索的最大间隔，默认 300 毫秒。",
	},
	quickCreate: { en: "Quick Create", zh: "快速创建" },
	enableQuickCreate: { en: "Enable quick create", zh: "启用快速创建" },
	enableQuickCreateDesc: {
		en: "When no exact match is found in quick search, show an option to create a new note with the search text as content.",
		zh: "极速搜索无精确匹配时，显示用搜索文本作为内容创建新笔记的选项。",
	},
	quickCreateFolder: {
		en: "Quick create folder",
		zh: "快速创建文件夹",
	},
	quickCreateFolderDesc: {
		en: "Folder to create new notes in. Leave empty for vault root.",
		zh: "新建笔记所在的文件夹，留空则为仓库根目录。",
	},
	titleFormat: { en: "Title format", zh: "标题格式" },
	titleFormatDesc: {
		en: "Timestamp format for the note title. Tokens: YYYY, MM, DD, HH, mm, ss.",
		zh: "笔记标题的时间戳格式，占位符：YYYY、MM、DD、HH、mm、ss。",
	},
	exclusions: { en: "Exclusions", zh: "排除项" },
	excludeFolders: { en: "Exclude folders", zh: "排除文件夹" },
	excludeFoldersDesc: {
		en: "Folders to skip in CMDK and main search. Pick a folder from the list; click a pill to remove.",
		zh: "在 CMDK 与主搜索中跳过的文件夹。从列表中选择，点击胶囊可删除。",
	},
	excludeFiles: { en: "Exclude files", zh: "排除文件" },
	excludeFilesDesc: {
		en: "Specific files to skip. Pick a file from the list; click a pill to remove.",
		zh: "需跳过的指定文件。从列表中选择，点击胶囊可删除。",
	},
	savedSearches: { en: "Saved searches", zh: "预设搜索" },
	addSavedSearch: { en: "Add saved search", zh: "添加预设搜索" },
	addSavedSearchDesc: {
		en: "Save a query as a preset. It appears as a chip above the CMDK results — click it to filter the list inline (no jump to the native search). Also runs from the command palette.",
		zh: "保存一个查询作为预设。它会以芯片形式出现在 CMDK 结果上方——点击即在原列表内筛选（不再跳转到原生搜索）。也可通过命令面板运行。",
	},
	namePlaceholder: {
		en: "Name (e.g. Current project)",
		zh: "名称（如：当前项目）",
	},
	queryPlaceholder: {
		en: "Query (e.g. tag:#project)",
		zh: "查询（如：tag:#项目）",
	},
	add: { en: "Add", zh: "添加" },
	edit: { en: "Edit", zh: "编辑" },
	delete: { en: "Delete", zh: "删除" },
	noSavedSearches: {
		en: "No saved searches yet.",
		zh: "暂无预设搜索。",
	},

	// Pills
	clickToRemove: { en: "Click to remove", zh: "点击删除" },

	// Name prompt modal
	saveAsPreset: { en: "Save search as preset", zh: "保存为预设搜索" },
	presetName: { en: "Preset name", zh: "预设名称" },
	save: { en: "Save", zh: "保存" },
	cancel: { en: "Cancel", zh: "取消" },

	// CMDK items
	savedSearchNote: { en: "Saved search", zh: "预设搜索" },
	saveCurrentTitle: {
		en: "Save current search as preset",
		zh: "保存当前搜索为预设",
	},

	// Command
	savedSearchCmd: {
		en: "Saved search: {name}",
		zh: "预设搜索：{name}",
	},

	// Placeholders
	phInbox: { en: "e.g. Inbox", zh: "例如：收件箱" },
	phTemplates: { en: "e.g. Templates", zh: "例如：Templates" },
	phSecrets: { en: "e.g. Secrets.md", zh: "例如：Secrets.md" },
	phTimestamp: { en: "YYYYMMDDHHmmss", zh: "YYYYMMDDHHmmss" },


};

export function t(
	key: keyof typeof dict | string,
	vars?: Record<string, string | number>
): string {
	const entry = dict[key];
	let s: string;
	if (!entry) {
		s = key;
	} else {
		s = detectLang() === "zh" ? entry.zh : entry.en;
	}
	if (vars) {
		for (const k of Object.keys(vars)) {
			s = s.split(`{${k}}`).join(String(vars[k]));
		}
	}
	return s;
}
