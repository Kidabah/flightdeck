/**
 * Multi-part 3MF project export for Orca / Bambu Studio (filament colours per object).
 */
import { zipSync, strToU8 } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js";
import { sanitizeMeshForStl } from "./stl.js";

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function meshTo3mfResources(mesh, objectId, name, extruder) {
  const clean = sanitizeMeshForStl(mesh);
  if (!clean?.positions?.length) return null;

  const verts = [];
  for (let i = 0; i < clean.positions.length; i += 3) {
    verts.push(
      `<vertex x="${clean.positions[i].toFixed(5)}" y="${clean.positions[i + 1].toFixed(5)}" z="${clean.positions[i + 2].toFixed(5)}"/>`,
    );
  }

  const tris = [];
  for (let t = 0; t < clean.indices.length; t += 3) {
    tris.push(
      `<triangle v1="${clean.indices[t]}" v2="${clean.indices[t + 1]}" v3="${clean.indices[t + 2]}"/>`,
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
  };
}

/**
 * @param {Array<{name:string, mesh:object, color:string, extruder:number}>} parts
 */
export function buildColoredProject3mf(parts, projectName = "makerdeck") {
  const usable = (parts || []).filter((p) => p?.mesh?.positions?.length);
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
  let objectId = 1;
  for (const part of usable) {
    const built = meshTo3mfResources(part.mesh, objectId, part.name, part.extruder || 1);
    if (!built) continue;
    objectXml.push(built.objectXml);
    buildItems.push(built.buildItem);
    objectId++;
  }
  if (!objectXml.length) throw new Error("No valid mesh parts to export");

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel">
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

  const modelSettings = JSON.stringify(
    usable.map((part, i) => ({
      id: i + 1,
      name: part.name,
      extruder: String(part.extruder || 1),
    })),
  );

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

  const zipped = zipSync({
    mimetype: strToU8("application/vnd.ms-package.3dmanufacturing-3dmodel+xml"),
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": strToU8(modelXml),
    "Metadata/project_settings.config": strToU8(projectSettings),
    "Metadata/model_settings.config": strToU8(modelSettings),
  });

  return new Blob([zipped], { type: "model/3mf" });
}

export function filename3mfFor(meta, part = "body") {
  const base = meta?.inner
    ? (() => {
        const { w, d, h } = meta.inner;
        if (meta.shape === "pencil") return `pencil-${w}x${d}x${h}mm.3mf`;
        if (meta.shape === "pencilBox") return `pencil-box-${w}x${d}x${h}mm.3mf`;
        if (meta.shape === "circle") return `circle-${w}x${h}mm.3mf`;
        if (meta.shape === "rounded") return `round-${w}x${d}x${h}mm.3mf`;
        return `box-${w}x${d}x${h}mm.3mf`;
      })()
    : "makerdeck.3mf";
  if (part === "lid") return base.replace(/\.3mf$/, "-lid.3mf");
  return base;
}
