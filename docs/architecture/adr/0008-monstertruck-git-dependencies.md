# ADR 0008: Monstertruck release dependencies

- Status: Accepted
- Date: 2026-08-04
- Supersedes: [ADR 0001](0001-monstertruck-kernel-baseline.md) for dependency distribution and promotion

## Context

The original integration tracked Monstertruck as a Git submodule and compiled
its crates through paths under `vendor/monstertruck`. That required a separate
repository checkout plus nested-resource initialization and allowed local
worktree state to affect the dependency graph.

The official upstream publishes its component crates to crates.io. The 0.4.0
release also splits fillet, healing, and I/O into explicit crates, so Crawler
should let Cargo resolve the released package graph rather than materializing a
workspace in the repository.

## Decision

Crawler declares each directly used Monstertruck package in
`[workspace.dependencies]` with:

```toml
monstertruck-modeling = "=0.4.0"
```

The renderer spike is a separate workspace and repeats the same exact release
for its GPU/render packages. There is no Monstertruck submodule or vendored
source.

Exact version requirements and `Cargo.lock` make `--locked` builds repeatable.
Qualification verifies the official registry source and common released
version before executing the existing native and WASM contracts.

## Consequences

- Fresh clones need no Monstertruck or resource submodule initialization.
- The lockfile, rather than a Gitlink, records the qualified release graph.
- Upstream crate boundaries are explicit in Crawler's dependency declarations.
- Advancing the Monstertruck release requires an intentional manifest and
  lockfile update plus the same contract review previously required for a
  submodule promotion.
