/**
 * Multi-part 3MF project export for Orca / Bambu Studio (filament colours per object).
 */
import { sanitizeMeshForStl, prepareMeshFor3mf, baseModelName } from "./stl.js?v=599";

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textEncoder() {
  return new TextEncoder();
}

function encodeText(str) {
  return textEncoder().encode(str);
}

/** Bambu/Orca per-triangle paint codes — slot 1 = "4", slot 2 = "8", slot 3 = "0C", … */
const PAINT_COLOR_CODES = [
  "4", "8", "0C", "1C", "2C", "3C", "4C", "5C",
  "6C", "7C", "8C", "9C", "AC", "BC", "CC", "DC",
];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeU32(view, offset, value) {
  view.setUint32(offset, value, true);
}

/** Minimal ZIP (store only, no compression) — avoids CDN dependency for 3MF packaging. */
function createZipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = encodeText(file.name);
    const data = file.data instanceof Uint8Array ? file.data : encodeText(String(file.data ?? ""));
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    writeU32(lv, 0, 0x04034b50);
    writeU16(lv, 4, 20);
    writeU16(lv, 6, 0);
    writeU16(lv, 8, 0);
    writeU16(lv, 10, 0);
    writeU16(lv, 12, 0);
    writeU32(lv, 14, crc);
    writeU32(lv, 18, data.length);
    writeU32(lv, 22, data.length);
    writeU16(lv, 26, name.length);
    writeU16(lv, 28, 0);
    local.set(name, 30);

    centralParts.push({ name, data, crc, offset });
    localParts.push(local, data);
    offset += local.length + data.length;
  }

  let centralSize = 0;
  for (const entry of centralParts) centralSize += 46 + entry.name.length;

  const out = new Uint8Array(offset + centralSize + 22);
  let pos = 0;
  for (const part of localParts) {
    out.set(part, pos);
    pos += part.length;
  }

  const centralStart = pos;
  for (const entry of centralParts) {
    const hdr = new Uint8Array(46 + entry.name.length);
    const cv = new DataView(hdr.buffer);
    writeU32(cv, 0, 0x02014b50);
    writeU16(cv, 4, 20);
    writeU16(cv, 6, 20);
    writeU16(cv, 8, 0);
    writeU16(cv, 10, 0);
    writeU16(cv, 12, 0);
    writeU16(cv, 14, 0);
    writeU32(cv, 16, entry.crc);
    writeU32(cv, 20, entry.data.length);
    writeU32(cv, 24, entry.data.length);
    writeU16(cv, 28, entry.name.length);
    writeU16(cv, 30, 0);
    writeU16(cv, 32, 0);
    writeU16(cv, 34, 0);
    writeU16(cv, 36, 0);
    writeU32(cv, 38, 0);
    writeU32(cv, 42, entry.offset);
    hdr.set(entry.name, 46);
    out.set(hdr, pos);
    pos += hdr.length;
  }

  const end = new DataView(out.buffer, pos, 22);
  writeU32(end, 0, 0x06054b50);
  writeU16(end, 4, 0);
  writeU16(end, 6, 0);
  writeU16(end, 8, centralParts.length);
  writeU16(end, 10, centralParts.length);
  writeU32(end, 12, centralSize);
  writeU32(end, 16, centralStart);
  writeU16(end, 20, 0);

  return out;
}

function paintCodeForExtruder(extruder) {
  return PAINT_COLOR_CODES[Math.max(0, Math.min(15, (extruder || 1) - 1))];
}

function meshTo3mfResources(mesh, objectId, name, extruder, { resanitize = false, plain = false, triangleExtruders = null } = {}) {
  const clean = resanitize ? sanitizeMeshForStl(mesh) : mesh;
  if (!clean?.positions?.length || !clean?.indices?.length) return null;

  const perTriPaint = triangleExtruders || clean.triangleExtruders;
  const defaultPaint = paintCodeForExtruder(extruder);
  const verts = [];
  for (let i = 0; i < clean.positions.length; i += 3) {
    verts.push(
      `<vertex x="${clean.positions[i].toFixed(5)}" y="${clean.positions[i + 1].toFixed(5)}" z="${clean.positions[i + 2].toFixed(5)}"/>`,
    );
  }

  const tris = [];
  for (let t = 0; t < clean.indices.length; t += 3) {
    const paint = perTriPaint?.length ? paintCodeForExtruder(perTriPaint[t / 3]) : defaultPaint;
    if (plain) {
      tris.push(
        `<triangle v1="${clean.indices[t]}" v2="${clean.indices[t + 1]}" v3="${clean.indices[t + 2]}"/>`,
      );
    } else {
      tris.push(
        `<triangle v1="${clean.indices[t]}" v2="${clean.indices[t + 1]}" v3="${clean.indices[t + 2]}" paint_color="${paint}"/>`,
      );
    }
  }

  const metaXml = plain
    ? `<metadata name="Name">${escapeXml(name)}</metadata>`
    : `<metadata name="Name">${escapeXml(name)}</metadata>
      <metadata name="slic3rpe:extruder">${extruder}</metadata>`;

  return {
    objectXml: `<object id="${objectId}" type="model">
      ${metaXml}
      <mesh>
        <vertices>${verts.join("")}</vertices>
        <triangles>${tris.join("")}</triangles>
      </mesh>
    </object>`,
    buildItem: `<item objectid="${objectId}"/>`,
    extruder,
    id: objectId,
    name,
  };
}

