import { App, PluginSettingTab, Setting } from "obsidian";
import type TypesetVitroPlugin from "./main";
import { VitroStyle, makeBuiltInPresets } from "./style/schema";

export interface VitroSettings {
	pandocPath: string;
	typstPath: string;
	fontPaths: string;
	bibliography: string;
	exportFolder: string;
	openAfterExport: boolean;
	callouts: "quote" | "omit";
	stripTags: boolean;
	embedNotes: boolean;
	hardLineBreaks: boolean;
	debounceMs: number;
	presets: VitroStyle[];
	activePresetId: string;
	panelOpen: boolean;
	zoom: number; // 0 = fit width
}

export const DEFAULT_SETTINGS: VitroSettings = {
	pandocPath: "pandoc",
	typstPath: "typst",
	fontPaths: "",
	bibliography: "",
	exportFolder: "",
	openAfterExport: true,
	callouts: "quote",
	stripTags: true,
	embedNotes: true,
	hardLineBreaks: false,
	debounceMs: 300,
	presets: makeBuiltInPresets(),
	activePresetId: "academic-de",
	panelOpen: true,
	zoom: 0,
};

export class VitroSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: TypesetVitroPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl).setName("Tools").setHeading();
		const versions = containerEl.createDiv({ cls: "vitro-settings-versions" });
		this.plugin.checkTools().then((v) => {
			versions.empty();
			versions.createDiv({ text: `Pandoc: ${v.pandoc ?? "not found"}`, cls: v.pandoc ? "" : "mod-warning" });
			versions.createDiv({ text: `Typst: ${v.typst ?? "not found"}`, cls: v.typst ? "" : "mod-warning" });
		});

		new Setting(containerEl)
			.setName("Pandoc executable")
			.setDesc("Command or full path, e.g. C:\\Program Files\\Pandoc\\pandoc.exe")
			.addText((t) =>
				t.setValue(s.pandocPath).onChange(async (v) => {
					s.pandocPath = v.trim() || "pandoc";
					await this.plugin.saveSettings();
				})
			);
		new Setting(containerEl)
			.setName("Typst executable")
			.setDesc("Command or full path. Typst 0.13 or newer.")
			.addText((t) =>
				t.setValue(s.typstPath).onChange(async (v) => {
					s.typstPath = v.trim() || "typst";
					await this.plugin.saveSettings();
					this.plugin.restartPreviews();
				})
			);
		new Setting(containerEl)
			.setName("Extra font folders")
			.setDesc("Optional. Folders with fonts that aren't installed system-wide, separated by ;")
			.addText((t) =>
				t.setValue(s.fontPaths).onChange(async (v) => {
					s.fontPaths = v;
					this.plugin.fontCache = null;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("Citations").setHeading();
		new Setting(containerEl)
			.setName("Bibliography file")
			.setDesc(
				"Absolute path to your library exported by Better BibTeX (Better CSL JSON or .bib, with “Keep updated” on). A note's own `bibliography:` frontmatter takes precedence."
			)
			.addText((t) =>
				t
					.setPlaceholder("C:\\Users\\…\\Zotero\\library.json")
					.setValue(s.bibliography)
					.onChange(async (v) => {
						s.bibliography = v.trim();
						await this.plugin.saveSettings();
						this.plugin.refreshPreviews(true);
					})
			);

		new Setting(containerEl).setName("Obsidian syntax").setHeading();
		new Setting(containerEl)
			.setName("Callouts")
			.addDropdown((d) =>
				d
					.addOption("quote", "Typeset as block quote")
					.addOption("omit", "Leave out")
					.setValue(s.callouts)
					.onChange(async (v) => {
						s.callouts = v as any;
						await this.plugin.saveSettings();
						this.plugin.refreshPreviews(true);
					})
			);
		new Setting(containerEl)
			.setName("Remove #tags")
			.addToggle((t) =>
				t.setValue(s.stripTags).onChange(async (v) => {
					s.stripTags = v;
					await this.plugin.saveSettings();
					this.plugin.refreshPreviews(true);
				})
			);
		new Setting(containerEl)
			.setName("Include embedded notes")
			.setDesc("![[Note]] and ![[Note#Section]] are typeset in place — handy for assembling chapters.")
			.addToggle((t) =>
				t.setValue(s.embedNotes).onChange(async (v) => {
					s.embedNotes = v;
					await this.plugin.saveSettings();
					this.plugin.refreshPreviews(true);
				})
			);
		new Setting(containerEl)
			.setName("Single line breaks are breaks")
			.setDesc("Off: only blank lines start a new paragraph (standard Markdown).")
			.addToggle((t) =>
				t.setValue(s.hardLineBreaks).onChange(async (v) => {
					s.hardLineBreaks = v;
					await this.plugin.saveSettings();
					this.plugin.refreshPreviews(true);
				})
			);

		new Setting(containerEl).setName("Preview & export").setHeading();
		new Setting(containerEl)
			.setName("Update delay")
			.setDesc("Milliseconds after you stop typing before the preview updates.")
			.addSlider((sl) =>
				sl
					.setLimits(100, 1500, 50)
					.setValue(s.debounceMs)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.debounceMs = v;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("PDF folder")
			.setDesc("Vault folder for exported PDFs. Empty: next to the note.")
			.addText((t) =>
				t.setValue(s.exportFolder).onChange(async (v) => {
					s.exportFolder = v.trim().replace(/^\/+|\/+$/g, "");
					await this.plugin.saveSettings();
				})
			);
		new Setting(containerEl).setName("Open PDF after export").addToggle((t) =>
			t.setValue(s.openAfterExport).onChange(async (v) => {
				s.openAfterExport = v;
				await this.plugin.saveSettings();
			})
		);
	}
}
