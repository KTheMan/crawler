import fs from "node:fs";
import init, {
  WasmPartRuntime,
} from "../web/crawler-app/src/generated/runtime/crawler_part_runtime.js";

const wasm = fs.readFileSync(
  new URL(
    "../web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm",
    import.meta.url,
  ),
);
await init({ module_or_path: wasm });

const runtime = WasmPartRuntime.newValidationRectangularPart(
  "document:wasm-frame-probe",
  "WASM Frame Probe",
  10_000_000n,
  10_000_000n,
  10_000_000n,
);

try {
  const snapshot = JSON.parse(runtime.bodySnapshotJson("body:part"));
  const solid = JSON.parse(
    new TextDecoder().decode(Uint8Array.from(snapshot.body.solid_json)),
  );
  const shell = solid.boundaries[0];
  const capIndex = shell.faces.findIndex((face) => {
    const plane = face.surface?.Plane;
    return plane?.o?.z === 10 && plane?.p?.z === 10 && plane?.q?.z === 10;
  });
  if (capIndex < 0) throw new Error("current B-rep has no translated planar cap");

  const currentFaceId = String(shell.face_stable_ids[capIndex]);
  const frame = JSON.parse(
    runtime.planarFaceFrameJson("body:part", currentFaceId),
  );
  const expectedOrigin = JSON.stringify([0, 0, 10_000_000]);
  const expectedNormal = JSON.stringify([0, 0, 1_000_000]);
  if (
    !frame.found ||
    frame.face_stable_id !== currentFaceId ||
    frame.analytic_surface !== "plane" ||
    frame.handedness !== "right" ||
    frame.scale_millionths !== 1_000_000 ||
    JSON.stringify(frame.frame.origin_nanometers) !== expectedOrigin ||
    JSON.stringify(frame.frame.normal_millionths) !== expectedNormal
  ) {
    throw new Error(`release-WASM authority probe failed: ${JSON.stringify(frame)}`);
  }

  console.log(
    JSON.stringify({
      probe: "release-wasm-planar-face-authority",
      found: frame.found,
      body_id: frame.body_id,
      face_stable_id: frame.face_stable_id,
      accepted_revision: frame.accepted_revision,
      origin_nanometers: frame.frame.origin_nanometers,
      normal_millionths: frame.frame.normal_millionths,
      handedness: frame.handedness,
    }),
  );
} finally {
  runtime.free();
}
