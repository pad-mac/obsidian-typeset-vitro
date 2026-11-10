import type { App } from "obsidian";
import * as fs from "fs";

/**
 * Citation data straight from ZotFlow (Evo), so no Better BibTeX export is needed.
 *
 * Preferred: ZotFlow's public API (`plugin.api.getCslItems`, v1+).
 * Fallback for ZotFlow builds without the API: read its local database
 * (IndexedDB "zotflow-dev", read-only) — same items, no network backfill.
 *
 * Citekey rule (same as ZotFlow's citation templates): an item's
 * `citationKey`, else its Zotero item key.
 */

const PLUGIN_IDS = ["zotflow-evo", "zotflow"];
const DB_NAME = "zotflow-dev";

type CslItem = Record<string, unknown> & { id: string };

interface ZotflowApiV1 {
	version: number;
	getCslItems(keys: string[]): Promise<{ items: Record<string, unknown>[]; missing: string[] }>;
	cslStylesFolder(): string;
	onSyncFinished(cb: () => void): () => void;
}

export type ZotflowMode = "api" | "database" | "none";

/** Pandoc citekeys in a Markdown text: [@key, 45], @key [45], [-@key] … */
export function extractCitekeys(markdown: string): string[] {
	const keys = new Set<string>();
	const re = /(?:^|[^\p{L}\p{N}_@.])-?@([\p{L}\p{N}_](?:[\p{L}\p{N}_:.#$%&\-+?<>~/]*[\p{L}\p{N}_])?)/gu;
	for (const m of markdown.matchAll(re)) keys.add(m[1]);
	// @{key with odd chars}
	for (const m of markdown.matchAll(/@\{([^}\s]+)\}/g)) keys.add(m[1]);
	return [...keys];
}

export class ZotflowSource {
	private cache = new Map<string, CslItem | null>();
	private unsubscribe: (() => void) | null = null;
	private writtenSignature = "";

	constructor(private app: App, private cacheFile: string, private onChange: () => void) {}

	private plugin(): any {
		const plugins = (this.app as any).plugins;
		for (const id of PLUGIN_IDS) {
			const p = plugins?.plugins?.[id];
			if (p) return p;
		}
		return null;
	}

	private api(): ZotflowApiV1 | null {
		const api = this.plugin()?.api;
		return api && typeof api.getCslItems === "function" && api.version >= 1 ? api : null;
	}

	mode(): ZotflowMode {
		if (!this.plugin()) return "none";
		return this.api() ? "api" : "database";
	}

	/** Vault folder where ZotFlow keeps custom .csl styles ("" if none). */
	stylesFolder(): string {
		const api = this.api();
		if (api) return api.cslStylesFolder() || "";
		return this.plugin()?.settings?.cslStylesFolder ?? "";
	}

	/** Forget everything (e.g. after a sync, or the refresh button). */
	clear() {
		this.cache.clear();
		this.writtenSignature = "";
	}

	private watchSyncs() {
		if (this.unsubscribe) return;
		const api = this.api();
		if (!api) return;
		try {
			this.unsubscribe = api.onSyncFinished(() => {
				this.clear();
				this.onChange();
			});
		} catch {
			/* older API */
		}
	}

	dispose() {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	/**
	 * Make sure every key is looked up; writes all known items to the cache file.
	 * Returns the CSL-JSON file for Pandoc and the keys ZotFlow doesn't know.
	 */
	async resolve(keys: string[]): Promise<{ file: string; missing: string[]; warning?: string }> {
		this.watchSyncs();
		const unknown = keys.filter((k) => !this.cache.has(k));
		let warning: string | undefined;
		if (unknown.length) {
			try {
				const found = this.api() ? await this.viaApi(unknown) : await this.viaDatabase(unknown);
				for (const k of unknown) this.cache.set(k, found.get(k) ?? null);
			} catch (e) {
				warning = `Couldn't read citations from ZotFlow: ${(e as Error).message}`;
			}
		}
		const missing = keys.filter((k) => this.cache.get(k) == null && this.cache.has(k));
		this.writeFile();
		return { file: this.cacheFile, missing, warning };
	}

	private writeFile() {
		const items = [...this.cache.values()].filter((v): v is CslItem => !!v);
		const signature = items.map((i) => i.id).sort().join("\u0000");
		if (signature === this.writtenSignature && fs.existsSync(this.cacheFile)) return;
		fs.writeFileSync(this.cacheFile, JSON.stringify(items), "utf8");
		this.writtenSignature = signature;
	}

	private async viaApi(keys: string[]): Promise<Map<string, CslItem>> {
		const { items } = await this.api()!.getCslItems(keys);
		const out = new Map<string, CslItem>();
		for (const item of items) if (typeof item.id === "string") out.set(item.id, item as CslItem);
		return out;
	}

	/** Read-only scan of ZotFlow's IndexedDB (for ZotFlow builds without the API). */
	private viaDatabase(keys: string[]): Promise<Map<string, CslItem>> {
		const wanted = new Set(keys);
		return new Promise((resolve, reject) => {
			const req = indexedDB.open(DB_NAME);
			req.onerror = () => reject(req.error ?? new Error("could not open ZotFlow's database"));
			req.onupgradeneeded = () => {
				// the database doesn't exist yet: don't create one on ZotFlow's behalf
				req.transaction?.abort();
				reject(new Error("ZotFlow has no local library yet (sync first)"));
			};
			req.onsuccess = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains("items")) {
					db.close();
					reject(new Error("unexpected ZotFlow database layout"));
					return;
				}
				const out = new Map<string, CslItem>();
				const byCitationKey = new Set<string>();
				const tx = db.transaction("items", "readonly");
				const cursorReq = tx.objectStore("items").openCursor();
				cursorReq.onsuccess = () => {
					const cursor = cursorReq.result;
					if (!cursor) return;
					const item = cursor.value as any;
					if (!item.trashed && !item.parentItem && item.csljson && !["note", "annotation", "attachment"].includes(item.itemType)) {
						const ck = item.citationKey && wanted.has(item.citationKey) ? item.citationKey : wanted.has(item.key) ? item.key : null;
						// a citationKey match wins over a Zotero-key match
						if (ck && (!out.has(ck) || (ck === item.citationKey && !byCitationKey.has(ck)))) {
							out.set(ck, { ...item.csljson, id: ck });
							if (ck === item.citationKey) byCitationKey.add(ck);
						}
					}
					cursor.continue();
				};
				tx.oncomplete = () => {
					db.close();
					resolve(out);
				};
				tx.onerror = () => {
					db.close();
					reject(tx.error ?? new Error("reading ZotFlow's database failed"));
				};
			};
		});
	}
}
