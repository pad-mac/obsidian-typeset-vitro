# Typeset Vitro

Live typeset preview for Obsidian. Write in a normal note, with real footnotes and Zotero citations, and see the finished pages update beside it as you type. A visual style panel sets fonts, sizes and spacing for each element. Export to PDF when done.

```
note (Markdown) ──► Pandoc + citeproc ──► Typst ──► pages in the preview pane / PDF
                         ▲                   ▲
            Zotero (Better BibTeX)     style panel (presets)
```

## Requirements

- Obsidian desktop
- [Pandoc](https://pandoc.org/installing.html) 3.x: `winget install --id JohnMacFarlane.Pandoc`
- [Typst](https://github.com/typst/typst) 0.13 or newer: `winget install --id Typst.Typst`
- For citations, either:
  - **ZotFlow Evo**: nothing to set up. Typeset Vitro reads the citation data from ZotFlow's library (see below), or
  - Zotero with [Better BibTeX](https://retorque.re/zotero-better-bibtex/). Export your library (or a collection) as **Better CSL JSON** and turn on **Keep updated**. Then put the path of that file under Settings → Typeset Vitro → Bibliography file.

Restart Obsidian after installing Pandoc or Typst so it picks up the new `PATH`. Alternatively, enter the full paths to the executables in the settings.

## Install (BRAT)

Add `pad-mac/obsidian-typeset-vitro` in BRAT.

## Use

1. Open a note and run **Typeset Vitro: Open typeset preview** (or click the ribbon icon). The preview opens next to the note and follows whichever note is active. Pin it to keep it on one note.
2. Write as usual:
   - footnotes: `[^1]` or `^[inline]`
   - citations: `[@latour1996, 45]`, `[vgl. @simondon1958, 12–14; @kittler1986]`, `@latour1996 [45]`
   - with a note style (the default is Chicago notes), every citation becomes a footnote by itself
3. The **style panel** (slider icon) has sections for Page, Body text, Headings (H1/H2/H3+), Footnotes (the number in the text and the notes themselves), Contents, Block quotes, Citations & bibliography, Title and Figures. Every change shows up within a fraction of a second. You can also drag a number field's label left or right to scrub its value. Font fields open a searchable list where each font name is shown in that font, rendered by Typst exactly as it will appear in the PDF. ↑/↓ try fonts live, Enter keeps, Esc reverts, and any typed name is accepted. "Reload installed fonts" picks up fonts installed while Obsidian is running.
4. **Export PDF** (download icon). The PDF goes next to the note, or into the folder set in the settings.

### Citations with ZotFlow

When ZotFlow Evo is enabled, every `@citekey` in the note is looked up in ZotFlow's library: the item's citation key, or its Zotero item key if it has none. That is the same rule ZotFlow uses when it inserts citations. After each ZotFlow sync the data is read again; the refresh button does the same. If ZotFlow Evo is older than 1.7.1-beta.21, Typeset Vitro reads ZotFlow's local database directly. That works too, but items synced without citation data are then reported as not found.

The intended format is Pandoc citations inside footnotes, with your own remarks around them:

```markdown
Der Transrapid schwebte.[^latour1996-p45]

[^latour1996-p45]: [@latour1996, pp. 45]
[^k1]: Vgl. dazu kritisch [@simondon1958, 12]; anders [@kittler1986].
```

- The CSL style formats every citation: first full form, then short forms, and *ibid.*/*Ebd.* if the style uses them. A footnote label used twice gives two footnotes in the PDF, as print needs.
- With a note style, citations inside your own text in a footnote are set without the parentheses Pandoc otherwise adds ("Vgl. dazu kritisch Gilbert Simondon, *Du mode …*, 12").
- Page labels work in any language: `pp. 45`, `p. 45`, `S. 45` and `Seite 45` all become the style's own page form. Other locators (`chap.`, `Bd.`) are left as written.
- CSL styles in ZotFlow's CSL styles folder appear in the panel's citation style list.

### Frontmatter the plugin reads

```yaml
title: Der Transrapid als Versprechen
subtitle: Eine Kulturgeschichte
author: Patrick Mackens
date: November 2026
lang: de-DE              # quotes, hyphenation, citation terms
typeset: Book 17 × 24    # pins a style preset to this note
bibliography: path.json  # overrides the library from the settings
csl: path/to/style.csl   # overrides the preset's citation style
```

To place the bibliography yourself, write `::: {#refs}` and `:::` on two lines where it should go.

### Obsidian syntax

| In the note | In the PDF |
|---|---|
| `[[Note\|alias]]` | the link text |
| `![[image.png\|300]]` | the image, 300 px wide |
| `![[Other note]]`, `![[Note#Section]]` | the embedded text (good for putting chapters together) |
| `> [!note] Title` callouts | a block quote, or left out (setting) |
| `==highlight==` | highlighted text |
| `%% comments %%`, `^block-ids`, `#tags` | removed |

## Style presets

Presets are plain data and don't depend on the engine. From the `⋯` menu in the panel you can:

- **Duplicate / rename / delete / reset** presets
- **Export as Typst template**: writes a standalone `.typ` file. Use it in any Typst document with `#import "style.typ": *` and `#show: vitro`. The preview runs this same code.
- **Export / import preset file** (`*.vitro.json`) to share a style with co-editors

Built-in presets: *Academic (DE)*, *Manuscript*, *Book 17 × 24*.

## How it works

- Pandoc converts the note to Typst markup. citeproc resolves the citations with your CSL style, and with note styles they become footnotes.
- The plugin generates a Typst template from the active preset and puts it in front of the body.
- A persistent `typst watch` process recompiles incrementally, typically in 10–60 ms, and writes one SVG per page. The pane shows those SVGs.
- If you only change the style, Pandoc doesn't run again. Typst recompiles from the cached body.

The bundled citation style *Chicago Manual of Style 18th edition (notes and bibliography)* comes from the [CSL project](https://github.com/citation-style-language/styles) and is licensed CC BY-SA 3.0.

## License

MIT
