# restorkit — Build Plan

Spec first. Each cycle ends with a green test run and a commit.

## Cycle 1 — Foundation

- Write SPEC.md and PLAN.md.
- Scaffold TypeScript project. Zero runtime dependencies.
- Build `types.ts`, `store.ts`, `geo.ts`, `csv.ts`.
- Tests: atomic store round-trip, schema guard, haversine, bbox, radius filter, CSV quoting.

## Cycle 2 — Records

- Build `sites.ts`: site CRUD, plantings, survival checks, survival statistics.
- Validation: coordinates, counts, dates, duplicate names.
- Tests: validation matrix, cascade delete, weighted survival.

## Cycle 3 — Threats

- Build `firms.ts` (global 24 h CSV, cache, filter), `weather.ts` (Open-Meteo fire-weather index), `gfw.ts` (Data API with key, graceful skip).
- Build `threats.ts`: scan, severity mapping, dedupe, source status.
- Tests: fixture CSV parse, radius filter, severity mapping, dedupe, offline mode, source failure isolation.

## Cycle 4 — Reports and exports

- Build `report.ts` (Markdown and printable HTML).
- Build `export.ts` (GeoJSON, CSV).
- Tests: totals, survival formatting, HTML escaping, valid GeoJSON, stable CSV header.

## Cycle 5 — Map and CLI

- Build `mapview.ts`: one self-contained HTML file with an SVG map, legend, and table.
- Build `index.ts`: argument parser, all commands, exit codes, `--json`.
- Build `demo.ts` and `import.ts`.
- Tests: CLI parsing, demo dataset, import validation, map output size and content.

## Cycle 6 — Polish and dogfood

- README with logo, features, quick start, screenshots, data sources.
- Live run: FIRMS, Open-Meteo, report, map.
- Fix defects found in the live run.
- Final commit and push.

## Budget

Six cycles. Ten is the hard limit.