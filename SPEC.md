# restorkit — Specification

## 1. Problem

Community groups plant trees and watch them for years. Records live in notebooks, spreadsheets, and chat threads. Two things then go wrong.

First, groups cannot prove results. Funders ask for survival rates and area planted. Staff rebuild these numbers by hand.

Second, groups learn about threats too late. A fire or a canopy-loss alert may touch a site for weeks before anyone notices.

## 2. Product

restorkit is a field kit for community forest-restoration groups. It runs on a laptop or a phone hotspot. It stores all records in one JSON file.

The tool answers four questions:

1. What did we plant, where, and when?
2. How many seedlings survived?
3. Is fire or canopy loss near our sites?
4. What do we report to funders?

restorkit uses free public data. It works offline from a cache. It needs no server and no account.

## 3. Users

- Volunteer coordinators with no GIS training.
- Landcare and "friends of the forest" groups.
- School and council restoration teams.
- Small NGOs that report to funders each season.

## 4. Core objects

| Object | Meaning |
| --- | --- |
| Site | A planting area. It has a name, latitude, longitude, area, and species mix. |
| Planting | A dated record of seedlings planted at a site. |
| Survival check | A dated count of live seedlings. Height and notes are optional. |
| Threat event | A fire detection, a canopy-loss alert, or a fire-weather risk day near a site. |
| Scan | One threat check across sites. It records source status. |

## 5. Commands and acceptance criteria

### 5.1 Setup

- `restorkit init` creates the data file and prints its path.
- The default data directory is `.restorkit` in the current directory.
- `--dir <path>` and `RESTORKIT_DIR` override the default.

Acceptance: a second `init` keeps existing data and reports "already initialised".

### 5.2 Sites

- `restorkit site add --name <name> --lat <lat> --lon <lon> [--area-ha <n>] [--species <a,b>] [--planted-on <date>] [--notes <text>]`
- `restorkit site list [--json]`
- `restorkit site show <id|name> [--json]`
- `restorkit site rm <id|name> [--force]`

Acceptance:

- Latitude must be between -90 and 90. Longitude must be between -180 and 180.
- A site name must not be empty.
- A duplicate name at the same location is rejected.
- `rm` removes the site and its plantings, checks, and threats. It asks for `--force` when records exist.

### 5.3 Plantings

- `restorkit plant log --site <id|name> --species <name> --count <n> [--date <date>] [--method <text>] [--notes <text>]`
- `restorkit plant list [--site <id|name>] [--json]`

Acceptance:

- Count must be a positive whole number.
- The date defaults to today. A future date is rejected.
- `plant list` shows site name, date, species, and count.

### 5.4 Survival checks

- `restorkit check log --site <id|name> --alive <n> [--planted <n>] [--date <date>] [--avg-height-cm <n>] [--notes <text>]`
- `restorkit check list [--site <id|name>] [--json]`
- `restorkit survival [--site <id|name>] [--json]`

Acceptance:

- Alive count must be zero or more.
- Alive count must not exceed planted count.
- The check date must not be before the earliest planting date at that site.
- `survival` reports the latest check per site, the survival rate, and a portfolio total.
- A survival rate is `alive / planted`, shown as a percentage with one decimal place.

### 5.5 Threat scan

- `restorkit threat scan [--site <id|name>|all] [--radius-km <n>] [--days <n>] [--offline] [--json]`
- `restorkit threat list [--site <id|name>] [--severity <level>] [--json]`

Sources:

1. NASA FIRMS VIIRS 24-hour global fire detections. No key is needed.
2. Open-Meteo daily forecast for a fire-weather index. No key is needed.
3. Global Forest Watch tree-cover loss alerts. It needs `GFW_API_KEY`. Without the key the source reports `skipped`.
4. A local alerts file, `--alerts-file <csv|geojson>`, for offline use.

Acceptance:

- A scan stores its source status. A failed source never aborts the scan.
- Fire detections within the radius become events. Distance is in kilometres, to one decimal place.
- Severity mapping: FIRMS confidence `h` gives `warning`, `n` gives `watch`, `l` gives `info`.
- Fire-weather index 70 or more gives `severe`, 50 or more `warning`, 30 or more `watch`. Lower values are not stored.
- A repeated event with the same site, kind, and date is stored once.
- `--offline` reads the cache and the alerts file only. It never opens a network connection.
- `threat list` sorts by date, newest first.

### 5.6 Reports and exports

- `restorkit report funder [--site <id|name>] [--from <date>] [--to <date>] [--out <file>] [--html]`
- `restorkit export geojson [--out <file>]`
- `restorkit export csv [--out <file>]`
- `restorkit map [--out <file>]`

Acceptance:

- The funder report contains: portfolio summary, per-site table, survival rates, planting totals, recent threats, and a data-sources note.
- Markdown goes to stdout by default. `--out` writes a file.
- HTML output is one self-contained file with inline CSS. It prints cleanly on A4.
- GeoJSON output is a valid `FeatureCollection`. Sites are points. Threats are points.
- CSV export has one row per site and a stable header.
- The map is one self-contained HTML file. It needs no network and no CDN.
- The map shows site markers, threat markers, a legend, and a site table.

### 5.7 Demo and import

- `restorkit demo [--dir <path>]` builds a sample dataset with three sites, plantings, checks, and threats.
- `restorkit import restor --file <csv|geojson> [--dry-run]` imports sites. Columns: name, lat, lon, area_ha, species.

Acceptance:

- `demo` works on a fresh directory and prints the next command to run.
- Import skips rows without a valid name or coordinates. It reports skipped rows.
- `--dry-run` prints what would change and writes nothing.

## 6. Non-goals

- No user accounts, no cloud sync, no server.
- No polygon drawing. Sites are points with an area value.
- No image upload in this version.
- No automatic posting to Restor or MERMAID.

## 7. Quality bars

- Zero runtime dependencies.
- Node 20 or newer.
- `node:test` for all tests. The suite must stay green.
- No network access in tests. All HTTP goes through an injectable fetch.
- Every command works offline, except live source fetches.
- Errors print one clear line and exit with code 1.

## 8. Data sources

| Source | Use | Key |
| --- | --- | --- |
| NASA FIRMS VIIRS C2 | Fire detections, 24 h, global | None |
| Open-Meteo Forecast API | Temperature, humidity, wind, rain | None |
| Global Forest Watch Data API | Tree-cover loss alerts | `GFW_API_KEY` |
| Restor export | Site import | None |

## 9. Success test

A coordinator can do this in under five minutes, offline after one scan:

1. Add three sites.
2. Log plantings and one survival check per site.
3. Run a threat scan.
4. Generate a funder report and a map.
5. Open the map file in a browser with no network.