import { setIcon, setTooltip } from "obsidian";
import type TypesetVitroPlugin from "../main";

/**
 * Font field with a searchable dropdown. Each entry is the family name set in
 * that font (rendered by Typst, so it is exactly what the PDF uses).
 * ↑/↓ step through the fonts and apply them live; Enter keeps, Esc reverts.
 * Any typed name is accepted too (Enter), e.g. a fallback list "A, B".
 */
export class FontPicker {
	private trigger: HTMLElement;
	private pop: HTMLElement | null = null;
	private listEl!: HTMLElement;
	private search!: HTMLInputElement;
	private rows: { name: string; el: HTMLElement }[] = [];
	private active = -1;
	private original = "";
	private observer: IntersectionObserver | null = null;
	private previews: Map<string, string> | null = null;
	private cleanup: (() => void)[] = [];

	constructor(
		parent: HTMLElement,
		private plugin: TypesetVitroPlugin,
		private value: string,
		private placeholder: string | undefined,
		private onPick: (value: string) => void
	) {
		this.trigger = parent.createDiv({ cls: "vitro-font-trigger", attr: { tabindex: "0", role: "button" } });
		this.renderTrigger();
		this.trigger.onclick = () => (this.pop ? this.close(true) : this.open());
		this.trigger.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
				e.preventDefault();
				this.open();
			}
		};
		this.plugin
			.fontPreviews()
			.then((p) => {
				this.previews = p;
				this.renderTrigger();
			})
			.catch(() => {});
	}

	private preview(name: string, into: HTMLElement) {
		const file = this.previews?.get(name);
		if (!file) {
			into.createSpan({ cls: "vitro-font-plain", text: name });
			return;
		}
		into.createEl("img", { cls: "vitro-font-img", attr: { src: this.plugin.fileUrl(file), alt: name, draggable: "false" } });
	}

	private renderTrigger() {
		this.trigger.empty();
		const face = this.trigger.createDiv({ cls: "vitro-font-face" });
		if (this.value) this.preview(this.value, face);
		else face.createSpan({ cls: "vitro-font-placeholder", text: this.placeholder ?? "Choose font" });
		setIcon(this.trigger.createDiv({ cls: "vitro-font-chevron" }), "chevrons-up-down");
		setTooltip(this.trigger, this.value || this.placeholder || "Font", { placement: "left" });
	}

	private async open() {
		if (this.pop) return;
		this.original = this.value;
		const pop = document.body.createDiv({ cls: "vitro-font-pop" });
		this.pop = pop;
		const r = this.trigger.getBoundingClientRect();
		const width = Math.max(240, r.width + 60);
		pop.style.width = `${width}px`;
		pop.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width))}px`;
		const below = window.innerHeight - r.bottom;
		if (below > 300) pop.style.top = `${r.bottom + 4}px`;
		else pop.style.bottom = `${window.innerHeight - r.top + 4}px`;

		this.search = pop.createEl("input", { type: "text", cls: "vitro-font-search", attr: { placeholder: "Search or type a font…", spellcheck: "false" } });
		this.listEl = pop.createDiv({ cls: "vitro-font-list" });
		const foot = pop.createDiv({ cls: "vitro-font-foot" });
		const reload = foot.createDiv({ cls: "vitro-font-reload", text: "Reload installed fonts" });
		reload.onclick = () => {
			this.plugin.reloadFonts();
			this.close(false);
		};

		this.search.oninput = () => this.fill();
		this.search.onkeydown = (e) => this.onKey(e);
		const outside = (e: MouseEvent) => {
			if (!pop.contains(e.target as Node) && !this.trigger.contains(e.target as Node)) this.close(false);
		};
		window.setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
		this.cleanup.push(() => document.removeEventListener("mousedown", outside, true));

		const [fonts] = await Promise.all([this.plugin.fonts(), this.plugin.fontPreviews().then((p) => (this.previews = p)).catch(() => null)]);
		if (this.pop !== pop) return;
		this.all = fonts;
		this.fill();
		this.search.focus();
	}

	private all: string[] = [];

	private fill() {
		const q = this.search.value.trim().toLowerCase();
		this.listEl.empty();
		this.observer?.disconnect();
		this.observer = new IntersectionObserver(
			(entries) => {
				for (const en of entries) {
					if (!en.isIntersecting) continue;
					const el = en.target as HTMLElement;
					this.observer?.unobserve(el);
					const name = el.dataset.font!;
					el.empty();
					if (name === "") el.createSpan({ cls: "vitro-font-placeholder", text: this.placeholder ?? "" });
					else this.preview(name, el);
				}
			},
			{ root: this.listEl, rootMargin: "200px 0px" }
		);
		const names = (this.placeholder && !q ? [""] : []).concat(this.all.filter((f) => !q || f.toLowerCase().includes(q)));
		this.rows = names.map((name) => {
			const el = this.listEl.createDiv({ cls: "vitro-font-row" });
			el.dataset.font = name;
			// placeholder text until the row scrolls into view
			el.createSpan({ cls: "vitro-font-plain is-pending", text: name || this.placeholder || "" });
			if (name) setTooltip(el, name, { placement: "left", delay: 600 });
			el.onmousedown = (e) => e.preventDefault();
			el.onclick = () => {
				this.apply(name);
				this.close(true);
			};
			this.observer!.observe(el);
			return { name, el };
		});
		if (!this.rows.length && q) {
			const el = this.listEl.createDiv({ cls: "vitro-font-row is-custom", text: `Use “${this.search.value.trim()}”` });
			el.onclick = () => {
				this.apply(this.search.value.trim());
				this.close(true);
			};
		}
		this.active = this.rows.findIndex((r) => r.name === this.value);
		this.highlight(false);
	}

	private highlight(scroll = true) {
		this.rows.forEach((r, i) => r.el.toggleClass("is-active", i === this.active));
		const row = this.rows[this.active];
		if (row) row.el.scrollIntoView({ block: scroll ? "nearest" : "center" });
	}

	private onKey(e: KeyboardEvent) {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			if (!this.rows.length) return;
			const d = e.key === "ArrowDown" ? 1 : -1;
			this.active = this.active < 0 ? 0 : (this.active + d + this.rows.length) % this.rows.length;
			this.highlight();
			this.apply(this.rows[this.active].name); // live
		} else if (e.key === "Enter") {
			e.preventDefault();
			const typed = this.search.value.trim();
			const exact = this.all.find((f) => f.toLowerCase() === typed.toLowerCase());
			if (this.active >= 0 && (!typed || this.rows[this.active].name.toLowerCase().includes(typed.toLowerCase()))) this.apply(this.rows[this.active].name);
			else if (typed) this.apply(exact ?? typed);
			this.close(true);
		} else if (e.key === "Escape") {
			e.preventDefault();
			this.close(false);
		}
	}

	private apply(v: string) {
		if (v === this.value) return;
		this.value = v;
		this.onPick(v);
	}

	/** Remove an open dropdown without touching the value (panel redraw). */
	dispose() {
		if (!this.pop) return;
		this.observer?.disconnect();
		this.cleanup.forEach((f) => f());
		this.cleanup = [];
		this.pop.remove();
		this.pop = null;
	}

	/** keep = false reverts live changes made with the arrow keys */
	close(keep: boolean) {
		if (!this.pop) return;
		if (!keep && this.value !== this.original) this.apply(this.original);
		this.observer?.disconnect();
		this.observer = null;
		this.cleanup.forEach((f) => f());
		this.cleanup = [];
		this.pop?.remove();
		this.pop = null;
		this.renderTrigger();
		this.trigger.focus();
	}
}
