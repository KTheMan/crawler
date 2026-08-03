# Manual alpha validation

This document records the manual evidence still required for the private-alpha
exit. Automated browser checks are useful evidence, but they do not substitute
for assistive-technology review, representative hardware measurements,
independent interchange validation, or external-user sessions.

## Evidence status

| Gate | Status | Evidence required |
| --- | --- | --- |
| Semantic names, keyboard focus, non-color operation states, reduced-motion CSS, onboarding persistence | Automated coverage present; full-suite requalification pending current M2/M3 implementation | `pnpm --dir web/crawler-app test`; focused: `pnpm --dir web/crawler-app exec playwright test tests/accessibility-m3.spec.ts` |
| Keyboard, visible focus, 200% zoom, and reduced-motion manual workflow | **Pending manual pass** | Complete the keyboard/visible-state and reduced-motion checklists below at the recorded display scale |
| Screen-reader reference workflow | **Pending manual session** | Named browser/timeline/inspector regions, announced operation and error states, readable parameter relationships, recovery choices |
| Representative-device performance | **Pending device run** | Device/browser/build identification plus reference-workflow frame, input, preview, recompute, load, memory, and long-task evidence |
| STEP export in an independent reader | **Pending external-reader run** | Reader name/version, imported artifact hash, body/shell counts, dimensions, visual evidence, failures or warnings |
| CAD-experienced and new-CAD-user usability sessions | **Pending external-user sessions** | Completed session records using the template below |
| Shell feature | Exact prismatic implementation qualified | Native/WASM stable-face and exact-thickness contracts plus browser durability/reload proof |

The M3 exit remains pending until the required external-user modeling and
recovery sessions complete without developer help. Do not infer that exit from
automated test results alone.

## Build and environment record

Complete this block before each manual pass.

- Date/time and timezone:
- Tester:
- Build or commit identifier:
- Portable document semantic hash:
- Browser and version:
- Operating system:
- Device model/class, CPU, memory, and GPU:
- Input devices:
- Display resolution and scaling:
- Network state (online/offline):
- Assistive technology and version, if applicable:

## Keyboard and visible-state checklist

Record **Pass**, **Fail**, or **Not run** and attach notes for every item.

- [ ] Command search opens from the keyboard, exposes enabled/disabled commands,
      and restores focus when dismissed.
- [ ] New, Open, Save, and Save As shortcuts do not fall through to browser
      defaults.
- [ ] Rectangle dimensions and extrusion distance can be focused, edited,
      committed with Enter, and cancelled with Escape.
- [ ] Named-parameter expressions retain unit-bearing source text; field errors
      retain the rejected input and do not mutate the accepted hash.
- [ ] Browser tree and feature timeline support arrow-key traversal with visible
      focus.
- [ ] Projection and standard-view commands are keyboard operable and do not
      change the semantic document.
- [ ] Operation state includes readable text for preview, committed, and
      cancelled states rather than relying on color.
- [ ] Selection, solver, storage, import, and recovery states remain visible
      without pointer hover.
- [ ] Body visibility exposes both text and a pressed state.
- [ ] A forced worker fault exposes recovery provenance and both recovery
      choices while preserving the accepted source.
- [ ] At 200% zoom, the reference workflow remains operable without obscured
      focused controls. Record any horizontal scrolling or clipped content.

## Screen-reader checklist — pending

Run the reference workflow with at least one supported desktop screen reader.

- [ ] Main workspace, feature browser, viewport, inspector, timeline, named
      parameters, dialogs, alerts, and status regions have useful names.
- [ ] Tree items expose their feature/body names and current status.
- [ ] Active operation and commit/cancel instructions are announced.
- [ ] Parameter name, expression source, evaluated value, and field diagnostic
      are understandable in reading and focus order.
- [ ] Validation errors are announced once and focus remains on the responsible
      field.
- [ ] Recovery state, provenance, and actions are understandable without visual
      context.
- [ ] Quick-tour steps are discoverable and do not trap focus.

Record the screen reader, verbosity settings, observed announcements, defects,
and any workaround. Leave this gate pending until an actual session is recorded.

## Reduced-motion checklist

- [ ] Enable the operating-system reduced-motion preference before launch.
- [ ] Confirm the application detects `prefers-reduced-motion: reduce`.
- [ ] Camera, timeline, dialog, and onboarding transitions do not animate in a
      way that conflicts with the preference.
- [ ] View and projection commands remain immediately operable.
- [ ] Record any unavoidable browser or GPU motion separately from application
      motion.

## Representative-device performance — pending

Run the reference workflow on the agreed mid-range device rather than a
developer workstation alone. Capture exported performance evidence and record:

The headless automated smoke gate permits an 18 ms frame-interval p50 to
accommodate virtual display cadence. It does not replace the product's 60 fps
representative-device requirement.

- Input feedback maximum:
- Preview latency maximum:
- Recompute p50 / p95 and sample count:
- Frame interval p50 / observed frame rate:
- Cold load time:
- Long-task maximum:
- Memory measurement support and observed value:
- Worker transfer bytes:
- Budget violations or recorded exception:

## Independent STEP reader — pending

1. Export the accepted reference part without further semantic edits.
2. Record the pre-export semantic hash and SHA-256 of the exported file.
3. Open the file in a reader that is independent of the writer/kernel path.
4. Record reader name/version, import warnings, units, overall dimensions,
   solid/shell/body count, and whether the body is reported closed/valid.
5. Capture standard-view screenshots and compare them with Crawler.
6. Record every discrepancy. Do not mark this gate complete from Crawler's own
   import path alone.

## Usability-session template — pending external users

### Session metadata

- Session ID:
- Date and duration:
- Facilitator / note taker:
- Participant CAD experience (none/new/experienced):
- Prior exposure to Crawler:
- Environment record link:
- Recording or notes location:

### Facilitation rules

- Start from the normal onboarding state and avoid explaining controls.
- Do not give developer help unless the participant is blocked; record the exact
  prompt, time, and resulting assistance.
- Ask the participant to think aloud without steering toward a control.
- Preserve the resulting document and recovery evidence under the session ID.

### Tasks and measures

| Task | Target | Start/end time | Completed without help? | Errors, assistance, and observations |
| --- | --- | --- | --- | --- |
| Identify the active operation and any missing input | Within 5 seconds | | | |
| Locate and edit an unfamiliar driving dimension | Within 30 seconds | | | |
| Create/edit the reference part through browser, inspector, and timeline | Complete model | | | |
| Undo and redo a dimensional or feature edit | Restore expected state | | | |
| Diagnose an intentionally broken reference | Identify first failed feature | | | |
| Repair the broken reference | Restore accepted geometry | | | |
| Save, reload, and recognize recovered provenance | Preserve accepted hash | | | |
| Recover after a forced worker fault | No developer help | | | |
| Skip, resume, and restart onboarding | All three found | | | |

### Post-session questions

- What did the participant think was currently active?
- Where did they expect dimensions to be edited?
- How did they distinguish the browser from the timeline?
- What did they believe Undo would change?
- Was the first failed feature and repair action understandable?
- Were recovery provenance and choices trusted and understood?
- Which state depended on color, hover, or prior CAD knowledge?
- What should change before another external session?

### Outcome

- Session result: Pass / Fail / Incomplete
- Developer assistance count and details:
- Blocking defects:
- Follow-up issue identifiers:
- Artifact and semantic-hash references:
- Reviewer and review date:

An internal rehearsal may refine this template, but it does not satisfy the
external-user M3 exit gate.
