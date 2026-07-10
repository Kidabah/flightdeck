/**
 * Validates MakerDeck multi-plate 3MF exports contain Bambu-required plate metadata.
 * Run: node .ref/multi-plate-3mf-verify.mjs
 */
import { buildMultiPlateColoredProject3mf } from "../makerforge/js/3mf.js";

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

const zipFiles = listZipNames(buf);
const cfgStart = text.indexOf("<config>");
const cfg = cfgStart >= 0 ? text.slice(cfgStart, text.indexOf("</config>", cfgStart) + 9) : "";
const modelStart = text.indexOf("<model ");
const model = modelStart >= 0 ? text.slice(modelStart, text.indexOf("</model>", modelStart) + 8) : "";

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
check("assemble section present", cfg.includes("<assemble>"));
check("two assemble_item entries", (cfg.match(/assemble_item /g) || []).length === 2);
check("two build items", (model.match(/<item /g) || []).length === 2);
check("plate thumbnail_file metadata", cfg.includes('thumbnail_file" value="Metadata/plate_1.png"'));

const plate1JsonStart = text.indexOf('"bbox_all"');
check("plate json bbox_all", plate1JsonStart >= 0);

console.log(`zip entries: ${zipFiles.length}`);
console.log(failures ? `${failures} FAILURES` : "ALL OK — multi-plate Bambu metadata complete");
process.exit(failures ? 1 : 0);
