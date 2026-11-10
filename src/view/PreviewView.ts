import { ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf, debounce, setIcon, setTooltip } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import type TypesetVitroPlugin from "../main";
import { VitroStyle } from "../style/schema";
import { DocMeta, buildDocument } from "../style/typst";
import { BodyResult, buildBody, pandocKey, readFrontmatter, vaultBasePath } from "../pipeline/document";
import { CompileResult, Diagnostic, TypstWatcher, compilePdf } from "../pipeline/typst";
import { StylePanel } from "./StylePanel";

export const VIEW_TYPE_PREVIEW = "typeset-vitro-preview";

interface PageEl {
	el: HTMLElement;
	img: HTMLImageElement;
	url: string | null;
	widthPt: number;
	heightPt: number;
}

const PT_TO_PX = 96 / 72;

export class PreviewView extends ItemView {
	file: TFile | null = null;
	private pinned = false;
	private liveText: string | null = null;
	private body: BodyResult | null = null;
	private bodyKey = "";
	private lastWritten = "";
	private lastDoc = "";
	private run = 0;
	private watcher: TypstWatcher | null = null;
	private cacheDir = "";
	private pages: PageEl[] = [];
	private warnings: string[] = [];
	private typstDiags: Diagnostic[] = [];
	private contentError: string | null = null;

