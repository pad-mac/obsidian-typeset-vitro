import { spawn } from "child_process";

export interface PandocOptions {
	pandocPath: string;
	cwd: string;
	/** absolute paths */
	bibliographies: string[];
	/** applied before citeproc, in order */
	luaFilters?: string[];
	/** absolute path to .csl, or "" for Pandoc's built-in Chicago author-date */
	csl: string;
	lang?: string;
	bibliographyTitle?: string;
	suppressBibliography?: boolean;
	hardLineBreaks?: boolean;
	/** frontmatter already declares bibliography/csl → don't override */
	docHasBibliography?: boolean;
	docHasCsl?: boolean;
}

export interface PandocResult {
	typst: string;
	warnings: string[];
}

export class ToolMissingError extends Error {}

export function runProcess(
	cmd: string,
	args: string[],
	opts: { cwd?: string; input?: string; timeoutMs?: number } = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true });
		} catch (e) {
			reject(e);
			return;
		}
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`${cmd} timed out`));
		}, opts.timeoutMs ?? 60000);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (d: string) => (stdout += d));
		child.stderr.on("data", (d: string) => (stderr += d));
		child.on("error", (e: NodeJS.ErrnoException) => {
			clearTimeout(timer);
			reject(e.code === "ENOENT" ? new ToolMissingError(`Could not start "${cmd}". Is it installed? Set its path in Typeset Vitro's settings.`) : e);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
		if (opts.input !== undefined) {
			child.stdin.on("error", () => {});
			child.stdin.end(opts.input, "utf8");
		}
	});
}

export async function pandocToTypst(markdown: string, o: PandocOptions): Promise<PandocResult> {
	const reader = "markdown+mark+tex_math_dollars" + (o.hardLineBreaks ? "+hard_line_breaks" : "");
	const args = ["-f", reader, "-t", "typst", "--wrap=none"];
	for (const f of o.luaFilters ?? []) args.push("--lua-filter", f);
	args.push("--citeproc");
	if (!o.docHasBibliography) for (const b of o.bibliographies) args.push("--bibliography", b);
	if (o.csl && !o.docHasCsl) args.push("--csl", o.csl);
	if (o.lang) args.push("-M", `lang=${o.lang}`);
	if (o.bibliographyTitle) args.push("-M", `reference-section-title=${o.bibliographyTitle}`);
	if (o.suppressBibliography) args.push("-M", "suppress-bibliography=true");

	const r = await runProcess(o.pandocPath || "pandoc", args, { cwd: o.cwd, input: markdown });
	if (r.code !== 0) throw new Error(r.stderr.trim() || `pandoc exited with code ${r.code}`);
	const warnings = r.stderr
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.startsWith("[WARNING]"))
		.map((l) => l.replace(/^\[WARNING\]\s*/, ""));
	return { typst: r.stdout, warnings };
}

export async function toolVersion(cmd: string): Promise<string | null> {
	try {
		const r = await runProcess(cmd, ["--version"], { timeoutMs: 10000 });
		return r.stdout.split(/\r?\n/)[0].trim() || null;
	} catch {
		return null;
	}
}
