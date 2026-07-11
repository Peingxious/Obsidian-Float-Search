import {
	addIcon,
	App,
	Editor,
	ExtraButtonComponent,
	Keymap,
	Menu,
	MenuItem,
	Modal,
	ObsidianProtocolData,
	OpenViewState,
	PaneType,
	AbstractInputSuggest,
	Plugin,
	prepareFuzzySearch,
	prepareSimpleSearch,
	renderResults,
	SearchResult,
	requireApiVersion,
	Scope,
	SearchView,
	setIcon,
	PluginSettingTab,
	Setting,
	SuggestModal,
	TAbstractFile,
	TFolder,
	TFile,
	ViewStateResult,
	Workspace,
	WorkspaceContainer,
	WorkspaceItem,
	WorkspaceLeaf,
} from "obsidian";
import { EmbeddedView, isEmebeddedLeaf, spawnLeafView } from "./leafView";
import { SearchFilter, parseQuery, requiresContent, type Query, type Clause } from "./searchFilter";
import { around } from "monkey-around";
import { debounce } from "obsidian";
import { t } from "./i18n";

type sortOrder =
	| "alphabetical"
	| "alphabeticalReverse"
	| "byModifiedTime"
	| "byModifiedTimeReverse"
	| "byCreatedTime"
	| "byCreatedTimeReverse";

type searchType = "modal" | "sidebar" | PaneType;

interface viewType {
	type: searchType;
	icon: string;
}

interface searchState extends Record<string, unknown> {
	collapseAll?: boolean;
	explainSearch?: boolean;
	extraContext?: boolean;
	matchingCase?: boolean;
	query: string;
	sortOrder?: sortOrder;
	current?: boolean;
}

type CmdkTriggerKey = "Shift" | "Control" | "Alt" | "Meta" | "none";

interface SavedSearch {
	name: string;
	query: string;
}

interface FloatSearchSettings {
	searchViewState: searchState;
	showFilePath: boolean;
	showInstructions: boolean;
	defaultViewType: searchType;
	cmdkTriggerKey: CmdkTriggerKey;
	cmdkDoubleTapInterval: number;
	cmdkQuickCreate: boolean;
	cmdkQuickCreateFolder: string;
	cmdkQuickCreateTitleFormat: string;
	excludeFolders: string[];
	excludeFiles: string[];
	savedSearches: SavedSearch[];
}

const DEFAULT_SETTINGS: FloatSearchSettings = {
	searchViewState: {
		collapseAll: false,
		explainSearch: false,
		extraContext: false,
		matchingCase: false,
		query: "",
		sortOrder: "alphabetical",
	},
	showFilePath: false,
	showInstructions: true,
	defaultViewType: "modal",
	cmdkTriggerKey: "Shift",
	cmdkDoubleTapInterval: 300,
	cmdkQuickCreate: false,
	cmdkQuickCreateFolder: "",
	cmdkQuickCreateTitleFormat: "YYYYMMDDHHmmss",
	excludeFolders: [],
	excludeFiles: [],
	savedSearches: [],
};

// Single plugin instance, used to apply exclusion rules inside module-scope helpers
// (e.g. initSearchViewWithLeaf) that don't otherwise have access to the plugin.
let activePlugin: FloatSearchPlugin | null = null;

const allViews: viewType[] = [
	{
		type: "modal",
		icon: "square-equal",
	},
	{
		type: "sidebar",
		icon: "panel-left-inactive",
	},
	{
		type: "split",
		icon: "split-square-horizontal",
	},
	{
		type: "tab",
		icon: "panel-top",
	},
	{
		type: "window",
		icon: "app-window",
	},
];

const initSearchViewWithLeaf = async (
	app: App,
	type: PaneType | "sidebar",
	state?: searchState
) => {
	const leaf =
		type === "sidebar"
			? app.workspace.getLeftLeaf(false)
			: app.workspace.getLeaf(type);
	leaf?.setPinned(type !== "sidebar");
	await leaf?.setViewState({
		type: "search",
		active: true,
		state: {
			...DEFAULT_SETTINGS.searchViewState,
			...state,
			query: activePlugin
				? activePlugin.withExclusion(
						new SearchFilter(app).toNativeQuery(
							(state?.query as string) ?? ""
						)
				  )
				: new SearchFilter(app).toNativeQuery(
						(state?.query as string) ?? ""
				  ),
			triggerBySelf: true,
		},
	});

	setTimeout(() => {
		const inputEl = leaf?.containerEl.getElementsByTagName("input")?.[0];
		inputEl?.focus();
	}, 0);
};

export default class FloatSearchPlugin extends Plugin {
	settings: FloatSearchSettings;
	private state: searchState;
	private modal: FloatSearchModal;
	private cmdkModal: FloatSearchCmdkModal;

	allLoaded: boolean = false;
	queryLoaded: boolean = false;

	patchedDomChildren = false;

	public applySettingsUpdate = debounce(async () => {
		if (!this.allLoaded) {
			this.allLoaded = true;
			return;
		}
		// Ensure all searchState properties are preserved
		this.settings.searchViewState = {
			...DEFAULT_SETTINGS.searchViewState,
			...this.settings.searchViewState,
			query: this.state?.query || "",
		};
		await this.saveSettings();
	}, 1000);

	private applyStateUpdate = debounce(() => {
		// Preserve all state properties when updating
		this.state = {
			...DEFAULT_SETTINGS.searchViewState,
			...this.state,
			query: "",
		};
	}, 30000);

	async onload() {
		await this.loadSettings();
		activePlugin = this;

		this.app.workspace.onLayoutReady(() => {
			this.initState();
			this.registerIcons();
			// The prototype monkeypatches (patchWorkspace / patchSearchView / …)
			// are deferred to first use via ensurePatched() — they are only
			// needed once the user actually opens a float search, so we no
			// longer pay for them at every startup (candidate ⑤).
			this.registerDoubleKeyHandler();
		});

		this.registerContentCacheInvalidation();

		this.registerObsidianURIHandler();
		this.registerObsidianCommands();
		this.registerEditorMenuHandler();
		this.registerContextMenuHandler();

		this.addRibbonIcon(
			"search",
			`Search obsidian in ${this.settings.defaultViewType} view`,
			() => {
				this.ensurePatched();
				if (this.settings.defaultViewType === "modal") {
					this.initModal(this.state, true, true);
				} else {
					initSearchViewWithLeaf(
						this.app,
						this.settings.defaultViewType,
						{
							...this.state,
							query: "",
						}
					);
				}
			}
		);
		this.updateFilePathVisibility();
		this.addSettingTab(new FloatSearchSettingTab(this.app, this));
	}

	onunload() {
		// this.state = DEFAULT_SETTINGS.searchViewState;
		this.modal?.close();
	}

	// Candidate ④: warm, plugin-scoped content cache shared across every CMDK
	// open (no longer cleared on each open). Invalidated per-path on vault
	// changes; capped with a simple LRU to bound memory.
	public contentCache = new Map<string, { mtime: number; text: string }>();
	private readonly CONTENT_CACHE_MAX = 2000;

	cacheFileContent(path: string, mtime: number, text: string) {
		if (this.contentCache.size >= this.CONTENT_CACHE_MAX) {
			const oldest = this.contentCache.keys().next().value;
			if (oldest !== undefined) this.contentCache.delete(oldest);
		}
		this.contentCache.set(path, { mtime, text });
	}

	private registerContentCacheInvalidation() {
		this.registerEvent(
			this.app.vault.on("modify", (f) => this.contentCache.delete(f.path))
		);
		this.registerEvent(
			this.app.vault.on("rename", (_f, oldPath) =>
				this.contentCache.delete(oldPath)
			)
		);
		this.registerEvent(
			this.app.vault.on("delete", (f) => this.contentCache.delete(f.path))
		);
	}

	// Candidate ⑤: run the prototype monkeypatches exactly once, on first use,
	// instead of unconditionally at every startup.
	private patched = false;
	private ensurePatched() {
		if (this.patched) return;
		this.patched = true;
		this.patchWorkspace();
		this.patchWorkspaceLeaf();
		this.patchSearchView();
		this.patchVchildren();
		this.patchDragManager();
		this.patchEditorHighlights();
	}

	// Obsidian's search addon calls removeHighlights()/hasHighlight() on every
	// markdown editor whenever a search runs. Editors created inside the
	// embedded (HoverPopover) preview leaf may not have the search-highlight
	// StateField registered in their CodeMirror state, so `state.field(...)`
	// throws "Field is not present in this state" and crashes the app. Wrap
	// both methods defensively so the embedded preview can never crash Obsidian
	// — when the field is absent there are simply no highlights to manage.
	private patchEditorHighlights() {
		const proto = Editor.prototype as any;
		for (const name of ["removeHighlights", "hasHighlight"] as const) {
			const orig = proto[name];
			if (!orig || orig.__fsPatched) continue;
			proto[name] = function (...args: any[]) {
				try {
					return orig.apply(this, args);
				} catch (e) {
					if (
						e instanceof RangeError &&
						/Field is not present in this state/.test(
							e.message
						)
					) {
						return name === "hasHighlight" ? false : undefined;
					}
					throw e;
				}
			};
			proto[name].__fsPatched = true;
		}
	}

