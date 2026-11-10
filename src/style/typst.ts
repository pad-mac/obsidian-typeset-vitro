import { VitroStyle, Weight, HeadingStyle } from "./schema";

/**
 * Turns a VitroStyle into a self-contained Typst template:
 *
 *   #import "my-style.typ": *
 *   #show: vitro
 *   #vitro-title(title: [...])
 *   ... body ...
 *
 * The preview uses exactly this code, so an exported template renders identically.
 */

const PAPER_ARGS: Record<string, string> = {
	a4: `paper: "a4"`,
	a5: `paper: "a5"`,
	"iso-b5": `paper: "iso-b5"`,
	"us-letter": `paper: "us-letter"`,
	"155x230": `width: 155mm, height: 230mm`,
	"170x240": `width: 170mm, height: 240mm`,
};

const num = (n: number): string => {
	const v = Number.isFinite(n) ? n : 0;
	return String(Math.round(v * 1000) / 1000);
};
const pt = (n: number) => `${num(n)}pt`;
const em = (n: number) => `${num(n)}em`;
const mm = (n: number) => `${num(n)}mm`;
const str = (s: string) => JSON.stringify(s.replace(/[\u0000-\u001f]/g, ""));
const weight = (w: Weight) => str(w);

/** Font list with Typst's bundled fonts as fallback, so a missing font never blanks the page. */
export function fontList(font: string): string {
	const fonts = font
		.split(",")
		.map((f) => f.trim())
		.filter(Boolean);
	if (!fonts.includes("Libertinus Serif")) fonts.push("Libertinus Serif");
	return `(${fonts.map(str).join(", ")})`;
}

