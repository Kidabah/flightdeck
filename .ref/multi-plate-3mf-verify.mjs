/**
 * Validates MakerDeck multi-plate 3MF exports contain Bambu-required plate metadata.
 * Run: node .ref/multi-plate-3mf-verify.mjs
 */
import { writeFileSync } from "node:fs";
import { buildMultiPlateColoredProject3mf } from "../makerforge/js/3mf.js";

const BAMBU_PLATE_GRID_X_MM = 256 + 47;

const boxMesh = {
  positions: [0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 50],
  indices: [0, 1, 2, 0, 2, 3],
};
const lidMesh = {
  positions: [0, 0, 0, 80, 0, 0, 0, 80, 0, 0, 0, 10],
  indices: [0, 1, 2, 0, 2, 3],
};

const blob = buildMultiPlateColoredProject3mf(
  [
    { plateId: 1, plateName: "Container", name: "verify-box", parts: [{ name: "Body", mesh: boxMesh, color: "#38bdf8", extruder: 1 }] },
    { plateId: 2, plateName: "Lid", name: "verify-box lid", parts: [{ name: "Lid", mesh: lidMesh, color: "#ff0000", extruder: 2 }] },
  ],
  "verify-box",
);

const buf = Buffer.from(await blob.arrayBuffer());
writeFileSync(".ref/multi-plate-test.3mf", buf);
const text = buf.toString("latin1");

function listZipNames(buffer) {
  const names = [];
  let pos = 0;
  while (pos + 30 <= buffer.length) {
    if (buffer.readUInt32LE(pos) !== 0x04034b50) break;
    const nameLen = buffer.readUInt16LE(pos + 26);
    const extraLen = buffer.readUInt16LE(pos + 28);
    const compSize = buffer.readUInt32LE(pos + 18);
    names.push(buffer.slice(pos + 30, pos + 30 + nameLen).toString("utf8"));
    pos += 30 + nameLen + extraLen + compSize;
  }
  return names;
}

function readZipEntry(buffer, entryName) {
  let pos = 0;
  while (pos + 30 <= buffer.length) {
    if (buffer.readUInt32LE(pos) !== 0x04034b50) break;
    const nameLen = buffer.readUInt16LE(pos + 26);
    const extraLen = buffer.readUInt16LE(pos + 28);
    const compSize = buffer.readUInt32LE(pos + 18);
    const name = buffer.slice(pos + 30, pos + 30 + nameLen).toString("utf8");
    const dataStart = pos + 30 + nameLen + extraLen;
    if (name === entryName) return buffer.slice(dataStart, dataStart + compSize).toString("utf8");
    pos = dataStart + compSize;
  }
  return null;
}

function transformValues(transformAttr) {
  if (!transformAttr) return [];
  return transformAttr.trim().split(/\s+/).map(Number);
}

function plateObjectId(plateXml) {
  const inst = plateXml.match(/<model_instance>([\s\S]*?)<\/model_instance>/);
  if (!inst) return null;
  return inst[1].match(/object_id" value="(\d+)"/)?.[1] ?? null;
}

const zipFiles = listZipNames(buf);
const cfgStart = text.indexOf("<config>");
const cfg = cfgStart >= 0 ? text.slice(cfgStart, text.indexOf("</config>", cfgStart) + 9) : "";
const modelStart = text.indexOf("<model ");
const model = modelStart >= 0 ? text.slice(modelStart, text.indexOf("</model>", modelStart) + 8) : "";

const buildTransforms = [...model.matchAll(/<item[^>]*transform="([^"]+)"/g)].map((m) => m[1]);
const assembleTransforms = [...cfg.matchAll(/assemble_item[^>]*transform="([^"]+)"/g)].map((m) => m[1]);
const plateBlocks = [...cfg.matchAll(/<plate>([\s\S]*?)<\/plate>/g)].map((m) => m[1]);
const plate1ObjId = plateObjectId(plateBlocks[0] || "");
const plate2ObjId = plateObjectId(plateBlocks[1] || "");
const buildObjectIds = [...model.matchAll(/<item[^>]*objectid="(\d+)"/g)].map((m) => m[1]);

const plate1Json = JSON.parse(readZipEntry(buf, "Metadata/plate_1.json"));
const plate2Json = JSON.parse(readZipEntry(buf, "Metadata/plate_2.json"));

let failures = 0;
const check = (name, cond) => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}`);
};

check("Metadata/plate_1.json present", zipFiles.includes("Metadata/plate_1.json"));
check("Metadata/plate_2.json present", zipFiles.includes("Metadata/plate_2.json"));
check("Metadata/plate_1.png present", zipFiles.includes("Metadata/plate_1.png"));
check("Metadata/plate_2.png present", zipFiles.includes("Metadata/plate_2.png"));
check("two plater_id entries", (cfg.match(/plater_id" value="/g) || []).length === 2);
check("two model_instance blocks", (cfg.match(/<model_instance>/g) || []).length === 2);
check("pattern_bbox_file on both plates", (cfg.match(/pattern_bbox_file" value="Metadata\/plate_/g) || []).length === 2);
check("assemble section present", cfg.includes("<assemble>"));
check("two assemble_item entries", (cfg.match(/assemble_item /g) || []).length === 2);
check("two build items", (model.match(/<item /g) || []).length === 2);

check("build transforms are 12-value 3MF matrices", buildTransforms.every((t) => transformValues(t).length === 12));
check("assemble transforms are 12-value 3MF matrices", assembleTransforms.every((t) => transformValues(t).length === 12));

check("plate 1 model_instance references container assembly", plate1ObjId === buildObjectIds[0]);
check("plate 2 model_instance references lid assembly", plate2ObjId === buildObjectIds[1]);
check("plate 1 and 2 reference different assemblies", plate1ObjId && plate2ObjId && plate1ObjId !== plate2ObjId);
check("lid assembly not assigned to plate 1", plate1ObjId !== plate2ObjId);

const plate1Build = transformValues(buildTransforms[0]);
const plate2Build = transformValues(buildTransforms[1]);
check("plate 1 build X is plate-local (not grid +303)", Math.abs(plate1Build[9]) < BAMBU_PLATE_GRID_X_MM - 50);
check("plate 2 build X is plate-local (not grid +303)", Math.abs(plate2Build[9] - BAMBU_PLATE_GRID_X_MM) > 50);
check("plate 2 build X matches plate 1 (separate tabs, not side-by-side)", Math.abs(plate2Build[9] - plate1Build[9]) < 50);

const plate2Assemble = transformValues(assembleTransforms[1]);
check("plate 2 assemble X is plate-local (not grid +303)", Math.abs(plate2Assemble[9] - BAMBU_PLATE_GRID_X_MM) > 50);

check("plate_1.json bbox centred on bed", plate1Json.bbox_all[0] >= 70 && plate1Json.bbox_all[2] <= 190);
check("plate_2.json bbox centred on bed", plate2Json.bbox_all[0] >= 80 && plate2Json.bbox_all[2] <= 180);
check("plate_2.json bbox is plate-local (not +303 world)", plate2Json.bbox_all[0] < 200);

console.log("build transforms:", buildTransforms);
console.log("assemble transforms:", assembleTransforms);
console.log("plate object ids:", { plate1ObjId, plate2ObjId, buildObjectIds });
console.log("plate_1 bbox_all:", plate1Json.bbox_all);
console.log("plate_2 bbox_all:", plate2Json.bbox_all);
console.log(`zip entries: ${zipFiles.length}`);
console.log(failures ? `${failures} FAILURES` : "ALL OK — multi-plate Bambu metadata complete");
process.exit(failures ? 1 : 0);
