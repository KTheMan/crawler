# ADR 0008: Monstertruck Git dependencies

- Status: Accepted
- Date: 2026-08-04
- Supersedes: [ADR 0001](0001-monstertruck-kernel-baseline.md) for dependency distribution and promotion

## Context

The original integration tracked Monstertruck as a Git submodule and compiled
its crates through paths under `vendor/monstertruck`. That required a separate
repository checkout plus nested-resource initialization and allowed local
worktree state to affect the dependency graph.

GitHub Packages does not provide a Cargo registry. The upstream `dev` line also
splits fillet, healing, and I/O into explicit crates, so Crawler should let
Cargo resolve the actual package graph rather than materializing a workspace in
the repository.

## Decision

Crawler declares each directly used Monstertruck package in
`[workspace.dependencies]` with:

```toml
git = "https://github.com/KTheMan/monstertruck.git"
branch = "dev"
```

The renderer spike is a separate workspace and repeats the same Git source for
its GPU/render packages. There is no Monstertruck submodule or vendored source.

`dev` is a branch, not a Git tag. `Cargo.lock` pins all resolved Monstertruck
packages to one immutable commit, making `--locked` builds repeatable while
allowing an intentional Cargo update to promote the branch head. Qualification
verifies the repository/ref source and common locked revision before executing
the existing native and WASM contracts.

## Consequences

- Fresh clones need no Monstertruck or resource submodule initialization.
- The lockfile, rather than a Gitlink, records the qualified source revision.
- Upstream crate boundaries are explicit in Crawler's dependency declarations.
- Advancing `dev` requires an intentional lockfile update and the same contract
  review previously required for a submodule promotion.
