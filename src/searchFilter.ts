import { App, TFile, prepareFuzzySearch } from "obsidian";

/**
 * SearchFilter — the single source of truth for matching files against
 * filter queries (chips / presets / the live CMDK modal input).
 *
 * It understands the full Obsidian Query Language operator set:
 *   tag:  path:  folder:  file:/name:  property:  [key::value]  prop:key:value  key::value
 *   line:  block:  section:  content:  task:
 *   - negation prefix (e.g.  -tag:done  -"some phrase")
 *   "quoted phrases"
 *   OR between groups (space = AND within a group)
 * Plain tokens are treated as free text (fuzzy on path + tried as a tag).
 *
 * A query is parsed into OR-groups of clauses. A file matches iff ANY group
 * matches (every clause in the group matches, AND-ed).
 *
 * Clauses split into two buckets for the async modal:
 *   - metadata clauses (no file read): tag/path/folder/name/property/text
 *   - content clauses (need file body): line/block/section/content/task
 */

export type Clause =
	| { kind: "tag"; tag: string; negated: boolean; quoted: boolean }
	| { kind: "path"; value: string; negated: boolean }
	| { kind: "folder"; value: string; negated: boolean }
	| { kind: "name"; value: string; negated: boolean }
	| {
			kind: "property";
			key: string;
			value?: string;
			negated: boolean;
	  }
	| { kind: "text"; value: string; negated: boolean; quoted: boolean }
	| { kind: "line"; value: string; negated: boolean }
	| { kind: "block"; value: string; negated: boolean }
	| { kind: "section"; value: string; negated: boolean }
	| { kind: "content"; value: string; negated: boolean }
	| { kind: "task"; value?: string; negated: boolean };

export interface Query {
	groups: Clause[][];
}

const CONTENT_KINDS = new Set([
	"line",
	"block",
	"section",
	"content",
	"task",
]);

function isContentKind(c: Clause): boolean {
	return CONTENT_KINDS.has(c.kind);
}

/** Does the query contain any content clause (so we must read file bodies)? */
export function requiresContent(query: Query): boolean {
	return query.groups.some((g) => g.some(isContentKind));
}

/** Parse a raw query string into OR-groups of clauses. */
export function parseQuery(raw: string): Query {
	const trimmed = raw.trim();
	if (!trimmed) return { groups: [] };
	const tokens = tokenize(trimmed);
	const groups: Clause[][] = [[]];
	for (const tok of tokens) {
		if (/^or$/i.test(tok)) {
			groups.push([]);
			continue;
		}
		const clause = parseClause(tok);
		if (clause) groups[groups.length - 1].push(clause);
	}
	return { groups: groups.filter((g) => g.length > 0) };
}

/** Tokenize respecting double quotes; keeps `-` negation prefix attached. */
function tokenize(raw: string): string[] {
	const tokens: string[] = [];
	const re = /-?"[^"]*"|-?\S+/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(raw)) !== null) tokens.push(m[0]);
	return tokens;
}

