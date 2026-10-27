import { plantedTotal, requireSite, listSites, survivalRate, survivalStats } from "./sites.js";
import { listThreats } from "./threats.js";
import type { Severity, SourceStatus, Store, ThreatEvent } from "./types.js";
import { severityRank } from "./types.js";

export interface ReportOptions {
  siteRef?: string;
  from?: string;
  to?: string;
  title?: string;
  now?: Date;
}

export interface SiteReportRow {
  siteId: string;
  name: string;
  areaHa: number | null;
  seedlings: number;
  survival: number | null;
  alive: number | null;
  checkDate: string | null;
  threats: number;
  worst: Severity | null;
}

export interface FunderReport {
  title: string;
  generatedAt: string;
  from: string | null;
  to: string | null;
  rows: SiteReportRow[];
  totals: {
    sites: number;
    areaHa: number;
    seedlings: number;
    alive: number;
    rate: number | null;
    threats: number;
  };
  recentThreats: ThreatEvent[];
  scanNotes: SourceStatus[];
}

function inPeriod(date: string, from: string | null, to: string | null): boolean {
  if (from !== null && date < from) return false;
  if (to !== null && date > to) return false;
  return true;
}

export function buildFunderReport(store: Store, options: ReportOptions = {}): FunderReport {
  const now = options.now ?? new Date();
  const from = options.from ?? null;
  const to = options.to ?? null;
  const sites = options.siteRef ? [requireSite(store, options.siteRef)] : listSites(store);
  const stats = survivalStats(store, options.siteRef);
  const statBySite = new Map(stats.map((row) => [row.siteId, row]));

  const rows: SiteReportRow[] = sites.map((site) => {
    const stat = statBySite.get(site.id);
    const siteThreats = store.threats
      .filter((event) => event.siteId === site.id)
      .filter((event) => inPeriod(event.date, from, to));
    const worst = siteThreats.reduce<Severity | null>((acc, event) => {
      if (acc === null) return event.severity;
      return severityRank(event.severity) > severityRank(acc) ? event.severity : acc;
    }, null);
    const checked = stat !== undefined && stat.checkDate !== null;
    return {
      siteId: site.id,
      name: site.name,
      areaHa: site.areaHa ?? null,
      seedlings: plantedTotal(store, site.id),
      survival: checked ? stat.rate : null,
      alive: checked ? stat.alive : null,
      checkDate: checked ? stat.checkDate : null,
      threats: siteThreats.length,
      worst,
    };
  });

  const checkedStats = stats.filter((row) => row.checkDate !== null);
  const checkPlanted = checkedStats.reduce((sum, row) => sum + row.planted, 0);
  const alive = checkedStats.reduce((sum, row) => sum + row.alive, 0);
  const areaHa = Math.round(rows.reduce((sum, row) => sum + (row.areaHa ?? 0), 0) * 100) / 100;

  const recentThreats = listThreats(store, options.siteRef ? { siteRef: options.siteRef } : {})
    .filter((event) => inPeriod(event.date, from, to))
    .slice(0, 8);

  const latestScan = store.scans[store.scans.length - 1];

  return {
    title: options.title ?? "restorkit funder report",
    generatedAt: now.toISOString(),
    from,
    to,
    rows,
    totals: {
      sites: rows.length,
      areaHa,
      seedlings: rows.reduce((sum, row) => sum + row.seedlings, 0),
      alive,
      rate: survivalRate(checkPlanted, alive),
      threats: rows.reduce((sum, row) => sum + row.threats, 0),
    },
    recentThreats,
    scanNotes: latestScan?.sources ?? [],
  };
}

