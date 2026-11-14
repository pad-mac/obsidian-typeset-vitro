import { Menu, Modal, Setting, setIcon, setTooltip } from "obsidian";
import type TypesetVitroPlugin from "../main";
import { FontPicker } from "./FontPicker";
import { PAPERS, VitroStyle, cloneStyle, makeBuiltInPresets } from "../style/schema";

type Path = string;

interface Base {
	label: string;
	path: Path;
	hint?: string;
	when?: (s: VitroStyle) => boolean;
	/** changing this needs a new Pandoc run (citations, bibliography) */
	content?: boolean;
	/** shown only on this tab of a tabbed section */
	tab?: number;
}
type Ctl =
	| (Base & { kind: "number"; unit: string; step: number })
	| (Base & { kind: "select"; options: [string, string][] | ((plugin: TypesetVitroPlugin) => [string, string][]) })
	| (Base & { kind: "toggle" })
	| (Base & { kind: "font"; placeholder?: string })
	| (Base & { kind: "text"; placeholder?: string })
	| (Base & { kind: "color"; placeholder?: string });

interface Section {
	id: string;
	title: string;
	icon: string;
	/** tab labels; with `substitute`, "$h" in paths becomes the tab index (heading levels) */
	tabs?: { labels: string[]; substitute?: boolean };
	controls: Ctl[];
}

/** Number field. No min/max on purpose: any value is allowed, the step only sets arrow keys and scrubbing. */
const n = (label: string, path: Path, unit: string, step: number, extra: Partial<Base> = {}): Ctl => ({
	kind: "number",
	label,
	path,
	unit,
	step,
	...extra,
});
const sel = (
	label: string,
	path: Path,
	options: [string, string][] | ((plugin: TypesetVitroPlugin) => [string, string][]),
	extra: Partial<Base> = {}
): Ctl => ({ kind: "select", label, path, options, ...extra });
const tog = (label: string, path: Path, extra: Partial<Base> = {}): Ctl => ({ kind: "toggle", label, path, ...extra });

const WEIGHTS: [string, string][] = [
	["regular", "Regular"],
	["medium", "Medium"],
	["semibold", "Semibold"],
	["bold", "Bold"],
];
const LANGS: [string, string][] = [
	["de", "German"],
	["en", "English"],
	["fr", "French"],
	["it", "Italian"],
	["es", "Spanish"],
	["nl", "Dutch"],
	["pl", "Polish"],
	["pt", "Portuguese"],
];

const H = "headings.levels.$h.";

