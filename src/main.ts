import { FuzzySuggestModal, MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf, debounce, normalizePath } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import chicagoNotes from "../assets/chicago-notes-bibliography.csl";
import noteCitationsLua from "../assets/note-citations.lua";
import pageLocatorsLua from "../assets/page-locators.lua";
import { ZotflowSource } from "./pipeline/zotflow";
import { DEFAULT_SETTINGS, VitroSettings, VitroSettingTab } from "./settings";
import { VitroStyle, cloneStyle, makeBuiltInPresets, normalizeStyle, slugify } from "./style/schema";
import { buildTemplate } from "./style/typst";
import { listFonts } from "./pipeline/typst";
import { toolVersion } from "./pipeline/pandoc";
import { BuildContext, vaultBasePath } from "./pipeline/document";
import { PreviewView, VIEW_TYPE_PREVIEW } from "./view/PreviewView";

export default class TypesetVitroPlugin extends Plugin {
	settings!: VitroSettings;
	fontCache: Promise<string[]> | null = null;
	zotflow!: ZotflowSource;
	private toolCache: Promise<{ pandoc: string | null; typst: string | null }> | null = null;

	async onload() {
		await this.loadSettings();
		this.installBundledAssets();
		this.zotflow = new ZotflowSource(this.app, path.join(this.pluginDirAbs(), ".cache", "zotflow-citations.json"), () =>
			this.refreshPreviews(true)
		);
		this.register(() => this.zotflow.dispose());

		this.registerView(VIEW_TYPE_PREVIEW, (leaf) => new PreviewView(leaf, this));

		this.addRibbonIcon("book-open-text", "Typeset preview", () => this.activateView());

		this.addCommand({
			id: "open-preview",
			name: "Open typeset preview",
			callback: () => this.activateView(),
		});
		this.addCommand({
			id: "export-pdf",
			name: "Export current note as PDF",
			callback: async () => {
				const view = await this.activateView(false);
				view?.exportPdf();
			},
		});
		this.addCommand({
			id: "copy-diagnostics",
			name: "Copy diagnostics (for bug reports)",
			callback: async () => {
				const tools = await this.checkTools(true);
				const views = this.previews().map((v) => v.diagnostics());
				const text = JSON.stringify({ version: this.manifest.version, tools, settings: { ...this.settings, presets: undefined }, views }, null, 2);
				await navigator.clipboard.writeText(text);
				new Notice("Typeset Vitro diagnostics copied to the clipboard.");
			},
		});
		this.addCommand({
			id: "export-typst-template",
			name: "Export current style as Typst template",
			callback: () => this.exportTemplate(this.activePreset()),
		});
		this.addCommand({
			id: "export-style-json",
			name: "Export current style as shareable preset file",
			callback: () => this.exportPresetJson(this.activePreset()),
		});
		this.addCommand({
			id: "import-style-json",
			name: "Import style preset from vault",
			callback: () => this.importPresetJson(),
		});

		this.addSettingTab(new VitroSettingTab(this.app, this));
	}

	onunload() {
		// views stop their typst processes in onClose
	}

	// ---------- settings & presets ----------