/** Bambu H2D printable bed (mm) — plate stride = width × 1.2 (PartPlate.cpp LOGICAL_PART_PLATE_GAP). */
const BAMBU_BED_WIDTH_MM = 350;
const BAMBU_BED_DEPTH_MM = 320;
const BAMBU_PLATE_GRID_GAP_RATIO = 0.2;
const BAMBU_PLATE_GRID_COLS = 2;

/** 1×1 PNG — Bambu plate tabs look for Metadata/plate_N.png alongside plate_N.json. */
const MINIMAL_PLATE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/** 3MF 4×3 transform (12 values, column-major) — Bambu/Orca reject !=12 and use identity. */
function formatTransform3x4(tx = 0, ty = 0, tz = 0) {
  return `1 0 0 0 1 0 0 0 1 ${tx} ${ty} ${tz}`;
}

function meshAxisAlignedBBox(mesh) {
  const positions = mesh?.positions;
  if (!positions?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function unionAxisAlignedBBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function translateAxisAlignedBBox(bbox, tx = 0, ty = 0) {
  if (!bbox) return null;
  return {
    minX: bbox.minX + tx,
    minY: bbox.minY + ty,
    maxX: bbox.maxX + tx,
    maxY: bbox.maxY + ty,
  };
}

/** Bambu GUI requires Metadata/plate_N.json per plate (Orca #13729 / BS loader). */
function buildBambuPlateJson({ identifyId, name, bbox, layerHeight = 0.2, nozzleDiameter = 0.4 }) {
  const { minX, minY, maxX, maxY } = bbox;
  const width = Math.max(0.001, maxX - minX);
  const depth = Math.max(0.001, maxY - minY);
  return JSON.stringify({
    version: 2,
    bbox_all: [minX, minY, maxX, maxY],
    bbox_objects: [{
      id: identifyId,
      name,
      bbox: [minX, minY, maxX, maxY],
      area: width * depth,
      layer_height: layerHeight,
    }],
    bed_type: "auto",
    filament_colors: [],
    filament_ids: [],
    first_extruder: 0,
    is_seq_print: false,
    nozzle_diameter: nozzleDiameter,
  });
}

/** Translate assembly bbox centre onto bed centre (plate-local, before grid offset).
 * H2C dual-nozzle overlap is 25–325 mm. Sitting in 0–25 forces left-nozzle-only. */
function centeringOffsetOnBed(bbox, bedWidth = BAMBU_BED_WIDTH_MM, bedDepth = BAMBU_BED_DEPTH_MM, dualNozzle = false) {
  if (!bbox) return { x: 0, y: 0, z: 0 };
  const originX = dualNozzle ? 25 : 0;
  const usableW = dualNozzle ? 300 : bedWidth;
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  return {
    x: originX + usableW / 2 - cx,
    y: bedDepth / 2 - cy,
    z: 0,
  };
}

/** World grid origin for plate N — Bambu reload_all_objects() uses bbox intersection with this. */
function plateGridOffset(plateId, bedWidth = BAMBU_BED_WIDTH_MM, bedDepth = BAMBU_BED_DEPTH_MM) {
  const index = Math.max(0, (plateId ?? 1) - 1);
  const col = index % BAMBU_PLATE_GRID_COLS;
  const row = Math.floor(index / BAMBU_PLATE_GRID_COLS);
  const strideX = bedWidth * (1 + BAMBU_PLATE_GRID_GAP_RATIO);
  const strideY = bedDepth * (1 + BAMBU_PLATE_GRID_GAP_RATIO);
  return { x: col * strideX, y: -row * strideY, z: 0 };
}

function plateStrideMm(bedWidth = BAMBU_BED_WIDTH_MM, bedDepth = BAMBU_BED_DEPTH_MM) {
  return {
    x: bedWidth * (1 + BAMBU_PLATE_GRID_GAP_RATIO),
    y: bedDepth * (1 + BAMBU_PLATE_GRID_GAP_RATIO),
  };
}

/** Build + assemble transforms: plate-local centre + multi-plate world grid offset. */
function worldTransformForPlate(centerOffset, plateId, bedWidth = BAMBU_BED_WIDTH_MM, bedDepth = BAMBU_BED_DEPTH_MM) {
  const grid = plateGridOffset(plateId, bedWidth, bedDepth);
  return formatTransform3x4(
    grid.x + (centerOffset?.x ?? 0),
    grid.y + (centerOffset?.y ?? 0),
    grid.z + (centerOffset?.z ?? 0),
  );
}

function buildItemXml(objectId, transform = null, { multiPlate = false } = {}) {
  // Placement lives on assemble_item only. Putting the same matrix on <item>
  // makes H2C drop the model at the origin (left-nozzle-only strip).
  return `<item objectid="${objectId}" printable="1" auto_drop="0"/>`;
}

function appendModelSettingsObject(lines, assemblyId, name, modelParts, singlePart) {
  lines.push(`  <object id="${assemblyId}">`);
  lines.push(`    <metadata key="name" value="${escapeXml(name)}"/>`);
  if (singlePart && modelParts.length === 1) {
    lines.push(`    <metadata key="extruder" value="${modelParts[0].extruder}"/>`);
  } else {
    for (const part of modelParts) {
      lines.push(`    <part id="${part.id}" subtype="normal_part">`);
      lines.push(`      <metadata key="name" value="${escapeXml(part.name)}"/>`);
      lines.push(`      <metadata key="extruder" value="${part.extruder}"/>`);
      lines.push("    </part>");
    }
  }
  lines.push("  </object>");
}

function appendModelSettingsPlate(lines, plateId, plateName, assemblyId, identifyId = 0, { filamentSlotCount = 1, filamentMaps = null } = {}) {
  lines.push("  <plate>");
  lines.push(`    <metadata key="plater_id" value="${plateId}"/>`);
  lines.push(`    <metadata key="plater_name" value="${escapeXml(plateName || "")}"/>`);
  lines.push('    <metadata key="locked" value="false"/>');
  if (filamentSlotCount > 1) {
    lines.push('    <metadata key="filament_map_mode" value="Manual"/>');
    lines.push(`    <metadata key="filament_maps" value="${filamentMaps || buildH2DFilamentMapsMeta(filamentSlotCount)}"/>`);
  } else {
    lines.push('    <metadata key="filament_map_mode" value="Auto For Flush"/>');
  }
  lines.push(`    <metadata key="thumbnail_file" value="Metadata/plate_${plateId}.png"/>`);
  lines.push(`    <metadata key="thumbnail_no_light_file" value="Metadata/plate_no_light_${plateId}.png"/>`);
  lines.push(`    <metadata key="top_file" value="Metadata/top_${plateId}.png"/>`);
  lines.push(`    <metadata key="pick_file" value="Metadata/pick_${plateId}.png"/>`);
  lines.push(`    <metadata key="pattern_bbox_file" value="Metadata/plate_${plateId}.json"/>`);
  lines.push("    <model_instance>");
  lines.push(`      <metadata key="object_id" value="${assemblyId}"/>`);
  lines.push('      <metadata key="instance_id" value="0"/>');
  lines.push(`      <metadata key="identify_id" value="${identifyId}"/>`);
  lines.push("    </model_instance>");
  lines.push("  </plate>");
}

function buildBambuSeparateObjectsModelSettingsXml(objects, worldTransform, filamentSlotCount = 1, allLeft = false) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<config>",
  ];
  for (const obj of objects) {
    lines.push(`  <object id="${obj.id}">`);
    lines.push(`    <metadata key="name" value="${escapeXml(obj.name)}"/>`);
    lines.push(`    <metadata key="extruder" value="${obj.extruder}"/>`);
    lines.push(`    <part id="1" subtype="normal_part">`);
    lines.push(`      <metadata key="name" value="${escapeXml(obj.name)}"/>`);
    lines.push(`      <metadata key="extruder" value="${obj.extruder}"/>`);
    lines.push("    </part>");
    lines.push("  </object>");
  }
  lines.push("  <plate>");
  lines.push('    <metadata key="plater_id" value="1"/>');
  lines.push('    <metadata key="plater_name" value=""/>');
  lines.push('    <metadata key="locked" value="false"/>');
  if (filamentSlotCount > 1) {
    lines.push('    <metadata key="filament_map_mode" value="Manual"/>');
    lines.push(`    <metadata key="filament_maps" value="${buildH2DFilamentMapsMeta(filamentSlotCount, allLeft)}"/>`);
  } else {
    lines.push('    <metadata key="filament_map_mode" value="Auto For Flush"/>');
  }
  lines.push('    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>');
  lines.push('    <metadata key="thumbnail_no_light_file" value="Metadata/plate_no_light_1.png"/>');
  lines.push('    <metadata key="top_file" value="Metadata/top_1.png"/>');
  lines.push('    <metadata key="pick_file" value="Metadata/pick_1.png"/>');
  lines.push('    <metadata key="pattern_bbox_file" value="Metadata/plate_1.json"/>');
  for (const obj of objects) {
    lines.push("    <model_instance>");
    lines.push(`      <metadata key="object_id" value="${obj.id}"/>`);
    lines.push('      <metadata key="instance_id" value="0"/>');
    lines.push(`      <metadata key="identify_id" value="${obj.id}"/>`);
    lines.push("    </model_instance>");
  }
  lines.push("  </plate>");
  if (worldTransform) {
    lines.push("  <assemble>");
    for (const obj of objects) {
      lines.push(
        `   <assemble_item object_id="${obj.id}" instance_id="0" transform="${worldTransform}" offset="0 0 0" />`,
      );
    }
    lines.push("  </assemble>");
  }
  lines.push("</config>");
  return lines.join("\n");
}