const SECTIONS: Section[] = [
	{
		id: "page",
		title: "Page",
		icon: "file",
		controls: [
			sel("Format", "page.paper", Object.entries(PAPERS)),
			tog("Two-sided", "page.twoSided", { hint: "Mirror margins for printing as a book" }),
			n("Top", "page.marginTop", "mm", 1),
			n("Bottom", "page.marginBottom", "mm", 1),
			n("Inner", "page.marginInner", "mm", 1, { when: (s) => s.page.twoSided }),
			n("Outer", "page.marginOuter", "mm", 1, { when: (s) => s.page.twoSided }),
			n("Left", "page.marginInner", "mm", 1, { when: (s) => !s.page.twoSided }),
			n("Right", "page.marginOuter", "mm", 1, { when: (s) => !s.page.twoSided }),
			sel("Page numbers", "page.numbering", [
				["none", "None"],
				["1", "1, 2, 3"],
				["i", "i, ii, iii"],
			]),
			sel(
				"Position",
				"page.numberAlign",
				[
					["center", "Centered"],
					["right", "Right"],
					["outside", "Outside"],
				],
				{ when: (s) => s.page.numbering !== "none" }
			),
			n("Number size", "page.numberSize", "pt", 0.5, { when: (s) => s.page.numbering !== "none" }),
			n("Numbers from page", "page.numberFrom", "", 1, {
				when: (s) => s.page.numbering !== "none",
				hint: "Pages before this one (title, contents) carry no number",
			}),
			tog("Count from 1 there", "page.restartNumbering", {
				when: (s) => s.page.numbering !== "none" && s.page.numberFrom > 1,
				hint: "Off: the number counts the pages before it too",
			}),
			tog("Hide on first numbered page", "page.hideFirstNumber", { when: (s) => s.page.numbering !== "none" }),
		],
	},
	{
		id: "text",
		title: "Body text",
		icon: "pilcrow",
		controls: [
			{ kind: "font", label: "Font", path: "text.font" },
			n("Size", "text.size", "pt", 0.5),
			n("Line gap", "text.leading", "em", 0.05, { hint: "Space between lines. 0.65 is Typst's default, ~1.0 looks like Word's 1.5 spacing." }),
			n("Paragraph gap", "text.parSpacing", "em", 0.05, { hint: "Extra space between paragraphs. Same as the line gap = no visible gap." }),
			n("First-line indent", "text.indent", "em", 0.1),
			tog("Indent after headings", "text.indentAll"),
			tog("Justified", "text.justify"),
			tog("Hyphenation", "text.hyphenate"),
			tog("Old-style figures", "text.oldStyleFigures", { hint: "Lowercase numerals (1234) — needs a font that has them" }),
			sel("Language", "text.lang", LANGS, { content: true, hint: "Quotes, hyphenation and citation terms. A note's `lang:` frontmatter wins." }),
		],
	},
	{
		id: "headings",
		title: "Headings",
		icon: "heading",
		tabs: { labels: ["H1", "H2", "H3+"], substitute: true },
		controls: [
			{ kind: "font", label: "Font", path: H + "font", placeholder: "Body font" },
			n("Size", H + "size", "pt", 0.5),
			sel("Weight", H + "weight", WEIGHTS),
			tog("Italic", H + "italic"),
			tog("Small caps", H + "smallCaps"),
			sel("Alignment", H + "align", [
				["left", "Left"],
				["center", "Centered"],
			]),
			n("Space above", H + "above", "em", 0.1),
			n("Space below", H + "below", "em", 0.1),
			tog("Numbered", H + "numbered"),
			sel(
				"Number format",
				"headings.numberFormat",
				[
					["1.1", "1.1"],
					["1.1.", "1.1."],
					["I.1", "I.1"],
				],
				{ when: (s) => s.headings.levels.some((l) => l.numbered) }
			),
			tog("Start on new page", H + "pageBreak"),
		],
	},
	{
		id: "footnotes",
		title: "Footnotes",
		icon: "superscript",
		tabs: { labels: ["Number in text", "Notes"] },
		controls: [
			sel(
				"Numbering",
				"footnotes.numbering",
				[
					["1", "1, 2, 3"],
					["i", "i, ii, iii"],
					["a", "a, b, c"],
					["*", "*, †, ‡"],
				]
			),
			// ---- the number in the running text
			sel(
				"Format",
				"footnotes.marker.format",
				[
					["1", "¹"],
					["[1]", "[¹]"],
					["1)", "¹⁾"],
					["(1)", "⁽¹⁾"],
				],
				{ tab: 0 }
			),
			tog("Font's superscript figures", "footnotes.marker.typographic", {
				tab: 0,
				hint: "Use the font's own superior figures when it has them; size and raise then don't apply. Off: Typst scales and raises the normal digits.",
			}),
			n("Size", "footnotes.marker.size", "%", 1, { tab: 0, when: (s) => !s.footnotes.marker.typographic }),
			n("Raise", "footnotes.marker.raise", "em", 0.05, { tab: 0, when: (s) => !s.footnotes.marker.typographic }),
			sel("Weight", "footnotes.marker.weight", WEIGHTS, { tab: 0 }),
			n("Space before", "footnotes.marker.spaceBefore", "em", 0.01, { tab: 0, hint: "A hair space between word and number" }),
			{ kind: "color", label: "Colour", path: "footnotes.marker.color", tab: 0, placeholder: "Text colour" },
			// ---- the notes at the page bottom
			n("Size", "footnotes.size", "pt", 0.5, { tab: 1 }),
			n("Line gap", "footnotes.leading", "em", 0.05, { tab: 1 }),
			n("Gap between notes", "footnotes.gap", "em", 0.05, { tab: 1 }),
			sel(
				"Number in note",
				"footnotes.entryMarker",
				[
					["super", "Superscript ¹"],
					["plain", "Plain “1.”"],
				],
				{ tab: 1 }
			),
			tog("Hanging numbers", "footnotes.hanging", { tab: 1, hint: "Note text aligned past the number" }),
			n("Number column", "footnotes.hangWidth", "em", 0.1, { tab: 1, when: (s) => s.footnotes.hanging }),
			n("Indent", "footnotes.indent", "em", 0.1, { tab: 1, when: (s) => !s.footnotes.hanging }),
			tog("Justified", "footnotes.justify", { tab: 1 }),
			n("Rule length", "footnotes.separatorLength", "%", 1, { tab: 1 }),
			n("Rule weight", "footnotes.separatorStroke", "pt", 0.1, { tab: 1 }),
			n("Space above rule", "footnotes.clearance", "em", 0.1, { tab: 1 }),
		],
	},
	{
		id: "toc",
		title: "Contents",
		icon: "list-tree",
		controls: [
			tog("Table of contents", "toc.show", { hint: "Generated from the headings, placed after the title" }),
			{ kind: "text", label: "Heading", path: "toc.title", placeholder: "none", when: (s) => s.toc.show },
			{ kind: "font", label: "Font", path: "toc.font", placeholder: "Body font", when: (s) => s.toc.show },
			sel(
				"Levels",
				"toc.depth",
				[
					["1", "H1"],
					["2", "H1–H2"],
					["3", "H1–H3"],
					["4", "H1–H4"],
				],
				{ when: (s) => s.toc.show }
			),
			n("Size", "toc.size", "pt", 0.5, { when: (s) => s.toc.show }),
			n("Indent per level", "toc.indent", "em", 0.1, { when: (s) => s.toc.show }),
			n("Line gap", "toc.spacing", "em", 0.05, { when: (s) => s.toc.show }),
			n("Space above H1", "toc.level1Above", "em", 0.05, { when: (s) => s.toc.show }),
			tog("H1 entries bold", "toc.level1Bold", { when: (s) => s.toc.show }),
			tog("Dot leaders", "toc.leaders", { when: (s) => s.toc.show && s.toc.pageNumbers }),
			tog("Page numbers", "toc.pageNumbers", { when: (s) => s.toc.show }),
			tog("Own page", "toc.ownPage", { when: (s) => s.toc.show }),
		],
	},
	{
		id: "quotes",
		title: "Block quotes",
		icon: "quote",
		controls: [
			n("Size", "quotes.size", "pt", 0.5),
			n("Line gap", "quotes.leading", "em", 0.05),
			n("Indent left", "quotes.indentLeft", "em", 0.1),
			n("Indent right", "quotes.indentRight", "em", 0.1),
			n("Space above", "quotes.above", "em", 0.1),
			n("Space below", "quotes.below", "em", 0.1),
			tog("Italic", "quotes.italic"),
		],
	},
	{
		id: "citations",
		title: "Citations & bibliography",
		icon: "library",
		controls: [
			sel(
				"Citation style",
				"citations.style",
				(plugin) => [
					["bundled:chicago-notes-bibliography", "Chicago — notes (footnotes)"],
					["pandoc-default", "Chicago — author-date"],
					...plugin.zotflowStyles(),
					["custom", "Other CSL file…"],
				],
				{ content: true, hint: "Styles in ZotFlow's CSL styles folder are listed too." }
			),
			{
				kind: "text",
				label: "CSL file",
				path: "citations.style",
				placeholder: "Absolute path to .csl",
				content: true,
				hint: "Any style from zotero.org/styles. Note styles put citations in footnotes.",
				when: (s) => !s.citations.style.startsWith("bundled:") && !s.citations.style.startsWith("vault:") && s.citations.style !== "pandoc-default",
			},
			tog("Print bibliography", "bibliography.show", { content: true }),
			{
				kind: "text",
				label: "Heading",
				path: "bibliography.title",
				placeholder: "none",
				content: true,
				when: (s) => s.bibliography.show,
				hint: "Ignored if the note places it with ::: {#refs} :::",
			},
			n("Size", "bibliography.size", "pt", 0.5, { when: (s) => s.bibliography.show }),
			n("Hanging indent", "bibliography.hangingIndent", "em", 0.1, { when: (s) => s.bibliography.show }),
			n("Gap between entries", "bibliography.spacing", "em", 0.05, { when: (s) => s.bibliography.show }),
			tog("Justified", "bibliography.justify", { when: (s) => s.bibliography.show }),
		],
	},
	{
		id: "title",
		title: "Title",
		icon: "type",
		controls: [
			tog("Show title", "title.show", { hint: "From the note's title / subtitle / author / date frontmatter" }),
			{ kind: "font", label: "Title font", path: "title.font", placeholder: "Body font", when: (s) => s.title.show },
			{ kind: "font", label: "Author font", path: "title.metaFont", placeholder: "Body font", when: (s) => s.title.show, hint: "Author and date" },
			sel(
				"Alignment",
				"title.align",
				[
					["left", "Left"],
					["center", "Centered"],
				],
				{ when: (s) => s.title.show }
			),
			n("Title size", "title.size", "pt", 0.5, { when: (s) => s.title.show }),
			sel("Weight", "title.weight", WEIGHTS, { when: (s) => s.title.show }),
			n("Subtitle size", "title.subtitleSize", "pt", 0.5, { when: (s) => s.title.show }),
			n("Author/date size", "title.metaSize", "pt", 0.5, { when: (s) => s.title.show }),
			n("Space below", "title.below", "em", 0.1, { when: (s) => s.title.show && !s.title.ownPage }),
			tog("Own page", "title.ownPage", { when: (s) => s.title.show }),
		],
	},
	{
		id: "figures",
		title: "Figures & tables",
		icon: "image",
		controls: [n("Caption size", "figures.captionSize", "pt", 0.5)],
	},
];

