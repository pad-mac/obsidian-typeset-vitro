import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { runProcess } from "./pandoc";

/**
 * Font previews rendered by Typst itself: one tiny SVG per font family, the
 * family name set in that font. Exactly what the PDF will use, including
 * Typst's built-in fonts and fonts from extra font folders.
 *
 * Cached on disk per (font list, Typst version); rendering ~300 fonts takes
 * about two seconds once.
 */
export async function renderFontPreviews(opts: {
	typstPath: string;
	fontPaths: string[];
	fonts: string[];
	cacheRoot: string;
	typstVersion: string;
}): Promise<Map<string, string>> {
	const hash = createHash("sha1").update(opts.typstVersion + "\u0000" + opts.fonts.join("\u0000")).digest("hex").slice(0, 12);
	const dir = path.join(opts.cacheRoot, `fonts-${hash}`);
	const done = path.join(dir, "done");
	const result = () => new Map(opts.fonts.map((f, i) => [f, path.join(dir, `f-${i + 1}.svg`)]));
	if (fs.existsSync(done)) return result();

	// old previews (other font lists) go
	try {
		for (const d of fs.readdirSync(opts.cacheRoot)) if (d.startsWith("fonts-") && d !== `fonts-${hash}`) fs.rmSync(path.join(opts.cacheRoot, d), { recursive: true, force: true });
	} catch {
		/* ignore */
	}
	fs.mkdirSync(dir, { recursive: true });

	const lines = [
		`#set page(width: auto, height: auto, margin: (x: 1pt, y: 2pt), fill: none)`,
		`#set text(size: 15pt, fill: black, top-edge: "ascender", bottom-edge: "descender")`,
	];
	opts.fonts.forEach((f, i) => {
		if (i) lines.push("#pagebreak()");
		// fallback: false so the preview shows the font's own glyphs only
		const s = JSON.stringify(f);
		lines.push(`#text(font: ${s}, fallback: false, ${s})`);
	});
	const src = path.join(dir, "previews.typ");
	fs.writeFileSync(src, lines.join("\n"), "utf8");
	const args = ["compile", src, path.join(dir, "f-{p}.svg"), "--root", dir];
	for (const fp of opts.fontPaths) args.push("--font-path", fp);
	const r = await runProcess(opts.typstPath || "typst", args, { timeoutMs: 120000 });
	if (r.code !== 0) throw new Error(r.stderr.trim() || "typst failed rendering font previews");
	fs.writeFileSync(done, String(Date.now()));
	return result();
}