/**
 * Bambu Studio reads extruder assignment from this XML file (not JSON).
 * All meshes are PARTS of one assembled object so the slicer treats them as
 * a single model — parts mid-air (accent bands, floating text) are supported
 * by the body instead of erroring with "empty first layer".
 */
function buildBambuModelSettingsXml(assemblyId, name, parts, { singlePart = false, worldTransform = null, filamentSlotCount = 1, filamentMaps = null } = {}) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<config>",
  ];
  appendModelSettingsObject(lines, assemblyId, name, parts, singlePart);
  appendModelSettingsPlate(lines, 1, "", assemblyId, assemblyId, { filamentSlotCount, filamentMaps });
  if (worldTransform) {
    lines.push("  <assemble>");
    lines.push(
      `   <assemble_item object_id="${assemblyId}" instance_id="0" transform="${worldTransform}" offset="0 0 0" />`,
    );
    lines.push("  </assemble>");
  }
  lines.push("</config>");
  return lines.join("\n");
}

function buildBambuMultiPlateModelSettingsXml(assemblies) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<config>",
  ];
  for (const asm of assemblies) {
    appendModelSettingsObject(lines, asm.assemblyId, asm.name, asm.modelParts, asm.singlePart);
  }
  for (const asm of assemblies) {
    appendModelSettingsPlate(lines, asm.plateId, asm.plateName, asm.assemblyId, asm.identifyId ?? 0, {
      filamentSlotCount: asm.filamentSlotCount ?? 1,
    });
  }
  lines.push("  <assemble>");
  for (const asm of assemblies) {
    const transform = asm.worldTransform
      || worldTransformForPlate(asm.centerOffset || { x: 0, y: 0, z: 0 }, asm.plateId);
    lines.push(
      `   <assemble_item object_id="${asm.assemblyId}" instance_id="0" transform="${transform}" offset="0 0 0" />`,
    );
  }
  lines.push("  </assemble>");
  lines.push("</config>");
  return lines.join("\n");
}