function parseClause(token: string): Clause | null {
	if (token === "-") return null;
	let negated = false;
	let t = token;
	if (t.startsWith("-") && t.length > 1) {
		negated = true;
		t = t.slice(1);
	}
	// Quoted phrase → free text
	if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
		return { kind: "text", value: t.slice(1, -1), negated, quoted: true };
	}

	// Bracket form: [key::value]
	const bracket = t.match(/^\[([^:]+)::(.*)\]$/);
	if (bracket) {
		return {
			kind: "property",
			key: bracket[1].trim(),
			value: bracket[2].trim() || undefined,
			negated,
		};
	}
	// Triple form: prop:key:value
	const prop = t.match(/^prop:([^:]+):(.*)$/);
	if (prop) {
		return {
			kind: "property",
			key: prop[1].trim(),
			value: prop[2].trim() || undefined,
			negated,
		};
	}

	const op = (name: string) => {
		const m = t.match(new RegExp("^" + name + ":(.+)$", "i"));
		return m ? m[1].trim() : null;
	};

	const tag = op("tag") ?? op("tags");
	if (tag !== null) {
		const v = tag.startsWith("#") ? tag : "#" + tag;
		return { kind: "tag", tag: v, negated, quoted: false };
	}
	const path = op("path");
	if (path !== null) return { kind: "path", value: path, negated };
	const folder = op("folder");
	if (folder !== null) return { kind: "folder", value: folder, negated };
	const name = op("file") ?? op("filename") ?? op("name");
	if (name !== null) return { kind: "name", value: name, negated };
	const line = op("line");
	if (line !== null) return { kind: "line", value: line, negated };
	const block = op("block");
	if (block !== null) return { kind: "block", value: block, negated };
	const section = op("section");
	if (section !== null)
		return { kind: "section", value: section, negated };
	const content = op("content");
	if (content !== null)
		return { kind: "content", value: content, negated };
	const task = t.match(/^task:(.*)$/i);
	if (task) {
		const v = task[1].trim();
		return {
			kind: "task",
			value: v === "" ? undefined : v,
			negated,
		};
	}
	const property = op("property");
	if (property !== null) {
		const idx = property.indexOf(":");
		if (idx === -1)
			return { kind: "property", key: property, negated };
		return {
			kind: "property",
			key: property.slice(0, idx).trim(),
			value: property.slice(idx + 1).trim() || undefined,
			negated,
		};
	}
	// Inline-property form: key::value
	const inline = t.match(/^([^:]+)::(.*)$/);
	if (inline) {
		return {
			kind: "property",
			key: inline[1].trim(),
			value: inline[2].trim() || undefined,
			negated,
		};
	}
	// Plain free text — fuzzy on path, also tried as a tag by callers.
	return { kind: "text", value: t, negated, quoted: false };
}

export class SearchFilter {
	constructor(private app: App) {}

	/** Does the file satisfy the parsed query (content optional)? */
	matches(file: TFile, filter: string, content?: string): boolean {
		const query = parseQuery(filter);
		if (query.groups.length === 0) return true;
		if (content !== undefined) return this.matchContent(file, content, query);
		// No content available: positive content clauses cannot be satisfied.
		return query.groups.some((group) =>
			group.every((c) => {
				if (isContentKind(c)) return c.negated; // unmet positive → false
				return this.matchMetaClause(file, c);
			})
		);
	}

	/** True iff file satisfies all METADATA clauses (no file read needed). */
	matchMetadata(file: TFile, query: Query): boolean {
		if (query.groups.length === 0) return true;
		return query.groups.some((group) =>
			group.every((c) => this.matchMetaClause(file, c))
		);
	}

	/** True iff file satisfies ALL clauses given its body content. */
	matchContent(file: TFile, content: string, query: Query): boolean {
		if (query.groups.length === 0) return true;
		return query.groups.some((group) =>
			group.every((c) => this.matchFullClause(file, content, c))
		);
	}

	private matchMetaClause(file: TFile, c: Clause): boolean {
		// Content clauses are evaluated by the async content phase, and free
		// text clauses by the caller's fuzzy match — both are neutral here so
		// they never pre-filter-out files that need a body read / fuzzy pass.
		if (isContentKind(c) || c.kind === "text") return true;
		const inner = this.matchClauseInner(file, null, c);
		return c.negated ? !inner : inner;
	}

	private matchFullClause(
		file: TFile,
		content: string,
		c: Clause
	): boolean {
		const inner = this.matchClauseInner(file, content, c);
		return c.negated ? !inner : inner;
	}

