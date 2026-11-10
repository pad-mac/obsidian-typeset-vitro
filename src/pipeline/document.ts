import { App, FileSystemAdapter, TFile, parseYaml } from "obsidian";
import * as path from "path";
import type { VitroSettings } from "../settings";
import { VitroStyle } from "../style/schema";
import { DocMeta } from "../style/typst";
import { pandocToTypst } from "./pandoc";
import { preprocess, splitFrontmatter } from "./preprocess";

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

export function resolveCsl(style: VitroStyle, pluginDirAbs: string): string {
	const c = style.citations.style;
	if (!c || c === "pandoc-default") return "";
	if (c.startsWith("bundled:")) return path.join(pluginDirAbs, "csl", c.slice(8) + ".csl");
	return c;
}

export async function buildBody(
	app: App,
	settings: VitroSettings,
	style: VitroStyle,
	file: TFile,
	text: string,
	pluginDirAbs: string
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
	const bib = fm.bibliography ? "" : settings.bibliography;
	const res = await pandocToTypst(pre.markdown, {
		pandocPath: settings.pandocPath,
		cwd: base,
		bibliography: bib,
		csl: resolveCsl(style, pluginDirAbs),
		lang: fm.lang ? undefined : style.text.lang,
		bibliographyTitle: style.bibliography.show && !hasRefsDiv ? style.bibliography.title.trim() : undefined,
		suppressBibliography: !style.bibliography.show,
		hardLineBreaks: settings.hardLineBreaks,
		docHasBibliography: !!fm.bibliography,
		docHasCsl: !!fm.csl,
	});

	const warnings = [...pre.warnings, ...res.warnings];
	if (!bib && !fm.bibliography && /\[[^\]]*@[\w:.#$%&\-+?<>~/]+/.test(pre.markdown)) {
		warnings.push("Citations found but no bibliography file is set (Settings → Typeset Vitro).");
	}
	return { body: res.typst, meta: metaFrom(fm, file), frontmatter: fm, warnings };
}
