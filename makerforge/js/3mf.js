/**
 * Multi-part 3MF project export for Orca / Bambu Studio (filament colours per object).
 */
import { sanitizeMeshForStl } from "./stl.js?v=74";

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

function meshTo3mfResources(mesh, objectId, name, extruder) {
  const clean = sanitizeMeshForStl(mesh);
  if (!clean?.positions?.length || !clean?.indices?.length) return null;

  const paint = paintCodeForExtruder(extruder);
  const verts = [];
  for (let i = 0; i < clean.positions.length; i += 3) {
    verts.push(
      `<vertex x="${clean.positions[i].toFixed(5)}" y="${clean.positions[i + 1].toFixed(5)}" z="${clean.positions[i + 2].toFixed(5)}"/>`,
    );
  }

  const tris = [];
  for (let t = 0; t < clean.indices.length; t += 3) {
    tris.push(
      `<triangle v1="${clean.indices[t]}" v2="${clean.indices[t + 1]}" v3="${clean.indices[t + 2]}" paint_color="${paint}"/>`,
    );
  }

  return {
    objectXml: `<object id="${objectId}" type="model">
      <metadata name="Name">${escapeXml(name)}</metadata>
      <metadata name="slic3rpe:extruder">${extruder}</metadata>
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

/** Bambu Studio reads extruder assignment from this XML file (not JSON). */
function buildBambuModelSettingsXml(objects) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<config>",
  ];

  for (const obj of objects) {
    lines.push(`  <object id="${obj.id}">`);
    lines.push(`    <metadata key="name" value="${escapeXml(obj.name)}"/>`);
    lines.push(`    <metadata key="extruder" value="${obj.extruder}"/>`);
    lines.push("  </object>");
  }

  lines.push("  <plate>");
  lines.push('    <metadata key="plater_id" value="1"/>');
  lines.push('    <metadata key="plater_name" value=""/>');
  lines.push('    <metadata key="locked" value="false"/>');
  lines.push('    <metadata key="filament_map_mode" value="Auto For Flush"/>');

  objects.forEach((obj, i) => {
    lines.push("    <model_instance>");
    lines.push(`      <metadata key="object_id" value="${obj.id}"/>`);
    lines.push('      <metadata key="instance_id" value="0"/>');
    lines.push(`      <metadata key="identify_id" value="${i}"/>`);
    lines.push("    </model_instance>");
  });

  lines.push("  </plate>");
  lines.push("</config>");
  return lines.join("\n");
}

/**
 * @param {Array<{name:string, mesh:object, color:string, extruder:number}>} parts
 */
export function buildColoredProject3mf(parts, projectName = "makerdeck") {
  const usable = (parts || []).filter((p) => p?.mesh?.positions?.length && p?.mesh?.indices?.length);
  if (!usable.length) throw new Error("No geometry to export");

  const maxExtruder = Math.max(...usable.map((p) => p.extruder || 1));
  const slotColors = Array.from({ length: maxExtruder }, (_, i) => {
    const part = usable.find((p) => (p.extruder || 1) === i + 1);
    return (part?.color || "#ffffff").toUpperCase();
  });

  const filamentType = slotColors.map(() => "PLA");
  const filamentIds = slotColors.map(() => "GFL99");
  const filamentVendor = slotColors.map(() => "Generic");
  const filamentDiameter = slotColors.map(() => "1.75");
  const filamentDensity = slotColors.map(() => "1.24");

  const objectXml = [];
  const buildItems = [];
  const modelObjects = [];
  let objectId = 1;
  for (const part of usable) {
    const built = meshTo3mfResources(part.mesh, objectId, part.name, part.extruder || 1);
    if (!built) continue;
    objectXml.push(built.objectXml);
    buildItems.push(built.buildItem);
    modelObjects.push({ id: built.id, name: built.name, extruder: built.extruder });
    objectId++;
  }
  if (!objectXml.length) throw new Error("No valid mesh parts to export");

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <metadata name="Application">MakerDeck</metadata>
  <metadata name="Title">${escapeXml(projectName)}</metadata>
  <resources>
    ${objectXml.join("\n    ")}
  </resources>
  <build>
    ${buildItems.join("\n    ")}
  </build>
</model>`;

  const projectSettings = JSON.stringify({
    from: "MakerDeck",
    name: projectName,
    version: "2.2.0",
    filament_type: filamentType,
    filament_colour: slotColors,
    filament_ids: filamentIds,
    filament_vendor: filamentVendor,
    filament_diameter: filamentDiameter,
    filament_density: filamentDensity,
  });

  const modelSettings = buildBambuModelSettingsXml(modelObjects);

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="config" ContentType="application/octet-stream"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  const zipped = createZipStore([
    { name: "mimetype", data: encodeText("application/vnd.ms-package.3dmanufacturing-3dmodel+xml") },
    { name: "[Content_Types].xml", data: encodeText(contentTypes) },
    { name: "_rels/.rels", data: encodeText(rels) },
    { name: "3D/3dmodel.model", data: encodeText(modelXml) },
    { name: "Metadata/project_settings.config", data: encodeText(projectSettings) },
    { name: "Metadata/model_settings.config", data: encodeText(modelSettings) },
  ]);

  return new Blob([zipped], { type: "model/3mf" });
}

export function filename3mfFor(meta, part = "body") {
  const base = meta?.inner
    ? (() => {
        const { w, d, h } = meta.inner;
        if (meta.shape === "pencil") return `pencil-${w}x${d}x${h}mm.3mf`;
        if (meta.shape === "pencilBox") return `pencil-box-${w}x${d}x${h}mm.3mf`;
        if (meta.shape === "circle") return `circle-${w}x${h}mm.3mf`;
        if (meta.shape === "oval") return `oval-${w}x${d}x${h}mm.3mf`;
        if (meta.shape === "rounded") return `round-${w}x${d}x${h}mm.3mf`;
        return `box-${w}x${d}x${h}mm.3mf`;
      })()
    : "makerdeck.3mf";
  if (part === "lid") return base.replace(/\.3mf$/, "-lid.3mf");
  return base;
}
