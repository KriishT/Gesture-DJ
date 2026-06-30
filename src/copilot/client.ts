import type {
  CopilotResponse,
  TrackAnalysis,
  TransitionRecipe,
} from "./recipeTypes";
import { apiUrl } from "../config/apiBase";
import { buildLibrarySuggestions, compareSuggestionRank, recipeUsesStems } from "./transitionLibrary";
import { shuffleSuggestionBand } from "./variety";

const cache = new Map<string, CopilotResponse>();

function pairKey(a: TrackAnalysis, b: TrackAnalysis): string {
  return `${a.fileName}|${a.bpm}|${a.camelotKey}->${b.fileName}|${b.bpm}|${b.camelotKey}`;
}

function loadPersisted(key: string): CopilotResponse | null {
  try {
    const raw = localStorage.getItem("gdj.copilot." + key);
    return raw ? (JSON.parse(raw) as CopilotResponse) : null;
  } catch {
    return null;
  }
}

function persist(key: string, value: CopilotResponse): void {
  try {
    localStorage.setItem("gdj.copilot." + key, JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

/**
 * Ask the DJ Brain for transition suggestions. Caches per track-pair to
 * keep AI cost near zero on repeats, and falls back to a local heuristic
 * generator if the backend/key is unavailable.
 */
export async function requestSuggestions(
  a: TrackAnalysis,
  b: TrackAnalysis,
  opts: { force?: boolean; stemsA?: boolean; stemsB?: boolean } = {},
): Promise<{ response: CopilotResponse; source: "ai" | "cache" | "fallback" }> {
  // The library catalog (30+) is always available so the user has a big menu.
  const library = buildLibrarySuggestions(a, b, {
    stemsA: opts.stemsA,
    stemsB: opts.stemsB,
  });
  const key = pairKey(a, b);

  let aiPicks: CopilotResponse | null = null;
  let source: "ai" | "cache" | "fallback" = "fallback";

  if (!opts.force) {
    const mem = cache.get(key) ?? loadPersisted(key);
    if (mem) {
      cache.set(key, mem);
      aiPicks = mem;
      source = "cache";
    }
  }

  if (!aiPicks) {
    try {
      const res = await fetch(apiUrl("/api/copilot"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackA: a,
          trackB: b,
          stemsA: opts.stemsA,
          stemsB: opts.stemsB,
        }),
      });
      if (!res.ok) throw new Error(`copilot ${res.status}`);
      const data = (await res.json()) as CopilotResponse;
      if (!data.suggestions?.length) throw new Error("empty suggestions");
      aiPicks = normalize(data, a, b);
      cache.set(key, aiPicks);
      persist(key, aiPicks);
      source = "ai";
    } catch (e) {
      console.warn("Co-pilot AI unavailable; using local catalog:", e);
    }
  }

  // Smart AI picks first (tailored to the pair), then the catalog — deduped by name.
  const merged = aiPicks
    ? dedupeSuggestions([...aiPicks.suggestions, ...library.suggestions])
    : library.suggestions;

  const response: CopilotResponse = aiPicks
    ? {
        suggestions: merged,
        notes: [aiPicks.notes, library.notes].filter(Boolean).join(" "),
      }
    : library;

  return { response: shuffleSuggestionBand(response), source };
}

/** Keep highest-impact variant when AI and catalog suggest similarly named moves. */
function dedupeSuggestions(list: CopilotResponse["suggestions"]): CopilotResponse["suggestions"] {
  const seen = new Map<string, (typeof list)[number]>();
  for (const s of list) {
    const key = s.recipe.name.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
    const prev = seen.get(key);
    if (!prev || s.impact > prev.impact) seen.set(key, s);
  }
  return [...seen.values()].sort(compareSuggestionRank);
}

export { recipeUsesStems };

/** Clamp AI output into valid ranges so the engine can trust it. */
function normalize(
  data: CopilotResponse,
  a: TrackAnalysis,
  b: TrackAnalysis,
): CopilotResponse {
  const fix = (r: TransitionRecipe): TransitionRecipe => ({
    ...r,
    cueOutA: clamp(r.cueOutA, 0, a.durationSec - 1),
    cueInB: clamp(r.cueInB, 0, b.durationSec - 1),
    bars: clamp(r.bars || 16, 4, 64),
    steps: (r.steps ?? [])
      .map((s, i) => ({ ...s, index: i, atBar: clamp(s.atBar ?? i * 2, 0, 64) }))
      .sort((x, y) => x.atBar - y.atBar),
  });
  return {
    ...data,
    suggestions: data.suggestions
      .map((s) => ({ ...s, recipe: fix(s.recipe) }))
      .sort(compareSuggestionRank),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
