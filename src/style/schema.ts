/**
 * Engine-neutral style description. Everything the style panel edits lives here;
 * generators (currently only Typst) turn it into engine code.
 *
 * Units: font sizes in pt, spacing in em (relative to the element's own size),
 * page margins in mm, rule lengths in % of the text width.
 */

export type PaperId =
	| "a4"
	| "a5"
	| "iso-b5"
	| "us-letter"
	| "155x230"
	| "170x240";

export const PAPERS: Record<PaperId, string> = {
	a4: "A4 (210 × 297 mm)",
	a5: "A5 (148 × 210 mm)",
	"iso-b5": "B5 (176 × 250 mm)",
	"us-letter": "US Letter",
	"155x230": "Book 15.5 × 23 cm",
	"170x240": "Book 17 × 24 cm",
};

export type Weight = "regular" | "medium" | "semibold" | "bold";

export interface HeadingStyle {
	/** empty = body font */
	font: string;
	size: number;
	weight: Weight;
	italic: boolean;
	smallCaps: boolean;
	align: "left" | "center";
	above: number;
	below: number;
	numbered: boolean;
	pageBreak: boolean;
}

export interface VitroStyle {
	id: string;
	name: string;
	page: {
		paper: PaperId;
		marginTop: number;
		marginBottom: number;
		marginInner: number;
		marginOuter: number;
		twoSided: boolean;
		numbering: "none" | "1" | "i";
		numberAlign: "center" | "right" | "outside";
		hideFirstNumber: boolean;
		numberSize: number;
		/** physical page on which page numbers start to appear */
		numberFrom: number;
		/** that page is numbered 1 (otherwise numbers count the pages before it) */
		restartNumbering: boolean;
	};
	text: {
		font: string;
		size: number;
		leading: number;
		justify: boolean;
		hyphenate: boolean;
		indent: number;
		indentAll: boolean;
		parSpacing: number;
		oldStyleFigures: boolean;
		lang: string;
	};
	headings: {
		numberFormat: "1.1" | "1.1." | "I.1";
		levels: [HeadingStyle, HeadingStyle, HeadingStyle];
	};
	footnotes: {
		size: number;
		leading: number;
		gap: number;
		numbering: "1" | "i" | "a" | "*";
		entryMarker: "super" | "plain";
		hanging: boolean;
		hangWidth: number;
		indent: number;
		separatorLength: number;
		separatorStroke: number;
		clearance: number;
		justify: boolean;
		/** the number in the running text */
		marker: {
			format: "1" | "[1]" | "1)" | "(1)";
			typographic: boolean;
			size: number;
			raise: number;
			weight: Weight;
			spaceBefore: number;
			color: string;
		};
	};
	quotes: {
		size: number;
		leading: number;
		indentLeft: number;
		indentRight: number;
		above: number;
		below: number;
		italic: boolean;
	};
	bibliography: {
		show: boolean;
		title: string;
		size: number;
		hangingIndent: number;
		spacing: number;
		justify: boolean;
	};
	citations: {
		/** "bundled:chicago-notes-bibliography" | "pandoc-default" | path to .csl */
		style: string;
	};
	toc: {
		show: boolean;
		title: string;
		depth: number;
		size: number;
		level1Bold: boolean;
		leaders: boolean;
		pageNumbers: boolean;
		indent: number;
		spacing: number;
		level1Above: number;
		ownPage: boolean;
	};
	title: {
		show: boolean;
		/** empty = body font */
		font: string;
		/** author and date; empty = body font */
		metaFont: string;
		align: "left" | "center";
		size: number;
		weight: Weight;
		subtitleSize: number;
		metaSize: number;
		below: number;
		ownPage: boolean;
	};
	figures: {
		captionSize: number;
	};
}

const heading = (o: Partial<HeadingStyle>): HeadingStyle => ({
	font: "",
	size: 12,
	weight: "bold",
	italic: false,
	smallCaps: false,
	align: "left",
	above: 1.6,
	below: 0.8,
	numbered: false,
	pageBreak: false,
	...o,
});

