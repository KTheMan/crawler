# Sketch Workspace — Intentional Figma Deviations

- Status: implementation ledger
- Date: 2026-08-10
- Applies to: `web/crawler-app` Sketcher workspace
- Related UX contract: `sketch-workspace-ux-flow.md`

## Source-of-truth note

The repository does not contain the original Figma file, frame export, or a
Figma URL. The preserved executable Figma contract is therefore the derived
shell in `src/style.css` plus `tests/figma-parity.spec.ts` and `tests/theme.spec.ts`.
Those tests lock the 1280 × 720 shell geometry, chrome heights, inspector width,
theme surfaces, z-index behavior, and viewport anchoring. This change preserves
that contract and records every deliberate Sketcher-only departure below.

## Preserved without deviation

- 24 px application header, 32 px workbench tabs, and 76 px command ribbon.
- 260 px floating inspector at the Figma-derived desktop breakpoint.
- Browser, viewport, inspector, timeline, theme, typography, border, and icon
  families already established by the Figma-derived shell.
- Existing command groups, flyout/pinning behavior, canvas scale, view cube,
  and Finish Sketch visual treatment while a sketch session is active.

## Intentional deviations

| Surface | Original derived behavior | Intentional implementation | Why it should stay |
| --- | --- | --- | --- |
| Neutral cursor state | Sketcher had no explicit neutral command in its ribbon. | A pinned **Select** group and command now exposes the no-tool state. | Makes Escape results visible and aligns toolbar, cursor, inspector, and status state. |
| New-sketch support selection | Line appeared active while the user was still choosing a plane. | Creation activation is gated until support resolves; Browser datum planes and viewport planes complete the same picker. | Prevents drawing affordances before a valid sketch coordinate system exists. |
| Datum-plane visualization | Origin planes were centered sheets crossing one another directly at the axes. | XY, XZ, and YZ are bounded translucent construction sheets occupying only their positive local quadrants, with an inset from the axes, persistent colored frames, and stronger hover opacity. | Makes each plane read as a selectable construction object while keeping the origin and positive axis directions legible. |
| Construction | Construction appeared inside Draw like a creation tool. | The shortcut is in **Format** as **Normal / Construction**, while selected geometry exposes the same property in the inspector. | Construction is an entity linetype plus a future-creation mode, not a standalone geometry command. |
| Finish Sketch visibility | A parity test expected Finish when the Sketcher tab was opened without a sketch session. | Finish Sketch is hidden unless a sketch session is active. | Finish is a terminal workspace action and must not imply a nonexistent draft. |
| Selection filters | Six filters occupied a permanent floating strip. | A compact Select control expands the same filters on demand. | Preserves capability while returning canvas area to geometry. |
| Inspector density | Tool, selection, palette, evidence, and constraint manager were always expanded together. | Selection properties are contextual; Sketch Palette and Constraint Manager are collapsible. | Keeps task input visible without removing workspace-level controls. |
| Neutral selection inspector | Sketch plane and generic tool input occupied the top of the panel even after leaving a tool. | In Select, entity type, measurements, construction state, relations, and compatible constraints move directly beneath the selection prompt. | Makes the selected object the primary editing context, consistent with direct-manipulation CAD workflows. |
| Entity hit testing | The visible 2 px curve stroke was also the hit target. | An invisible 12 px semantic hit path sits behind each curve. | Improves precision without changing the Figma-derived visible line weight. |
| Preselection | Curves had no general neutral hover state. | Compatible geometry receives cyan preselection; incompatible geometry receives a dashed red state. | Makes the next click predictable and distinguishes invalid operands before activation. |
| Handles and DOF badges | All point handles and DOF badges could remain visible, including during dimension placement. | Handles appear for selected geometry or operand-collecting tools; DOF badges are selection-contextual in neutral mode. | Reduces collisions with dimension and inference feedback. |
| Routine endpoint diagnostics | Open-profile endpoint labels could stack on normal unconstrained geometry. | Routine open endpoints stay summarized in the inspector; canvas callouts are reserved for actionable crossings, overlaps, and orphaning. | Removes duplicate labels without hiding an error that requires direct canvas repair. |
| Unavailable commands | Native-disabled controls exposed reasons primarily through hover titles and could appear inert. | Focusable `aria-disabled` commands retain their reason; attempted invocation projects the reason into the inspector status. | Satisfies the no-silent-click contract and supports keyboard discovery. |
| Dimension ribbon | Smart Dimension and Distance were equally pinned. | Smart Dimension remains primary; the primitive command is renamed **Linear** and stays in the flyout. | Keeps a single obvious default while retaining explicit access. |
| Numeric presentation | Dimension fields could expose long floating-point values. | Visible values are normalized to at most three decimal places while expressions remain accepted. | Matches the displayed unit precision and reduces visual noise. |
| Overlapping geometry | Alt-click silently cycled candidates. | Alt-click opens a named **Select other** list. | Makes overlap resolution discoverable and deterministic. |

## Escape and completion contract

1. Escape cancels the current partial use or preview.
2. Escape exits a persistent tool into Select.
3. Escape in Select clears the current sketch selection.
4. Finish Sketch, not Escape, commits and exits the workspace.
5. Completing one use leaves repeatable tools ready for another use.

These are intentional interaction additions. They do not change the underlying
Figma-derived shell dimensions or general visual language.