	private matchClauseInner(
		file: TFile,
		content: string | null,
		c: Clause
	): boolean {
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
				// Free text: match path (fuzzy-ish substring) and, when we
				// have the body, the content too.
				if (
					file.path.toLowerCase().includes(c.value.toLowerCase())
				)
					return true;
				if (
					content &&
					content.toLowerCase().includes(c.value.toLowerCase())
				)
					return true;
				// Saved presets may store a tag without '#'.
				const asTag = c.value.startsWith("#")
					? c.value
					: "#" + c.value;
				return this.fileHasTag(file, asTag);
			}
			case "line":
				return this.bodyHasLine(content, c.value);
			case "block":
				return this.bodyHasBlock(content, c.value);
			case "section":
				return this.fileHasSection(file, c.value);
			case "content":
				return (
					content?.toLowerCase().includes(c.value.toLowerCase()) ??
					false
				);
			case "task":
				return this.fileHasTask(content, c.value);
		}
	}

	private bodyHasLine(content: string | null, value: string): boolean {
		if (!content) return false;
		const v = value.toLowerCase();
		return content
			.split("\n")
			.some((line) => line.toLowerCase().includes(v));
	}

	private bodyHasBlock(content: string | null, value: string): boolean {
		if (!content) return false;
		// Obsidian block references are written as `^blockid`
		return content.includes("^" + value);
	}

	private fileHasSection(file: TFile, value: string): boolean {
		const cache = this.app.metadataCache.getFileCache(file);
		const v = value.toLowerCase();
		return (
			cache?.headings?.some((h) =>
				h.heading.toLowerCase().includes(v)
			) ?? false
		);
	}

	private fileHasTask(content: string | null, value?: string): boolean {
		if (!content) return false;
		const v = value?.toLowerCase();
		return content.split("\n").some((line) => {
			const m = line.match(/^\s*- \[( |x|X)\]/);
			if (!m) return false;
			if (!v) return true; // any task
			return line.toLowerCase().includes(v);
		});
	}

	/** Tag match with nested-tag support (e.g. #项目 also matches #项目/子). */
	fileHasTag(file: TFile, normalizedTag: string): boolean {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return false;
		// 1) Inline tags / the standard `tags` frontmatter property, both of
		// which Obsidian indexes into `cache.tags`.
		if (
			cache.tags?.some(
				(t) =>
					t.tag === normalizedTag ||
					t.tag.startsWith(normalizedTag + "/")
			)
		)
			return true;
		// 2) Tags stored under ANY frontmatter property (custom property
		// names, YAML lists, or comma/space separated strings). This covers
		// vaults where every tag lives in properties rather than inline.
		const fm = cache.frontmatter;
		if (fm) {
			const tagBase = normalizedTag.replace(/^#/, "");
			for (const value of Object.values(fm)) {
				if (this.valueHasTag(value, tagBase, normalizedTag))
					return true;
			}
		}
		return false;
	}

	private valueHasTag(
		value: unknown,
		tagBase: string,
		normalizedTag: string
	): boolean {
		if (typeof value === "string") {
			const tokens = value
				.split(/[,\n\s]+/)
				.map((s) => s.trim())
				.filter(Boolean);
			return tokens.some((tok) => this.tagEquals(tok, normalizedTag));
		}
		if (Array.isArray(value)) {
			return value.some(
				(v) =>
					typeof v === "string" &&
					this.tagEquals(v.trim(), normalizedTag)
			);
		}
		return false;
	}

	private tagEquals(tok: string, normalizedTag: string): boolean {
		const t = tok.startsWith("#") ? tok : "#" + tok;
		return t === normalizedTag || t.startsWith(normalizedTag + "/");
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
	 * Used by the CMDK modal for fast set-membership filtering (chips).
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
	 * CMDK modal. Native search understands every operator we support.
	 */
	toNativeQuery(filter: string): string {
		const query = parseQuery(filter);
		if (query.groups.length === 0) return filter;
		return query.groups
			.map((group) =>
				group.map((c) => this.clauseToNative(c)).join(" ")
			)
			.join(" OR ");
	}

	private clauseToNative(c: Clause): string {
		const neg = c.negated ? "-" : "";
		switch (c.kind) {
			case "tag":
				return neg + "tag:" + c.tag.replace(/^#/, "");
			case "path":
				return neg + "path:" + c.value;
			case "folder":
				// Native search has no dedicated folder operator; a path
				// prefix matches the containing folder closely enough.
				return neg + "path:" + c.value;
			case "name":
				return neg + "file:" + c.value;
			case "property":
				return c.value === undefined
					? neg + "property:" + c.key
					: `${neg}[${c.key}::${c.value}]`;
			case "text": {
				if (c.quoted) return neg + `"${c.value}"`;
				if (this.looksLikeTag(c.value)) return "tag:" + c.value;
				return neg + c.value;
			}
			case "line":
				return neg + "line:" + c.value;
			case "block":
				return neg + "block:" + c.value;
			case "section":
				return neg + "section:" + c.value;
			case "content":
				return neg + "content:" + c.value;
			case "task":
				return neg + "task:" + (c.value ?? "");
		}
	}

	private looksLikeTag(token: string): boolean {
		// Tag-like if it contains a nested-tag slash or any non-ASCII
		// character (emoji / CJK), i.e. clearly not a plain ASCII filename
		// search term.
		return /[/]/.test(token) || /[^\x00-\x7F]/.test(token);
	}
}