function getPath(obj: any, path: string): any {
	return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj: any, path: string, value: any) {
	const keys = path.split(".");
	const last = keys.pop()!;
	const target = keys.reduce((o, k) => o[k], obj);
	target[last] = value;
}

export interface PanelHost {
	style(): VitroStyle;
	/** note frontmatter pins a preset */
	styleFromNote(): boolean;
	choosePreset(id: string): void;
	styleChanged(content: boolean): void;
}

export class StylePanel {
	private open = new Set<string>(["text"]);
	/** active tab per section */
	private tabOf = new Map<string, number>();
	/** heading level being edited (tab of the headings section) */
	private get level() {
		return this.tabOf.get("headings") ?? 0;
	}
	private pickers: FontPicker[] = [];
	private scrollEl!: HTMLElement;

	constructor(private el: HTMLElement, private plugin: TypesetVitroPlugin, private host: PanelHost) {
		this.render();
	}

	render() {
		for (const p of this.pickers) p.dispose();
		this.pickers = [];
		const scroll = this.scrollEl?.scrollTop ?? 0;
		this.el.empty();
		this.renderPresetBar();
		this.scrollEl = this.el.createDiv({ cls: "vitro-panel-scroll" });
		for (const sec of SECTIONS) this.renderSection(sec);
		this.scrollEl.scrollTop = scroll;
	}