export function formatPercent(rate: number | null): string {
  if (rate === null) return "n/a";
  return `${rate.toFixed(1)}%`;
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function renderMarkdown(report: FunderReport): string {
  const lines: string[] = [];
  lines.push(`# ${report.title}`);
  lines.push("");
  const period =
    report.from || report.to
      ? `Period ${report.from ?? "start"} to ${report.to ?? "today"}.`
      : "Period: all recorded data.";
  lines.push(`Generated ${formatDate(report.generatedAt)}. ${period}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Sites: ${report.totals.sites}`);
  lines.push(`- Area: ${report.totals.areaHa} ha`);
  lines.push(`- Seedlings logged: ${report.totals.seedlings}`);
  lines.push(
    `- Latest survival: ${formatPercent(report.totals.rate)} (${report.totals.alive} alive at the latest checks)`,
  );
  lines.push(`- Threat events: ${report.totals.threats}`);
  lines.push("");
  lines.push("## Sites");
  lines.push("");
  lines.push("| Site | Area (ha) | Seedlings | Survival | Last check | Threats |");
  lines.push("| --- | ---: | ---: | ---: | --- | ---: |");
  for (const row of report.rows) {
    lines.push(
      `| ${row.name} | ${row.areaHa ?? "-"} | ${row.seedlings} | ${formatPercent(row.survival)} | ${row.checkDate ?? "none"} | ${row.threats} |`,
    );
  }
  if (report.rows.length === 0) {
    lines.push("| No sites | - | - | - | - | - |");
  }
  lines.push("");
  lines.push("## Recent threats");
  lines.push("");
  if (report.recentThreats.length === 0) {
    lines.push("No threats were recorded in this period.");
  } else {
    for (const threat of report.recentThreats) {
      const site = report.rows.find((row) => row.siteId === threat.siteId)?.name ?? "a site";
      lines.push(`- ${threat.date} ${threat.severity} ${threat.kind} at ${site}: ${threat.summary}`);
    }
  }
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push("Survival uses the latest check at each site. It compares live seedlings with the count at that check.");
  lines.push("Threat distances are straight-line kilometres. A threat scan uses free public data.");
  lines.push("");
  lines.push("## Data sources");
  lines.push("");
  lines.push("- NASA FIRMS VIIRS active fire detections (24 hour global file).");
  lines.push("- Open-Meteo forecast for the fire-weather indicator.");
  lines.push("- Global Forest Watch tree-cover loss alerts, when an API key is set.");
  lines.push("");
  if (report.scanNotes.length > 0) {
    lines.push("Last scan sources:");
    lines.push("");
    for (const note of report.scanNotes) {
      lines.push(`- ${note.source}: ${note.state}${note.message ? ` - ${note.message}` : ""}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderHtml(report: FunderReport): string {
  const rows = report.rows
    .map(
      (row) => `<tr>
      <td>${escapeHtml(row.name)}</td>
      <td class="num">${row.areaHa ?? "-"}</td>
      <td class="num">${row.seedlings}</td>
      <td class="num">${formatPercent(row.survival)}</td>
      <td>${row.checkDate ?? "none"}</td>
      <td class="num">${row.threats}</td>
    </tr>`,
    )
    .join("\n");

  const threats =
    report.recentThreats.length === 0
      ? "<p>No threats were recorded in this period.</p>"
      : `<ul>${report.recentThreats
          .map((threat) => {
            const site = report.rows.find((row) => row.siteId === threat.siteId)?.name ?? "a site";
            return `<li><strong>${escapeHtml(threat.date)} ${escapeHtml(threat.severity)} ${escapeHtml(
              threat.kind,
            )}</strong> at ${escapeHtml(site)}. ${escapeHtml(threat.summary)}</li>`;
          })
          .join("")}</ul>`;

  const notes =
    report.scanNotes.length === 0
      ? ""
      : `<h2>Last scan sources</h2><ul>${report.scanNotes
          .map(
            (note) =>
              `<li>${escapeHtml(note.source)}: ${escapeHtml(note.state)}${
                note.message ? ` - ${escapeHtml(note.message)}` : ""
              }</li>`,
          )
          .join("")}</ul>`;

  const period =
    report.from || report.to
      ? `Period ${report.from ?? "start"} to ${report.to ?? "today"}.`
      : "Period: all recorded data.";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(report.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; font: 15px/1.5 Georgia, "Times New Roman", serif; color: #1c2620; background: #fbfaf6; }
  main { max-width: 880px; margin: 0 auto; }
  h1 { font-size: 30px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 19px; margin: 28px 0 8px; border-bottom: 1px solid #d9d4c7; padding-bottom: 4px; }
  .meta { color: #5d665f; margin: 0 0 20px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 18px 0 4px; }
  .card { border: 1px solid #d9d4c7; border-radius: 6px; padding: 10px 12px; background: #fff; }
  .card b { display: block; font: 600 22px/1.2 -apple-system, Segoe UI, Arial, sans-serif; }
  .card span { color: #5d665f; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 14px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #e4dfd2; }
  th { font: 600 13px/1.2 -apple-system, Segoe UI, Arial, sans-serif; color: #45504a; text-transform: uppercase; letter-spacing: 0.04em; }
  td.num, th.num { text-align: right; }
  ul { margin: 6px 0 0 18px; padding: 0; }
  li { margin: 4px 0; }
  footer { margin-top: 28px; color: #6a736d; font-size: 13px; }
  @media print {
    body { background: #fff; padding: 0; font-size: 12pt; }
    .card { break-inside: avoid; }
    h2 { break-after: avoid; }
  }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(report.title)}</h1>
  <p class="meta">Generated ${formatDate(report.generatedAt)}. ${escapeHtml(period)}</p>

  <div class="cards">
    <div class="card"><b>${report.totals.sites}</b><span>sites</span></div>
    <div class="card"><b>${report.totals.areaHa}</b><span>hectares</span></div>
    <div class="card"><b>${report.totals.seedlings}</b><span>seedlings logged</span></div>
    <div class="card"><b>${formatPercent(report.totals.rate)}</b><span>latest survival</span></div>
    <div class="card"><b>${report.totals.threats}</b><span>threat events</span></div>
  </div>

  <h2>Sites</h2>
  <table>
    <thead><tr><th>Site</th><th class="num">Area (ha)</th><th class="num">Seedlings</th><th class="num">Survival</th><th>Last check</th><th class="num">Threats</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <h2>Recent threats</h2>
  ${threats}

  <h2>Method</h2>
  <p>Survival uses the latest check at each site. It compares live seedlings with the count at that check. Threat distances are straight-line kilometres. A threat scan uses free public data.</p>

  <h2>Data sources</h2>
  <ul>
    <li>NASA FIRMS VIIRS active fire detections.</li>
    <li>Open-Meteo forecast for the fire-weather indicator.</li>
    <li>Global Forest Watch tree-cover loss alerts, when an API key is set.</li>
  </ul>
  ${notes}
  <footer>Report produced by restorkit.</footer>
</main>
</body>
</html>
`;
}