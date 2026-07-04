/** Photoshop-style art draft — edit on canvas, Apply commits to mesh. */

function cloneTraceRects(rects) {
  if (!rects) return null;
  return {
    rects: rects.rects?.map((r) => ({ ...r })) || [],
    mask: rects.mask ? [...rects.mask] : [],
    shapeGroups: rects.shapeGroups?.map((g) => ({
      outer: g.outer.map(([x, y]) => [x, y]),
      holes: g.holes.map((h) => h.map(([x, y]) => [x, y])),
    })) || [],
    strokePaths: rects.strokePaths?.map((p) => p.map(([x, y]) => [x, y])) || [],
    strokeWidth: rects.strokeWidth,
    mode: rects.mode || "silhouette",
    width: rects.width,
    height: rects.height,
  };
}

let artDraft = null;
let artDraftDirty = false;

export function getArtDraft() {
  return artDraft;
}

export function isArtDraftDirty() {
  return artDraftDirty;
}

export function draftHasContent(draft = artDraft) {
  if (!draft) return false;
  const trace = draft.traceRects;
  return (
    !!draft.text?.trim() ||
    (draft.traceEnabled &&
      (trace?.shapeGroups?.length || trace?.strokePaths?.length || trace?.mask?.length)) ||
    (draft.svgEnabled && !!draft.svgText?.trim())
  );
}

export function snapshotAppliedArt(state) {
  return {
    text: state.embossText || "",
    font: state.embossFont || "inter",
    height: state.embossHeight ?? 7,
    face: state.embossFace || "front",
    offsetX: state.decorOffsetX ?? 0,
    offsetY: state.decorOffsetY ?? 0,
    rotation: state.decorRotation ?? 0,
    depth: state.embossDepth ?? 0.7,
    deboss: !!state.embossDeboss,
    traceEnabled: !!state.embossTraceEnabled,
    traceRects: cloneTraceRects(state.embossTraceRects),
    traceSize: state.embossTraceSize ?? 16,
    svgEnabled: !!state.embossSvgEnabled,
    svgText: state.embossSvgText || "",
  };
}

export function appliedHasArt(state) {
  const trace = state.embossTraceRects;
  return (
    state.embossTraceEnabled ||
    !!trace?.shapeGroups?.length ||
    !!trace?.strokePaths?.length ||
    !!state.embossText?.trim() ||
    (state.embossSvgEnabled && !!state.embossSvgText?.trim())
  );
}

export function ensureArtDraftFromState(state) {
  if (!artDraft) {
    artDraft = snapshotAppliedArt(state);
    artDraftDirty = false;
  }
  return artDraft;
}

export function resetArtDraft(state) {
  artDraft = snapshotAppliedArt(state);
  artDraftDirty = false;
}

export function clearArtDraft() {
  artDraft = null;
  artDraftDirty = false;
}

export function startBlankArtDraft(state) {
  artDraft = {
    text: "",
    font: state.embossFont || "inter",
    height: state.embossHeight ?? 7,
    face: state.embossFace || "front",
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    depth: state.embossDepth ?? 0.7,
    deboss: false,
    traceEnabled: false,
    traceRects: null,
    traceSize: state.embossTraceSize ?? 16,
    svgEnabled: false,
    svgText: "",
  };
  artDraftDirty = false;
}

export function patchArtDraft(patch) {
  if (!artDraft) return;
  Object.assign(artDraft, patch);
  artDraftDirty = true;
}

export function buildArtPreviewParams(state, baseParams) {
  if (!artDraft) return baseParams;
  return {
    ...baseParams,
    embossText: artDraft.text,
    embossFont: artDraft.font,
    embossHeight: artDraft.height,
    embossFace: artDraft.face,
    embossDepth: artDraft.depth,
    embossDeboss: artDraft.deboss,
    decorOffsetX: artDraft.offsetX,
    decorOffsetY: artDraft.offsetY,
    decorRotation: artDraft.rotation,
    embossTraceEnabled: artDraft.traceEnabled,
    embossTraceRects: artDraft.traceRects,
    embossTraceSize: artDraft.traceSize,
    embossSvgEnabled: artDraft.svgEnabled,
    embossSvgText: artDraft.svgText,
  };
}

export function applyDraftToState(state, draft = artDraft) {
  if (!draft) return;
  state.embossText = draft.text;
  state.embossFont = draft.font;
  state.embossHeight = draft.height;
  state.embossFace = draft.face;
  state.decorOffsetX = draft.offsetX;
  state.decorOffsetY = draft.offsetY;
  state.decorRotation = draft.rotation;
  state.embossDepth = draft.depth;
  state.embossDeboss = draft.deboss;
  state.embossTraceEnabled = draft.traceEnabled;
  state.embossTraceRects = cloneTraceRects(draft.traceRects);
  state.embossTraceSize = draft.traceSize;
  state.embossSvgEnabled = draft.svgEnabled;
  state.embossSvgText = draft.svgText;
}

export function commitArtDraft(state) {
  if (!draftHasContent()) return false;
  applyDraftToState(state, artDraft);
  artDraftDirty = false;
  return true;
}

export function cancelArtDraft(state) {
  if (appliedHasArt(state)) {
    resetArtDraft(state);
  } else {
    clearArtDraft();
  }
}

export function loadTraceIntoArtDraft(state, traceRects, { clearText = true } = {}) {
  ensureArtDraftFromState(state);
  if (clearText) artDraft.text = "";
  artDraft.traceEnabled = true;
  artDraft.traceRects = cloneTraceRects(traceRects);
  artDraft.traceSize = state.embossTraceSize ?? 16;
  artDraft.svgEnabled = false;
  artDraft.svgText = "";
  artDraftDirty = true;
}