export const BASE_STYLE: VitroStyle = {
	id: "academic-de",
	name: "Academic (DE)",
	page: {
		paper: "a4",
		marginTop: 30,
		marginBottom: 30,
		marginInner: 30,
		marginOuter: 30,
		twoSided: false,
		numbering: "1",
		numberAlign: "center",
		hideFirstNumber: false,
		numberSize: 10,
		numberFrom: 1,
		restartNumbering: true,
	},
	text: {
		font: "Libertinus Serif",
		size: 11,
		leading: 0.7,
		justify: true,
		hyphenate: true,
		indent: 1.2,
		indentAll: false,
		parSpacing: 0.7,
		oldStyleFigures: false,
		lang: "de",
	},
	headings: {
		numberFormat: "1.1",
		levels: [
			heading({ size: 14, above: 2, below: 1 }),
			heading({ size: 12 }),
			heading({ size: 11, weight: "regular", italic: true, above: 1.4, below: 0.6 }),
		],
	},
	footnotes: {
		size: 9,
		leading: 0.55,
		gap: 0.45,
		numbering: "1",
		entryMarker: "super",
		hanging: true,
		hangWidth: 1.4,
		indent: 0,
		separatorLength: 25,
		separatorStroke: 0.5,
		clearance: 1.2,
		justify: true,
		marker: {
			format: "1",
			typographic: true,
			size: 60,
			raise: 0.5,
			weight: "regular",
			spaceBefore: 0,
			color: "",
		},
	},
	quotes: {
		size: 10,
		leading: 0.6,
		indentLeft: 2,
		indentRight: 0,
		above: 1,
		below: 1,
		italic: false,
	},
	bibliography: {
		show: true,
		title: "Literatur",
		size: 10,
		hangingIndent: 1.5,
		spacing: 0.5,
		justify: false,
	},
	citations: { style: "bundled:chicago-notes-bibliography" },
	toc: {
		show: false,
		title: "Inhalt",
		depth: 2,
		size: 11,
		level1Bold: true,
		leaders: true,
		pageNumbers: true,
		indent: 1.5,
		spacing: 0.45,
		level1Above: 0.9,
		ownPage: true,
	},
	title: {
		show: true,
		font: "",
		metaFont: "",
		align: "left",
		size: 20,
		weight: "regular",
		subtitleSize: 14,
		metaSize: 11,
		below: 2.5,
		ownPage: false,
	},
	figures: { captionSize: 9 },
};

function clone<T>(o: T): T {
	return JSON.parse(JSON.stringify(o));
}

export function makeBuiltInPresets(): VitroStyle[] {
	const academic = clone(BASE_STYLE);

	const manuscript = clone(BASE_STYLE);
	manuscript.id = "manuscript";
	manuscript.name = "Manuscript";
	manuscript.page = { ...manuscript.page, marginTop: 25, marginBottom: 25, marginInner: 25, marginOuter: 40, numberAlign: "right" };
	manuscript.text = { ...manuscript.text, size: 12, leading: 1.0, justify: false, indent: 0, parSpacing: 1.2 };
	manuscript.headings.levels[0].size = 15;
	manuscript.headings.levels[1].size = 13;
	manuscript.headings.levels[2].size = 12;
	manuscript.footnotes = { ...manuscript.footnotes, size: 10, leading: 0.6, justify: false };
	manuscript.quotes = { ...manuscript.quotes, size: 11, leading: 0.7 };

	const book = clone(BASE_STYLE);
	book.id = "book-17x24";
	book.name = "Book 17 × 24";
	book.page = {
		...book.page,
		paper: "170x240",
		marginTop: 22,
		marginBottom: 28,
		marginInner: 20,
		marginOuter: 26,
		twoSided: true,
		numberAlign: "outside",
		hideFirstNumber: true,
		numberSize: 9.5,
	};
	book.text = { ...book.text, font: "EB Garamond", size: 10.5, leading: 0.68, oldStyleFigures: true };
	book.headings.levels[0] = { ...book.headings.levels[0], size: 15, weight: "regular", smallCaps: true, align: "center", above: 3, below: 1.5, pageBreak: true };
	book.headings.levels[1] = { ...book.headings.levels[1], size: 11.5, weight: "regular", italic: true };
	book.headings.levels[2] = { ...book.headings.levels[2], size: 10.5 };
	book.footnotes = { ...book.footnotes, size: 8.5 };
	book.quotes = { ...book.quotes, size: 9.5 };
	book.bibliography = { ...book.bibliography, size: 9.5 };
	book.title = { ...book.title, align: "center", size: 22, ownPage: true };

	return [academic, manuscript, book];
}

/** Fill fields missing from older/imported presets with defaults. */
export function normalizeStyle(raw: unknown): VitroStyle {
	const base = clone(BASE_STYLE);
	// ≤ 0.2: footnotes.marker was the number style inside the note
	const r = raw as any;
	if (r?.footnotes && typeof r.footnotes.marker === "string") {
		r.footnotes = { ...r.footnotes, entryMarker: r.footnotes.marker };
		delete r.footnotes.marker;
	}
	const merge = (target: any, src: any): any => {
		if (Array.isArray(target)) {
			return target.map((t, i) => (Array.isArray(src) && src[i] !== undefined ? merge(t, src[i]) : t));
		}
		if (target && typeof target === "object") {
			const out: any = {};
			for (const k of Object.keys(target)) {
				out[k] = src && typeof src === "object" && k in src ? merge(target[k], src[k]) : target[k];
			}
			return out;
		}
		return src !== undefined && typeof src === typeof target ? src : target;
	};
	return merge(base, raw);
}

export function cloneStyle(s: VitroStyle): VitroStyle {
	return clone(s);
}

export function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "style"
	);
}
