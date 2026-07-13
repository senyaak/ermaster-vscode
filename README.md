# erm-vsc

A VS Code extension for ER diagrams — an ERMaster replacement with **full
compatibility with the `.erm` format**: files open and save so that the
original Eclipse ERMaster plugin still reads them (and vice versa).

## Features

- **Visual `.erm` editor** (custom editor, SVG canvas)
  - tool palette (Select / Table / Note / Relation)
  - ERMaster-style tables: colored header, primary keys on top with a
    separator, PK/FK markers
  - relations in IE (crow's foot) notation, auto-created FK columns
  - categories (visual grouping frames), notes, colors
  - display modes: logical / physical / both
  - edit dialogs on double-click; context menu; zoom/pan
- **ERMaster compatibility** — the native XML format is implemented:
  word dictionary, relations with cardinalities, indexes (including the
  historical `<inidex>` typo), categories, test data, change tracking and
  settings all survive a round-trip losslessly; cross-references are
  renumbered exactly like `PersistentXmlImpl`
- **DDL generation** — PostgreSQL and MySQL (tables, PK, FK, UNIQUE, indexes,
  comments, sequences, views)
- **DDL import** — turn a `.sql` file into a diagram
- **Image export** — SVG and PNG
- **Validation** — duplicate/empty names, missing PK, missing type reported in
  the Problems panel

## Usage

- Open any `.erm` file — it opens as a diagram
  (right-click → Open With → Text Editor for the raw XML)
- `ERD: New Diagram` — create a new file
- `ERD: Generate DDL` — DDL toolbar button or right-click a `.erm` in the explorer
- `ERD: Import DDL (.sql) as Diagram` — right-click a `.sql` file

## Development

```sh
npm install
npm run compile     # or npm run watch
npm run typecheck
npm test
```

Press `F5` to launch the Extension Host, then open `examples/shop.erm`.

Build and install locally:
`npx @vscode/vsce package && code --install-extension erm-vsc-0.0.1.vsix`

## Structure

- `src/erm/xml.ts` — XML parser + escaping matching ERMaster exactly
- `src/erm/model.ts` — diagram model (raw values + object references)
- `src/erm/load.ts` — XML → model (mirror of `XMLLoader.java`)
- `src/erm/write.ts` — model → XML (mirror of `PersistentXmlImpl.java`, byte-for-byte)
- `src/erm/ops.ts` — editing operations (ERMaster command semantics)
- `src/erm/validate.ts` — model validation
- `src/erm/importDdl.ts` — DDL → diagram import
- `src/ddl.ts` — DDL generation
- `src/erdEditorProvider.ts` — custom editor (webview ↔ document)
- `src/webview/` — the diagram editor (rendering, dialogs, tools)
- `FEATURES.md` — full list of ERMaster features and porting status
