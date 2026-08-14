# Sketch DXF acceptance workload

`all-geometry.input.dxf` is a deliberately small R12 ASCII fixture in
millimetres. A later human or external-CAD sanity check should show:

- one construction line from `(0, 0)` to `(20, 0)` mm;
- one circle centred at `(5, 10)` mm with radius `3` mm;
- one counter-clockwise quarter arc centred at `(15, 10)` mm with radius
  `5` mm, from 0° to 90°.

`all-geometry.expected.dxf` is the canonical output produced by Crawler. The
automated workload imports the static input, compares the exact normalized
output, imports that output again, and requires a byte-identical second export.
The `CRAWLER` XDATA values carry durable geometry IDs for comparison without
depending on entity ordering in another DXF viewer.