	private renderPresetBar() {
		const bar = this.el.createDiv({ cls: "vitro-presets" });
		const style = this.host.style();
		const select = bar.createEl("select", { cls: "dropdown vitro-preset-select" });
		for (const p of this.plugin.settings.presets) select.createEl("option", { value: p.id, text: p.name });
		select.value = style.id;
		select.onchange = () => this.host.choosePreset(select.value);
		if (this.host.styleFromNote()) {
			const pin = bar.createDiv({ cls: "vitro-preset-pin" });
			setIcon(pin, "pin");
			setTooltip(pin, "Chosen by this note's `typeset:` frontmatter");
		}
		const more = bar.createDiv({ cls: "clickable-icon vitro-preset-more" });
		setIcon(more, "more-horizontal");
		setTooltip(more, "Style presets");
		more.onclick = (e) => this.presetMenu(e);
	}

	private presetMenu(e: MouseEvent) {
		const plugin = this.plugin;
		const style = this.host.style();
		const m = new Menu();
		m.addItem((i) =>
			i
				.setTitle("Duplicate style")
				.setIcon("copy")
				.onClick(() => {
					const s = cloneStyle(style);
					s.name = `${style.name} copy`;
					const added = plugin.addPreset(s);
					this.host.choosePreset(added.id);
				})
		);
		m.addItem((i) =>
			i
				.setTitle("Rename…")
				.setIcon("pencil")
				.onClick(() =>
					new NameModal(plugin, style.name, (name) => {
						const clash = plugin.settings.presets.some((p) => p !== style && p.name.toLowerCase() === name.toLowerCase());
						style.name = clash ? plugin.uniqueName(name) : name;
						plugin.saveSettings();
						this.render();
					}).open()
				)
		);
		const builtIn = makeBuiltInPresets().find((p) => p.id === style.id);
		if (builtIn) {
			m.addItem((i) =>
				i
					.setTitle("Reset to original")
					.setIcon("rotate-ccw")
					.onClick(() => {
						Object.assign(style, cloneStyle(builtIn));
						plugin.saveSettings();
						this.render();
						this.host.styleChanged(true);
					})
			);
		}
		m.addSeparator();
		m.addItem((i) =>
			i
				.setTitle("Export as Typst template")
				.setIcon("file-code")
				.onClick(() => plugin.exportTemplate(style))
		);
		m.addItem((i) =>
			i
				.setTitle("Export preset file (to share)")
				.setIcon("share")
				.onClick(() => plugin.exportPresetJson(style))
		);
		m.addItem((i) =>
			i
				.setTitle("Import preset file…")
				.setIcon("download")
				.onClick(() => plugin.importPresetJson())
		);
		if (plugin.settings.presets.length > 1) {
			m.addSeparator();
			m.addItem((i) =>
				i
					.setTitle("Delete style")
					.setIcon("trash")
					.setWarning(true)
					.onClick(() => {
						plugin.settings.presets = plugin.settings.presets.filter((p) => p.id !== style.id);
						if (plugin.settings.activePresetId === style.id) plugin.settings.activePresetId = plugin.settings.presets[0].id;
						plugin.saveSettings();
						this.host.choosePreset(plugin.settings.activePresetId);
					})
			);
		}
		m.showAtMouseEvent(e);
	}

