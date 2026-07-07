/** Multi-band accent helpers — up to two stacked colour ribbons. */

export const MAX_ACCENT_BANDS = 2;

export const DEFAULT_ACCENT_BAND = {
  id: "",
  pos: 50,
  height: 20,
  edge: "wave",
  waveAmp: 3,
  waveCount: 6,
  face: "rim",
  color: "#f97316",
};

export function newAccentBand(overrides = {}) {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : `b${Date.now().toString(36)}`;
  return { ...DEFAULT_ACCENT_BAND, id, ...overrides };
}

function legacyBandFromParams(params) {
  return newAccentBand({
    pos: params.accentPos ?? 100,
    height: params.accentHeight ?? 4,
    edge: params.accentEdge ?? "straight",
    waveAmp: params.accentWaveAmp ?? 3,
    waveCount: params.accentWaveCount ?? 6,
    face: params.accentFace ?? "rim",
    color: params.accentColor ?? "#f97316",
  });
}

/** Resolve accent bands from params — supports legacy flat accent fields. */
export function normalizeAccentBands(params) {
  if (!params?.accentEnabled) return [];
  if (Array.isArray(params.accentBands) && params.accentBands.length) {
    return params.accentBands.map((band, i) => ({
      ...newAccentBand(),
      ...band,
      id: band.id || `b${i}`,
    }));
  }
  return [legacyBandFromParams(params)];
}

/** Per-band build params for vase/box accent mesh builders. */
export function bandToBuildParams(baseParams, band) {
  return {
    ...baseParams,
    accentPos: band.pos ?? 100,
    accentHeight: band.height ?? 4,
    accentEdge: band.edge ?? "straight",
    accentWaveAmp: band.waveAmp ?? 3,
    accentWaveCount: band.waveCount ?? 6,
    accentFace: band.face ?? "rim",
  };
}

function normalizeBandFields(band, index = 0) {
  if (!band.id) band.id = `b${index}`;
  for (const [key, value] of Object.entries(DEFAULT_ACCENT_BAND)) {
    if (band[key] === undefined || band[key] === null) band[key] = value;
  }
  return band;
}

/** Migrate app state from legacy single-band fields to accentBands[]. */
export function ensureStateAccentBands(state) {
  if (Array.isArray(state.accentBands) && state.accentBands.length) {
    state.accentBands.forEach((band, i) => normalizeBandFields(band, i));
    syncFlatAccentFromBands(state);
    return;
  }
  if (state.accentEnabled) {
    state.accentBands = [legacyBandFromParams(state)];
  } else {
    state.accentBands = [newAccentBand()];
  }
  syncFlatAccentFromBands(state);
}

/** Keep legacy flat fields in sync with band 1 for session/library compat. */
export function syncFlatAccentFromBands(state) {
  const band = state.accentBands?.[0];
  if (!band) return;
  state.accentPos = band.pos;
  state.accentHeight = band.height;
  state.accentEdge = band.edge;
  state.accentWaveAmp = band.waveAmp;
  state.accentWaveCount = band.waveCount;
  state.accentFace = band.face;
  state.accentColor = band.color;
}
