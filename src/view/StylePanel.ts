import { Menu, Modal, Setting, setIcon, setTooltip } from "obsidian";
import type TypesetVitroPlugin from "../main";
import { PAPERS, VitroStyle, cloneStyle, makeBuiltInPresets } from "../style/schema";

type Path = string;

interface Base {
	label: string;
	path: Path;
	hint?: string;
	when?: (s: VitroStyle) => boolean;
	/** changing this needs a new Pandoc run (citations, bibliography) */
	content?: boolean;
}
type Ctl =
	| (Base & { kind: "number"; unit: string; min: number; max: number; step: number })
	| (Base & { kind: "select"; options: [string, string][] })
	| (Base & { kind: "toggle" })
	| (Base & { kind: "font"; placeholder?: string })
	| (Base & { kind: "text"; placeholder?: string });

interface Section {
	id: string;
	title: string;
	icon: string;
	levels?: boolean;
	controls: Ctl[];
}

const n = (label: string, path: Path, unit: string, min: number, max: number, step: number, extra: Partial<Base> = {}): Ctl => ({
	kind: "number",
	label,
	path,
	unit,
	min,
	max,
	step,
	...extra,
});
const sel = (label: string, path: Path, options: [string, string][], extra: Partial<Base> = {}): Ctl => ({ kind: "select", label, path, options, ...extra });
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
			n("Top", "page.marginTop", "mm", 5, 80, 1),
			n("Bottom", "page.marginBottom", "mm", 5, 80, 1),
			n("Inner", "page.marginInner", "mm", 5, 80, 1, { when: (s) => s.page.twoSided }),
			n("Outer", "page.marginOuter", "mm", 5, 80, 1, { when: (s) => s.page.twoSided }),
			n("Left", "page.marginInner", "mm", 5, 80, 1, { when: (s) => !s.page.twoSided }),
			n("Right", "page.marginOuter", "mm", 5, 80, 1, { when: (s) => !s.page.twoSided }),
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
			n("Number size", "page.numberSize", "pt", 6, 16, 0.5, { when: (s) => s.page.numbering !== "none" }),
			tog("Hide on first page", "page.hideFirstNumber", { when: (s) => s.page.numbering !== "none" }),
		],
	},
	{
		id: "text",
		title: "Body text",
		icon: "pilcrow",
		controls: [
			{ kind: "font", label: "Font", path: "text.font" },
			n("Size", "text.size", "pt", 6, 24, 0.5),
			n("Line gap", "text.leading", "em", 0.2, 2.5, 0.05, { hint: "Space between lines. 0.65 is Typst's default, ~1.0 looks like Word's 1.5 spacing." }),
			n("Paragraph gap", "text.parSpacing", "em", 0, 3, 0.05, { hint: "Extra space between paragraphs. Same as the line gap = no visible gap." }),
			n("First-line indent", "text.indent", "em", 0, 5, 0.1),
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
		levels: true,
		controls: [
			{ kind: "font", label: "Font", path: H + "font", placeholder: "Body font" },
			n("Size", H + "size", "pt", 6, 40, 0.5),
			sel("Weight", H + "weight", WEIGHTS),
			tog("Italic", H + "italic"),
			tog("Small caps", H + "smallCaps"),
			sel("Alignment", H + "align", [
				["left", "Left"],
				["center", "Centered"],
			]),
			n("Space above", H + "above", "em", 0, 6, 0.1),
			n("Space below", H + "below", "em", 0, 4, 0.1),
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
		controls: [
			n("Size", "footnotes.size", "pt", 5, 16, 0.5),
			n("Line gap", "footnotes.leading", "em", 0.2, 2, 0.05),
			n("Gap between notes", "footnotes.gap", "em", 0, 2, 0.05),
			sel("Numbering", "footnotes.numbering", [
				["1", "1, 2, 3"],
				["i", "i, ii, iii"],
				["a", "a, b, c"],
				["*", "*, †, ‡"],
			]),
			sel("Number in note", "footnotes.marker", [
				["super", "Superscript ¹"],
				["plain", "Plain “1.”"],
			]),
			tog("Hanging numbers", "footnotes.hanging", { hint: "Note text aligned past the number" }),
			n("Number column", "footnotes.hangWidth", "em", 0.5, 4, 0.1, { when: (s) => s.footnotes.hanging }),
			n("Indent", "footnotes.indent", "em", 0, 4, 0.1, { when: (s) => !s.footnotes.hanging }),
			tog("Justified", "footnotes.justify"),
			n("Rule length", "footnotes.separatorLength", "%", 0, 100, 1),
			n("Rule weight", "footnotes.separatorStroke", "pt", 0, 3, 0.1),
			n("Space above rule", "footnotes.clearance", "em", 0, 4, 0.1),
		],
	},
	{
		id: "quotes",
		title: "Block quotes",
		icon: "quote",
		controls: [
			n("Size", "quotes.size", "pt", 6, 20, 0.5),
			n("Line gap", "quotes.leading", "em", 0.2, 2, 0.05),
			n("Indent left", "quotes.indentLeft", "em", 0, 8, 0.1),
			n("Indent right", "quotes.indentRight", "em", 0, 8, 0.1),
			n("Space above", "quotes.above", "em", 0, 4, 0.1),
			n("Space below", "quotes.below", "em", 0, 4, 0.1),
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
				[
					["bundled:chicago-notes-bibliography", "Chicago — notes (footnotes)"],
					["pandoc-default", "Chicago — author-date"],
					["custom", "Other CSL file…"],
				],
				{ content: true }
			),
			{
				kind: "text",
				label: "CSL file",
				path: "citations.style",
				placeholder: "Absolute path to .csl",
				content: true,
				hint: "Any style from zotero.org/styles. Note styles put citations in footnotes.",
				when: (s) => !s.citations.style.startsWith("bundled:") && s.citations.style !== "pandoc-default",
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
			n("Size", "bibliography.size", "pt", 6, 16, 0.5, { when: (s) => s.bibliography.show }),
			n("Hanging indent", "bibliography.hangingIndent", "em", 0, 5, 0.1, { when: (s) => s.bibliography.show }),
			n("Gap between entries", "bibliography.spacing", "em", 0, 3, 0.05, { when: (s) => s.bibliography.show }),
			tog("Justified", "bibliography.justify", { when: (s) => s.bibliography.show }),
		],
	},
	{
		id: "title",
		title: "Title",
		icon: "type",
		controls: [
			tog("Show title", "title.show", { hint: "From the note's title / subtitle / author / date frontmatter" }),
			sel(
				"Alignment",
				"title.align",
				[
					["left", "Left"],
					["center", "Centered"],
				],
				{ when: (s) => s.title.show }
			),
			n("Title size", "title.size", "pt", 8, 48, 0.5, { when: (s) => s.title.show }),
			sel("Weight", "title.weight", WEIGHTS, { when: (s) => s.title.show }),
			n("Subtitle size", "title.subtitleSize", "pt", 6, 36, 0.5, { when: (s) => s.title.show }),
			n("Author/date size", "title.metaSize", "pt", 6, 24, 0.5, { when: (s) => s.title.show }),
			n("Space below", "title.below", "em", 0, 10, 0.1, { when: (s) => s.title.show && !s.title.ownPage }),
			tog("Own page", "title.ownPage", { when: (s) => s.title.show }),
		],
	},
	{
		id: "figures",
		title: "Figures & tables",
		icon: "image",
		controls: [n("Caption size", "figures.captionSize", "pt", 5, 16, 0.5)],
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

const round = (v: number, step: number) => {
	const decimals = (String(step).split(".")[1] ?? "").length;
	return Number((Math.round(v / step) * step).toFixed(decimals));
};

export interface PanelHost {
	style(): VitroStyle;
	/** note frontmatter pins a preset */
	styleFromNote(): boolean;
	choosePreset(id: string): void;
	styleChanged(content: boolean): void;
}

export class StylePanel {
	private open = new Set<string>(["text"]);
	private level = 0;
	private datalistId = "vitro-fonts-" + Math.random().toString(36).slice(2, 8);
	private scrollEl!: HTMLElement;

	constructor(private el: HTMLElement, private plugin: TypesetVitroPlugin, private host: PanelHost) {
		this.render();
	}

	render() {
		const scroll = this.scrollEl?.scrollTop ?? 0;
		this.el.empty();
		this.renderPresetBar();
		this.scrollEl = this.el.createDiv({ cls: "vitro-panel-scroll" });
		const dl = this.scrollEl.createEl("datalist", { attr: { id: this.datalistId } });
		this.plugin.fonts().then((fonts) => fonts.forEach((f) => dl.createEl("option", { value: f })));
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

		if (sec.levels) {
			const tabs = inner.createDiv({ cls: "vitro-tabs" });
			["H1", "H2", "H3+"].forEach((label, i) => {
				const t = tabs.createDiv({ cls: "vitro-tab" + (i === this.level ? " is-active" : ""), text: label });
				t.onclick = () => {
					this.level = i;
					this.rerenderSection(sec, wrap);
				};
			});
		}
		for (const c of sec.controls) {
			if (c.when && !c.when(s)) continue;
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
				const input = box.createEl("input", { type: "number", attr: { min: c.min, max: c.max, step: c.step } });
				input.value = String(value);
				box.createSpan({ cls: "vitro-unit", text: c.unit });
				const apply = (v: number) => {
					if (!Number.isFinite(v)) return;
					v = round(Math.min(c.max, Math.max(c.min, v)), c.step);
					input.value = String(v);
					this.commit(c, v, sec, row);
				};
				input.oninput = () => {
					const v = parseFloat(input.value);
					if (Number.isFinite(v) && v >= c.min && v <= c.max) this.commit(c, v, sec, row);
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
						const next = round(Math.min(c.max, Math.max(c.min, start + steps * c.step)), c.step);
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
				for (const [v, t] of c.options) select.createEl("option", { value: v, text: t });
				let current = String(value);
				if (c.path === "citations.style" && !c.options.some(([v]) => v === current)) current = "custom";
				select.value = current;
				select.onchange = () => {
					let v: string = select.value;
					if (c.path === "citations.style" && v === "custom") v = "";
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
			case "font":
			case "text": {
				const input = ctl.createEl("input", {
					type: "text",
					cls: "vitro-text",
					attr: { placeholder: c.placeholder ?? "", spellcheck: "false" },
				});
				if (c.kind === "font") input.setAttr("list", this.datalistId);
				input.value = value ?? "";
				let t: number | null = null;
				input.oninput = () => {
					if (t) window.clearTimeout(t);
					// fonts: wait until a name is complete-ish, avoids warnings mid-typing
					t = window.setTimeout(() => this.commitQuiet(c, input.value.trim()), c.kind === "font" ? 350 : 500);
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
