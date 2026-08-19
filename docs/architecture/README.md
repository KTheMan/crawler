# Architecture decision records

Crawler records settled architecture choices as architecture decision records
(ADRs). A superseding ADR must name the record it replaces; accepted records are
otherwise immutable apart from corrections and evidence updates.

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](adr/0001-monstertruck-kernel-baseline.md) | Superseded | Pin and qualify the Monstertruck kernel baseline |
| [0002](adr/0002-renderer-boundary.md) | Accepted | Select transferable provenance packets and Three.js/WebGL2 |
| [0003](adr/0003-parametric-document-contract.md) | Accepted | Define the versioned parametric document contract |
| [0004](adr/0004-portable-package-format.md) | Accepted | Define the portable package family and canonical manifest |
| [0005](adr/0005-operation-schema-and-errors.md) | Accepted | Share versioned operation schemas and structured errors |
| [0006](adr/0006-reference-fixtures-and-measurements.md) | Accepted | Define reproducible reference fixtures and measurement evidence |
| [0007](adr/0007-sketch-graph-and-ezpz-wasm-contract.md) | Accepted | Decompose the 2D constraint graph and solve it with EZPZ behind the Crawler WASM contract |
| [0008](adr/0008-monstertruck-git-dependencies.md) | Accepted | Consume the Monstertruck dev branch as locked Cargo Git dependencies |