	registerDoubleKeyHandler() {
		let lastKeyUp = 0;
		let keyOnly = true;

		this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
			const triggerKey = this.settings.cmdkTriggerKey;
			if (triggerKey === "none" || e.key !== triggerKey) {
				keyOnly = false;
			}
		});

		this.registerDomEvent(document, "keyup", (e: KeyboardEvent) => {
			const triggerKey = this.settings.cmdkTriggerKey;
			if (triggerKey === "none") return;
			if (e.key === triggerKey) {
				const now = Date.now();
				if (
					keyOnly &&
					now - lastKeyUp < this.settings.cmdkDoubleTapInterval &&
					!document.querySelector(
						".float-search-cmdk-container"
					)
				) {
					lastKeyUp = 0;
					this.openCmdkModal();
				} else {
					lastKeyUp = now;
					keyOnly = true;
				}
			}
		});
	}

	openCmdkModal(initialFilters?: string[]) {
		this.ensurePatched();
		if (this.cmdkModal) {
			this.cmdkModal.close();
		}
		this.cmdkModal = new FloatSearchCmdkModal(this, initialFilters);
		this.cmdkModal.open();
	}

	updateFilePathVisibility() {
		const { showFilePath } = this.settings;
		document.body.toggleClass("show-file-path", showFilePath);
	}

	changeFilePathVisibility() {
		this.settings.showFilePath = !this.settings.showFilePath;
		this.updateFilePathVisibility();
		this.applySettingsUpdate();
	}

	// ── Exclusion helpers ──────────────────────────────────────────────
	private normalizePath(p: string): string {
		return p.trim().replace(/^\/+/, "").replace(/\/+$/, "");
	}

	buildExcludeClause(): string {
		const parts: string[] = [];
		for (const raw of this.settings.excludeFolders) {
			const p = this.normalizePath(raw);
			if (p) parts.push(`-path:"${p}/"`);
		}
		for (const raw of this.settings.excludeFiles) {
			const p = this.normalizePath(raw);
			if (p) parts.push(`-path:"${p}"`);
		}
		return parts.join(" ");
	}

	withExclusion(query: string): string {
		const clause = this.buildExcludeClause();
		const q = (query ?? "").trim();
		if (!clause) return q;
		if (q.includes(clause)) return q;
		return q ? `${q} ${clause}` : clause;
	}

	stripExclusion(query: string): string {
		const clause = this.buildExcludeClause();
		let q = query ?? "";
		if (clause) q = q.split(clause).join("");
		return q.replace(/\s+/g, " ").trim();
	}

	isFileExcluded(file: TFile): boolean {
		const folders = this.settings.excludeFolders
			.map((f) => this.normalizePath(f))
			.filter(Boolean);
		const files = this.settings.excludeFiles
			.map((f) => this.normalizePath(f))
			.filter(Boolean);
		const path = file.path;
		if (
			files.some((f) => f === path || f === file.name)
		)
			return true;
		if (
			folders.some((f) => path === f || path.startsWith(f + "/"))
		)
			return true;
		return false;
	}

	// ── Saved searches ────────────────────────────────────────────────
	private slug(name: string): string {
		return (
			name
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "") || "x"
		);
	}

	private registeredSavedIds = new Set<string>();

	registerSavedSearchCommands() {
		for (const s of this.settings.savedSearches) {
			const id = "savedsearch-" + this.slug(s.name);
			if (this.registeredSavedIds.has(id)) continue;
			this.registeredSavedIds.add(id);
			this.addCommand({
				id,
				name: t("savedSearchCmd", { name: s.name }),
				callback: () => this.openCmdkModal([s.query]),
			});
		}
	}

	addSavedSearch(name: string, query: string) {
		this.settings.savedSearches.push({ name, query });
		this.saveSettings();
		this.registerSavedSearchCommands();
	}

	// Open the main Float Search (modal or configured view) with a query.
	// Exclusion rules are applied automatically by the target search view.
	openSearchWithQuery(query: string) {
		this.ensurePatched();
		const viewType = this.settings.defaultViewType;
		const nativeQuery = new SearchFilter(this.app).toNativeQuery(query);
		const state = { ...this.state, query: nativeQuery, current: true };
		if (viewType === "modal") {
			this.initModal(state, true, false);
		} else {
			initSearchViewWithLeaf(
				this.app,
				viewType as PaneType | "sidebar",
				state
			);
		}
	}

	initState() {
		// Initialize state with all default properties
		this.state = {
			...DEFAULT_SETTINGS.searchViewState,
			...this.settings.searchViewState,
		};
	}

	initModal(
		state: searchState,
		stateSave: boolean = false,
		clearQuery: boolean = false
	) {
		this.ensurePatched();
		if (this.modal) {
			this.modal.close();
		}

		this.modal = new FloatSearchModal(
			(state) => {
				// Preserve all state properties when updating from modal
				this.state = {
					...DEFAULT_SETTINGS.searchViewState,
					...state,
				};
				if (stateSave) this.applyStateUpdate();
				this.settings.searchViewState = this.state;
				this.applySettingsUpdate();
			},
			this,
			{ ...state, query: clearQuery ? "" : state.query }
		);
		this.modal.open();
	}

	patchWorkspace() {
		let layoutChanging = false;
		const self = this;
		const uninstaller = around(Workspace.prototype, {
			getLeaf: (next) =>
				function (...args) {
					const activeLeaf = (this as Workspace).activeLeaf;
					if (activeLeaf?.parent) {
						// @ts-ignore
						const fsCtnEl = (
							activeLeaf.parent.containerEl as HTMLElement
						).parentElement;
						if (fsCtnEl?.hasClass("fs-content")) {
							if (activeLeaf.view.getViewType() === "markdown") {
								return activeLeaf;
							}

							const newLeaf =
								self.app.workspace.getMostRecentLeaf();

							if (newLeaf) {
								this.setActiveLeaf(newLeaf);
							}
						}
						return next.call(this, ...args);
					}
					return next.call(this, ...args);
				},
			changeLayout(old) {
				return async function (workspace: unknown) {
					layoutChanging = true;
					try {
						// Don't consider hover popovers part of the workspace while it's changing
						await old.call(this, workspace);
					} finally {
						layoutChanging = false;
					}
				};
			},
			iterateLeaves(old) {
				type leafIterator = (item: WorkspaceLeaf) => boolean | void;
				return function (arg1, arg2) {
					// Fast exit if desired leaf found
					if (old.call(this, arg1, arg2)) return true;

					// Handle old/new API parameter swap
					const cb: leafIterator = (
						typeof arg1 === "function" ? arg1 : arg2
					) as leafIterator;
					const parent: WorkspaceItem = (
						typeof arg1 === "function" ? arg2 : arg1
					) as WorkspaceItem;

					if (!parent) return false; // <- during app startup, rootSplit can be null
					if (layoutChanging) return false; // Don't let HEs close during workspace change

					// 0.14.x doesn't have WorkspaceContainer; this can just be an instanceof check once 15.x is mandatory:

					if (!requireApiVersion("0.15.0")) {
						if (
							parent === self.app.workspace.rootSplit ||
							(WorkspaceContainer &&
								parent instanceof WorkspaceContainer)
						) {
							for (const popover of EmbeddedView.popoversForWindow(
								(parent as WorkspaceContainer).win
							)) {
								// Use old API here for compat w/0.14.x
								if (old.call(this, cb, popover.rootSplit))
									return false;
							}
						}
					}
					return false;
				};
			},
			setActiveLeaf(old) {
				return function (leaf: any, params?: any) {
					if (isEmebeddedLeaf(leaf)) {
						old.call(this, leaf, params);
						leaf.activeTime = 1700000000000;
					}
					return old.call(this, leaf, params);
				};
			},
			pushUndoHistory(old: any) {
				return function (
					leaf: WorkspaceLeaf,
					id: string,
					...args: any[]
				) {
					const viewState = leaf.getViewState();
					if (viewState.type === "search") {
						return;
					}
					return old.call(this, leaf, id, ...args);
				};
			},
		});
		this.register(uninstaller);
	}

	// Used for patch workspaceleaf pinned behaviors
	patchWorkspaceLeaf() {
		this.register(
			around(WorkspaceLeaf.prototype, {
				getRoot(old) {
					return function () {
						const top = old.call(this);
						return top?.getRoot === this.getRoot
							? top
							: top?.getRoot();
					};
				},
				setPinned(old) {
					return function (pinned: boolean) {
						old.call(this, pinned);
						if (isEmebeddedLeaf(this) && !pinned)
							this.setPinned(true);
					};
				},
				openFile(old) {
					return function (file: TFile, openState?: OpenViewState) {
						if (isEmebeddedLeaf(this)) {
							setTimeout(
								around(Workspace.prototype, {
									recordMostRecentOpenedFile(old) {
										return function (_file: TFile) {
											// Don't update the quick switcher's recent list
											if (_file !== file) {
												return old.call(this, _file);
											}
										};
									},
								}),
								1
							);
							const recentFiles =
								this.app.plugins.plugins[
									"recent-files-obsidian"
								];
							if (recentFiles) {
								setTimeout(
									around(recentFiles, {
										shouldAddFile(old) {
											return function (_file: TFile) {
												// Don't update the Recent Files plugin
												return (
													_file !== file &&
													old.call(this, _file)
												);
											};
										},
									}),
									1
								);
							}
						}

						const view = old.call(this, file, openState);
						setTimeout(() => {
							if (!this.parent) return;
							const fsCtnEl = (
								this.parent.containerEl as HTMLElement
							).parentElement;
							if (!fsCtnEl?.classList.contains("fs-content"))
								return;
							if (file.extension != "canvas") return;

							const canvas = this.view.canvas;
							setTimeout(() => {
								if (canvas && openState?.eState?.match) {
									let node = canvas.data.nodes?.find(
										(e: any) =>
											e.text ===
											(openState?.eState as any)?.match
												?.content
									);
									if (node) {
										node = canvas.nodes.get(node.id);
										canvas.selectOnly(node);
										canvas.zoomToSelection();
									}
								}
							}, 20);
						}, 1);

						return view;
					};
				},
			})
		);
	}

	patchSearchView() {
		const checkCurrentViewType = (leaf: WorkspaceLeaf) => {
			const isModal =
				document.querySelector(".float-search-modal") !== null;
			const currentLeafRoot = leaf.getRoot();
			if (
				currentLeafRoot?.side &&
				(currentLeafRoot?.side === "left" ||
					currentLeafRoot?.side === "right")
			)
				return "sidebar";
			if (leaf.getContainer()?.type === "window") return "window";
			return isModal ? "modal" : "split";
		};

		const initViewMenu = (
			menu: Menu,
			current: searchType,
			originLeaf?: WorkspaceLeaf
		) => {
			menu.dom.toggleClass("float-search-view-menu", true);
			let availableViews = allViews.filter((view) => {
				if (current === "split") {
					return view.type !== "tab";
				} else {
					return view.type !== current;
				}
			});
			for (const view of availableViews) {
				menu.addItem((item: MenuItem) => {
					item.setTitle(`${view.type} view`)
						.setIcon(`${view.icon}`)
						.onClick(async () => {
							if (view.type === "modal") {
								originLeaf?.detach();
								setTimeout(() => {
									this.initModal(this.state, true, false);
								}, 10);
							} else if (view.type === "sidebar") {
								await initSearchViewWithLeaf(
									this.app,
									view.type,
									this.state
								);
							} else {
								if (current === "window") {
									originLeaf?.detach();
									setTimeout(async () => {
										await initSearchViewWithLeaf(
											this.app,
											<"tab" | "split">view.type,
											this.state
										);
									}, 10);
								} else {
									await initSearchViewWithLeaf(
										this.app,
										view.type,
										this.state
									);
								}
							}
							if (current === "modal") {
								this.modal.close();
							} else {
								originLeaf?.detach();
							}
						});
				});
			}
			return menu;
		};

		const patchSearch = async () => {
			const searchLeaf = this.app.workspace.getLeavesOfType("search")[0];
			if (!searchLeaf) return false;
			if (requireApiVersion("1.7.3") && searchLeaf.isDeferred) {
				await searchLeaf.loadIfDeferred();
			}

			const searchView = searchLeaf?.view as any;
			const self = this;

			if (!searchView) return false;

			const searchViewConstructor = searchView.constructor;

			this.register(
				around(searchViewConstructor.prototype, {
					onOpen(old) {
						return function () {
							old.call(this);

							const viewSwitchEl = createDiv({
								cls: "float-search-view-switch",
							});
							const targetEl = this.filterSectionToggleEl;
							const viewSwitchButton = new ExtraButtonComponent(
								viewSwitchEl
							);
							viewSwitchButton
								.setIcon("layout-template")
								.setTooltip("Switch to File View");
							viewSwitchButton.onClick(() => {
								const currentType = checkCurrentViewType(
									this.leaf
								);
								const layoutMenu = initViewMenu(
									new Menu(),
									currentType,
									this.leaf
								);
								const viewSwitchButtonPos =
									viewSwitchEl.getBoundingClientRect();
								layoutMenu.showAtPosition({
									x: viewSwitchButtonPos.x,
									y: viewSwitchButtonPos.y + 30,
								});
							});
							targetEl.parentElement.insertBefore(
								viewSwitchEl,
								targetEl
							);
							if (!this.hidePathToggle) {
								this.hidePathToggle = new Setting(
									this.searchParamsContainerEl
								)
									.setName("Show file path")
									.addToggle((toggle) => {
										toggle.toggleEl.toggleClass(
											"mod-small",
											true
										);
										toggle
											.setValue(
												self.settings.showFilePath
											)
											.onChange(async (value) => {
												self.settings.showFilePath =
													!value;
												self.changeFilePathVisibility();
												self.applySettingsUpdate();
											});
									});
							}
							if (!this.showInstructionsToggle) {
								this.showInstructionsToggle = new Setting(
									this.searchParamsContainerEl
								)
									.setName("Show instructions")
									.addToggle((toggle) => {
										toggle.toggleEl.toggleClass(
											"mod-small",
											true
										);
										toggle
											.setValue(
												self.settings.showInstructions
											)
											.onChange(async (value) => {
												self.settings.showInstructions =
													value;
												self.applySettingsUpdate();
											});
									});
							}
							if (!this.defaultViewTypeDropdown) {
								this.defaultViewTypeDropdown = new Setting(
									this.searchParamsContainerEl
								)
									.setName("Default view type")
									.addDropdown((dropdown) => {
										dropdown.addOptions({
											modal: "Modal",
											split: "Split",
											tab: "Tab",
											window: "Window",
											sidebar: "Sidebar",
										});
										dropdown.setValue(
											self.settings.defaultViewType
										);
										dropdown.onChange((value) => {
											self.settings.defaultViewType =
												value as searchType;
											self.applySettingsUpdate();
										});
									});
							}
						};
					},
					setExplainSearch(old) {
						return function (value: boolean) {
							old.call(this, value);
							if (self.app.workspace.layoutReady) {
								self.settings.searchViewState.explainSearch =
									value;
								self.applySettingsUpdate();
							}
						};
					},
					setCollapseAll(old) {
						return function (value: boolean) {
							old.call(this, value);
							if (self.app.workspace.layoutReady) {
								self.settings.searchViewState.collapseAll =
									value;
								self.applySettingsUpdate();
							}
						};
					},
					setExtraContext(old) {
						return function (value: boolean) {
							old.call(this, value);
							if (self.app.workspace.layoutReady) {
								self.settings.searchViewState.extraContext =
									value;
								self.applySettingsUpdate();
							}
						};
					},
					setMatchingCase(old) {
						return function (value: boolean) {
							old.call(this, value);
							if (self.app.workspace.layoutReady) {
								self.settings.searchViewState.matchingCase =
									value;
								self.applySettingsUpdate();
							}
						};
					},
					setSortOrder(old) {
						return function (value: string) {
							old.call(this, value);
							if (self.app.workspace.layoutReady) {
								self.settings.searchViewState.sortOrder =
									value as sortOrder;
								self.applySettingsUpdate();
							}
						};
					},
					setQuery(old) {
						return function (value: string) {
							old.call(this, value);
							if (self.app.workspace.layoutReady) {
								self.settings.searchViewState.query =
									self.stripExclusion(value);
								self.applySettingsUpdate();
							}
						};
					},
					setState(old) {
						return function (
							state: any,
							eState: Record<string, unknown>
						) {
							if (
								typeof state.query === "string" &&
								!state?.triggerBySelf
							) {
								if (self.queryLoaded) {
									if (
										self.settings.defaultViewType ===
										"modal"
									) {
										self.initModal(
											{
												...state,
												query: state.query,
												current: false,
												triggerBySelf: true,
											},
											true,
											false
										);
									} else {
										initSearchViewWithLeaf(
											self.app,
											self.settings.defaultViewType,
											{
												...state,
												query: state.query,
												current: false,
												triggerBySelf: true,
											}
										);
									}

									return;
								}

								self.queryLoaded = true;
							}

							old.call(this, state, eState);
						};
					},
				})
			);
			searchView.leaf?.rebuildView();
			return true;
		};
		this.app.workspace.onLayoutReady(async () => {
			if (!(await patchSearch())) {
				const evt = this.app.workspace.on("layout-change", async () => {
					(await patchSearch()) && this.app.workspace.offref(evt);
				});
				this.registerEvent(evt);
			}
		});
	}

	patchVchildren() {
		const patchSearchDom = () => {
			const searchView = this.app.workspace.getLeavesOfType("search")[0]
				?.view as any;
			if (!searchView) return false;

			const dom = searchView.dom.constructor;
			const self = this;

			this.register(
				around(dom.prototype, {
					stopLoader(old) {
						return function () {
							old.call(this);
							// console.log(this?.vChildren?.children);
							this?.vChildren?.children?.forEach((child: any) => {
								if (child?.file && !child?.pathEl) {
									const path =
										child?.file.parent?.path || "/";
									const pathEl = createDiv({
										cls: "search-result-file-path",
									});
									const pathIconEl = pathEl.createDiv({
										cls: "search-result-file-path-icon",
									});
									setIcon(pathIconEl, "folder");
									const pathTextEl = pathEl.createDiv({
										cls: "search-result-file-path-text",
										text: path,
									});
									child.pathEl = pathEl;
									const titleEl = child.containerEl.find(
										".search-result-file-title"
									);
									titleEl.prepend(pathEl);
								}
							});
						};
					},
				})
			);
			return true;
		};
		this.app.workspace.onLayoutReady(() => {
			if (!patchSearchDom()) {
				const evt = this.app.workspace.on("layout-change", () => {
					patchSearchDom() && this.app.workspace.offref(evt);
				});
				this.registerEvent(evt);
			}
		});
	}

	patchDragManager() {
		const manager = this.app.dragManager;
		if (!manager) return;
		const self = this;

		this.register(
			around(manager.constructor.prototype, {
				dragFile(old: any) {
					return function (e: any, a: TFile) {
						const result = old.call(this, e, a);

						setTimeout(() => {
							self?.modal?.close();
						}, 10);
						return result;
					};
				},
			})
		);
	}

	registerObsidianURIHandler() {
		/**
		 * Handles obsidian://fs protocol for search functionality
		 *
		 * @param viewType - Where to open search:
		 *   - "modal" (default) - Opens in modal popup
		 *   - "tab" - Opens in new tab
		 *   - "split" - Opens in split pane
		 *   - "window" - Opens in new window
		 *   - "sidebar" - Opens in sidebar
		 * @param query - Search query string
		 *
		 * Examples:
		 * obsidian://fs?query=hello&viewType=modal
		 * obsidian://fs?query=world&viewType=tab
		 * obsidian://fs?query=test (defaults to modal)
		 */
		this.registerObsidianProtocolHandler(
			"fs",
			async (path: ObsidianProtocolData) => {
				const viewType = path.viewType || "modal";
				const query = path.query || "";

				if (viewType === "modal") {
					this.initModal(
						{
							...this.state,
							query,
							current: false,
						},
						true,
						false
					);
				} else {
					await initSearchViewWithLeaf(
						this.app,
						viewType as PaneType | "sidebar",
						{
							...this.state,
							query,
							current: false,
						}
					);
				}
			}
		);
	}

	private createCommand(options: {
		id: string;
		name: string;
		queryBuilder: (file?: TFile) => string;
		global: boolean;
	}): void {
		if (options.global) {
			this.addCommand({
				id: options.id,
				name: options.name,
				callback: () => {
					const query = options.queryBuilder();
					const viewType = this.settings.defaultViewType;

					if (viewType === "modal") {
						this.initModal(
							{ ...this.state, query, current: true },
							true,
							false
						);
					} else {
						initSearchViewWithLeaf(
							this.app,
							viewType as PaneType | "sidebar",
							{
								...this.state,
								query,
								current: true,
							}
						);
					}
				},
			});
		} else {
			this.addCommand({
				id: options.id,
				name: options.name,
				checkCallback: (checking: boolean) => {
					const activeLeaf = this.app.workspace.activeLeaf;
					if (!activeLeaf) return;

					const viewType = activeLeaf.view.getViewType();
					if (viewType === "markdown" || viewType === "canvas") {
						if (!checking) {
							const currentFile = activeLeaf.view.file;
							const query = options.queryBuilder(currentFile);
							const viewType = this.settings.defaultViewType;

							if (viewType === "modal") {
								this.initModal(
									{ ...this.state, query, current: true },
									true,
									false
								);
							} else {
								initSearchViewWithLeaf(
									this.app,
									viewType as PaneType | "sidebar",
									{
										...this.state,
										query,
										current: true,
									}
								);
							}
						}
						return true;
					}
				},
			});
		}
	}

	registerObsidianCommands() {
		this.addCommand({
			id: "show-or-hide-file-path",
			name: "Show/hide file path",
			callback: () => {
				this.changeFilePathVisibility();
			},
		});

		this.addCommand({
			id: "search-obsidian-globally",
			name: "Search obsidian globally",
			callback: () =>
				this.initModal(
					{ ...this.state, query: "", current: false },
					false,
					true
				),
		});

		this.addCommand({
			id: "search-obsidian-globally-state",
			name: "Search Obsidian Globally (With Last State)",
			callback: () =>
				this.initModal(
					{ ...this.state, query: this.state.query, current: false },
					true,
					false
				),
		});

		this.createCommand({
			id: "search-in-backlink",
			name: "Search in backlink Of current file",
			queryBuilder: (file?: TFile) => {
				if (!file) return "";
				return (
					" /\\[\\[" +
					(file.extension === "canvas" ? file.name : file.basename) +
					"(\\|[^\\]]*)?\\]\\]/"
				);
			},
			global: false,
		});

		this.createCommand({
			id: "search-in-current-file",
			name: "Search in current file",
			queryBuilder: (file?: TFile) => {
				if (!file) return "";
				return " path:" + `"${file.path}"`;
			},
			global: false,
		});

		// Register search operator commands
		this.registerSearchOperatorCommands();

		for (const type of ["split", "tab", "window"] as PaneType[]) {
			this.addCommand({
				id: `open-search-view-${type}`,
				name: `Open search view (${type})`,
				callback: async () => {
					const existingLeaf =
						this.app.workspace.getLeavesOfType("search");
					switch (type) {
						case "window":
							// @ts-ignore
							const isExistingWindowLeaf = existingLeaf.find(
								(leaf) =>
									leaf.parentSplit.parent.type === "window"
							);
							if (isExistingWindowLeaf) {
								this.app.workspace.revealLeaf(
									isExistingWindowLeaf
								);
								return;
							}
							await initSearchViewWithLeaf(this.app, type, {
								...this.state,
								triggerBySelf: true,
							});
							break;
						case "tab":
						case "split":
							// @ts-ignore
							const isExistingLeaf = existingLeaf.find(
								(leaf) => !leaf.parentSplit.parent.side
							);
							if (isExistingLeaf) {
								this.app.workspace.revealLeaf(isExistingLeaf);
								isExistingLeaf.setViewState({
									type: "search",
									active: true,
									state: {
										...this.state,
										triggerBySelf: true,
									} as Record<string, unknown>,
								});
								return;
							}
							await initSearchViewWithLeaf(this.app, type, {
								...this.state,
								triggerBySelf: true,
							});
							break;
					}
				},
			});
		}

		this.registerSavedSearchCommands();
	}

	registerSearchOperatorCommands() {
		const searchOperators = [
			{
				id: "search-file-operator",
				name: "Search: file: (Find text in filename)",
				query: "file:",
			},
			{
				id: "search-path-operator",
				name: "Search: path: (Find text in file path)",
				query: "path:",
			},
			{
				id: "search-content-operator",
				name: "Search: content: (Find text in file content)",
				query: "content:",
			},
			{
				id: "search-match-case-operator",
				name: "Search: match-case: (Case-sensitive match)",
				query: "match-case:",
			},
			{
				id: "search-ignore-case-operator",
				name: "Search: ignore-case: (Case-insensitive match)",
				query: "ignore-case:",
			},
			{
				id: "search-tag-operator",
				name: "Search: tag: (Find tag)",
				query: "tag:",
			},
			{
				id: "search-line-operator",
				name: "Search: line: (Find files with matching line)",
				query: "line:",
			},
			{
				id: "search-block-operator",
				name: "Search: block: (Find matches in the same block)",
				query: "block:",
			},
			{
				id: "search-section-operator",
				name: "Search: section: (Find matches in the same section)",
				query: "section:",
			},
			{
				id: "search-task-operator",
				name: "Search: task: (Find matches in a task)",
				query: "task:",
			},
			{
				id: "search-task-todo-operator",
				name: "Search: task-todo: (Find matches in uncompleted tasks)",
				query: "task-todo:",
			},
			{
				id: "search-task-done-operator",
				name: "Search: task-done: (Find matches in completed tasks)",
				query: "task-done:",
			},
			{
				id: "search-property",
				name: "Search: [property] or [property:value]",
				query: "[]",
			},
		];

		// Register all search operator commands
		searchOperators.forEach((operator) => {
			this.createCommand({
				id: operator.id,
				name: operator.name,
				queryBuilder: () => operator.query || "",
				global: true,
			});
		});
	}

	registerEditorMenuHandler() {
		this.registerEvent(
			this.app.workspace.on(
				"editor-menu",
				(menu: Menu, editor: Editor) => {
					if (!editor) {
						return;
					}
					if (editor.getSelection().length === 0) {
						return;
					}
					const selection = editor.getSelection().trim();
					let searchWord = selection;

					if (selection.length > 8) {
						searchWord =
							selection.substring(0, 3) +
							"..." +
							selection.substring(
								selection.length - 3,
								selection.length
							);
					} else {
						searchWord = selection;
					}

					menu.addItem((item) => {
						// Add sub menu
						item.setTitle(
							'Search "' + searchWord + '"' + " in Float Search"
						)
							.setIcon("search")
							.onClick(() =>
								this.initModal(
									{
										...this.state,
										query: selection,
										current: false,
									},
									true,
									false
								)
							);
					});
				}
			)
		);
	}

	registerContextMenuHandler() {
		this.registerEvent(
			this.app.workspace.on(
				"file-menu",
				(
					menu: Menu,
					file: TAbstractFile,
					source: string,
					leaf?: WorkspaceLeaf
				) => {
					const popover = leaf
						? EmbeddedView.forLeaf(leaf)
						: undefined;
					if (file instanceof TFile && !popover && !leaf) {
						menu.addItem((item) => {
							item.setIcon("popup-open")
								.setTitle("Open in Float Preview")
								.onClick(async () => {
									if (this.modal) {
										await this.modal.initFileView(
											file,
											undefined
										);

										return;
									}

									this.initModal(
										{ ...this.state, current: false },
										true,
										true
									);
									setTimeout(async () => {
										await this.modal.initFileView(
											file,
											undefined
										);
									}, 20);
								})
								.setSection?.("open");
						});
					}
				}
			)
		);
	}

	registerIcons() {
		addIcon(
			"panel-left-inactive",
			`<path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 4.999687 3 L 19.000312 3 C 20.104688 3 21 3.895312 21 4.999687 L 21 19.000312 C 21 20.104688 20.104688 21 19.000312 21 L 4.999687 21 C 3.895312 21 3 20.104688 3 19.000312 L 3 4.999687 C 3 3.895312 3.895312 3 4.999687 3 Z M 4.999687 3 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 9 13.999688 L 9 15 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 9 19.000312 L 9 21 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 9 3 L 9 4.999687 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 9 9 L 9 10.000312 " transform="matrix(4.166667,0,0,4.166667,0,0)"/>`
		);
		addIcon(
			"app-window",
			`<path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 4.000312 4.000312 L 19.999688 4.000312 C 21.105 4.000312 22.000312 4.895625 22.000312 6 L 22.000312 18 C 22.000312 19.104375 21.105 19.999688 19.999688 19.999688 L 4.000312 19.999688 C 2.895 19.999688 1.999687 19.104375 1.999687 18 L 1.999687 6 C 1.999687 4.895625 2.895 4.000312 4.000312 4.000312 Z M 4.000312 4.000312 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 10.000312 4.000312 L 10.000312 7.999687 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 1.999687 7.999687 L 22.000312 7.999687 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 6 4.000312 L 6 7.999687 " transform="matrix(4.166667,0,0,4.166667,0,0)"/>`
		);
		addIcon(
			"panel-top",
			`<path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 4.999687 3 L 19.000312 3 C 20.104688 3 21 3.895312 21 4.999687 L 21 19.000312 C 21 20.104688 20.104688 21 19.000312 21 L 4.999687 21 C 3.895312 21 3 20.104688 3 19.000312 L 3 4.999687 C 3 3.895312 3.895312 3 4.999687 3 Z M 4.999687 3 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 3 9 L 21 9 " transform="matrix(4.166667,0,0,4.166667,0,0)"/>`
		);
		addIcon(
			"square-equal",
			`<path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 4.999687 3 L 19.000312 3 C 20.104688 3 21 3.895312 21 4.999687 L 21 19.000312 C 21 20.104688 20.104688 21 19.000312 21 L 4.999687 21 C 3.895312 21 3 20.104688 3 19.000312 L 3 4.999687 C 3 3.895312 3.895312 3 4.999687 3 Z M 4.999687 3 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 7.000312 10.000312 L 16.999688 10.000312 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 7.000312 13.999688 L 16.999688 13.999688 " transform="matrix(4.166667,0,0,4.166667,0,0)"/>`
		);
	}

	async loadSettings() {
		type LegacySettings = Partial<FloatSearchSettings> & {
			filterButtons?: { name: string; query: string }[];
		};
		const data = (await this.loadData()) as LegacySettings;
		const merged: FloatSearchSettings & {
			filterButtons?: { name: string; query: string }[];
		} = Object.assign({}, DEFAULT_SETTINGS, data);

		// Merge the legacy "filter buttons" feature into saved searches so the
		// single preset list drives the CMDK filter chips.
		if (Array.isArray(data.filterButtons)) {
			for (const fb of data.filterButtons) {
				if (
					fb?.name &&
					fb?.query &&
					!merged.savedSearches.some(
						(s) => s.query.trim() === fb.query.trim()
					)
				) {
					merged.savedSearches.push({
						name: fb.name,
						query: fb.query,
					});
				}
			}
			delete merged.filterButtons;
		}

		this.settings = merged;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

const TRIGGER_KEY_OPTIONS: Record<CmdkTriggerKey, string> = {
	Shift: "Double Shift",
	Control: "Double Ctrl",
	Alt: "Double Alt",
	Meta: "Double Meta (Cmd/Win)",
	none: "Disabled",
};

class NamePromptModal extends Modal {
	private defaultValue: string;
	private result: (value: string | null) => void;

	constructor(
		app: App,
		defaultValue: string,
		result: (value: string | null) => void
	) {
		super(app);
		this.defaultValue = defaultValue;
		this.result = result;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("float-search-prompt");
		contentEl.createEl("h3", { text: t("saveAsPreset") });
		const input = contentEl.createEl("input", {
			type: "text",
			placeholder: t("presetName"),
		});
		input.value = this.defaultValue;
		const row = contentEl.createDiv({ cls: "float-search-prompt-row" });
		const ok = row.createEl("button", { text: t("save") });
		const cancel = row.createEl("button", { text: t("cancel") });

		const submit = () => {
			const v = input.value.trim();
			this.result(v || this.defaultValue);
			this.close();
		};
		ok.onClickEvent(() => submit());
		cancel.onClickEvent(() => {
			this.result(null);
			this.close();
		});
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") submit();
			if (e.key === "Escape") {
				this.result(null);
				this.close();
			}
		});
		setTimeout(() => input.focus(), 0);
	}

	onClose() {
		this.contentEl.empty();
	}
}