	private renderSection(sec: Section) {
		const s = this.host.style();
		const isOpen = this.open.has(sec.id);
		const wrap = this.scrollEl.createDiv({ cls: "vitro-section" + (isOpen ? " is-open" : "") });
		const head = wrap.createDiv({ cls: "vitro-section-head" });
		setIcon(head.createSpan({ cls: "vitro-section-icon" }), sec.icon);
		head.createSpan({ text: sec.title, cls: "vitro-section-title" });
		setIcon(head.createSpan({ cls: "vitro-section-chevron" }), "chevron-right");
		const body = wrap.createDiv({ cls: "vitro-section-body" });
		const inner = body.createDiv({ cls: "vitro-section-inner" });
		head.onclick = () => {
			const now = !wrap.hasClass("is-open");
			wrap.toggleClass("is-open", now);
			now ? this.open.add(sec.id) : this.open.delete(sec.id);
		};

		const active = this.tabOf.get(sec.id) ?? 0;
		if (sec.tabs) {
			const tabs = inner.createDiv({ cls: "vitro-tabs" });
			sec.tabs.labels.forEach((label, i) => {
				const t = tabs.createDiv({ cls: "vitro-tab" + (i === active ? " is-active" : ""), text: label });
				t.onclick = () => {
					this.tabOf.set(sec.id, i);
					this.rerenderSection(sec, wrap);
				};
			});
		}
		for (const c of sec.controls) {
			if (c.when && !c.when(s)) continue;
			if (sec.tabs && c.tab !== undefined && c.tab !== active) continue;
			this.renderControl(inner, c, sec);
		}
	}