export function partMaxExtruder(part) {
  if (part.extruderColors) {
    let max = 1;
    for (const key of Object.keys(part.extruderColors)) {
      max = Math.max(max, Number(key) || 1);
    }
    return max;
  }
  const paints = part.triangleExtruders || part.mesh?.triangleExtruders;
  if (paints?.length) {
    let max = 1;
    for (let i = 0; i < paints.length; i++) {
      if (paints[i] > max) max = paints[i];
    }
    return max;
  }
  return part.extruder || 1;
}

/** Shift filament slot indices when merging lid parts after body parts. */
export function offsetPartExtruders(parts, offset) {
  if (!offset) return parts;
  return parts.map((part) => {
    const next = {
      ...part,
      extruder: (part.extruder || 1) + offset,
    };
    if (part.extruderColors) {
      next.extruderColors = {};
      for (const [key, value] of Object.entries(part.extruderColors)) {
        next.extruderColors[Number(key) + offset] = value;
      }
    }
    const paints = part.triangleExtruders || part.mesh?.triangleExtruders;
    if (paints?.length) {
      const shifted = paints.map((slot) => slot + offset);
      if (part.triangleExtruders) next.triangleExtruders = shifted;
      if (part.mesh?.triangleExtruders) {
        next.mesh = { ...part.mesh, triangleExtruders: shifted };
      }
    }
    return next;
  });
}

function filterUsableParts(parts) {
  return (parts || []).filter((p) => p?.mesh?.positions?.length && p?.mesh?.indices?.length);
}