function buildPillList(
	container: HTMLElement,
	items: string[],
	onRemove: (index: number) => void
) {
	const wrap = container.createDiv({ cls: "float-search-pill-list" });
	wrap.empty();
	items.forEach((item, i) => {
		const pill = wrap.createDiv({ cls: "float-search-pill" });
		pill.setText(item);
		pill.title = t("clickToRemove");
		pill.onClickEvent(() => onRemove(i));
	});
	return wrap;
}

function promptForName(
	app: App,
	defaultValue: string
): Promise<string | null> {
	return new Promise((resolve) => {
		new NamePromptModal(app, defaultValue, resolve).open();
	});
}

/**
 * Folder / file picker backed by the official vault API. As the user types,
 * it shows a fuzzy-filtered list of real vault folders or files, so the
 * exact path never has to be typed by hand.
 */
class PathSuggest extends AbstractInputSuggest<TFolder | TFile> {
	constructor(
		app: App,
		private inputEl: HTMLInputElement,
		private kind: "folder" | "file",
		private onPick: (path: string) => void
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): (TFolder | TFile)[] {
		const pool = this.app.vault
			.getAllLoadedFiles()
			.filter((f) =>
				this.kind === "folder"
					? f instanceof TFolder && f.path !== ""
					: f instanceof TFile
			) as (TFolder | TFile)[];
		if (!query) return pool.slice(0, 50);
		const fuzzy = prepareFuzzySearch(query);
		return pool
			.map((f) => ({ f, m: fuzzy(f.path) }))
			.filter((x) => x.m)
			.sort(
				(a, b) =>
					(b.m!.score ?? -Infinity) - (a.m!.score ?? -Infinity)
			)
			.slice(0, 50)
			.map((x) => x.f);
	}

