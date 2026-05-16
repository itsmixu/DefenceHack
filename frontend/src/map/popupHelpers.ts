/**
 * Shared Leaflet popup HTML helpers.
 *
 * Every layer's `bindPopup` html should funnel through `buildPopup` so popups
 * feel like one product: identical typography, spacing, label/value rhythm,
 * and an optional one-line tactical takeaway.
 *
 * Anti-goals: this is not a templating engine. If a source needs something
 * truly bespoke (n2yo coverage cone, fmi_forecast wind barb), bypass this and
 * write raw HTML.
 */

export type PopupFact = {
  label: string;
  value: string | number | null | undefined;
  /** Optional muted suffix shown after the value (e.g. "(52%)"). */
  hint?: string;
  /** Optional override colour for the value (used for ratings, danger). */
  valueColor?: string;
};

export type PopupSpec = {
  /** Bold first line — usually the entity name or classification. */
  header: string;
  /** Optional pill rendered before the header (emoji, abbreviation, rating). */
  headerChip?: { text: string; color: string };
  /** Small muted second line under the header. */
  subheader?: string;
  /** 2-5 key facts. Falsy values are skipped automatically. */
  facts?: PopupFact[];
  /** One-line tactical implication ("⚔ Leopard 2 OK, Abrams marginal"). */
  tactical?: string;
  /** Width of the popup body. */
  minWidth?: number;
  /** Optional collapsed "show all data" section — facts revealed on click. */
  details?: {
    label?: string;          // defaults to "Show all data"
    facts: PopupFact[];      // empty facts are dropped
  };
};

const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPE[c]);

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === '' || v === '—' ||
  (typeof v === 'number' && Number.isNaN(v));

const renderFact = (f: PopupFact): string => {
  if (isEmpty(f.value)) return '';
  const valueStyle = f.valueColor ? `color:${f.valueColor};` : '';
  const hint = f.hint
    ? ` <span style="color:#94a3b8;font-weight:400">${escapeHtml(f.hint)}</span>`
    : '';
  return `<div style="display:flex;justify-content:space-between;gap:12px">
    <span style="color:#94a3b8">${escapeHtml(f.label)}</span>
    <strong style="${valueStyle}">${escapeHtml(f.value)}${hint}</strong>
  </div>`;
};

export function buildPopup(spec: PopupSpec): string {
  const width = spec.minWidth ?? 200;
  const chip = spec.headerChip
    ? `<span style="background:${spec.headerChip.color};color:#fff;padding:1px 6px;border-radius:3px;margin-right:6px;font-size:10px;letter-spacing:0.04em">${escapeHtml(spec.headerChip.text)}</span>`
    : '';

  const factsHtml = (spec.facts ?? [])
    .map(renderFact)
    .filter(Boolean)
    .join('');

  const factsBlock = factsHtml
    ? `<div style="margin-top:6px;display:flex;flex-direction:column;gap:2px">${factsHtml}</div>`
    : '';

  const sub = spec.subheader
    ? `<div style="color:#94a3b8;font-size:10px;margin-top:1px">${escapeHtml(spec.subheader)}</div>`
    : '';

  const tactical = spec.tactical
    ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.18);color:#e2e8f0;font-size:10px;line-height:1.4">⚔ ${escapeHtml(spec.tactical)}</div>`
    : '';

  let detailsBlock = '';
  if (spec.details && spec.details.facts.length) {
    const detailFactsHtml = spec.details.facts.map(renderFact).filter(Boolean).join('');
    if (detailFactsHtml) {
      const label = spec.details.label ?? 'Show all data';
      detailsBlock = `<details style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.18)">
        <summary style="cursor:pointer;color:#94a3b8;font-size:10px;letter-spacing:0.03em;user-select:none;list-style:none">▸ ${escapeHtml(label)}</summary>
        <div style="margin-top:4px;display:flex;flex-direction:column;gap:2px">${detailFactsHtml}</div>
      </details>`;
    }
  }

  return `<div style="font-size:11px;line-height:1.45;min-width:${width}px">
    <div style="font-weight:700">${chip}${escapeHtml(spec.header)}</div>
    ${sub}
    ${factsBlock}
    ${tactical}
    ${detailsBlock}
  </div>`;
}

/** Round to N decimals, return "—" for empty. */
export const fmtNum = (v: unknown, decimals = 0): string => {
  if (isEmpty(v)) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(decimals);
};

/** Format an integer with thousands separators. */
export const fmtInt = (v: unknown): string => {
  if (isEmpty(v)) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
};

/** Format a percentage given a fraction (0..1) or already-percent (0..100). */
export const fmtPct = (numerator: unknown, denominator: unknown): string => {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return '—';
  return `${Math.round((n / d) * 100)}%`;
};
