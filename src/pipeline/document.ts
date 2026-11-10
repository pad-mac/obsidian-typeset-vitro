import { App, FileSystemAdapter, TFile, parseYaml } from "obsidian";
import * as path from "path";
import type { VitroSettings } from "../settings";
import { VitroStyle } from "../style/schema";
import { DocMeta } from "../style/typst";
import { pandocToTypst } from "./pandoc";
import { preprocess, splitFrontmatter } from "./preprocess";
import * as fs from "fs";
import { ZotflowSource, extractCitekeys } from "./zotflow";

export interface BuildContext {
	pluginDirAbs: string;
	zotflow: ZotflowSource;
	/** Lua filter that removes citeproc's parentheses around citations in footnotes */
	noteCitationsFilter: string;
	/** Lua filter that accepts page labels in any language (pp., S., p. …) */
	pageLocatorsFilter: string;
}

const noteStyleCache = new Map<string, { mtime: number; note: boolean }>();

/** CSL "note" styles turn citations into footnotes (Chicago notes, most German humanities styles). */
export function isNoteStyle(cslPath: string): boolean {
	if (!cslPath) return false; // Pandoc's built-in style is author-date
	try {
		const mtime = fs.statSync(cslPath).mtimeMs;
		const hit = noteStyleCache.get(cslPath);
		if (hit && hit.mtime === mtime) return hit.note;
		const head = fs.readFileSync(cslPath, "utf8").slice(0, 4000);
		const note = /<style\b[^>]*\bclass\s*=\s*["']note["']/.test(head);
		noteStyleCache.set(cslPath, { mtime, note });
		return note;
	} catch {
		return false;
	}
}

export interface BodyResult {
	body: string;
	meta: DocMeta;
	frontmatter: Record<string, any>;
	warnings: string[];
}

export function vaultBasePath(app: App): string {
	const a = app.vault.adapter;
	if (a instanceof FileSystemAdapter) return a.getBasePath();
	throw new Error("Typeset Vitro needs the desktop app (vault on the local file system).");
}

export function readFrontmatter(text: string): Record<string, any> {
	const { frontmatter } = splitFrontmatter(text);
	if (!frontmatter) return {};
	try {
		const inner = frontmatter.replace(/^---\r?\n/, "").replace(/\r?\n(---|\.\.\.)\r?\n?$/, "");
		return (parseYaml(inner) as Record<string, any>) ?? {};
	} catch {
		return {};
	}
}

const asText = (v: unknown): string | undefined => {
	if (v == null || v === "") return undefined;
	if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(", ") || undefined;
	if (v instanceof Date) return v.toISOString().slice(0, 10);
	if (typeof v === "object") return asText((v as any).name ?? (v as any).literal);
	return String(v);
};

export function metaFrom(fm: Record<string, any>, file: TFile): DocMeta {
	return {
		title: asText(fm.title) ?? undefined,
		subtitle: asText(fm.subtitle),
		author: asText(fm.author ?? fm.authors),
		date: asText(fm.date),
		lang: asText(fm.lang),
	};
}

/** Everything in a style that changes Pandoc's output (as opposed to Typst's). */
export function pandocKey(s: VitroStyle): string {
	return JSON.stringify([s.citations, s.bibliography.show, s.bibliography.title, s.text.lang]);
}

export function resolveCsl(style: VitroStyle, pluginDirAbs: string, vaultBase: string): string {
	const c = style.citations.style;
	if (!c || c === "pandoc-default") return "";
	if (c.startsWith("bundled:")) return path.join(pluginDirAbs, "csl", c.slice(8) + ".csl");
	if (c.startsWith("vault:")) return path.join(vaultBase, c.slice(6));
	return c;
}

export function useZotflow(settings: VitroSettings, zotflow: ZotflowSource): boolean {
	if (settings.citationSource === "file") return false;
	if (settings.citationSource === "zotflow") return true;
	return zotflow.mode() !== "none";
}

export async function buildBody(
	app: App,
	settings: VitroSettings,
	style: VitroStyle,
	file: TFile,
	text: string,
	ctx: BuildContext
): Promise<BodyResult> {
	const base = vaultBasePath(app);
	const fm = readFrontmatter(text);

	const pre = await preprocess(
		text,
		file.path,
		{
			resolve: (link, from) => app.metadataCache.getFirstLinkpathDest(link, from)?.path ?? null,
			read: async (p) => {
				const f = app.vault.getAbstractFileByPath(p);
				return f instanceof TFile ? app.vault.cachedRead(f) : null;
			},
		},
		{ callouts: settings.callouts, stripTags: settings.stripTags, embedNotes: settings.embedNotes }
	);

	const hasRefsDiv = /:::\s*\{#refs\}/.test(pre.markdown);
	const warnings = [...pre.warnings];
	const bibliographies: string[] = [];
	const citekeys = extractCitekeys(pre.markdown);
	let zotflowMissing: string[] = [];

	if (!fm.bibliography && citekeys.length && useZotflow(settings, ctx.zotflow)) {
		if (ctx.zotflow.mode() === "none") {
			warnings.push("Citation data is set to come from ZotFlow, but ZotFlow isn't enabled.");
		} else {
			const z = await ctx.zotflow.resolve(citekeys);
			bibliographies.push(z.file);
			zotflowMissing = z.missing;
			if (z.warning) warnings.push(z.warning);
		}
	}
	if (!fm.bibliography && settings.bibliography) bibliographies.push(settings.bibliography);

	const csl = resolveCsl(style, ctx.pluginDirAbs, base);
	const res = await pandocToTypst(pre.markdown, {
		pandocPath: settings.pandocPath,
		cwd: base,
		bibliographies,
		luaFilters: [ctx.pageLocatorsFilter, ...(isNoteStyle(csl) ? [ctx.noteCitationsFilter] : [])],
		csl,
		lang: fm.lang ? undefined : style.text.lang,
		bibliographyTitle: style.bibliography.show && !hasRefsDiv ? style.bibliography.title.trim() : undefined,
		suppressBibliography: !style.bibliography.show,
		hardLineBreaks: settings.hardLineBreaks,
		docHasBibliography: !!fm.bibliography,
		docHasCsl: !!fm.csl,
	});

	// one clear line per unknown key instead of Pandoc's generic warning
	const unknown = new Set<string>();
	for (const w of res.warnings) {
		const m = w.match(/^Citeproc: citation (\S+) not found/);
		if (m) unknown.add(m[1]);
		else warnings.push(w);
	}
	if (unknown.size) {
		const viaZotflow = useZotflow(settings, ctx.zotflow) && ctx.zotflow.mode() !== "none";
		const where = viaZotflow ? (settings.bibliography ? "in ZotFlow or the bibliography file" : "in your ZotFlow library") : "in the bibliography file";
		const hint =
			viaZotflow && ctx.zotflow.mode() === "database"
				? " — if they are in Zotero, run a ZotFlow sync (or update ZotFlow Evo, which can then fetch missing citation data)."
				: "";
		warnings.push(`Not found ${where}: ${[...unknown].map((k) => "@" + k).join(", ")}${hint}`);
	}
	if (!bibliographies.length && !fm.bibliography && citekeys.length) {
		warnings.push("Citations found but there's no citation source: enable ZotFlow or set a bibliography file (Settings → Typeset Vitro).");
	}
	return { body: res.typst, meta: metaFrom(fm, file), frontmatter: fm, warnings };
}