function buildFilamentSlots(usable, defaultPreset = "Generic PLA @BBL H2D") {
  const maxExtruder = Math.max(1, ...usable.map((p) => partMaxExtruder(p)));
  const slotColors = Array.from({ length: maxExtruder }, (_, i) => {
    const slot = i + 1;
    for (const part of usable) {
      if (part.extruderColors?.[slot]) return String(part.extruderColors[slot]).toUpperCase();
      if ((part.extruder || 1) === slot) return (part.color || "#ffffff").toUpperCase();
    }
    return "#FFFFFF";
  });
  // Per-slot Bambu preset (e.g. liner = "Bambu PLA Pure @BBL H2D") so Bambu Studio maps
  // the right AMS unit automatically (PLA Pure lives in the AMS HT, not AMS 1).
  const slotPreset = (slot) => {
    for (const part of usable) {
      if ((part.extruder || 1) === slot && part.filamentPreset) return String(part.filamentPreset).trim();
    }
    return defaultPreset;
  };
  // filament_id from BambuStudio system profiles: PLA Pure=GFA19, PLA Basic=GFA00, PLA Matte=GFA01.
  const presetFilamentId = (preset) => {
    if (/pla pure/i.test(preset)) return "GFA19";
    if (/pla basic/i.test(preset)) return "GFA00";
    if (/pla matte/i.test(preset)) return "GFA01";
    return "GFL99";
  };
  const presets = slotColors.map((_, i) => slotPreset(i + 1));
  return {
    maxExtruder,
    slotColors,
    filamentType: slotColors.map(() => "PLA"),
    filamentIds: presets.map(presetFilamentId),
    filamentSettingsId: presets,
    filamentVendor: presets.map((preset) => (/^bambu/i.test(preset) ? "Bambu Lab" : "Generic")),
    filamentDiameter: slotColors.map(() => "1.75"),
    filamentDensity: slotColors.map(() => "1.24"),
  };
}

/** H2D/H2C logical extruder 1 = left hotend (regular AMS). */
function buildH2DFilamentMap(slotCount, allLeft = false) {
  const n = Math.max(1, slotCount);
  if (allLeft || n <= 1) return Array.from({ length: n }, () => "1");
  // Body on left (AMS HT); extra colours on the right nozzle.
  return Array.from({ length: n }, (_, i) => (i === 0 ? "1" : "2"));
}

function buildH2DFilamentMapsMeta(slotCount, allLeft = false) {
  return buildH2DFilamentMap(slotCount, allLeft).join(" ");
}

function buildDifferentSettingsToSystem(filamentCount, printDiffKeys, printerDiffKeys) {
  const n = Math.max(3, (Number(filamentCount) || 1) + 2);
  const out = Array.from({ length: n }, () => "");
  out[0] = (printDiffKeys || []).filter(Boolean).join(";");
  out[1] = (printerDiffKeys || []).filter(Boolean).join(";");
  return out;
}

function buildAssemblyFromParts(usable, projectName, startObjectId, { plainSingle = false } = {}) {
  const objectXml = [];
  const modelParts = [];
  let objectId = startObjectId;
  let localBBox = null;
  for (const part of usable) {
    const built = meshTo3mfResources(part.mesh, objectId, part.name, part.extruder || 1, {
      resanitize: false,
      plain: plainSingle,
      triangleExtruders: part.triangleExtruders || part.mesh?.triangleExtruders,
    });
    if (!built) continue;
    objectXml.push(built.objectXml);
    modelParts.push({ id: built.id, name: built.name, extruder: built.extruder });
    localBBox = unionAxisAlignedBBox(localBBox, meshAxisAlignedBBox(part.mesh));
    objectId++;
  }
  if (!objectXml.length) return null;

  const triangleCount = usable.reduce(
    (sum, part) => sum + Math.floor((part.mesh.indices?.length || 0) / 3),
    0,
  );
  const singlePart = modelParts.length === 1;
  let buildObjectId;
  if (singlePart) {
    buildObjectId = modelParts[0].id;
  } else {
    const assemblyId = objectId;
    buildObjectId = assemblyId;
    const componentsXml = modelParts.map((p) => `<component objectid="${p.id}"/>`).join("");
    objectXml.push(`<object id="${assemblyId}" type="model">
      <metadata name="Name">${escapeXml(projectName)}</metadata>
      <components>${componentsXml}</components>
    </object>`);
    objectId++;
  }

  return {
    objectXml,
    modelParts,
    buildObjectId,
    singlePart,
    triangleCount,
    nextObjectId: objectId,
    localBBox,
  };
}

