import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { runProcess, ToolMissingError } from "./pandoc";

export interface Diagnostic {
	severity: "error" | "warning";
	message: string;
	line?: number;
	column?: number;
	hints: string[];
}

export interface CompileResult {
	ok: boolean;
	durationMs?: number;
	diagnostics: Diagnostic[];
	/** absolute paths of the current page SVGs, in order */
	pages: string[];
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const STATUS = /\[\d\d:\d\d:\d\d\] compiled (successfully|with warnings|with errors)(?: in ([\d.]+)\s*(ms|s|µs))?/g;
const PAGE_FILE = /^p-(\d+)-of-(\d+)\.svg$/;

export function parseDiagnostics(text: string, mainFile: string): Diagnostic[] {
	const diags: Diagnostic[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		let m = line.match(/^(.*?):(\d+):(\d+): (error|warning): (.*)$/);
		if (m) {
			const inMain = path.basename(m[1]) === path.basename(mainFile);
			diags.push({
				severity: m[4] as "error" | "warning",
				message: m[5],
				line: inMain ? +m[2] : undefined,
				column: inMain ? +m[3] : undefined,
				hints: [],
			});
			continue;
		}
		m = line.match(/^(error|warning): (.*)$/);
		if (m) {
			diags.push({ severity: m[1] as "error" | "warning", message: m[2], hints: [] });
			continue;
		}
		m = line.match(/^hint: (.*)$/);
		if (m && diags.length) diags[diags.length - 1].hints.push(m[1]);
	}
	return diags;
}

/**
 * Keeps one `typst watch` process alive per preview. Typst then compiles
 * incrementally (fonts loaded once, unchanged parts memoised), which is what
 * makes the live preview fast.
 */
export class TypstWatcher {
	private proc: ChildProcess | null = null;
	private buf = "";
	private flushTimer: number | null = null;
	private mtimes = new Map<string, number>();
	stopped = false;

	constructor(
		private typstPath: string,
		private root: string,
		private mainFile: string,
		private outDir: string,
		private fontPaths: string[],
		private onResult: (r: CompileResult) => void,
		private onExit: (err: Error | null) => void
	) {}

	start() {
		fs.mkdirSync(this.outDir, { recursive: true });
		const args = [
			"watch",
			this.mainFile,
			path.join(this.outDir, "p-{p}-of-{t}.svg"),
			"--root",
			this.root,
			"--diagnostic-format",
			"short",
		];
		for (const fp of this.fontPaths) args.push("--font-path", fp);
		const proc = spawn(this.typstPath || "typst", args, {
			windowsHide: true,
			env: { ...process.env, NO_COLOR: "1" },
		});
		this.proc = proc;
		proc.stderr?.setEncoding("utf8");
		proc.stdout?.setEncoding("utf8");
		proc.stderr?.on("data", (d: string) => this.onData(d));
		proc.stdout?.on("data", (d: string) => this.onData(d));
		proc.on("error", (e: NodeJS.ErrnoException) => {
			this.proc = null;
			this.onExit(
				e.code === "ENOENT"
					? new ToolMissingError(`Could not start "${this.typstPath || "typst"}". Is Typst installed? Set its path in Typeset Vitro's settings.`)
					: e
			);
		});
		proc.on("exit", (code) => {
			if (this.proc === proc) this.proc = null;
			if (!this.stopped) this.onExit(code ? new Error(`typst watch exited (${code})`) : null);
		});
	}

	get running() {
		return !!this.proc;
	}

	stop() {
		this.stopped = true;
		if (this.flushTimer) window.clearTimeout(this.flushTimer);
		this.proc?.kill();
		this.proc = null;
	}

	private onData(chunk: string) {
		this.buf += chunk.replace(ANSI, "");
		if (this.flushTimer) window.clearTimeout(this.flushTimer);
		this.flushTimer = window.setTimeout(() => this.flush(), 35);
	}

	private flush() {
		this.flushTimer = null;
		const matches = [...this.buf.matchAll(STATUS)];
		const last = matches.pop();
		if (!last || last.index === undefined) return;
		let tail = this.buf.slice(last.index + last[0].length);
		const next = tail.indexOf("watching ");
		if (next >= 0) {
			this.buf = tail.slice(next);
			tail = tail.slice(0, next);
		} else {
			this.buf = "";
		}
		const status = last[1];
		let durationMs: number | undefined;
		if (last[2]) {
			const v = parseFloat(last[2]);
			durationMs = last[3] === "s" ? v * 1000 : last[3] === "µs" ? v / 1000 : v;
		}
		const diagnostics = parseDiagnostics(tail, this.mainFile);
		const ok = status !== "with errors";
		const pages = ok ? this.collectPages() : this.currentPages();
		this.onResult({ ok, durationMs, diagnostics, pages });
	}

	private listPages(): { file: string; p: number; t: number; mtime: number }[] {
		let names: string[] = [];
		try {
			names = fs.readdirSync(this.outDir);
		} catch {
			return [];
		}
		const out = [];
		for (const n of names) {
			const m = n.match(PAGE_FILE);
			if (!m) continue;
			const file = path.join(this.outDir, n);
			try {
				out.push({ file, p: +m[1], t: +m[2], mtime: fs.statSync(file).mtimeMs });
			} catch {
				/* raced with deletion */
			}
		}
		return out;
	}

	private lastTotal = 0;

	private currentPages(): string[] {
		return this.listPages()
			.filter((f) => f.t === this.lastTotal)
			.sort((a, b) => a.p - b.p)
			.map((f) => f.file);
	}

	/** Pages of the newest compile; files from older page counts are removed. */
	private collectPages(): string[] {
		const files = this.listPages();
		if (!files.length) return [];
		const newest = files.reduce((a, b) => (b.mtime > a.mtime ? b : a));
		const total = newest.t;
		this.lastTotal = total;
		for (const f of files) {
			if (f.t !== total) {
				try {
					fs.unlinkSync(f.file);
				} catch {
					/* ignore */
				}
			}
		}
		return files
			.filter((f) => f.t === total)
			.sort((a, b) => a.p - b.p)
			.map((f) => f.file);
	}

	/** True when the page file changed since we last read it. */
	changed(file: string): boolean {
		try {
			const m = fs.statSync(file).mtimeMs;
			if (this.mtimes.get(file) === m) return false;
			this.mtimes.set(file, m);
			return true;
		} catch {
			return true;
		}
	}
}

export async function compilePdf(
	typstPath: string,
	root: string,
	mainFile: string,
	outFile: string,
	fontPaths: string[]
): Promise<Diagnostic[]> {
	const args = ["compile", mainFile, outFile, "--root", root, "--diagnostic-format", "short"];
	for (const fp of fontPaths) args.push("--font-path", fp);
	const r = await runProcess(typstPath || "typst", args, { timeoutMs: 120000 });
	const diags = parseDiagnostics(r.stderr.replace(ANSI, ""), mainFile);
	if (r.code !== 0) {
		const err = new Error(diags.filter((d) => d.severity === "error").map((d) => d.message).join("\n") || r.stderr);
		(err as any).diagnostics = diags;
		throw err;
	}
	return diags;
}

export async function listFonts(typstPath: string, fontPaths: string[]): Promise<string[]> {
	const args = ["fonts"];
	for (const fp of fontPaths) args.push("--font-path", fp);
	try {
		const r = await runProcess(typstPath || "typst", args, { timeoutMs: 30000 });
		return [...new Set(r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
}
