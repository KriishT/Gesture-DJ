import type { Deck, DeckId, StemPreset } from "../audio/Deck";
import type { RemixLayerKind } from "./types";

/** Equal-power center — both decks contribute; stem levels do the real balance. */
export const MASHUP_CROSSFADER = 0.5;

export function introCrossfader(bedDeck: DeckId): number {
  return bedDeck === "A" ? 0.03 : 0.97;
}

export function mashupCrossfader(_bedDeck: DeckId): number {
  return MASHUP_CROSSFADER;
}

/** Reset channel gains before remix so neither deck is accidentally dimmed. */
export function primeRemixDecks(bed: Deck, layer: Deck): void {
  bed.setVolume(1, false);
  layer.setVolume(1, false);
  bed.setEq({ low: 0, mid: 0, high: 0 });
  layer.setEq({ low: 0, mid: 0, high: 0 });
  bed.setFilter(0, false);
  layer.setFilter(0, false);
}

export function applyBedGroove(
  bed: Deck,
  layerKind: RemixLayerKind,
  stemsReady: boolean,
  durationSec: number,
): void {
  if (stemsReady) {
    const preset: StemPreset = layerKind === "acapella" ? "noVocals" : "instrumental";
    bed.rampStemPreset(preset, durationSec);
    bed.setStemLevel("drums", 1, true);
    bed.setStemLevel("bass", 1, true);
    bed.setStemLevel("other", 0.97, true);
    bed.setStemLevel("guitar", 0.94, true);
    bed.setStemLevel("piano", 0.94, true);
    bed.setStemLevel("vocals", 0, true);
  } else {
    bed.rampEqLow(0, durationSec * 0.5);
    bed.setEq({ low: 0, mid: -2, high: -5 });
    bed.rampFilter(0.35, durationSec);
  }
}

export function applyLayerStem(
  layer: Deck,
  layerKind: RemixLayerKind,
  durationSec: number,
): void {
  layer.rampStemPreset(layerKind as StemPreset, durationSec);
  switch (layerKind) {
    case "acapella":
      layer.setStemLevel("vocals", 0.9, true);
      break;
    case "drums":
      layer.setStemLevel("drums", 0.82, true);
      break;
    case "bass":
      layer.setStemLevel("bass", 0.78, true);
      break;
    case "guitar":
      layer.setStemLevel("guitar", 0.72, true);
      break;
    case "piano":
      layer.setStemLevel("piano", 0.72, true);
      break;
    default:
      break;
  }
}