function packColoredProject3mf({
  projectName,
  objectXml,
  buildEntries,
  triangleCount,
  filament,
  modelSettings,
  plainSingle = false,
  extraZipFiles = [],
  multiPlate = false,
  printer = null,
}) {
  const buildItems = buildEntries.map((entry) => {
    if (typeof entry === "number") return buildItemXml(entry, null, { multiPlate });
    return buildItemXml(entry.objectId, entry.transform ?? null, { multiPlate });
  }).join("\n    ");
  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
  <metadata name="Application">BambuStudio-01.09.00.00</metadata>
  <metadata name="BambuStudio:3mfVersion">1</metadata>
  <metadata name="Title">${escapeXml(projectName)}</metadata>
  <metadata name="MakerDeck-Triangles">${triangleCount}</metadata>
  <resources>
    ${objectXml.join("\n    ")}
  </resources>
  <build>
    ${buildItems}
  </build>
</model>`;

  const multiColour = filament.maxExtruder > 1;
  const printerModel = printer?.printer_model || "Bambu Lab H2D";
  const printerSettingsId = printer?.printer_settings_id || "Bambu Lab H2D 0.4 nozzle";
  const printSettingsId = printer?.print_settings_id || "0.20mm Standard @BBL H2D";
  const layerHeight = printer?.layerHeight;
  const bedW = printer?.bedWidth ?? BAMBU_BED_WIDTH_MM;
  const bedD = printer?.bedDepth ?? BAMBU_BED_DEPTH_MM;
  const nozzleDia = String(printer?.nozzleDiameter ?? 0.4);
  const allLeft = !!printer?.singleNozzle;
  const amsHtLeft = !!printer?.amsHtLeft;
  const filamentMap = buildH2DFilamentMap(filament.maxExtruder, allLeft);
  const printDiff = ["filament_map", "filament_map_mode"];
  const printerDiff = [];
  if (Number.isFinite(layerHeight)) printDiff.push("layer_height", "initial_layer_print_height");
  if (multiColour) {
    printDiff.push(
      "flush_into_infill",
      "flush_into_objects",
      "enable_prime_tower",
      "enable_tower_interface_features",
      "flush_multiplier",
    );
  }
  if (amsHtLeft) printerDiff.push("extruder_ams_count", "extruder_printable_area");
  const projectSettings = JSON.stringify({
    from: "project",
    // Bambu uses this as the embedded process profile id — must NOT be the model filename.
    name: "project_settings",
    version: "01.09.00.00",
    printer_model: printerModel,
    printer_settings_id: printerSettingsId,
    print_settings_id: printSettingsId,
    nozzle_diameter: [nozzleDia, nozzleDia],
    extruder_type: ["Direct Drive", "Direct Drive"],
    printable_area: ["0x0", `${bedW}x0`, `${bedW}x${bedD}`, `0x${bedD}`],
    printable_height: "325",
    filament_type: filament.filamentType,
    filament_colour: filament.slotColors,
    filament_ids: filament.filamentIds,
    filament_settings_id: filament.filamentSettingsId,
    filament_vendor: filament.filamentVendor,
    filament_diameter: filament.filamentDiameter,
    filament_density: filament.filamentDensity,
    filament_map: filamentMap,
    filament_map_mode: "Manual",
    physical_extruder_map: ["1", "0"],
    // Left nozzle = AMS HT (type 4); right nozzle = regular AMS (type 1).
    ...(amsHtLeft ? {
      extruder_ams_count: ["1#0|4#1", "1#1|4#0"],
      extruder_printable_area: [
        `0x0,325x0,325x${bedD},0x${bedD}`,
        `25x0,330x0,330x${bedD},25x${bedD}`,
      ],
    } : {}),
    different_settings_to_system: buildDifferentSettingsToSystem(filament.maxExtruder, printDiff, printerDiff),
    ...(Number.isFinite(layerHeight) ? {
      layer_height: String(layerHeight),
      initial_layer_print_height: String(layerHeight),
    } : {}),
    // Dual-nozzle art (hoodie: white left / red+black right) needs a prime tower —
    // the right nozzle cannot purge into left-nozzle infill. All-left maps skip the tower.
    ...(multiColour ? {
      flush_into_infill: "1",
      flush_into_objects: "1",
      enable_prime_tower: allLeft ? "0" : "1",
      enable_tower_interface_features: allLeft ? "0" : "1",
      flush_multiplier: ["0.4", "0.4"],
    } : {}),
  });

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="config" ContentType="application/octet-stream"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="json" ContentType="application/json"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  const zipFiles = [
    { name: "mimetype", data: encodeText("application/vnd.ms-package.3dmanufacturing-3dmodel+xml") },
    { name: "[Content_Types].xml", data: encodeText(contentTypes) },
    { name: "_rels/.rels", data: encodeText(rels) },
    { name: "3D/3dmodel.model", data: encodeText(modelXml) },
  ];
  zipFiles.push(
    { name: "Metadata/project_settings.config", data: encodeText(projectSettings) },
    { name: "Metadata/model_settings.config", data: encodeText(modelSettings) },
  );
  if (extraZipFiles.length) zipFiles.push(...extraZipFiles);

  const zipped = createZipStore(zipFiles);
  return new Blob([zipped], { type: "model/3mf" });
}

/**
 * @param {Array<{plateId:number, plateName:string, name:string, parts:Array}>} plates
 */
export function buildMultiPlateColoredProject3mf(plates, projectName = "makerdeck") {
  const normalized = (plates || [])
    .map((plate) => ({ ...plate, parts: filterUsableParts(plate.parts) }))
    .filter((plate) => plate.parts.length);
  if (!normalized.length) throw new Error("No geometry to export");
  if (normalized.length === 1) {
    return buildColoredProject3mf(normalized[0].parts, normalized[0].name || projectName);
  }

  const allParts = normalized.flatMap((plate) => plate.parts);
  const filament = buildFilamentSlots(allParts);
  const assemblies = [];
  const objectXml = [];
  const buildEntries = [];
  const extraZipFiles = [];
  let objectId = 1;
  let triangleCount = 0;

  normalized.forEach((plate, index) => {
    const built = buildAssemblyFromParts(plate.parts, plate.name || projectName, objectId, { plainSingle: false });
    if (!built) return;
    objectXml.push(...built.objectXml);
    const plateId = plate.plateId ?? index + 1;
    const identifyId = built.buildObjectId;
    const centerOffset = centeringOffsetOnBed(built.localBBox);
    const worldTransform = worldTransformForPlate(centerOffset, plateId);
    // plate_N.json bbox is plate-local (centred on bed), not world grid coordinates
    const plateBBox = translateAxisAlignedBBox(
      built.localBBox || { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      centerOffset.x,
      centerOffset.y,
    );
    buildEntries.push({
      objectId: built.buildObjectId,
      transform: worldTransform,
    });
    triangleCount += built.triangleCount;
    objectId = built.nextObjectId;
    assemblies.push({
      assemblyId: built.buildObjectId,
      name: plate.name || projectName,
      modelParts: built.modelParts,
      singlePart: built.singlePart,
      plateId,
      plateName: plate.plateName || "",
      identifyId,
      plateBBox,
      centerOffset,
      worldTransform,
      filamentSlotCount: filament.maxExtruder,
    });
    extraZipFiles.push(
      {
        name: `Metadata/plate_${plateId}.json`,
        data: encodeText(buildBambuPlateJson({
          identifyId,
          name: plate.name || projectName,
          bbox: plateBBox,
        })),
      },
      { name: `Metadata/plate_${plateId}.png`, data: MINIMAL_PLATE_PNG },
      { name: `Metadata/plate_no_light_${plateId}.png`, data: MINIMAL_PLATE_PNG },
      { name: `Metadata/top_${plateId}.png`, data: MINIMAL_PLATE_PNG },
      { name: `Metadata/pick_${plateId}.png`, data: MINIMAL_PLATE_PNG },
    );
  });

  if (!assemblies.length) throw new Error("No valid mesh parts to export");

  const modelSettings = buildBambuMultiPlateModelSettingsXml(assemblies);
  return packColoredProject3mf({
    projectName,
    objectXml,
    buildEntries,
    triangleCount,
    filament,
    modelSettings,
    plainSingle: false,
    extraZipFiles,
    multiPlate: true,
  });
}

/**
 * @param {Array<{name:string, mesh:object, color:string, extruder:number}>} parts
 */
export function buildColoredProject3mf(parts, projectName = "makerdeck", options = {}) {
  const usable = filterUsableParts(parts);
  if (!usable.length) throw new Error("No geometry to export");

  const filament = buildFilamentSlots(usable, options.filamentPreset);
  const printer = options.printer || null;
  const separateObjects = !!options.separateObjects;

  if (separateObjects) {
    const objectXml = [];
    const modelObjects = [];
    let objectId = 1;
    let localBBox = null;
    let triangleCount = 0;
    for (const part of usable) {
      const built = meshTo3mfResources(part.mesh, objectId, part.name, part.extruder || 1, {
        resanitize: false,
        plain: false,
        triangleExtruders: part.triangleExtruders || part.mesh?.triangleExtruders,
      });
      if (!built) continue;
      objectXml.push(built.objectXml);
      modelObjects.push({ id: objectId, name: part.name, extruder: part.extruder || 1 });
      localBBox = unionAxisAlignedBBox(localBBox, meshAxisAlignedBBox(part.mesh));
      triangleCount += Math.floor((part.mesh.indices?.length || 0) / 3);
      objectId++;
    }
    if (!modelObjects.length) throw new Error("No valid mesh parts to export");
    const centerOffset = centeringOffsetOnBed(
      localBBox,
      printer?.bedWidth ?? BAMBU_BED_WIDTH_MM,
      printer?.bedDepth ?? BAMBU_BED_DEPTH_MM,
      !!printer?.amsHtLeft,
    );
    const worldTransform = formatTransform3x4(centerOffset.x, centerOffset.y, centerOffset.z ?? 0);
    const plateBBox = translateAxisAlignedBBox(
      localBBox || { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      centerOffset.x,
      centerOffset.y,
    );
    const modelSettings = buildBambuSeparateObjectsModelSettingsXml(
      modelObjects,
      worldTransform,
      filament.maxExtruder,
      !!printer?.singleNozzle,
    );
    const extraZipFiles = [
      {
        name: "Metadata/plate_1.json",
        data: encodeText(buildBambuPlateJson({
          identifyId: modelObjects[0].id,
          name: projectName,
          bbox: plateBBox,
          layerHeight: printer?.layerHeight ?? 0.2,
          nozzleDiameter: printer?.nozzleDiameter ?? 0.4,
        })),
      },
      { name: "Metadata/plate_1.png", data: MINIMAL_PLATE_PNG },
      { name: "Metadata/plate_no_light_1.png", data: MINIMAL_PLATE_PNG },
      { name: "Metadata/top_1.png", data: MINIMAL_PLATE_PNG },
      { name: "Metadata/pick_1.png", data: MINIMAL_PLATE_PNG },
    ];
    return packColoredProject3mf({
      projectName,
      objectXml,
      buildEntries: modelObjects.map((obj) => ({ objectId: obj.id, transform: worldTransform })),
      triangleCount,
      filament,
      modelSettings,
      plainSingle: false,
      extraZipFiles,
      multiPlate: true,
      printer,
    });
  }

  // Always embed Bambu Metadata — plainSingle skipped project_settings and Bambu used the filename as profile.
  const built = buildAssemblyFromParts(usable, projectName, 1, { plainSingle: false });
  if (!built) throw new Error("No valid mesh parts to export");

  const centerOffset = centeringOffsetOnBed(
    built.localBBox,
    printer?.bedWidth ?? BAMBU_BED_WIDTH_MM,
    printer?.bedDepth ?? BAMBU_BED_DEPTH_MM,
    !!printer?.amsHtLeft,
  );
  const worldTransform = formatTransform3x4(centerOffset.x, centerOffset.y, centerOffset.z ?? 0);
  const plateBBox = translateAxisAlignedBBox(
    built.localBBox || { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    centerOffset.x,
    centerOffset.y,
  );

  const modelSettings = buildBambuModelSettingsXml(
    built.buildObjectId,
    built.singlePart ? built.modelParts[0].name : projectName,
    built.modelParts,
    {
      singlePart: built.singlePart,
      worldTransform,
      filamentSlotCount: filament.maxExtruder,
      filamentMaps: buildH2DFilamentMapsMeta(filament.maxExtruder, !!printer?.singleNozzle),
    },
  );

  const extraZipFiles = [
    {
      name: "Metadata/plate_1.json",
      data: encodeText(buildBambuPlateJson({
        identifyId: built.buildObjectId,
        name: projectName,
        bbox: plateBBox,
        layerHeight: printer?.layerHeight ?? 0.2,
        nozzleDiameter: printer?.nozzleDiameter ?? 0.4,
      })),
    },
    { name: "Metadata/plate_1.png", data: MINIMAL_PLATE_PNG },
    { name: "Metadata/plate_no_light_1.png", data: MINIMAL_PLATE_PNG },
    { name: "Metadata/top_1.png", data: MINIMAL_PLATE_PNG },
    { name: "Metadata/pick_1.png", data: MINIMAL_PLATE_PNG },
  ];

  return packColoredProject3mf({
    projectName,
    objectXml: built.objectXml,
    buildEntries: [{ objectId: built.buildObjectId, transform: worldTransform }],
    triangleCount: built.triangleCount,
    filament,
    modelSettings,
    plainSingle: false,
    extraZipFiles,
    multiPlate: true,
    printer,
  });
}

export function filename3mfFor(meta, part = "body") {
  const base = `${baseModelName(meta)}.3mf`;
  if (part === "lid") return base.replace(/\.3mf$/, "-lid.3mf");
  if (part === "liner") return base.replace(/\.3mf$/, "-liner.3mf");
  if (part === "container") return base.replace(/\.3mf$/, "-container.3mf");
  if (part === "base") return base.replace(/\.3mf$/, "-base.3mf");
  if (part === "stack") return base.replace(/\.3mf$/, "-stack.3mf");
  return base;
}

/** Pack arbitrary files into a minimal store-only ZIP (browser-safe, no CDN). */
export function createZipArchiveBlob(files, { mimeType = "application/zip", rootFolder = "" } = {}) {
  const folder = String(rootFolder || "").replace(/^[/\\]+|[/\\]+$/g, "");
  const prefix = folder ? `${folder}/` : "";
  const entries = prefix
    ? files.map((file) => ({
      ...file,
      name: file.name.startsWith(prefix) ? file.name : `${prefix}${file.name.replace(/^[/\\]+/, "")}`,
    }))
    : files;
  const zipped = createZipStore(entries);
  return new Blob([zipped], { type: mimeType });
}

/** @internal verify / diagnostics */
export {
  BAMBU_BED_WIDTH_MM,
  BAMBU_BED_DEPTH_MM,
  BAMBU_PLATE_GRID_GAP_RATIO,
  plateGridOffset,
  plateStrideMm,
  worldTransformForPlate,
  centeringOffsetOnBed,
};
