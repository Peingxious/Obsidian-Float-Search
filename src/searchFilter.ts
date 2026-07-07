import { App, TFile, prepareFuzzySearch } from "obsidian";

/**
 * SearchFilter — the single source of truth for matching files against
 * filter queries (chips / presets). Used by both the CMDK fuzzy modal
 * (set-based precompute) and, via `toNativeQuery`, the main float search.
 *
 * A filter string is split into space-separated CLAUSES. Each clause
 * addresses exactly one dimension (tag / path / folder / name / property /
 * text). A filter matches a file iff EVERY clause matches (AND). Multiple
 * active filters (chips) are AND-ed together by the caller.
 */

export type Clause =
	| { kind: "tag"; tag: string }
	| { kind: "path"; value: string }
	| { kind: "folder"; value: string }
	| { kind: "name"; value: string }
	| { kind: "property"; key: string; value?: string }
	| { kind: "text"; value: string };

/** Split a filter string into its component clauses. */
export function parseFilter(raw: string): Clause[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	return trimmed.split(/\s+/).map(parseClause);
}

function parseClause(token: string): Clause {
	// Bracket form: [key::value]  (Obsidian native property syntax)
	const bracket = token.match(/^\[([^:]+)::(.*)\]$/);
	if (bracket) {
		return {
			kind: "property",
			key: bracket[1].trim(),
			value: bracket[2].trim() || undefined,
		};
	}
	// Triple form: prop:key:value
	const prop = token.match(/^prop:([^:]+):(.*)$/);
	if (prop) {
		return {
			kind: "property",
			key: prop[1].trim(),
			value: prop[2].trim() || undefined,
		};
	}
	// Inline-property form: key::value  (dataview / inline property style)
	const inline = token.match(/^([^:]+)::(.*)$/);
	if (inline) {
		return {
			kind: "property",
			key: inline[1].trim(),
			value: inline[2].trim() || undefined,
		};
	}
	// Tag: tag:xxx or #xxx
	const tag = token.match(/^tag:(.+)$/) || token.match(/^#(.+)$/);
	if (tag) {
		const t = tag[1].trim();
		return { kind: "tag", tag: t.startsWith("#") ? t : "#" + t };
	}
	// Path prefix
	const path = token.match(/^path:(.+)$/);
	if (path) return { kind: "path", value: path[1].trim() };
	// Folder (parent directory only)
	const folder = token.match(/^folder:(.+)$/);
	if (folder) return { kind: "folder", value: folder[1].trim() };
	// Filename
	const name = token.match(/^(?:file|name):(.+)$/);
	if (name) return { kind: "name", value: name[1].trim() };
	// Plain text — fuzzy on path, and also tried as a tag (saved presets
	// may omit the leading '#', e.g. "📬/笔记" → tag "#📬/笔记").
	return { kind: "text", value: token };
}

export class SearchFilter {
	constructor(private app: App) {}

	/** Does the file satisfy every clause of the filter? */
	matches(file: TFile, filter: string): boolean {
		const clauses = parseFilter(filter);
		if (clauses.length === 0) return true;
		return clauses.every((c) => this.matchClause(file, c));
	}

	private matchClause(file: TFile, c: Clause): boolean {
		switch (c.kind) {
			case "tag":
				return this.fileHasTag(file, c.tag);
			case "path":
				return file.path
					.toLowerCase()
					.includes(c.value.toLowerCase());
			case "folder": {
				const parent = file.parent?.path ?? "";
				return parent
					.toLowerCase()
					.includes(c.value.toLowerCase());
			}
			case "name":
				return (
					file.name.toLowerCase().includes(c.value.toLowerCase()) ||
					file.basename.toLowerCase() === c.value.toLowerCase()
				);
			case "property":
				return this.matchProperty(file, c.key, c.value);
			case "text": {
				const fuzzy = prepareFuzzySearch(c.value);
				if (fuzzy(file.path) != null) return true;
				// Saved presets may store a tag without '#'.
				const asTag = c.value.startsWith("#")
					? c.value
					: "#" + c.value;
				return this.fileHasTag(file, asTag);
			}
		}
	}

	/** Tag match with nested-tag support (e.g. #项目 also matches #项目/子). */
	fileHasTag(file: TFile, normalizedTag: string): boolean {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.tags) return false;
		return cache.tags.some(
			(t) =>
				t.tag === normalizedTag ||
				t.tag.startsWith(normalizedTag + "/")
		);
	}

	/** Frontmatter or inline property match. Value is optional (existence). */
	private matchProperty(
		file: TFile,
		key: string,
		value?: string
	): boolean {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm || !(key in fm)) return false;
		if (value === undefined) return true;
		return String(fm[key])
			.toLowerCase()
			.includes(value.toLowerCase());
	}

	/**
	 * Precompute, for each filter string, the set of matching file paths.
	 * Used by the CMDK modal for fast set-membership filtering.
	 */
	buildMatchSets(
		files: TFile[],
		filters: string[]
	): Map<string, Set<string>> {
		const map = new Map<string, Set<string>>();
		for (const f of filters) {
			const set = new Set<string>();
			for (const file of files) {
				if (this.matches(file, f)) set.add(file.path);
			}
			map.set(f, set);
		}
		return map;
	}

	/**
	 * Translate a filter into a native Obsidian search query so the SAME
	 * preset yields the same results in the native search view as in the
	 * CMDK modal. Native search understands `tag:` / `path:` / `file:` /
	 * `[key::value]`, but it does NOT know our bare-token tag shorthand
	 * (e.g. `📬/笔记` stored without `#`). We normalize those here.
	 */
	toNativeQuery(filter: string): string {
		const clauses = parseFilter(filter);
		if (clauses.length === 0) return filter;
		return clauses.map((c) => this.clauseToNative(c)).join(" ");
	}

	private clauseToNative(c: Clause): string {
		switch (c.kind) {
			case "tag":
				return "tag:" + c.tag.replace(/^#/, "");
			case "path":
				return "path:" + c.value;
			case "folder":
				// Native search has no dedicated folder operator; a path
				// prefix matches the containing folder closely enough.
				return "path:" + c.value;
			case "name":
				return "file:" + c.value;
			case "property":
				return c.value === undefined
					? "property:" + c.key
					: `[${c.key}::${c.value}]`;
			case "text": {
				// A bare token that looks like a tag (emoji / CJK / nested
				// slash) is searched as a tag, matching the CMDK behavior
				// which also tries the token as a tag (so presets like
				// "📬/笔记" resolve to tag "📬/笔记" in native search too).
				if (this.looksLikeTag(c.value)) return "tag:" + c.value;
				return c.value;
			}
		}
	}

	private looksLikeTag(token: string): boolean {
		// Tag-like if it contains a nested-tag slash or any non-ASCII
		// character (emoji / CJK), i.e. clearly not a plain ASCII filename
		// search term.
		return /[/]/.test(token) || /[^\x00-\x7F]/.test(token);
	}
}
