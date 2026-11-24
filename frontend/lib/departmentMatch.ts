/**
 * Department suggestions while typing (owner request 2026-11-24): "gynocologist" → Gynecology.
 *
 * How it works, in plain words:
 * 1. Both texts are cut down to a "stem": lower case, letters only, and a doctor-style ending removed
 *    ("cardiologist" → "cardiolog", "cardiology" → "cardiolog", "pediatrician" → "pediatric").
 * 2. A department matches when its name contains what was typed, or when the typed stem is "close enough"
 *    to the start of the department's stem: at most 1 wrong letter per 4 letters typed (edit distance).
 */

const ENDINGS = ["ologists", "ologist", "icians", "ician", "ists", "ist", "ics", "ic", "y", "s"];

function stem(text: string): string {
  let s = text.toLowerCase().replace(/[^a-z]/g, "");
  for (const end of ENDINGS) {
    if (s.length > end.length + 3 && s.endsWith(end)) {
      // "ologist" → keep "olog", so "cardiologist" and "cardiology" meet at "cardiolog".
      s = end.startsWith("olog") ? s.slice(0, -end.length) + "olog" : s.slice(0, -end.length);
      break;
    }
  }
  return s;
}

/** Edit distance: how many letters must be added, removed or changed to turn a into b. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/** How well `name` fits what was typed: lower is better; null = no match. */
function score(typed: string, name: string): number | null {
  const t = typed.trim().toLowerCase();
  if (!t) return null;
  const n = name.toLowerCase();
  if (n.startsWith(t)) return 0;
  if (n.includes(t)) return 1;
  const ts = stem(t);
  if (ts.length < 4) return null; // too short to guess spelling mistakes
  const ns = stem(name);
  const d = distance(ts, ns.slice(0, ts.length));
  return d <= Math.max(1, Math.floor(ts.length / 4)) ? 2 + d : null;
}

/** Up to `limit` departments that fit what was typed, best first. */
export function matchDepartments<T extends { name: string }>(typed: string, list: T[], limit = 6): T[] {
  return list
    .map((d) => ({ d, s: score(typed, d.name) }))
    .filter((x): x is { d: T; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.d.name.localeCompare(b.d.name))
    .slice(0, limit)
    .map((x) => x.d);
}