	renderSuggestion(value: TFolder | TFile, el: HTMLElement) {
		el.setText(value.path || "/");
	}

	selectSuggestion(value: TFolder | TFile) {
		this.onPick(value.path);
		this.inputEl.value = "";
		this.close();
	}
}

class FloatSearchSettingTab extends PluginSettingTab {
	plugin: FloatSearchPlugin;
	// Reference to the saved-search list container so it can be re-rendered
	// in place (preserving the settings scroll position) instead of calling
	// the full display() that rebuilds everything and jumps the scroll.
	private savedListEl?: HTMLElement;

	constructor(app: App, plugin: FloatSearchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: t("settingsTitle") });

		new Setting(containerEl)
			.setName(t("quickSearchTrigger"))
			.setDesc(t("quickSearchTriggerDesc"))
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(
					TRIGGER_KEY_OPTIONS
				)) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue(this.plugin.settings.cmdkTriggerKey);
				dropdown.onChange(async (value) => {
					this.plugin.settings.cmdkTriggerKey =
						value as CmdkTriggerKey;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t("doubleTapInterval"))
			.setDesc(t("doubleTapIntervalDesc"))
			.addSlider((slider) => {
				slider
					.setLimits(150, 600, 50)
					.setValue(this.plugin.settings.cmdkDoubleTapInterval)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.cmdkDoubleTapInterval =
							value;
						await this.plugin.saveSettings();
					});
			});

		containerEl.createEl("h3", { text: t("quickCreate") });

		new Setting(containerEl)
			.setName(t("enableQuickCreate"))
			.setDesc(t("enableQuickCreateDesc"))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.cmdkQuickCreate)
					.onChange(async (value) => {
						this.plugin.settings.cmdkQuickCreate = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t("quickCreateFolder"))
			.setDesc(t("quickCreateFolderDesc"))
			.addText((text) => {
				text.setPlaceholder(t("phInbox"))
					.setValue(this.plugin.settings.cmdkQuickCreateFolder)
					.onChange(async (value) => {
						this.plugin.settings.cmdkQuickCreateFolder =
							value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t("titleFormat"))
			.setDesc(t("titleFormatDesc"))
			.addText((text) => {
				text.setPlaceholder(t("phTimestamp"))
					.setValue(
						this.plugin.settings.cmdkQuickCreateTitleFormat
					)
					.onChange(async (value) => {
						this.plugin.settings.cmdkQuickCreateTitleFormat =
							value;
						await this.plugin.saveSettings();
					});
			});

		// ── Exclusions ──────────────────────────────────────────────
		containerEl.createEl("h3", { text: t("exclusions") });

		// Exclude folders
		new Setting(containerEl)
			.setName(t("excludeFolders"))
			.setDesc(t("excludeFoldersDesc"))
			.addText((text) => {
				text.setPlaceholder(t("phTemplates"));
				new PathSuggest(
					this.app,
					text.inputEl,
					"folder",
					async (path) => {
						if (
							!this.plugin.settings.excludeFolders.includes(
								path
							)
						) {
							this.plugin.settings.excludeFolders.push(path);
							await this.plugin.saveSettings();
							this.display();
						}
					}
				);
			});
		buildPillList(
			containerEl,
			this.plugin.settings.excludeFolders,
			async (i) => {
				this.plugin.settings.excludeFolders.splice(i, 1);
				await this.plugin.saveSettings();
				this.display();
			}
		);

		// Exclude files
		new Setting(containerEl)
			.setName(t("excludeFiles"))
			.setDesc(t("excludeFilesDesc"))
			.addText((text) => {
				text.setPlaceholder(t("phSecrets"));
				new PathSuggest(
					this.app,
					text.inputEl,
					"file",
					async (path) => {
						if (
							!this.plugin.settings.excludeFiles.includes(
								path
							)
						) {
							this.plugin.settings.excludeFiles.push(path);
							await this.plugin.saveSettings();
							this.display();
						}
					}
				);
			});
		buildPillList(
			containerEl,
			this.plugin.settings.excludeFiles,
			async (i) => {
				this.plugin.settings.excludeFiles.splice(i, 1);
				await this.plugin.saveSettings();
				this.display();
			}
		);

		// ── Saved searches ─────────────────────────────────────────
		containerEl.createEl("h3", { text: t("savedSearches") });

		const addSetting = new Setting(containerEl).setName(
			t("addSavedSearch")
		);
		addSetting.setDesc(t("addSavedSearchDesc"));
		let nameInput: any;
		let queryInput: any;
		addSetting.addText((text) => {
			nameInput = text;
			text.setPlaceholder(t("namePlaceholder"));
		});
		addSetting.addText((text) => {
			queryInput = text;
			text.setPlaceholder(t("queryPlaceholder"));
		});
		addSetting.addButton((button) => {
			button
				.setButtonText(t("add"))
				.setCta()
				.onClick(async () => {
					const name = nameInput?.inputEl.value.trim();
					const query = queryInput?.inputEl.value.trim();
					if (name && query) {
					this.plugin.addSavedSearch(name, query);
					this.renderSavedList();
					nameInput.inputEl.value = "";
					queryInput.inputEl.value = "";
					}
				});
		});

		// Saved search list (rendered by its own method so it can be
		// refreshed in place without rebuilding the whole settings tab).
		const listEl = containerEl.createDiv({
			cls: "float-search-saved-list",
		});
		this.savedListEl = listEl;
		this.renderSavedList();
	}

	// Re-render only the saved-search list in place. Used after add / edit /
	// delete so the settings tab scroll position is preserved (calling the
	// full display() rebuilds everything and jumps the scroll to the top).
	private renderSavedList() {
		const listEl = this.savedListEl;
		if (!listEl) return;
		listEl.empty();
		this.plugin.settings.savedSearches.forEach((s, i) => {
			const row = listEl.createDiv({
				cls: "float-search-saved-row",
			});
			const label = row.createDiv({
				cls: "float-search-saved-label",
			});
			label.createSpan({ cls: "float-search-saved-name" }).setText(
				s.name
			);
			label.createSpan({
				cls: "float-search-saved-query",
			}).setText(s.query);

			// Action buttons (grouped, right-aligned)
			const actions = row.createDiv({
				cls: "float-search-saved-actions",
			});
			const edit = actions.createEl("button", {
				text: t("edit"),
				cls: "float-search-saved-edit",
			});
			const del = actions.createEl("button", {
				text: t("delete"),
				cls: "float-search-saved-delete",
			});

			edit.onClickEvent(() => {
				// Turn the row into inline editable fields.
				row.empty();
				row.addClass("is-editing");
				const nameField = row.createEl("input", {
					cls: "float-search-saved-input",
					type: "text",
				});
				nameField.value = s.name;
				nameField.placeholder = t("namePlaceholder");
				const queryField = row.createEl("input", {
					cls: "float-search-saved-input",
					type: "text",
				});
				queryField.value = s.query;
				queryField.placeholder = t("queryPlaceholder");
				const saveBtn = row.createEl("button", {
					text: t("save"),
					cls: "float-search-saved-save",
				});
				const cancelBtn = row.createEl("button", {
					text: t("cancel"),
					cls: "float-search-saved-cancel",
				});
				nameField.focus();
				const commit = async () => {
					const newName = nameField.value.trim();
					const newQuery = queryField.value.trim();
					if (newName && newQuery) {
						this.plugin.settings.savedSearches[i] = {
							name: newName,
							query: newQuery,
						};
						await this.plugin.saveSettings();
						this.plugin.registerSavedSearchCommands();
						this.renderSavedList();
					}
				};
				saveBtn.onClickEvent(() => commit());
				queryField.addEventListener("keydown", (e) => {
					if (e.key === "Enter") commit();
					if (e.key === "Escape") this.renderSavedList();
				});
				cancelBtn.onClickEvent(() => this.renderSavedList());
			});

			del.onClickEvent(async () => {
				this.plugin.settings.savedSearches.splice(i, 1);
				await this.plugin.saveSettings();
				this.renderSavedList();
			});
		});
		if (this.plugin.settings.savedSearches.length === 0) {
			listEl.createDiv({
				cls: "float-search-saved-empty",
				text: t("noSavedSearches"),
			});
		}
	}
}

function createInstructionElement(
	parentEl: HTMLElement,
	divCls: string,
	keyText: string,
	text: string
) {
	const divEl = parentEl.createDiv({ cls: divCls });
	const iconEl = divEl.createSpan({
		cls: "float-search-modal-instructions-key",
	});
	const textEl = divEl.createSpan({
		cls: "float-search-modal-instructions-text",
	});

	iconEl.setText(keyText);
	textEl.setText(text);

	return { divEl, iconEl, textEl };
}

class FloatSearchModal extends Modal {
	private readonly plugin: FloatSearchPlugin;
	private searchEmbeddedView: EmbeddedView;
	private fileEmbeddedView: EmbeddedView;

	searchLeaf: WorkspaceLeaf;
	fileLeaf: WorkspaceLeaf | undefined;

	private cb: (state: any) => void;
	private state: any;

	private fileState: any;

	private searchCtnEl: HTMLElement;
	private instructionsEl: HTMLElement;
	private fileEl: HTMLElement;
	private viewType: string;

	private focusdItem: any;

	private debouncedAutoPreview = debounce(() => {
		this.autoPreviewFocusedItem();
	}, 150);

	constructor(
		cb: (state: any) => void,
		plugin: FloatSearchPlugin,
		state: any,
		viewType: string = "search"
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.cb = cb;
		this.state = state;
		this.viewType = viewType;
	}

	async onOpen() {
		const { contentEl, containerEl, modalEl } = this;

		this.searchCtnEl = contentEl.createDiv({
			cls: "float-search-modal-search-ctn",
		});
		this.instructionsEl = modalEl.createDiv({
			cls: "float-search-modal-instructions",
		});

		this.initInstructions(this.instructionsEl);
		this.initCss(contentEl, modalEl, containerEl);
		await this.initSearchView(this.searchCtnEl);
		this.initInput();
		this.initContent();
	}

	onClose() {
		const { contentEl } = this;

		const st = this.searchLeaf.view.getState();
		st.query = this.plugin.stripExclusion(st.query as string);
		this.cb(st);

		this.searchLeaf.detach();
		this.fileLeaf?.detach();
		this.searchEmbeddedView.unload();
		this.fileEmbeddedView?.unload();
		contentEl.empty();
	}

	initInstructions(instructionsEl: HTMLElement) {
		if (!this.plugin.settings.showInstructions) {
			return;
		}
		const navigate = createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-navigate",
			"↑↓",
			"Navigate"
		);
		const collapse = createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-collapse",
			"Shift+↑↓",
			"Collapse/Expand"
		);
		const enter = createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-enter",
			"↵",
			"Open in background"
		);
		const altEnter = createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-alt-enter",
			"Alt+↵",
			"Open File and Close"
		);
		const ctrlEnter = createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-ctrl-enter",
			"Ctrl+↵",
			"Create File When Not Exist"
		);
		const tab = createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-tab",
			"Tab/Shift+Tab",
			"Preview/Close Preview"
		);
		const switchView = createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-switch",
			"Ctrl+G",
			"Switch Between Search and File View"
		);
		const click = createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-click",
			"Alt+Click",
			"Close Modal While In File View"
		);
	}

	initCss(
		contentEl: HTMLElement,
		modalEl: HTMLElement,
		containerEl: HTMLElement
	) {
		contentEl.classList.add("float-search-modal-content");
		modalEl.classList.add("float-search-modal");
		containerEl.classList.add("float-search-modal-container");
	}

	async initSearchView(contentEl: HTMLElement) {
		const [createdLeaf, embeddedView] = spawnLeafView(
			this.plugin,
			contentEl
		);
		this.searchLeaf = createdLeaf;
		this.searchEmbeddedView = embeddedView;

		this.searchLeaf.setPinned(true);
		await this.searchLeaf.setViewState({
			type: "search",
			state: {
				...this.state,
				query: this.plugin.withExclusion(this.state.query ?? ""),
				triggerBySelf: true,
			},
		});

		// Only adjust the caret; the query was already applied via setViewState
		// so re-applying setState here would trigger a second redundant search.
		setTimeout(() => {
			const searchComponent = (this.searchLeaf.view as SearchView)
				.searchComponent;
			if (searchComponent?.inputEl) {
				this.state?.current
					? searchComponent.inputEl.setSelectionRange(0, 0)
					: searchComponent.inputEl.setSelectionRange(
							0,
							this.state?.query?.length
					  );
			}
		}, 0);

		return;
	}

	initInput(retries = 10) {
		const inputEl = this.contentEl.getElementsByTagName("input")[0];
		if (!inputEl) {
			if (retries > 0) {
				setTimeout(() => this.initInput(retries - 1), 50);
			}
			return;
		}
		inputEl.focus();
		inputEl.onkeydown = (e) => {
			const currentView = this.searchLeaf.view as SearchView;
			switch (e.key) {
				case "ArrowDown":
				case "n":
					if (e.key === "n" && !e.ctrlKey) break;
					if (e.key === "n") e.preventDefault();

					if (e.shiftKey) {
						currentView.onKeyShowMoreAfter(e);
						if (currentView.dom.focusedItem) {
							if (currentView.dom.focusedItem.collapsible) {
								currentView.dom.focusedItem.setCollapse(false);
							}
							this.focusdItem = currentView.dom.focusedItem;
						}
					} else {
						currentView.onKeyArrowDownInFocus(e);
						this.focusdItem = currentView.dom.focusedItem;
						this.debouncedAutoPreview();
					}
					break;
				case "ArrowUp":
				case "p":
					if (e.key === "p" && !e.ctrlKey) break;
					if (e.key === "p") e.preventDefault();

					if (e.shiftKey) {
						currentView.onKeyShowMoreBefore(e);
						if (currentView.dom.focusedItem) {
							if (currentView.dom.focusedItem.collapseEl) {
								currentView.dom.focusedItem.setCollapse(true);
							}
							this.focusdItem = currentView.dom.focusedItem;
						}
					} else {
						currentView.onKeyArrowUpInFocus(e);
						this.focusdItem = currentView.dom.focusedItem;
						if (!currentView.dom.focusedItem.content) {
							this.focusdItem = undefined;
						}
						this.debouncedAutoPreview();
					}
					break;
				case "ArrowLeft":
					currentView.onKeyArrowLeftInFocus(e);
					break;
				case "ArrowRight":
					currentView.onKeyArrowRightInFocus(e);
					break;
				case "Enter":
					if (
						Keymap.isModifier(e, "Mod") &&
						Keymap.isModifier(e, "Shift") &&
						!this.focusdItem
					) {
						e.preventDefault();
						const fileName = inputEl.value.trim();
						const real = fileName.replace(/[/\\?%*:|"<>]/g, "-");
						this.plugin.app.workspace.openLinkText(real, "", true);
						this.close();
						break;
					}
					currentView.onKeyEnterInFocus(e);
					if (e.altKey && currentView.dom.focusedItem) {
						this.close();
					}
					break;
				case "Tab":
					e.preventDefault();
					if (e.shiftKey) {
						if (this.fileLeaf) {
							this.fileLeaf?.detach();
							this.fileLeaf = undefined;
							this.fileEmbeddedView?.unload();
							this.modalEl.toggleClass(
								"float-search-width",
								false
							);
							this.fileEl.detach();

							break;
						}
					}

					if (currentView.dom.focusedItem) {
						const item = currentView.dom.focusedItem;
						const file =
							item.parent.file instanceof TFile
								? item.parent.file
								: item.file;

						item.parent.file instanceof TFile
							? this.initFileView(file, {
									match: {
										content: item.content,
										matches: item.matches,
									},
							  })
							: this.initFileView(file, undefined);
					}
					break;
				case "e":
					if (e.ctrlKey) {
						e.preventDefault();
						if (this.fileLeaf) {
							const estate = this.fileLeaf.getViewState();
							estate.state = {
								...estate.state,
								mode:
									"preview" === estate.state?.mode
										? "source"
										: "preview",
							};
							this.fileLeaf.setViewState(estate, {
								focus: true,
							});
							setTimeout(() => {
								(
									this.searchLeaf.view as SearchView
								).searchComponent?.inputEl?.focus();
							}, 0);
						}
					}
					break;
				case "g":
					if (this.fileLeaf && e.ctrlKey) {
						e.preventDefault();
						this.plugin.app.workspace.setActiveLeaf(this.fileLeaf, {
							focus: true,
						});
					}
					break;
				case "C":
					if (e.ctrlKey && e.shiftKey) {
						e.preventDefault();
						const text = currentView.dom.focusedItem.el.innerText;
						navigator.clipboard.writeText(text);
					}
					break;
			}
		};
	}

	private autoPreviewFocusedItem() {
		const currentView = this.searchLeaf.view as SearchView;
		const item = currentView.dom?.focusedItem;
		if (!item) return;

		const file =
			item.parent?.file instanceof TFile
				? item.parent.file
				: item.file;
		if (!(file instanceof TFile)) return;

		const state =
			item.parent?.file instanceof TFile
				? {
						match: {
							content: item.content,
							matches: item.matches,
						},
				  }
				: undefined;

		this.initFileView(file, state);
	}

	initContent() {
		const { contentEl } = this;
		contentEl.onclick = (e) => {
			const resultElement = contentEl.getElementsByClassName(
				"search-results-children"
			)[0];
			if (resultElement.children.length < 2) {
				return;
			}

			let targetElement = e.target as HTMLElement | null;

			if (e.altKey || !this.fileLeaf) {
				while (targetElement) {
					if (targetElement.classList.contains("tree-item-icon")) {
						break;
					}
					if (
						targetElement.classList.contains(
							"search-result-hover-button"
						)
					) {
						break;
					}
					if (targetElement.classList.contains("tree-item")) {
						this.close();
						break;
					}
					targetElement = targetElement.parentElement;
				}
				return;
			}

			if (this.fileLeaf) {
				const currentView = this.searchLeaf.view as SearchView;

				if (
					(this.searchCtnEl as Node).contains(targetElement as Node)
				) {
					while (targetElement) {
						if (targetElement.classList.contains("tree-item")) {
							break;
						}
						targetElement = targetElement.parentElement;
					}
					if (!targetElement) return;

					const fileInnerEl = targetElement?.getElementsByClassName(
						"tree-item-inner"
					)[0] as HTMLElement;
					const innerText = fileInnerEl.innerText;
					const file =
						this.plugin.app.metadataCache.getFirstLinkpathDest(
							innerText,
							""
						);

					if (file) {
						const item = currentView.dom.resultDomLookup.get(file);
						currentView.dom.setFocusedItem(item);
						this.initFileView(file, undefined);
						(
							this.searchLeaf.view as SearchView
						).searchComponent?.inputEl?.focus();
					}
				}

				return;
			}
		};
	}

	async initFileView(file: TFile, state: any) {
		if (this.fileLeaf) {
			await this.fileLeaf.openFile(file, {
				active: false,
				eState: state,
			});

			if (
				this.fileState?.match?.matches[0] ===
					state?.match?.matches[0] &&
				state &&
				this.fileState
			) {
				setTimeout(() => {
					if (this.fileLeaf) {
						this.plugin.app.workspace.setActiveLeaf(this.fileLeaf, {
							focus: true,
						});
					}
				}, 0);
			} else {
				this.fileState = state;
				setTimeout(() => {
					(
						this.searchLeaf.view as SearchView
					).searchComponent?.inputEl?.focus();
				}, 0);
			}

			return;
		}

		const { contentEl } = this;
		this.fileEl = contentEl.createDiv({
			cls: "float-search-modal-file-ctn",
		});
		this.modalEl.toggleClass("float-search-width", true);
		this.fileEl.onkeydown = (e) => {
			if (e.ctrlKey && e.key === "g") {
				e.preventDefault();
				e.stopPropagation();

				(
					this.searchLeaf.view as SearchView
				).searchComponent?.inputEl?.focus();
			}

			if (e.key === "Tab" && e.ctrlKey) {
				e.preventDefault();
				e.stopPropagation();

				(
					this.searchLeaf.view as SearchView
				).searchComponent?.inputEl?.focus();
			}
		};

		if (!this.fileEl) return;

		const [createdLeaf, embeddedView] = spawnLeafView(
			this.plugin,
			this.fileEl
		);
		this.fileLeaf = createdLeaf;
		this.fileEmbeddedView = embeddedView;

		this.fileLeaf.setPinned(true);
		await this.fileLeaf.openFile(file, {
			active: false,
			eState: state,
		});
		this.fileState = state;

		(this.searchLeaf.view as SearchView).searchComponent?.inputEl?.focus();
	}
}

interface CmdkResult {
	file: TFile;
	nameMatch: SearchResult | null;
	pathMatch: SearchResult | null;
	heading?: string;
	headingMatch?: SearchResult | null;
	content?: string;
	contentMatch?: SearchResult | null;
	line?: number;
	type: "file" | "heading" | "content" | "create" | "saved" | "save";
	createQuery?: string;
	savedQuery?: string;
}

class FloatSearchCmdkModal extends SuggestModal<CmdkResult> {
	plugin: FloatSearchPlugin;
	private bodyEl: HTMLElement;
	private previewEl: HTMLElement | undefined;
	private fileLeaf: WorkspaceLeaf | undefined;
	private fileEmbeddedView: EmbeddedView | undefined;
	private searchAbort: AbortController | null = null;
	private debouncedUpdate = debounce(() => this.runSearch(), 150);
	private activeFilters: string[] = [];
	private filterMatchSets: Map<string, Set<string>> | null = null;
	private searchFilter: SearchFilter;
	private liveQuery: Query = { groups: [] };
	private liveHasContent = false;
	private filterBarEl: HTMLElement;
	// Candidate ③: the scanned + exclusion-filtered candidate file set, built
	// once and reused across keystrokes (invalidated on vault changes).
	private candidateFiles: TFile[] | null = null;
	private vaultHandlers: Array<[string, () => void]> = [];
	// Candidate ⑥: file paths that already passed the metadata pre-filter in
	// runSearch, so the heading phase need not re-evaluate them.
	private passedMeta: Set<string> | null = null;

	constructor(plugin: FloatSearchPlugin, initialFilters?: string[]) {
		super(plugin.app);
		this.plugin = plugin;
		this.limit = 50;
		this.searchFilter = new SearchFilter(this.app);
		this.activeFilters = initialFilters ? [...initialFilters] : [];
		this.setPlaceholder("Search files and content...");
		this.setInstructions([
			{ command: "↑↓", purpose: "Navigate" },
			{ command: "↵", purpose: "Open" },
			{ command: "Shift ↵", purpose: "New tab" },
			{ command: "esc", purpose: "Close" },
		]);
		this.modalEl.addClass("float-search-cmdk");
		this.containerEl.addClass("float-search-cmdk-container");
	}

	onOpen() {
		super.onOpen();
		// Candidate ③: invalidate the cached candidate file set whenever the
		// vault changes, so the next search rebuilds it lazily.
		const invalidate = () => {
			this.candidateFiles = null;
		};
		for (const ev of ["create", "modify", "rename", "delete"] as const) {
			const h = invalidate;
			(this.app.vault as any).on(ev, h);
			this.vaultHandlers.push([ev, h]);
		}
		this.bodyEl = createDiv("float-search-cmdk-body");
		this.modalEl.insertBefore(
			this.bodyEl,
			(this as any).resultContainerEl
		);
		this.bodyEl.appendChild((this as any).resultContainerEl);

		// Render filter chip bar as its own horizontal row, above the results body
		this.filterBarEl = this.modalEl.createDiv({
			cls: "float-search-filter-bar",
		});
		this.modalEl.insertBefore(this.filterBarEl, this.bodyEl);
		this.renderFilterBar();

		// If the modal was opened with presets pre-selected (e.g. via the
		// saved-search command), filter the list immediately.
		if (this.activeFilters.length > 0) {
			this.runSearch();
		}
	}

	// Required by SuggestModal but unused — we drive the chooser directly
	getSuggestions(_query: string): CmdkResult[] {
		return [];
	}

  // Override to use progressive rendering via chooser.addSuggestion
  updateSuggestions() {
    this.debouncedUpdate();
  }

  // ── Filter bar ─────────────────────────────────────────────────────
  private renderFilterBar() {
    this.filterBarEl.empty();
    const buttons = this.plugin.settings.savedSearches;
    if (buttons.length === 0) {
      this.filterBarEl.style.display = "none";
      return;
    }
    this.filterBarEl.style.display = "";

    for (const fb of buttons) {
      const chip = this.filterBarEl.createDiv({
        cls: "float-search-filter-chip",
        text: fb.name,
      });
      if (this.activeFilters.includes(fb.query)) {
        chip.addClass("is-active");
      }
      chip.onClickEvent(() => {
        // Single-select (mutually exclusive): clicking the active chip
        // clears it; clicking another chip replaces the previous selection.
        if (this.activeFilters.includes(fb.query)) {
          this.activeFilters = [];
        } else {
          this.activeFilters = [fb.query];
        }
        this.renderFilterBar();
        this.runSearch();
      });
    }
  }

  private matchesFilters(file: TFile): boolean {
    if (this.activeFilters.length === 0) return true;
    return this.activeFilters.every((f) =>
      this.filterMatchSets?.get(f)?.has(file.path) ?? false
    );
  }

  // Candidate ③: build the scanned + exclusion-filtered candidate file set
  // once, normalising the exclusion lists a single time (not per file), and
  // reuse it across keystrokes. Rebuilt lazily after any vault change.
  private getCandidateFiles(): TFile[] {
    if (this.candidateFiles) return this.candidateFiles;
    const folders = this.plugin.settings.excludeFolders
      .map((f) => this.plugin.normalizePath(f))
      .filter(Boolean);
    const fileExcludes = this.plugin.settings.excludeFiles
      .map((f) => this.plugin.normalizePath(f))
      .filter(Boolean);
    const exts = new Set(["md", "canvas", "pdf"]);
    this.candidateFiles = this.app.vault.getFiles().filter((f: TFile) => {
      if (!exts.has(f.extension)) return false;
      const p = f.path;
      if (fileExcludes.some((x) => x === p || x === f.name)) return false;
      if (folders.some((x) => p === x || p.startsWith(x + "/"))) return false;
      return true;
    });
    return this.candidateFiles;
  }

  // Precompute, for each active filter query, the set of file paths that
  // match. Delegates to SearchFilter, the single source of truth for all
  // filter matching (tag / path / folder / property / text, with AND across
  // clauses and nested-tag support matching native search).
  private prepareFilterMatchSets(files: TFile[]) {
    this.filterMatchSets = this.searchFilter.buildMatchSets(
      files,
      this.activeFilters
    );
  }

	private runSearch() {
		// Cancel previous in-flight search
		this.searchAbort?.abort();
		const abort = (this.searchAbort = new AbortController());
		const { signal } = abort;
		this.passedMeta = null;

    const chooser = (this as any).chooser;
    const rawInput = this.inputEl.value;
    const trimmed = rawInput.trim();

		// Candidate ③: reuse the cached, exclusion-filtered candidate set
		// instead of re-scanning + re-normalising exclusions on every keystroke.
		const files = this.getCandidateFiles();

		// Precompute filter match sets before filtering
		if (this.activeFilters.length > 0) {
			this.prepareFilterMatchSets(files);
		} else {
			this.filterMatchSets = null;
		}

		// "Save current query" chip (shown when a query is typed and not yet saved)
		const extra: CmdkResult[] = [];
		if (
			trimmed &&
			!this.plugin.settings.savedSearches.some(
				(s) => s.query.trim() === trimmed
			)
		) {
			extra.push({
				file: null as any,
				nameMatch: null,
				pathMatch: null,
				type: "save",
			});
		}

		// Empty query — show launcher (saved) + recent files, filtered by active chips
		if (!trimmed) {
			const recent = files
				.sort((a: TFile, b: TFile) => b.stat.mtime - a.stat.mtime)
				.filter((f: TFile) => this.matchesFilters(f))
				.slice(0, this.limit)
				.map((file: TFile) => ({
					file,
					nameMatch: null,
					pathMatch: null,
					type: "file" as const,
				}));
			chooser.setSuggestions([...extra, ...recent]);
			return;
		}

		// Parse the live query with the FULL Obsidian Query syntax
		// (tag:/path:/folder:/file:/property:/[key::value] plus line:/block:/
		// section:/content:/task:, -exclusion, "quoted phrases", OR grouping).
		// Metadata clauses are applied synchronously; content clauses
		// (line/block/section/content/task) are evaluated in the async
		// content phase so we don't read every file body on each keystroke.
		const query = parseQuery(trimmed);
		this.liveQuery = query;
		this.liveHasContent = requiresContent(query);
		const pureText = query.groups.every((g) =>
			g.every((c) => c.kind === "text" && !c.negated)
		);
		const textTokens = query.groups
			.flat()
			.map((c) => (c.kind === "text" && !c.negated ? c.value.trim() : ""))
			.filter((v) => v !== "");
		const fuzzyText = textTokens.join(" ");
		const fuzzy = fuzzyText ? prepareFuzzySearch(fuzzyText) : null;

		const fileResults: CmdkResult[] = [];

		// When the query needs file bodies (content operators), the file list
		// is produced by the async content phase to avoid false positives.
		if (!this.liveHasContent) {
			// Candidate ⑥: remember which files passed the metadata pre-filter
			// so the (later, batched) heading phase can reuse it instead of
			// re-evaluating matchMetadata per file.
			this.passedMeta = new Set<string>();
			for (const file of files) {
				// Active chips (presets) always apply
				if (!this.matchesFilters(file)) continue;
				// Live metadata clauses (tag/path/folder/name/property) apply
				if (!this.searchFilter.matchMetadata(file, query)) continue;
				this.passedMeta.add(file.path);
				const nameMatch = fuzzy ? fuzzy(file.basename) : null;
				const pathMatch = fuzzy ? fuzzy(file.path) : null;
				// Text requirement only applies when there is plain text
				if (fuzzy && !nameMatch && !pathMatch) continue;
				fileResults.push({
					file,
					nameMatch,
					pathMatch,
					type: "file",
				});
			}
		}

		fileResults.sort((a, b) => {
			const sa = Math.max(
				a.nameMatch?.score ?? -Infinity,
				(a.pathMatch?.score ?? -Infinity) * 0.5
			);
			const sb = Math.max(
				b.nameMatch?.score ?? -Infinity,
				(b.pathMatch?.score ?? -Infinity) * 0.5
			);
			return (
				sb - sa || a.file.basename.localeCompare(b.file.basename)
			);
		});

		// Check if there is an exact name match (for quick-create gating)
		const queryLower = trimmed.toLowerCase();
		const hasExactMatch = fileResults.some(
			(r) => r.file.basename.toLowerCase() === queryLower
		);

		const resultsToShow = fileResults
			.filter((r) => this.matchesFilters(r.file))
			.slice(0, this.limit);

		// Append "quick create" option when enabled and no exact match
		if (
			this.plugin.settings.cmdkQuickCreate &&
			!hasExactMatch &&
			pureText &&
			trimmed.length > 0
		) {
			resultsToShow.push({
				file: null as any,
				nameMatch: null,
				pathMatch: null,
				type: "create",
				createQuery: trimmed,
			});
		}

		// Render file results immediately
		chooser.setSuggestions([...extra, ...resultsToShow]);

		// Phase 2: heading search — progressive, batched via setTimeout.
		// Headings can't be checked against content operators, so skip this
		// phase when the query needs file bodies.
		if (trimmed.length >= 2) {
			if (fuzzy && !this.liveHasContent)
				this.progressiveHeadingSearch(files, fuzzy, chooser, signal);

			// Phase 3: content search — progressive, async (reads file content)
			this.progressiveContentSearch(files, query, chooser, signal);
		}
	}

	private progressiveHeadingSearch(
		files: TFile[],
		fuzzy: (text: string) => SearchResult | null,
		chooser: any,
		signal: AbortSignal
	) {
		const BATCH_SIZE = 50; // files per tick
		let idx = 0;
		let added = 0;
		const MAX_HEADING_RESULTS = 20;

		const processBatch = () => {
			if (signal.aborted) return;

			const end = Math.min(idx + BATCH_SIZE, files.length);
			for (; idx < end; idx++) {
				if (added >= MAX_HEADING_RESULTS) return;
				const file = files[idx];
				const cache =
					this.app.metadataCache.getFileCache(file);
				if (!cache?.headings) continue;

				for (const h of cache.headings) {
					const headingMatch = fuzzy(h.heading);
					if (
						headingMatch &&
						this.matchesFilters(file) &&
						// Candidate ⑥: reuse the precomputed pass-set instead of
						// re-running matchMetadata on every heading check.
						(this.passedMeta?.has(file.path) ??
							this.searchFilter.matchMetadata(file, this.liveQuery))
					) {
						chooser.addSuggestion({
							file,
							nameMatch: null,
							pathMatch: null,
							heading: h.heading,
							headingMatch,
							type: "heading",
						});
							added++;
							if (added >= MAX_HEADING_RESULTS) return;
						}
					}
				}

			// More files to process — yield to event loop
			if (idx < files.length && added < MAX_HEADING_RESULTS) {
				setTimeout(processBatch, 0);
			}
		};

		// Start first batch on next microtask so file results render first
		setTimeout(processBatch, 0);
	}

	private progressiveContentSearch(
		files: TFile[],
		query: Query,
		chooser: any,
		signal: AbortSignal
	) {
		const BATCH_SIZE = 50;
		const MAX_CONTENT_RESULTS = 20;
		const DURATION_LIMIT = 5; // ms before yielding

		const contentMode = this.liveHasContent;
		// Fuzzy-text mode: a plain free-text search across file bodies.
		const fuzzyText = contentMode
			? ""
			: query.groups
					.flat()
					.map((c) =>
						c.kind === "text" && !c.negated
							? c.value.trim()
							: ""
					)
					.filter((v) => v !== "")
					.join(" ");
		const simpleSearch = !contentMode && fuzzyText ? prepareSimpleSearch(fuzzyText) : null;
		if (!contentMode && !simpleSearch) return;
		if (contentMode && query.groups.length === 0) return;

		let idx = 0;
		let added = 0;

		const processBatch = async () => {
			if (signal.aborted) return;
			const start = performance.now();

			for (; idx < files.length; idx++) {
				if (signal.aborted || added >= MAX_CONTENT_RESULTS) return;

				// Adaptive yielding: check time every BATCH_SIZE items
				if (idx % BATCH_SIZE === 0 && idx > 0) {
					if (performance.now() - start > DURATION_LIMIT) {
						setTimeout(processBatch, 0);
						return;
					}
				}

				const file = files[idx];
				if (file.extension !== "md") continue;

				// Fast metadata pre-filter (no file read needed).
				if (!this.searchFilter.matchMetadata(file, query)) continue;
				if (!contentMode && !this.matchesFilters(file)) continue;

				let text: string;
				// Candidate ④: read through the plugin-scoped, warm content
				// cache — shared across every CMDK open, so repeated opens
				// (and other searchers) almost never re-read file bodies.
				const cached = this.plugin.contentCache.get(file.path);
				try {
					if (cached && cached.mtime === file.stat.mtime) {
						text = cached.text;
					} else {
						text = await this.app.vault.cachedRead(file);
						this.plugin.cacheFileContent(
							file.path,
							file.stat.mtime,
							text
						);
					}
				} catch {
					continue;
				}

				if (contentMode) {
					// Full query evaluation including content operators.
					if (!this.searchFilter.matchContent(file, text, query))
						continue;
					const lineInfo = this.firstMatchLine(text, query);
					chooser.addSuggestion({
						file,
						nameMatch: null,
						pathMatch: null,
						content: lineInfo.text,
						contentMatch: null,
						line: lineInfo.line,
						type: "content",
					} as CmdkResult);
					added++;
					if (added >= MAX_CONTENT_RESULTS) return;
					continue;
				}

				const result = simpleSearch!(text);
				if (!result) continue;

				// Compute line number and context from first match offset
				const matchStart = result.matches[0][0];
				let line = 0;
				let lineStart = 0;
				for (let i = 0; i < matchStart; i++) {
					if (text.charCodeAt(i) === 10) {
						line++;
						lineStart = i + 1;
					}
				}
				let lineEnd = text.indexOf("\n", lineStart);
				if (lineEnd === -1) lineEnd = text.length;
				const lineText = text.substring(lineStart, lineEnd).trim();

				// Recompute match on the line for highlight offsets
				const lineMatch = simpleSearch!(lineText);

				chooser.addSuggestion({
					file,
					nameMatch: null,
					pathMatch: null,
					content: lineText,
					contentMatch: lineMatch,
					line,
					type: "content",
				} as CmdkResult);
				added++;
				if (added >= MAX_CONTENT_RESULTS) return;
			}
		};

		// Start after heading search has a chance to render
		setTimeout(processBatch, contentMode ? 0 : 50);
	}

	/** First line in `text` matching any positive content clause value. */
	private firstMatchLine(
		text: string,
		query: Query
	): { line: number; text: string } {
		const clauseValue = (c: Clause): string | undefined => {
			switch (c.kind) {
				case "content":
				case "line":
				case "section":
				case "block":
				case "task":
					return c.value;
				default:
					return undefined;
			}
		};
		const vals: string[] = [];
		for (const g of query.groups) {
			for (const c of g) {
				if (c.negated) continue;
				const v = clauseValue(c);
				if (v) vals.push(v.toLowerCase());
			}
		}
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const low = lines[i].toLowerCase();
			if (vals.some((v) => low.includes(v)))
				return { line: i, text: lines[i].trim() };
		}
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim()) return { line: i, text: lines[i].trim() };
		}
		return { line: 0, text: "" };
	}

	renderSuggestion(result: CmdkResult, el: HTMLElement) {
		el.addClass("mod-complex");

		if (result.type === "create") {
			el.addClass("float-search-cmdk-create-item");
			const contentEl = el.createDiv("suggestion-content");
			const titleEl = contentEl.createDiv("suggestion-title");
			titleEl.setText("Create new note");
			const noteEl = contentEl.createDiv("suggestion-note");
			const folder =
				this.plugin.settings.cmdkQuickCreateFolder || "/";
			noteEl.setText(
				`"${result.createQuery}" → ${folder}`
			);
			const auxEl = el.createDiv("suggestion-aux");
			const flair = auxEl.createSpan("suggestion-flair");
			setIcon(flair, "plus");
			return;
		}



		if (result.type === "save") {
			const contentEl = el.createDiv("suggestion-content");
			const titleEl = contentEl.createDiv("suggestion-title");
			titleEl.setText(t("saveCurrentTitle"));
			const noteEl = contentEl.createDiv("suggestion-note");
			noteEl.setText(this.inputEl.value.trim());
			const auxEl = el.createDiv("suggestion-aux");
			const flair = auxEl.createSpan("suggestion-flair");
			setIcon(flair, "bookmark");
			return;
		}


		const contentEl = el.createDiv("suggestion-content");

		if (result.type === "content" && result.content) {
			const titleEl = contentEl.createDiv("suggestion-title");
			if (result.contentMatch) {
				renderResults(titleEl, result.content, result.contentMatch);
			} else {
				titleEl.setText(result.content);
			}
			const noteEl = contentEl.createDiv("suggestion-note");
			noteEl.setText(result.file.path);
		} else if (result.type === "heading" && result.heading) {
			const titleEl = contentEl.createDiv("suggestion-title");
			if (result.headingMatch) {
				renderResults(titleEl, result.heading, result.headingMatch);
			} else {
				titleEl.setText(result.heading);
			}
			const noteEl = contentEl.createDiv("suggestion-note");
			noteEl.setText(result.file.path);
		} else {
			const titleEl = contentEl.createDiv("suggestion-title");
			if (result.nameMatch) {
				renderResults(
					titleEl,
					result.file.basename,
					result.nameMatch
				);
			} else {
				titleEl.setText(result.file.basename);
			}

			const noteEl = contentEl.createDiv("suggestion-note");
			const parentPath = result.file.parent?.path || "/";
			if (result.pathMatch) {
				renderResults(noteEl, parentPath, result.pathMatch);
			} else {
				noteEl.setText(parentPath);
			}
		}

		if (result.file.extension !== "md") {
			el.createDiv("suggestion-aux")
				.createSpan("suggestion-flair")
				.setText(result.file.extension);
		}
	}

	async onChooseSuggestion(
		result: CmdkResult,
		evt: MouseEvent | KeyboardEvent
	) {
		if (result.type === "create") {
			this.quickCreateNote(result.createQuery ?? "", evt);
			return;
		}



		if (result.type === "save") {
			const current = this.inputEl.value.trim();
			const name = await promptForName(this.app, current);
			if (name) {
				this.plugin.addSavedSearch(name, current);
			}
			this.close();
			return;
		}

		const leaf = Keymap.isModEvent(evt)
			? this.app.workspace.getLeaf("tab")
			: this.app.workspace.getMostRecentLeaf() ??
				this.app.workspace.getLeaf();

		const eState: Record<string, any> = {};
		if (result.type === "heading" && result.heading) {
			eState.subpath = "#" + result.heading;
		} else if (result.type === "content" && result.line != null) {
			eState.line = result.line;
		}

		leaf.setViewState({
			type: result.file.extension === "pdf" ? "pdf" : "markdown",
			state: { file: result.file.path },
			active: true,
		}).then(() => {
			if (eState.subpath || eState.line != null) {
				leaf.setEphemeralState(eState);
			}
		});
	}

	private async quickCreateNote(
		content: string,
		evt: MouseEvent | KeyboardEvent
	) {
		const settings = this.plugin.settings;
		const fmt = settings.cmdkQuickCreateTitleFormat || "YYYYMMDDHHmmss";
		const title = this.formatTimestamp(new Date(), fmt);

		// Resolve target folder
		let folderPath = settings.cmdkQuickCreateFolder.trim();
		if (!folderPath || folderPath === "/") {
			folderPath = "";
		}
		// Ensure folder exists
		if (folderPath) {
			const folder =
				this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder) {
				await this.app.vault.createFolder(folderPath);
			}
		}

		const filePath = folderPath
			? `${folderPath}/${title}.md`
			: `${title}.md`;

		const file = await this.app.vault.create(filePath, content);

		const leaf = Keymap.isModEvent(evt)
			? this.app.workspace.getLeaf("tab")
			: this.app.workspace.getMostRecentLeaf() ??
				this.app.workspace.getLeaf();

		await leaf.setViewState({
			type: "markdown",
			state: { file: file.path },
			active: true,
		});
	}

	private formatTimestamp(date: Date, fmt: string): string {
		const pad = (n: number, len = 2) =>
			String(n).padStart(len, "0");
		const tokens: Record<string, string> = {
			YYYY: String(date.getFullYear()),
			YY: String(date.getFullYear()).slice(-2),
			MM: pad(date.getMonth() + 1),
			DD: pad(date.getDate()),
			HH: pad(date.getHours()),
			mm: pad(date.getMinutes()),
			ss: pad(date.getSeconds()),
		};
		let result = fmt;
		// Replace longest tokens first to avoid partial matches
		for (const token of ["YYYY", "YY", "MM", "DD", "HH", "mm", "ss"]) {
			result = result.split(token).join(tokens[token]);
		}
		return result;
	}

	// Called by internal Chooser on selection change
	// @ts-ignore
	onSelectedChange = debounce(
		(result: CmdkResult, _evt: Event | null) => {
			if (result?.type === "create" || !result?.file) {
				this.hidePreview();
			} else {
				this.showPreview(result);
			}
		},
		100
	);

	private hidePreview() {
		if (this.previewEl) {
			this.previewEl.hide();
		}
	}

	async showPreview(result: CmdkResult) {
		if (!this.previewEl) {
			this.previewEl = this.bodyEl.createDiv(
				"float-search-cmdk-preview"
			);
			const [leaf, view] = spawnLeafView(
				this.plugin,
				this.previewEl
			);
			this.fileLeaf = leaf;
			this.fileEmbeddedView = view;
			this.fileLeaf.setPinned(true);
		}

		this.previewEl.show();
		this.modalEl.addClass("float-search-cmdk-expanded");

		const file = result.file;
		await this.fileLeaf!.openFile(file, { active: false });

		const eState: Record<string, any> = {};
		if (result.type === "heading" && result.heading) {
			eState.subpath = "#" + result.heading;
		} else if (result.type === "content" && result.line != null) {
			eState.line = result.line;
		}

		if (eState.subpath || eState.line != null) {
			this.fileLeaf!.setViewState({
				type: file.extension === "pdf" ? "pdf" : "markdown",
				state: { file: file.path },
			}).then(() => {
				this.fileLeaf?.setEphemeralState(eState);
			});
		}

		this.inputEl.focus();
	}

	onClose() {
		super.onClose?.();
		for (const [ev, h] of this.vaultHandlers) {
			this.app.vault.off(ev as any, h as any);
		}
		this.vaultHandlers = [];
		this.fileLeaf?.detach();
		this.fileEmbeddedView?.unload();
	}
}