	async loadSettings() {
		const raw = (await this.loadData()) ?? {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
		const presets = Array.isArray(raw.presets) && raw.presets.length ? raw.presets : makeBuiltInPresets();
		this.settings.presets = presets.map((p: unknown) => normalizeStyle(p));
		if (!this.settings.presets.some((p) => p.id === this.settings.activePresetId)) {
			this.settings.activePresetId = this.settings.presets[0].id;
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** For rapid edits from the style panel. */
	saveSettingsSoon = debounce(() => this.saveSettings(), 600, true);

	activePreset(): VitroStyle {
		return this.settings.presets.find((p) => p.id === this.settings.activePresetId) ?? this.settings.presets[0];
	}

	presetByName(name: unknown): VitroStyle | null {
		if (typeof name !== "string" || !name.trim()) return null;
		const n = name.trim().toLowerCase();
		return this.settings.presets.find((p) => p.name.toLowerCase() === n || p.id === n) ?? null;
	}

	uniqueId(name: string): string {
		const base = slugify(name);
		let id = base;
		let i = 2;
		while (this.settings.presets.some((p) => p.id === id)) id = `${base}-${i++}`;
		return id;
	}

	uniqueName(name: string): string {
		let n = name;
		let i = 2;
		while (this.settings.presets.some((p) => p.name.toLowerCase() === n.toLowerCase())) n = `${name} ${i++}`;
		return n;
	}

	addPreset(style: VitroStyle): VitroStyle {
		const s = cloneStyle(style);
		s.name = this.uniqueName(s.name);
		s.id = this.uniqueId(s.name);
		this.settings.presets.push(s);
		this.settings.activePresetId = s.id;
		this.saveSettings();
		return s;
	}

	// ---------- paths & tools ----------

	pluginDirAbs(): string {
		return path.join(vaultBasePath(this.app), this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
	}

	fontPaths(): string[] {
		return this.settings.fontPaths
			.split(/[;\n]/)
			.map((p) => p.trim())
			.filter(Boolean);
	}

	private installBundledAssets() {
		const put = (rel: string, content: string) => {
			try {
				const file = path.join(this.pluginDirAbs(), rel);
				fs.mkdirSync(path.dirname(file), { recursive: true });
				if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) fs.writeFileSync(file, content, "utf8");
			} catch (e) {
				console.error(`Typeset Vitro: could not install ${rel}`, e);
			}
		};
		put("csl/chicago-notes-bibliography.csl", chicagoNotes);
		put("filters/note-citations.lua", noteCitationsLua);
		put("filters/page-locators.lua", pageLocatorsLua);
		fs.mkdirSync(path.join(this.pluginDirAbs(), ".cache"), { recursive: true });
	}

	buildContext(): BuildContext {
		return {
			pluginDirAbs: this.pluginDirAbs(),
			zotflow: this.zotflow,
			noteCitationsFilter: path.join(this.pluginDirAbs(), "filters", "note-citations.lua"),
			pageLocatorsFilter: path.join(this.pluginDirAbs(), "filters", "page-locators.lua"),
		};
	}

	/** .csl files in ZotFlow's styles folder, as citation-style options. */
	zotflowStyles(): [string, string][] {
		const folder = this.zotflow?.stylesFolder();
		if (!folder) return [];
		return this.app.vault
			.getFiles()
			.filter((f) => f.extension === "csl" && f.path.startsWith(folder.replace(/\/+$/, "") + "/"))
			.map((f) => [`vault:${f.path}`, `ZotFlow: ${f.basename}`] as [string, string])
			.sort((a, b) => a[1].localeCompare(b[1]));
	}

	checkTools(force = false) {
		if (!this.toolCache || force) {
			this.toolCache = Promise.all([toolVersion(this.settings.pandocPath), toolVersion(this.settings.typstPath)]).then(([pandoc, typst]) => ({
				pandoc,
				typst,
			}));
		}
		return this.toolCache;
	}

	fonts(): Promise<string[]> {
		if (!this.fontCache) this.fontCache = listFonts(this.settings.typstPath, this.fontPaths());
		return this.fontCache;
	}

	// ---------- views ----------

	previews(): PreviewView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE_PREVIEW)
			.map((l) => l.view)
			.filter((v): v is PreviewView => v instanceof PreviewView);
	}

	refreshPreviews(content: boolean) {
		for (const v of this.previews()) content ? v.requestContent(true) : v.requestStyle();
	}

	restartPreviews() {
		this.toolCache = null;
		this.fontCache = null;
		for (const v of this.previews()) v.restart();
	}

	async activateView(reveal = true): Promise<PreviewView | null> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PREVIEW)[0];
		let leaf: WorkspaceLeaf | null = existing ?? null;
		if (!leaf) {
			const source = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
			leaf = source ? this.app.workspace.createLeafBySplit(source, "vertical") : this.app.workspace.getRightLeaf(false);
			if (!leaf) return null;
			await leaf.setViewState({ type: VIEW_TYPE_PREVIEW, active: false });
			// hand focus back to the note
			if (source) this.app.workspace.setActiveLeaf(source, { focus: true });
		}
		if (reveal && existing) this.app.workspace.revealLeaf(leaf);
		return leaf.view instanceof PreviewView ? leaf.view : null;
	}

	/** Open a vault PDF, bypassing plugins that take over the .pdf extension unless told otherwise. */
	async openPdf(vaultPath: string) {
		const file = this.app.vault.getAbstractFileByPath(vaultPath);
		if (!(file instanceof TFile)) return;
		const leaf = this.app.workspace.getLeaf("tab");
		const registry = (this.app as any).viewRegistry;
		const nativeAvailable = !!registry?.getViewCreatorByType?.("pdf");
		if (this.settings.openPdfWith === "obsidian" && nativeAvailable) {
			await leaf.setViewState({ type: "pdf", state: { file: file.path }, active: true });
		} else {
			await leaf.openFile(file);
		}
	}

	// ---------- export / import ----------

	async writeVaultFile(vaultPath: string, data: string): Promise<TFile> {
		const p = normalizePath(vaultPath);
		const dir = p.split("/").slice(0, -1).join("/");
		if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
		const existing = this.app.vault.getAbstractFileByPath(p);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, data);
			return existing;
		}
		return this.app.vault.create(p, data);
	}

	exportDir(): string {
		return this.settings.exportFolder || this.app.workspace.getActiveFile()?.parent?.path || "";
	}

	async exportTemplate(style: VitroStyle) {
		const p = [this.exportDir(), `${slugify(style.name)}.typ`].filter(Boolean).join("/");
		await this.writeVaultFile(p, buildTemplate(style));
		new Notice(`Typst template saved: ${p}`);
	}

	async exportPresetJson(style: VitroStyle) {
		const p = [this.exportDir(), `${slugify(style.name)}.vitro.json`].filter(Boolean).join("/");
		const { id, ...rest } = style;
		await this.writeVaultFile(p, JSON.stringify({ typesetVitro: 1, ...rest }, null, 2));
		new Notice(`Style preset saved: ${p}`);
	}

	importPresetJson() {
		const files = this.app.vault.getFiles().filter((f) => f.path.endsWith(".vitro.json"));
		if (!files.length) {
			new Notice("No *.vitro.json preset files found in the vault.");
			return;
		}
		new PresetFileModal(this, files).open();
	}

	async importFrom(file: TFile) {
		try {
			const raw = JSON.parse(await this.app.vault.read(file));
			const s = this.addPreset(normalizeStyle(raw));
			new Notice(`Imported style “${s.name}”.`);
			this.refreshPreviews(true);
			for (const v of this.previews()) v.refreshPanel();
		} catch (e) {
			new Notice(`Could not import ${file.name}: ${(e as Error).message}`);
		}
	}
}

class PresetFileModal extends FuzzySuggestModal<TFile> {
	constructor(private plugin: TypesetVitroPlugin, private files: TFile[]) {
		super(plugin.app);
		this.setPlaceholder("Choose a style preset file");
	}
	getItems() {
		return this.files;
	}
	getItemText(f: TFile) {
		return f.path;
	}
	onChooseItem(f: TFile) {
		this.plugin.importFrom(f);
	}
}
