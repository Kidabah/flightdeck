/**
 * Multi-part 3MF project export for Orca / Bambu Studio (filament colours per object).
 */
import { sanitizeMeshForStl, prepareMeshFor3mf, baseModelName } from "./stl.js?v=201";

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

/** Bambu/Orca plate grid stride (bed width + gap) — plate 2 sits at +X. */
const BAMBU_PLATE_GRID_X_MM = 256 + 47;
const BAMBU_PLATE_GRID_Y_MM = 256 + 47;

/** 1×1 PNG — Bambu plate tabs look for Metadata/plate_N.png alongside plate_N.json. */
const MINIMAL_PLATE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function formatTransform3x4(tx = 0, ty = 0, tz = 0) {
  return `1 0 0 0 0 1 0 0 0 0 1 0 ${tx} ${ty} ${tz}`;
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

function plateGridOffset(plateId) {
  const index = Math.max(0, (plateId || 1) - 1);
  const col = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: col * BAMBU_PLATE_GRID_X_MM,
    y: -row * BAMBU_PLATE_GRID_Y_MM,
    z: 0,
  };
}

function buildItemXml(objectId, transform = null, { multiPlate = false } = {}) {
  if (multiPlate) {
    const matrix = transform || formatTransform3x4(0, 0, 0);
    return `<item objectid="${objectId}" transform="${matrix}" printable="1" auto_drop="1"/>`;
  }
  if (transform) {
    return `<item objectid="${objectId}" transform="${transform}" printable="1"/>`;
  }
  return `<item objectid="${objectId}"/>`;
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

function appendModelSettingsPlate(lines, plateId, plateName, assemblyId, identifyId = 0) {
  lines.push("  <plate>");
  lines.push(`    <metadata key="plater_id" value="${plateId}"/>`);
  lines.push(`    <metadata key="plater_name" value="${escapeXml(plateName || "")}"/>`);
  lines.push('    <metadata key="locked" value="false"/>');
  lines.push('    <metadata key="filament_map_mode" value="Auto For Flush"/>');
  lines.push(`    <metadata key="thumbnail_file" value="Metadata/plate_${plateId}.png"/>`);
  lines.push(`    <metadata key="thumbnail_no_light_file" value="Metadata/plate_no_light_${plateId}.png"/>`);
  lines.push(`    <metadata key="top_file" value="Metadata/top_${plateId}.png"/>`);
  lines.push(`    <metadata key="pick_file" value="Metadata/pick_${plateId}.png"/>`);
  lines.push("    <model_instance>");
  lines.push(`      <metadata key="object_id" value="${assemblyId}"/>`);
  lines.push('      <metadata key="instance_id" value="0"/>');
  lines.push(`      <metadata key="identify_id" value="${identifyId}"/>`);
  lines.push("    </model_instance>");
  lines.push("  </plate>");
}

/**
 * Bambu Studio reads extruder assignment from this XML file (not JSON).
 * All meshes are PARTS of one assembled object so the slicer treats them as
 * a single model — parts mid-air (accent bands, floating text) are supported
 * by the body instead of erroring with "empty first layer".
 */
function buildBambuModelSettingsXml(assemblyId, name, parts, { singlePart = false } = {}) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<config>",
  ];
  appendModelSettingsObject(lines, assemblyId, name, parts, singlePart);
  appendModelSettingsPlate(lines, 1, "", assemblyId, 0);
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
    appendModelSettingsPlate(lines, asm.plateId, asm.plateName, asm.assemblyId, asm.identifyId ?? 0);
  }
  lines.push("  <assemble>");
  for (const asm of assemblies) {
    const offset = plateGridOffset(asm.plateId);
    const transform = formatTransform3x4(offset.x, offset.y, offset.z);
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

function buildFilamentSlots(usable) {
  const maxExtruder = Math.max(1, ...usable.map((p) => partMaxExtruder(p)));
  const slotColors = Array.from({ length: maxExtruder }, (_, i) => {
    const slot = i + 1;
    for (const part of usable) {
      if (part.extruderColors?.[slot]) return String(part.extruderColors[slot]).toUpperCase();
      if ((part.extruder || 1) === slot) return (part.color || "#ffffff").toUpperCase();
    }
    return "#FFFFFF";
  });
  return {
    maxExtruder,
    slotColors,
    filamentType: slotColors.map(() => "PLA"),
    filamentIds: slotColors.map(() => "GFL99"),
    filamentVendor: slotColors.map(() => "Generic"),
    filamentDiameter: slotColors.map(() => "1.75"),
    filamentDensity: slotColors.map(() => "1.24"),
  };
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
}) {
  const buildItems = buildEntries.map((entry) => {
    if (typeof entry === "number") return buildItemXml(entry, null, { multiPlate });
    return buildItemXml(entry.objectId, entry.transform ?? null, { multiPlate });
  }).join("\n    ");
  const modelXml = plainSingle
    ? `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">MakerDeck</metadata>
  <metadata name="Title">${escapeXml(projectName)}</metadata>
  <metadata name="MakerDeck-Triangles">${triangleCount}</metadata>
  <resources>
    ${objectXml.join("\n    ")}
  </resources>
  <build>
    ${buildItems}
  </build>
</model>`
    : `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <metadata name="Application">MakerDeck</metadata>
  <metadata name="Title">${escapeXml(projectName)}</metadata>
  <metadata name="MakerDeck-Triangles">${triangleCount}</metadata>
  <resources>
    ${objectXml.join("\n    ")}
  </resources>
  <build>
    ${buildItems}
  </build>
</model>`;

  const projectSettings = JSON.stringify({
    from: "MakerDeck",
    name: projectName,
    version: "2.2.0",
    filament_type: filament.filamentType,
    filament_colour: filament.slotColors,
    filament_ids: filament.filamentIds,
    filament_vendor: filament.filamentVendor,
    filament_diameter: filament.filamentDiameter,
    filament_density: filament.filamentDensity,
  });

  const contentTypes = plainSingle
    ? `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`
    : `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="config" ContentType="application/octet-stream"/>
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
  if (!plainSingle) {
    zipFiles.push(
      { name: "Metadata/project_settings.config", data: encodeText(projectSettings) },
      { name: "Metadata/model_settings.config", data: encodeText(modelSettings) },
    );
  }
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
    const grid = plateGridOffset(plateId);
    const identifyId = built.buildObjectId;
    const plateBBox = translateAxisAlignedBBox(
      built.localBBox || { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      grid.x,
      grid.y,
    );
    buildEntries.push({
      objectId: built.buildObjectId,
      transform: formatTransform3x4(grid.x, grid.y, grid.z),
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
export function buildColoredProject3mf(parts, projectName = "makerdeck") {
  const usable = filterUsableParts(parts);
  if (!usable.length) throw new Error("No geometry to export");

  const filament = buildFilamentSlots(usable);
  const plainSingle = usable.length === 1
    && filament.maxExtruder === 1
    && !usable[0].triangleExtruders?.length;

  const built = buildAssemblyFromParts(usable, projectName, 1, { plainSingle });
  if (!built) throw new Error("No valid mesh parts to export");

  const modelSettings = buildBambuModelSettingsXml(
    built.buildObjectId,
    built.singlePart ? built.modelParts[0].name : projectName,
    built.modelParts,
    { singlePart: built.singlePart },
  );

  return packColoredProject3mf({
    projectName,
    objectXml: built.objectXml,
    buildEntries: [built.buildObjectId],
    triangleCount: built.triangleCount,
    filament,
    modelSettings,
    plainSingle,
  });
}

export function filename3mfFor(meta, part = "body") {
  const base = `${baseModelName(meta)}.3mf`;
  if (part === "lid") return base.replace(/\.3mf$/, "-lid.3mf");
  return base;
}