	private toolbarEl!: HTMLElement;
	private fileEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private zoomEl!: HTMLElement;
	private stageEl!: HTMLElement;
	private pagesEl!: HTMLElement;
	private messagesEl!: HTMLElement;
	private emptyEl!: HTMLElement;
	private panelEl!: HTMLElement;
	private panel: StylePanel | null = null;
	private pinBtn!: HTMLElement;
	private panelBtn!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, private plugin: TypesetVitroPlugin) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_PREVIEW;
	}
	getDisplayText() {
		return this.file ? `Typeset: ${this.file.basename}` : "Typeset preview";
	}
	getIcon() {
		return "book-open-text";
	}

	// ---------------------------------------------------------------- lifecycle

	async onOpen() {
		const root = this.contentEl;
		root.empty();
		root.addClass("vitro-view");

		this.buildToolbar(root.createDiv({ cls: "vitro-toolbar" }));
		const main = root.createDiv({ cls: "vitro-main" });
		this.stageEl = main.createDiv({ cls: "vitro-stage" });
		this.messagesEl = this.stageEl.createDiv({ cls: "vitro-messages" });
		this.emptyEl = this.stageEl.createDiv({ cls: "vitro-empty", text: "Open a note to typeset it." });
		this.pagesEl = this.stageEl.createDiv({ cls: "vitro-pages" });
		this.panelEl = main.createDiv({ cls: "vitro-panel" });
		this.panel = new StylePanel(this.panelEl, this.plugin, {
			style: () => this.style(),
			styleFromNote: () => !!this.notePreset(),
			choosePreset: (id) => this.choosePreset(id),
			styleChanged: (content) => (content ? this.requestContent(true) : this.requestStyle()),
		});
		this.setPanelOpen(this.plugin.settings.panelOpen);

		this.cacheDir = path.join(this.plugin.pluginDirAbs(), ".cache", Math.random().toString(36).slice(2, 10));

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (this.pinned || !leaf || leaf === this.leaf) return;
				if (leaf.view instanceof MarkdownView && leaf.view.file) this.setFile(leaf.view.file);
			})
		);
		this.registerEvent(
			this.app.workspace.on("editor-change", (editor, info) => {
				if (this.file && info.file?.path === this.file.path) {
					this.liveText = editor.getValue();
					this.requestContent();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("modify", (f) => {
				if (!this.file) return;
				if (f.path === this.file.path) {
					if (!this.openEditorText()) {
						this.liveText = null;
						this.requestContent();
					}
				} else if (f.path.endsWith(".md") && this.plugin.settings.embedNotes) {
					// an embedded note may have changed
					const links = this.app.metadataCache.resolvedLinks[this.file.path] ?? {};
					if (f.path in links) this.requestContent();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (f) => {
				if (f === this.file) this.updateHeader();
			})
		);
		this.registerDomEvent(window, "resize", () => this.layoutPages());

		// restored views get their file via setState(); otherwise follow what's open
		window.setTimeout(() => {
			if (this.file) return;
			const md = this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.app.workspace.getMostRecentLeaf()?.view;
			if (md instanceof MarkdownView && md.file) return this.setFile(md.file);
			const active = this.app.workspace.getActiveFile();
			if (active?.extension === "md") return this.setFile(active);
			const recent = this.app.workspace
				.getLastOpenFiles()
				.map((p) => this.app.vault.getAbstractFileByPath(p))
				.find((f): f is TFile => f instanceof TFile && f.extension === "md");
			if (recent) this.setFile(recent);
		}, 0);
	}

	getState(): Record<string, unknown> {
		return { file: this.file?.path ?? null, pinned: this.pinned };
	}

	async setState(state: any, result: any): Promise<void> {
		if (state?.file) {
			const f = this.app.vault.getAbstractFileByPath(state.file);
			if (f instanceof TFile) this.setFile(f);
		}
		this.pinned = !!state?.pinned;
		this.pinBtn?.toggleClass("is-active", this.pinned);
		await super.setState(state, result);
	}

	async onClose() {
		this.watcher?.stop();
		this.watcher = null;
		for (const p of this.pages) if (p.url) URL.revokeObjectURL(p.url);
		this.pages = [];
		try {
			fs.rmSync(this.cacheDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}

	onResize() {
		this.layoutPages();
	}

	restart() {
		this.watcher?.stop();
		this.watcher = null;
		this.lastWritten = "";
		this.requestContent(true);
	}

	refreshPanel() {
		this.panel?.render();
	}

	// ---------------------------------------------------------------- toolbar

	private buildToolbar(bar: HTMLElement) {
		this.toolbarEl = bar;
		this.fileEl = bar.createDiv({ cls: "vitro-file" });
		this.statusEl = bar.createDiv({ cls: "vitro-status" });
		bar.createDiv({ cls: "vitro-spacer" });

		const btn = (icon: string, tip: string, fn: (e: MouseEvent) => void, cls = "") => {
			const b = bar.createDiv({ cls: `clickable-icon vitro-btn ${cls}` });
			setIcon(b, icon);
			setTooltip(b, tip);
			b.onclick = fn;
			return b;
		};
		const zoom = bar.createDiv({ cls: "vitro-zoom" });
		const zbtn = (icon: string, tip: string, fn: () => void) => {
			const b = zoom.createDiv({ cls: "clickable-icon vitro-btn" });
			setIcon(b, icon);
			setTooltip(b, tip);
			b.onclick = fn;
		};
		zbtn("minus", "Zoom out", () => this.zoomBy(1 / 1.15));
		this.zoomEl = zoom.createDiv({ cls: "vitro-zoom-label" });
		setTooltip(this.zoomEl, "Fit width");
		this.zoomEl.onclick = () => this.setZoom(0);
		zbtn("plus", "Zoom in", () => this.zoomBy(1.15));

		this.pinBtn = btn("pin", "Pin to this note", () => {
			this.pinned = !this.pinned;
			this.pinBtn.toggleClass("is-active", this.pinned);
			this.app.workspace.requestSaveLayout();
		});
		btn("refresh-cw", "Re-run (e.g. after updating your Zotero library)", () => this.requestContent(true));
		this.panelBtn = btn("sliders-horizontal", "Style panel", () => this.setPanelOpen(!this.plugin.settings.panelOpen));
		btn("file-down", "Export PDF", () => this.exportPdf(), "vitro-export");
		this.updateZoomLabel();
	}

	private setPanelOpen(open: boolean) {
		this.plugin.settings.panelOpen = open;
		this.plugin.saveSettingsSoon();
		this.contentEl.toggleClass("vitro-panel-open", open);
		this.panelBtn?.toggleClass("is-active", open);
		// re-fit once the panel transition finishes
		window.setTimeout(() => this.layoutPages(), 200);
	}

	private updateHeader() {
		this.fileEl.setText(this.file ? this.file.basename : "");
		(this.leaf as any).updateHeader?.();
		(this as any).titleEl?.setText?.(this.getDisplayText());
	}

	private setStatus(state: "busy" | "ok" | "error" | "idle", text: string) {
		this.statusEl.empty();
		this.statusEl.className = `vitro-status is-${state}`;
		this.statusEl.createSpan({ cls: "vitro-status-dot" });
		this.statusEl.createSpan({ text });
	}

	// ---------------------------------------------------------------- styles

	private notePreset(): VitroStyle | null {
		const text = this.liveText ?? "";
		const fm = this.body?.frontmatter ?? readFrontmatter(text);
		return this.plugin.presetByName(fm?.typeset);
	}

	style(): VitroStyle {
		return this.notePreset() ?? this.plugin.activePreset();
	}

	private async choosePreset(id: string) {
		const target = this.plugin.settings.presets.find((p) => p.id === id);
		if (!target) return;
		if (this.notePreset() && this.file) {
			await this.app.fileManager.processFrontMatter(this.file, (fm) => (fm.typeset = target.name));
			if (this.body) this.body.frontmatter.typeset = target.name;
		} else {
			this.plugin.settings.activePresetId = id;
			await this.plugin.saveSettings();
		}
		this.panel?.render();
		this.requestContent(true);
	}

	// ---------------------------------------------------------------- pipeline

	setFile(file: TFile) {
		if (file.extension !== "md") return;
		if (this.file?.path === file.path) return;
		this.file = file;
		this.liveText = this.openEditorText();
		this.body = null;
		this.updateHeader();
		this.emptyEl.hide();
		this.app.workspace.requestSaveLayout();
		this.requestContent(true);
		this.panel?.render();
	}

	private openEditorText(): string | null {
		if (!this.file) return null;
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const v = leaf.view;
			if (v instanceof MarkdownView && v.file?.path === this.file.path) return v.editor.getValue();
		}
		return null;
	}

	private contentDelay = -1;
	private debouncedContent = debounce(() => this.runContent(), 300, true);

	requestContent(now = false) {
		if (now) {
			this.debouncedContent.cancel();
			this.runContent();
			return;
		}
		// honour the user's delay setting
		if (this.contentDelay !== this.plugin.settings.debounceMs) {
			this.debouncedContent.cancel();
			this.contentDelay = this.plugin.settings.debounceMs;
			this.debouncedContent = debounce(() => this.runContent(), this.contentDelay, true);
		}
		this.debouncedContent();
	}

	private debouncedStyle = debounce(() => this.writeDocument(), 40, true);

	requestStyle() {
		if (!this.body) return;
		if (pandocKey(this.style()) !== this.bodyKey) {
			this.requestContent(true);
			return;
		}
		this.debouncedStyle();
	}

	private async runContent() {
		const file = this.file;
		if (!file) return;
		const id = ++this.run;
		this.setStatus("busy", "Typesetting…");
		try {
			const text = this.liveText ?? this.openEditorText() ?? (await this.app.vault.cachedRead(file));
			const fm = readFrontmatter(text);
			const style = this.plugin.presetByName(fm.typeset) ?? this.plugin.activePreset();
			const body = await buildBody(this.app, this.plugin.settings, style, file, text, this.plugin.pluginDirAbs());
			if (id !== this.run || file !== this.file) return;
			this.body = body;
			this.bodyKey = pandocKey(style);
			this.contentError = null;
			this.warnings = body.warnings;
			const hadPin = this.panelEl.querySelector(".vitro-preset-pin") != null;
			if (hadPin !== !!this.notePreset()) this.panel?.render();
			this.writeDocument();
		} catch (e) {
			if (id !== this.run) return;
			this.contentError = (e as Error).message;
			this.setStatus("error", "Pandoc failed");
			this.renderMessages();
		}
	}

	private writeDocument() {
		if (!this.body || !this.file) return;
		const doc = buildDocument(this.style(), this.body.meta, this.body.body);
		this.lastDoc = doc;
		if (doc === this.lastWritten && this.watcher?.running) {
			this.showResultStatus();
			return;
		}
		try {
			fs.mkdirSync(this.cacheDir, { recursive: true });
			fs.writeFileSync(path.join(this.cacheDir, "main.typ"), doc, "utf8");
			this.lastWritten = doc;
		} catch (e) {
			this.contentError = `Could not write preview file: ${(e as Error).message}`;
			this.renderMessages();
			return;
		}
		this.setStatus("busy", "Typesetting…");
		this.ensureWatcher();
	}

	private ensureWatcher() {
		if (this.watcher?.running) return;
		this.watcher?.stop();
		const w = new TypstWatcher(
			this.plugin.settings.typstPath,
			vaultBasePath(this.app),
			path.join(this.cacheDir, "main.typ"),
			path.join(this.cacheDir, "pages"),
			this.plugin.fontPaths(),
			(r) => this.onCompiled(w, r),
			(err) => {
				if (this.watcher !== w) return;
				this.watcher = null;
				if (err) {
					this.contentError = err.message;
					this.setStatus("error", "Typst stopped");
					this.renderMessages();
				}
			}
		);
		this.watcher = w;
		w.start();
	}

	private lastResult: CompileResult | null = null;

	private async onCompiled(w: TypstWatcher, r: CompileResult) {
		if (w !== this.watcher) return;
		this.lastResult = r;
		this.typstDiags = r.diagnostics;
		this.pageError = null;
		try {
			await this.showPages(w, r.pages);
		} catch (e) {
			this.pageError = `Could not display pages: ${(e as Error).message}`;
			console.error("Typeset Vitro: showPages failed", e);
		}
		this.showResultStatus();
		this.renderMessages();
	}

	private pageError: string | null = null;

	private showResultStatus() {
		const r = this.lastResult;
		if (!r) return;
		if (!r.ok) {
			this.setStatus("error", "Typst error");
			return;
		}
		const n = r.pages.length;
		const t = r.durationMs != null ? ` · ${r.durationMs < 10 ? r.durationMs.toFixed(1) : Math.round(r.durationMs)} ms` : "";
		this.setStatus("ok", `${n} page${n === 1 ? "" : "s"}${t}`);
	}

	// ---------------------------------------------------------------- pages

	private async showPages(w: TypstWatcher, files: string[]) {
		const updates: Promise<void>[] = [];
		files.forEach((file, i) => {
			let page = this.pages[i];
			if (!page) {
				const el = this.pagesEl.createDiv({ cls: "vitro-page" });
				const img = el.createEl("img", { attr: { draggable: "false", alt: `Page ${i + 1}` } });
				page = { el, img, url: null, widthPt: 595, heightPt: 842 };
				this.pages[i] = page;
			}
			const changed = w.changed(file) || !page.url;
			if (!changed) return;
			updates.push(this.loadPage(page, file));
		});
		for (const extra of this.pages.splice(files.length)) {
			if (extra.url) URL.revokeObjectURL(extra.url);
			extra.el.remove();
		}
		// size the pages right away, so a slow or failing load never leaves them invisible
		this.layoutPages();
		const results = await Promise.allSettled(updates);
		const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
		if (failed.length) throw failed[0].reason;
		this.layoutPages();
	}

	private async loadPage(page: PageEl, file: string) {
		let svg = "";
		// Windows may still hold the file briefly after Typst reports success
		for (let attempt = 0; attempt < 4; attempt++) {
			try {
				svg = await fs.promises.readFile(file, "utf8");
				if (svg.trimEnd().endsWith("</svg>")) break;
			} catch (e) {
				if (attempt === 3) throw new Error(`reading ${path.basename(file)}: ${(e as Error).message}`);
			}
			await new Promise((r) => window.setTimeout(r, 60));
		}
		if (!svg) throw new Error(`${path.basename(file)} is empty`);
		const wm = svg.match(/<svg[^>]*?\swidth="([\d.]+)pt"/);
		const hm = svg.match(/<svg[^>]*?\sheight="([\d.]+)pt"/);
		if (wm) page.widthPt = parseFloat(wm[1]);
		if (hm) page.heightPt = parseFloat(hm[1]);
		const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
		// preload off-screen so the swap doesn't flicker; never wait more than 1.5 s
		await Promise.race([
			new Promise<void>((resolve) => {
				const pre = new Image();
				pre.onload = pre.onerror = () => resolve();
				pre.src = url;
			}),
			new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
		]);
		const old = page.url;
		page.img.src = url;
		page.url = url;
		if (old) window.setTimeout(() => URL.revokeObjectURL(old), 1000);
	}

	/** Snapshot for bug reports (command: Copy diagnostics). */
	diagnostics(): Record<string, unknown> {
		const pagesDir = path.join(this.cacheDir, "pages");
		let files: string[] = [];
		try {
			files = fs.readdirSync(pagesDir).map((f) => `${f} (${fs.statSync(path.join(pagesDir, f)).size} B)`);
		} catch (e) {
			files = [`unreadable: ${(e as Error).message}`];
		}
		return {
			file: this.file?.path ?? null,
			platform: process.platform,
			watcherRunning: !!this.watcher?.running,
			lastResult: this.lastResult && { ok: this.lastResult.ok, pages: this.lastResult.pages.length, durationMs: this.lastResult.durationMs },
			pageError: this.pageError,
			contentError: this.contentError,
			typstDiagnostics: this.typstDiags,
			warnings: this.warnings,
			cacheDir: this.cacheDir,
			pageFiles: files,
			pageElements: this.pages.map((p) => {
				const r = p.el.getBoundingClientRect();
				return { w: Math.round(r.width), h: Math.round(r.height), src: p.img.src.slice(0, 40), natural: [p.img.naturalWidth, p.img.naturalHeight], pt: [p.widthPt, p.heightPt] };
			}),
			stage: [this.stageEl.clientWidth, this.stageEl.clientHeight],
			zoom: this.plugin.settings.zoom,
			plugins: Object.keys((this.app as any).plugins?.plugins ?? {}),
		};
	}

	private scale(): number {
		const z = this.plugin.settings.zoom;
		if (z > 0) return z * PT_TO_PX;
		const maxW = Math.max(...this.pages.map((p) => p.widthPt), 595);
		const avail = this.stageEl.clientWidth - 48;
		return Math.max(0.2, Math.min(4, avail / maxW));
	}

	private layoutPages() {
		if (!this.stageEl) return;
		const s = this.scale();
		for (const p of this.pages) {
			p.el.style.width = `${Math.round(p.widthPt * s)}px`;
			p.el.style.height = `${Math.round(p.heightPt * s)}px`;
		}
		this.updateZoomLabel();
	}

	private setZoom(z: number) {
		// keep the reading position stable when zooming
		const st = this.stageEl;
		const ratio = st.scrollHeight ? st.scrollTop / st.scrollHeight : 0;
		this.plugin.settings.zoom = z;
		this.plugin.saveSettingsSoon();
		this.layoutPages();
		st.scrollTop = ratio * st.scrollHeight;
	}

	private zoomBy(f: number) {
		const current = this.scale() / PT_TO_PX;
		this.setZoom(Math.min(4, Math.max(0.25, Math.round(current * f * 100) / 100)));
	}

	private updateZoomLabel() {
		if (!this.zoomEl) return;
		const fit = this.plugin.settings.zoom === 0;
		const pct = Math.round((this.pages.length ? this.scale() / PT_TO_PX : this.plugin.settings.zoom || 1) * 100);
		this.zoomEl.setText(fit ? `Fit` : `${pct}%`);
		this.zoomEl.toggleClass("is-fit", fit);
	}

	// ---------------------------------------------------------------- messages

	private renderMessages() {
		const box = this.messagesEl;
		box.empty();
		const errors: { title: string; detail?: string; hint?: string }[] = [];
		const warns: string[] = [...this.warnings];

		if (this.contentError) errors.push({ title: this.contentError });
		if (this.pageError) errors.push({ title: this.pageError, hint: "Run “Typeset Vitro: Copy diagnostics” and send the result." });
		const lines = this.lastWritten.split("\n");
		for (const d of this.typstDiags) {
			if (d.severity === "error") {
				errors.push({
					title: d.message,
					detail: d.line ? lines[d.line - 1]?.trim().slice(0, 200) : undefined,
					hint: d.hints.join(" "),
				});
			} else {
				const font = d.message.match(/unknown font family: (.*)$/);
				warns.push(font ? `Font “${font[1]}” isn't installed — showing Libertinus Serif instead.` : d.message);
			}
		}
		box.toggleClass("has-content", errors.length > 0 || warns.length > 0);
		this.pagesEl.toggleClass("is-stale", errors.length > 0);
		if (errors.length) {
			const e = box.createDiv({ cls: "vitro-msg is-error" });
			for (const err of errors) {
				const item = e.createDiv({ cls: "vitro-msg-item" });
				item.createDiv({ cls: "vitro-msg-title", text: err.title });
				if (err.detail) item.createEl("code", { cls: "vitro-msg-detail", text: err.detail });
				if (err.hint) item.createDiv({ cls: "vitro-msg-hint", text: err.hint });
			}
		}
		if (warns.length) {
			const unique = [...new Set(warns)];
			const w = box.createEl("details", { cls: "vitro-msg is-warning" });
			w.createEl("summary", { text: `${unique.length} warning${unique.length === 1 ? "" : "s"}` });
			for (const msg of unique) w.createDiv({ cls: "vitro-msg-item", text: msg });
		}
	}

	// ---------------------------------------------------------------- export

	async exportPdf() {
		const file = this.file ?? this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("Open a note first.");
			return;
		}
		if (file !== this.file) this.setFile(file);
		const notice = new Notice("Exporting PDF…", 0);
		try {
			const text = this.liveText ?? this.openEditorText() ?? (await this.app.vault.read(file));
			const fm = readFrontmatter(text);
			const style = this.plugin.presetByName(fm.typeset) ?? this.plugin.activePreset();
			const body = await buildBody(this.app, this.plugin.settings, style, file, text, this.plugin.pluginDirAbs());
			const doc = buildDocument(style, body.meta, body.body);
			fs.mkdirSync(this.cacheDir, { recursive: true });
			const src = path.join(this.cacheDir, "export.typ");
			fs.writeFileSync(src, doc, "utf8");

			const folder = this.plugin.settings.exportFolder || file.parent?.path || "";
			const vaultPdf = [folder, `${file.basename}.pdf`].filter((s) => s && s !== "/").join("/");
			if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
			const abs = path.join(vaultBasePath(this.app), vaultPdf);
			await compilePdf(this.plugin.settings.typstPath, vaultBasePath(this.app), src, abs, this.plugin.fontPaths());
			notice.hide();
			new Notice(`PDF saved: ${vaultPdf}`);
			if (this.plugin.settings.openAfterExport) {
				// give Obsidian a moment to index the new file
				window.setTimeout(() => this.plugin.openPdf(vaultPdf), 400);
			}
		} catch (e) {
			notice.hide();
			new Notice(`PDF export failed:\n${(e as Error).message}`, 10000);
		}
	}
}

export type { DocMeta };
