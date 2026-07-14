# ERMaster features (from source r128) — porting status

Source: `org.insightech.er` (SVN r128, SourceForge). Status: ✅ done, 🚧 partial, ⬜ not yet.

## Interface (ERMaster-style)

| Feature | Status | Notes |
|---|---|---|
| Left tool palette (Select/Table/Note/Relation) | ✅ | + hotkeys v/t/n/r, Esc |
| ERMaster-style tables | ✅ | colored header, PK section on top with separator, 🔑/◇(FK) markers, `*` for NOT NULL |
| Relations in IE notation | ✅ | crow's foot at child, bar/circle at parent; solid=identifying, dashed=not; bendpoints rendered |
| Relation (1:n) tool | ✅ | click parent→child, auto-creates FK columns from the PK (like ERMaster) |
| Display mode logical/physical/both | ✅ | toolbar; table and column names; tested |
| Edit dialogs on double-click | ✅ | table with tabs (Attributes/Columns/Indexes/Unique/Relations), note, view |
| Context menu (right-click) | ✅ | Edit, Add child table, Delete, New table/note here, Export |
| Move nodes, zoom/pan | ✅ | pointer capture |

## Diagram core

| Feature | Status | Notes |
|---|---|---|
| Tables (physical/logical names, description) | ✅ | dialog + tests |
| Columns: type, PK, NN, UQ, default, logical name, order (↑↓) | ✅ | grid in dialog + tests |
| Word dictionary | ✅ | full format support, rebuilt on save; tests |
| Relations 1:N (FK), ON DELETE/UPDATE, cardinalities, constraint name | ✅ | Relations tab + tool; tests |
| Indexes (including the `<inidex>` typo) | ✅ | Indexes tab: name, UNIQUE, columns; DDL; tests |
| Composite unique keys | ✅ | Unique Keys tab + DDL + tests |
| Notes | ✅ | tool, text, color, drawn behind tables; tests |
| Views | ✅ | name, SQL and columns editable (Columns grid in dialog); DDL; tests |
| Table colors | ✅ | color picker in dialog |
| Composite FK | ✅ | Relation tool copies the whole PK; tests |
| Categories (visual grouping) | ✅ | Groups button: name, color, member tables; canvas frame; tests |
| Column groups (`column_groups`) | ✅ | Groups tab in the table dialog: create, edit columns, attach to tables; tests |
| comment_connection (note↔table) | ✅ | Link palette tool; dashed chopbox-routed line; tests |
| Images on canvas (`image`) | ✅ | rendered (base64 data-URI); Image tool + file picker; hue/sat/brightness/opacity editable; tests |
| Bendpoint editing | ✅ | click a relation to select, drag handles, click segment to add, double-click to remove; tests |
| Bezier relations, IDEF1X notation | ✅ | toolbar Curve toggle + IE/IDEF1X selector; tests |

## Databases

| Feature | Status | Notes |
|---|---|---|
| Dialect selector (10 ERMaster DBs) | ✅ | toolbar dropdown, written to settings.database |
| DDL: PostgreSQL | ✅ | tables, PK, FK, UNIQUE, indexes, comments, sequences, views, triggers; tests |
| DDL: MySQL | ✅ | backticks, AUTO_INCREMENT, type mapping, inline COMMENT; tests |
| DDL: Oracle / SQL Server / SQLite | ✅ | type mapping, IDENTITY/sequences, bracket quoting; tests |
| DDL: other dialects (DB2/H2/Firebird…) | 🚧 | StandardSQL fallback (ANSI quoting) |
| Full per-DB type mapping (SqlType.xls) | 🚧 | curated list + parameterized types |
| Tablespaces | 🚧 | raw passthrough |

## Import / Export

| Feature | Status | Notes |
|---|---|---|
| DDL export | ✅ | DDL button / command / context menu |
| DDL file import | ✅ | `ERD: Import DDL` + right-click a .sql; CREATE TABLE, constraints, ALTER FK; tests |
| SVG export | ✅ | SVG button (light palette, auto-crop) |
| PNG export | ✅ | PNG button (2x) |
| Import from a live DB (JDBC) | ⬜ | candidate: node-postgres; next big step |
| Excel/HTML report export | ⬜ | low priority |
| Java/Hibernate generation | ⬜ | questionable value |
| Test data generation | 🚧 | full format support; no generation |

## Misc

| Feature | Status | Notes |
|---|---|---|
| Model validation | ✅ | duplicate/empty names, no PK, no type → VS Code Problems panel; tests |
| Change tracking | 🚧 | raw passthrough — history preserved |
| Environments | 🚧 | format only; no UI |
| Print/page settings, translations | 🚧 | raw passthrough |

## Tests

`npm test` — vitest: XML parser/escaping, round-trip (idempotency, FK resolution,
dictionary, raw sections), operations (names/types/relations/indexes/UNIQUE/notes),
DDL (PG + MySQL + dialect selection), validation, DDL import, categories, and
scene paint order.

## Next steps

1. Import a schema from a live PostgreSQL (node-postgres).
2. Composite FK and self-relations in the UI.
3. Bendpoint dragging and notation settings.
4. Column groups: management in the UI.
