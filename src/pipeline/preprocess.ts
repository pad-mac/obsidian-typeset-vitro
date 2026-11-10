/**
 * Obsidian-flavoured Markdown → Pandoc Markdown.
 *
 * Handles the Obsidian-only syntax Pandoc doesn't know: wikilinks, embeds,
 * callouts, %%comments%%, block ids, inline tags. Fenced code and inline code
 * are protected from all rewriting.
 */

export interface Resolver {
	/** Vault path of the linked file, or null. */
	resolve(link: string, fromPath: string): string | null;
	/** Text of a vault file (for note embeds). */
	read(vaultPath: string): Promise<string | null>;
}

export interface PreprocessOptions {
	callouts: "quote" | "omit";
	stripTags: boolean;
	embedNotes: boolean;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;
const MAX_EMBED_DEPTH = 4;

export function splitFrontmatter(md: string): { frontmatter: string; body: string } {
	const m = md.match(/^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\r?\n?/);
	if (!m) return { frontmatter: "", body: md };
	return { frontmatter: m[0], body: md.slice(m[0].length) };
}

/** Replace code spans/blocks with placeholders, run fn, restore. */
function protectCode(text: string, fn: (t: string) => Promise<string>): Promise<string> {
	const saved: string[] = [];
	const hold = (s: string) => `\u0000${saved.push(s) - 1}\u0000`;
	let t = text.replace(/^(```+|~~~+)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, hold);
	t = t.replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g, hold);
	// display/inline math must also survive tag/link rewriting
	t = t.replace(/\$\$[\s\S]+?\$\$/g, hold);
	return fn(t).then((out) => out.replace(/\u0000(\d+)\u0000/g, (_, i) => saved[+i]));
}

function linkText(target: string, alias?: string): string {
	if (alias) return alias.trim();
	const [file, sub] = target.split("#");
	if (sub) {
		const s = sub.replace(/^\^/, "").trim();
		return file ? `${basename(file)} › ${s}` : s;
	}
	return basename(file);
}

function basename(p: string): string {
	return p.split("/").pop()!.replace(/\.md$/i, "");
}

function extractSection(md: string, heading: string): string {
	const lines = md.split("\n");
	const want = heading.trim().toLowerCase();
	let start = -1;
	let level = 0;
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
		if (!m) continue;
		if (start < 0 && m[2].trim().toLowerCase() === want) {
			start = i;
			level = m[1].length;
		} else if (start >= 0 && m[1].length <= level) {
			return lines.slice(start, i).join("\n");
		}
	}
	return start >= 0 ? lines.slice(start).join("\n") : "";
}

function convertCallouts(text: string, mode: "quote" | "omit"): string {
	const lines = text.split("\n");
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(/^(\s*>\s*)\[!([\w-]+)\][+-]?\s*(.*)$/);
		if (!m) {
			out.push(lines[i]);
			continue;
		}
		// collect the whole callout (consecutive > lines)
		let j = i + 1;
		while (j < lines.length && /^\s*>/.test(lines[j])) j++;
		if (mode === "quote") {
			if (m[3].trim()) out.push(`${m[1]}**${m[3].trim()}**`, m[1].trimEnd());
			out.push(...lines.slice(i + 1, j));
		}
		i = j - 1;
	}
	return out.join("\n");
}

export async function preprocess(
	md: string,
	fromPath: string,
	resolver: Resolver,
	opts: PreprocessOptions,
	depth = 0,
	warnings: string[] = []
): Promise<{ markdown: string; warnings: string[] }> {
	const { frontmatter, body } = splitFrontmatter(md);

	const out = await protectCode(body, async (t) => {
		// comments
		t = t.replace(/%%[\s\S]*?%%/g, "");
		t = t.replace(/<!--[\s\S]*?-->/g, "");

		// embeds: images and notes
		const embeds: Promise<string>[] = [];
		t = t.replace(/!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (_, target: string, alias?: string) => {
			const idx = embeds.length;
			embeds.push(
				(async () => {
					const [file, sub] = target.split("#");
					const path = resolver.resolve(file, fromPath);
					if (!path) {
						warnings.push(`Embed not found: ${target}`);
						return "";
					}
					if (IMAGE_EXT.test(path)) {
						const w = alias && /^\d+(x\d+)?$/.test(alias.trim()) ? `{width=${Math.round(parseInt(alias) * 0.75)}pt}` : "";
						const caption = alias && !/^\d+(x\d+)?$/.test(alias.trim()) ? alias : "";
						return `![${caption}](</${path}>)${w}`;
					}
					if (/\.md$/i.test(path) && opts.embedNotes) {
						if (depth >= MAX_EMBED_DEPTH) return "";
						let src = await resolver.read(path);
						if (src == null) return "";
						src = splitFrontmatter(src).body;
						if (sub && !sub.startsWith("^")) src = extractSection(src, sub);
						if (sub && sub.startsWith("^")) {
							const id = sub.slice(1);
							const para = src.split(/\n\s*\n/).find((p) => new RegExp(`\\^${id}\\s*$`).test(p.trim()));
							src = para ?? "";
						}
						const r = await preprocess(src, path, resolver, opts, depth + 1, warnings);
						return `\n\n${r.markdown}\n\n`;
					}
					return ""; // pdf, audio, … are not typeset
				})()
			);
			return `\u0001${idx}\u0001`;
		});
		const resolved = await Promise.all(embeds);
		t = t.replace(/\u0001(\d+)\u0001/g, (_, i) => resolved[+i]);

		// standard markdown images with vault-relative paths
		t = t.replace(/!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(\s+"[^"]*")?\)/g, (all, alt: string, rawUrl: string) => {
			let url = rawUrl.replace(/^<|>$/g, "");
			if (/^[a-z]+:\/\//i.test(url)) {
				warnings.push(`Remote image skipped: ${url}`);
				return alt;
			}
			if (url.startsWith("/")) return all;
			try {
				url = decodeURI(url);
			} catch {
				/* keep */
			}
			const path = resolver.resolve(url, fromPath);
			return path ? `![${alt}](</${path}>)` : all;
		});

		// wikilinks → their display text
		t = t.replace(/\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (_, target: string, alias?: string) => linkText(target, alias));

		// callouts
		t = convertCallouts(t, opts.callouts);

		// block ids at line end
		t = t.replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/gm, "");

		// inline tags (not headings: those need a space after #)
		if (opts.stripTags) t = t.replace(/(^|[\s(])#[\p{L}_][\p{L}\p{N}_/-]*/gu, "$1");

		return t;
	});

	return { markdown: frontmatter + out, warnings };
}