	private rerenderSection(sec: Section, wrap: HTMLElement) {
		const scroll = this.scrollEl.scrollTop;
		const placeholder = createDiv();
		wrap.replaceWith(placeholder);
		const tmp = this.scrollEl;
		// render into a detached container, then swap in place
		const holder = createDiv();
		this.scrollEl = holder;
		this.renderSection(sec);
		this.scrollEl = tmp;
		placeholder.replaceWith(holder.firstElementChild as HTMLElement);
		this.scrollEl.scrollTop = scroll;
	}

	private resolve(path: string) {
		return path.replace("$h", String(this.level));
	}

	private commit(c: Ctl, value: any, sec: Section, rowEl: HTMLElement) {
		const s = this.host.style();
		setPath(s, this.resolve(c.path), value);
		this.plugin.saveSettingsSoon();
		this.host.styleChanged(!!c.content);
		// controls that show/hide others need the section redrawn
		if (c.kind === "toggle" || c.kind === "select") {
			const wrap = rowEl.closest(".vitro-section") as HTMLElement | null;
			if (wrap) this.rerenderSection(sec, wrap);
		}
	}

	private renderControl(parent: HTMLElement, c: Ctl, sec: Section) {
		const s = this.host.style();
		const value = getPath(s, this.resolve(c.path));
		const row = parent.createDiv({ cls: `vitro-row vitro-row-${c.kind}` });
		const label = row.createDiv({ cls: "vitro-label", text: c.label });
		if (c.hint) setTooltip(label, c.hint, { placement: "left" });
		const ctl = row.createDiv({ cls: "vitro-control" });

		switch (c.kind) {
			case "number": {
				const box = ctl.createDiv({ cls: "vitro-num" });
				const input = box.createEl("input", { type: "number", attr: { step: c.step } });
				input.value = String(value);
				box.createSpan({ cls: "vitro-unit", text: c.unit });
				const apply = (v: number) => {
					if (!Number.isFinite(v)) return;
					input.value = String(v);
					this.commit(c, v, sec, row);
				};
				input.oninput = () => {
					const v = parseFloat(input.value);
					if (Number.isFinite(v)) this.commit(c, v, sec, row);
				};
				input.onchange = () => apply(parseFloat(input.value));
				// drag the label horizontally to scrub the value
				label.addClass("is-scrubbable");
				label.onpointerdown = (e) => {
					const startX = e.clientX;
					const start = parseFloat(input.value) || 0;
					label.setPointerCapture(e.pointerId);
					row.addClass("is-scrubbing");
					label.onpointermove = (ev) => {
						const steps = Math.round((ev.clientX - startX) / 4);
						// no snapping to the step grid, just float noise removed
						const next = Number((start + steps * c.step).toFixed(10));
						if (String(next) !== input.value) {
							input.value = String(next);
							this.commit(c, next, sec, row);
						}
					};
					label.onpointerup = () => {
						label.onpointermove = null;
						row.removeClass("is-scrubbing");
					};
				};
				break;
			}
			case "select": {
				const select = ctl.createEl("select", { cls: "dropdown" });
				const options = typeof c.options === "function" ? c.options(this.plugin) : c.options;
				for (const [v, t] of options) select.createEl("option", { value: v, text: t });
				let current = String(value);
				if (c.path === "citations.style" && !options.some(([v]) => v === current)) current = "custom";
				select.value = current;
				select.onchange = () => {
					let v: string | number = select.value;
					if (c.path === "citations.style" && v === "custom") v = "";
					if (typeof value === "number") v = Number(v);
					this.commit(c, v, sec, row);
				};
				break;
			}
			case "toggle": {
				const t = ctl.createDiv({ cls: "checkbox-container" + (value ? " is-enabled" : "") });
				t.createEl("input", { type: "checkbox", attr: { tabindex: 0 } });
				t.onclick = () => {
					const v = !t.hasClass("is-enabled");
					t.toggleClass("is-enabled", v);
					this.commit(c, v, sec, row);
				};
				break;
			}
			case "color": {
				const wrap = ctl.createDiv({ cls: "vitro-color" });
				const input = wrap.createEl("input", { type: "color" });
				input.value = value || "#000000";
				const label2 = wrap.createSpan({ cls: "vitro-color-label", text: value ? String(value) : c.placeholder ?? "" });
				const reset = wrap.createDiv({ cls: "clickable-icon vitro-color-reset" });
				setIcon(reset, "x");
				setTooltip(reset, "Use the text colour");
				reset.toggleClass("is-hidden", !value);
				input.oninput = () => {
					label2.setText(input.value);
					reset.removeClass("is-hidden");
					this.commitQuiet(c, input.value);
				};
				reset.onclick = () => {
					label2.setText(c.placeholder ?? "");
					reset.addClass("is-hidden");
					input.value = "#000000";
					this.commitQuiet(c, "");
				};
				break;
			}
			case "font": {
				const picker = new FontPicker(ctl, this.plugin, value ?? "", c.placeholder, (v) => this.commitQuiet(c, v));
				this.pickers.push(picker);
				break;
			}
			case "text": {
				const input = ctl.createEl("input", {
					type: "text",
					cls: "vitro-text",
					attr: { placeholder: c.placeholder ?? "", spellcheck: "false" },
				});
				input.value = value ?? "";
				let t: number | null = null;
				input.oninput = () => {
					if (t) window.clearTimeout(t);
					// fonts: wait until a name is complete-ish, avoids warnings mid-typing
					t = window.setTimeout(() => this.commitQuiet(c, input.value.trim()), 500);
				};
				break;
			}
		}
	}

	/** Commit without redrawing the section (keeps focus in text fields). */
	private commitQuiet(c: Ctl, value: any) {
		setPath(this.host.style(), this.resolve(c.path), value);
		this.plugin.saveSettingsSoon();
		this.host.styleChanged(!!c.content);
	}
}

class NameModal extends Modal {
	constructor(plugin: TypesetVitroPlugin, private value: string, private done: (v: string) => void) {
		super(plugin.app);
	}
	onOpen() {
		this.titleEl.setText("Rename style");
		let v = this.value;
		new Setting(this.contentEl).setName("Name").addText((t) => {
			t.setValue(v).onChange((x) => (v = x));
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					this.submit(v);
				}
			});
			window.setTimeout(() => t.inputEl.select(), 10);
		});
		new Setting(this.contentEl).addButton((b) => b.setButtonText("Save").setCta().onClick(() => this.submit(v)));
	}
	private submit(v: string) {
		if (v.trim()) this.done(v.trim());
		this.close();
	}
	onClose() {
		this.contentEl.empty();
	}
}