/** Escape plain text for use inside Typst markup ([...]). */
export function escapeMarkup(text: string): string {
	return text.replace(/[\u0000-\u001f]/g, " ").replace(/[\\#\[\]*_`$<>@~/=+\-.]/g, (c) => "\\" + c);
}

function headingRules(level: number, h: HeadingStyle, s: VitroStyle): string[] {
	const sel = `heading.where(level: ${level})`;
	const out: string[] = [];
	const textArgs = [
		h.font.trim() ? `font: ${fontList(h.font)}` : null,
		`size: ${pt(h.size)}`,
		`weight: ${weight(h.weight)}`,
		`style: ${h.italic ? `"italic"` : `"normal"`}`,
	].filter(Boolean);
	out.push(`show ${sel}: set text(${textArgs.join(", ")})`);
	out.push(`show ${sel}: set block(above: ${em(h.above)}, below: ${em(h.below)})`);
	out.push(`show ${sel}: set align(${h.align})`);
	out.push(`show ${sel}: set par(justify: false)`);
	if (!h.numbered) out.push(`show ${sel}: set heading(numbering: none)`);
	if (h.smallCaps || h.pageBreak) {
		const body = h.smallCaps ? "smallcaps(it)" : "it";
		out.push(`show ${sel}: it => {${h.pageBreak ? " pagebreak(weak: true);" : ""} ${body} }`);
	}
	return out;
}

function footerRule(s: VitroStyle): string | null {
	const p = s.page;
	if (p.numbering === "none") return null;
	const from = Math.max(1, Math.round(p.numberFrom || 1));
	// outside = the physical side: odd pages are right-hand pages
	const alignExpr =
		p.numberAlign === "outside"
			? p.twoSided
				? `if calc.even(p) { left } else { right }`
				: `right`
			: p.numberAlign;
	const show = `align(${alignExpr}, text(size: ${pt(p.numberSize)}, counter(page).display(${str(p.numbering)})))`;
	const conds = [from > 1 ? `p >= ${from}` : null, p.hideFirstNumber ? `p != ${from}` : null].filter(Boolean);
	const body = conds.length ? `if ${conds.join(" and ")} { ${show} }` : show;
	return `footer: context { let p = here().page(); ${body} }`;
}

/** Restart the page counter on the first numbered page (so the contents list agrees). */
function headerRule(s: VitroStyle): string | null {
	const from = Math.max(1, Math.round(s.page.numberFrom || 1));
	if (s.page.numbering === "none" || from <= 1 || !s.page.restartNumbering) return null;
	return `header: context { if here().page() == ${from} { counter(page).update(1) } }`;
}

const MARKER_PATTERNS: Record<string, [string, string]> = {
	"1": ["", ""],
	"[1]": ["[", "]"],
	"1)": ["", ")"],
	"(1)": ["(", ")"],
};

function tocRules(s: VitroStyle): string[] {
	const t = s.toc;
	const out = [
		`show outline.entry: set text(size: ${pt(t.size)})`,
		`show outline.entry: set block(spacing: ${em(t.spacing)})`,
		`show outline.entry.where(level: 1): set block(above: ${em(t.level1Above)})`,
		`set outline.entry(fill: ${t.leaders ? "repeat([.], gap: 0.25em)" : "none"})`,
	];
	if (t.level1Bold) out.push(`show outline.entry.where(level: 1): set text(weight: "bold")`);
	if (!t.pageNumbers) out.push(`show outline.entry: it => link(it.element.location(), it.indented(it.prefix(), it.body()))`);
	return out;
}

export function buildTemplate(s: VitroStyle): string {
	const p = s.page;
	const t = s.text;
	const f = s.footnotes;
	const q = s.quotes;
	const b = s.bibliography;
	const anyNumbered = s.headings.levels.some((l) => l.numbered);
	const numberPattern = { "1.1": "1.1", "1.1.": "1.1.", "I.1": "I.1" }[s.headings.numberFormat];

	const margins = p.twoSided
		? `(top: ${mm(p.marginTop)}, bottom: ${mm(p.marginBottom)}, inside: ${mm(p.marginInner)}, outside: ${mm(p.marginOuter)})`
		: `(top: ${mm(p.marginTop)}, bottom: ${mm(p.marginBottom)}, left: ${mm(p.marginInner)}, right: ${mm(p.marginOuter)})`;

	const footer = footerRule(s);
	const header = headerRule(s);
	const pageArgs = [PAPER_ARGS[p.paper] ?? `paper: "a4"`, `margin: ${margins}`, `numbering: ${p.numbering === "none" ? "none" : str(p.numbering)}`];
	if (header) pageArgs.push(header);
	if (footer) pageArgs.push(footer);

	const markExpr = f.entryMarker === "super" ? "super(num)" : "[#num.]";
	const m = f.marker;
	const [pre, post] = MARKER_PATTERNS[m.format] ?? ["", ""];
	// the in-text pattern may wrap the number; the note itself uses the bare one
	const textPattern = f.numbering === "*" ? "*" : `${pre}${f.numbering}${post}`;
	const markerRules = [
		`show footnote: set super(typographic: ${m.typographic}, size: ${num(m.size / 100)}em, baseline: ${em(-m.raise)})`,
		`show footnote: set text(weight: ${weight(m.weight)}${m.color ? `, fill: rgb(${str(m.color)})` : ""})`,
		m.spaceBefore > 0 ? `show footnote: it => [#h(${em(m.spaceBefore)})#it]` : null,
	].filter((x): x is string => !!x);
	const footnoteEntry = f.hanging
		? `[#set par(hanging-indent: ${em(f.hangWidth)}); #box(width: ${em(f.hangWidth)}, mark)#it.note.body]`
		: `[#h(${em(f.indent)})#mark#h(0.25em)#it.note.body]`;

	const L = (s: string) => "  " + s;
	const rules: string[] = [
		`set page(${pageArgs.join(", ")})`,
		`set text(font: ${fontList(t.font)}, size: ${pt(t.size)}, lang: lang, region: region, hyphenate: ${t.hyphenate}${t.oldStyleFigures ? `, number-type: "old-style"` : ""})`,
		`set par(justify: ${t.justify}, leading: ${em(t.leading)}, spacing: ${em(t.parSpacing)}, first-line-indent: (amount: ${em(t.indent)}, all: ${t.indentAll}))`,
		`set heading(numbering: ${anyNumbered ? str(numberPattern) : "none"})`,
		...s.headings.levels.flatMap((h, i) => headingRules(i + 1, h, s)),
		// headings below level 3 inherit level 3
		...[4, 5, 6].flatMap((l) => headingRules(l, s.headings.levels[2], s)),
		`set footnote(numbering: ${str(textPattern)})`,
		...markerRules,
		`set footnote.entry(separator: line(length: ${num(f.separatorLength)}%, stroke: ${pt(f.separatorStroke)}), gap: ${em(f.gap)}, clearance: ${em(f.clearance)}, indent: 0em)`,
		`show footnote.entry: set text(size: ${pt(f.size)})`,
		`show footnote.entry: set par(leading: ${em(f.leading)}, first-line-indent: 0em, justify: ${f.justify})`,
		`show footnote.entry: it => context {`,
		`  let loc = it.note.location()`,
		`  let num = numbering(${str(f.numbering)}, ..counter(footnote).at(loc))`,
		`  let mark = link(loc, ${markExpr})`,
		`  ${footnoteEntry}`,
		`}`,
		`show quote.where(block: true): it => block(above: ${em(q.above)}, below: ${em(q.below)}, inset: (left: ${em(q.indentLeft)}, right: ${em(q.indentRight)}))[`,
		`  #set text(size: ${pt(q.size)}${q.italic ? `, style: "italic"` : ""})`,
		`  #set par(first-line-indent: 0em, leading: ${em(q.leading)})`,
		`  #it.body`,
		`]`,
		`show <refs>: set text(size: ${pt(b.size)})`,
		`show <refs>: set par(hanging-indent: ${em(b.hangingIndent)}, first-line-indent: 0em, justify: ${b.justify})`,
		`show <refs>: set block(spacing: ${em(b.spacing)})`,
		`show figure.caption: set text(size: ${pt(s.figures.captionSize)})`,
		...tocRules(s),
		`set table(inset: 6pt, stroke: none)`,
		`show figure.where(kind: table): set figure.caption(position: top)`,
		`show figure.where(kind: image): set figure.caption(position: bottom)`,
		`doc`,
	];

	const ti = s.title;
	const titleFont = ti.font.trim() ? `font: ${fontList(ti.font)}, ` : "";
	const metaFont = ti.metaFont.trim() ? `font: ${fontList(ti.metaFont)}, ` : "";
	const titleFn = [
		`#let vitro-title(title: none, subtitle: none, author: none, date: none) = {`,
		`  if title == none { return }`,
		`  set par(first-line-indent: 0em, justify: false)`,
		`  block(width: 100%, below: ${em(ti.below)}, align(${ti.align}, {`,
		`    text(${titleFont}size: ${pt(ti.size)}, weight: ${weight(ti.weight)}, hyphenate: false, title)`,
		`    if subtitle != none { parbreak(); v(-0.4em); text(${titleFont}size: ${pt(ti.subtitleSize)}, subtitle) }`,
		`    if author != none or date != none {`,
		`      parbreak(); v(0.4em)`,
		`      set text(${metaFont}size: ${pt(ti.metaSize)})`,
		`      if author != none { author }`,
		`      if author != none and date != none { linebreak() }`,
		`      if date != none { date }`,
		`    }`,
		`  }))`,
		ti.ownPage ? `  pagebreak()` : null,
		`}`,
	].filter((x) => x !== null);

	const toc = s.toc;
	const tocFn = [
		`#let vitro-toc() = {`,
		`  outline(title: ${toc.title.trim() ? `[${escapeMarkup(toc.title.trim())}]` : "none"}, depth: ${Math.max(1, Math.min(6, Math.round(toc.depth)))}, indent: ${em(toc.indent)})`,
		toc.ownPage ? `  pagebreak(weak: true)` : `  v(1.5em)`,
		`}`,
	];

	return [
		`// Typeset Vitro style: ${s.name.replace(/\n/g, " ")}`,
		`// Usage:  #import "this-file.typ": *`,
		`//         #show: vitro            (or vitro.with(lang: "en"))`,
		``,
		`// Helpers Pandoc's Typst writer expects`,
		`#let horizontalrule = block(width: 100%, above: 1.2em, below: 1.2em, align(center, line(length: 30%, stroke: 0.5pt)))`,
		`#let blockquote(body) = quote(block: true, body)`,
		`#show terms.item: it => block(breakable: false)[`,
		`  #text(weight: "bold")[#it.term]`,
		`  #block(inset: (left: 1.5em, top: -0.4em))[#it.description]`,
		`]`,
		``,
		...titleFn,
		``,
		...tocFn,
		``,
		`#let vitro(lang: ${str(t.lang || "en")}, region: none, doc) = {`,
		...rules.map(L),
		`}`,
		``,
	].join("\n");
}

export interface DocMeta {
	title?: string;
	subtitle?: string;
	author?: string;
	date?: string;
	lang?: string;
}

/** The full main.typ for a note: template + title + Pandoc body. */
export function buildDocument(s: VitroStyle, meta: DocMeta, body: string): string {
	const [lang, region] = (meta.lang || s.text.lang || "en").split(/[-_]/);
	const head = [
		buildTemplate(s),
		meta.title ? `#set document(title: ${str(meta.title)}${meta.author ? `, author: ${str(meta.author)}` : ""})` : "",
		`#show: vitro.with(lang: ${str(lang.toLowerCase())}, region: ${region ? str(region.toUpperCase()) : "none"})`,
	];
	if (s.title.show && meta.title) {
		const arg = (k: string, v?: string) => (v ? `${k}: [${escapeMarkup(v)}]` : null);
		const args = [arg("title", meta.title), arg("subtitle", meta.subtitle), arg("author", meta.author), arg("date", meta.date)].filter(Boolean);
		head.push(`#vitro-title(${args.join(", ")})`);
	}
	if (s.toc.show) head.push(`#vitro-toc()`);
	head.push("", "// ---- body (generated by Pandoc) ----", "");
	return head.join("\n") + body;
}
