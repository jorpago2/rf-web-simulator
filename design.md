# Design — RF Network Simulator

A locked design system for the RF workbench. Interface changes must preserve
the scientific canvas, simulation behavior, and project data model.

## Genre

Modern-minimal, technical and austere.

## Macrostructure family

- App pages: Workbench — one unified header, four-task rail, one mutually
  exclusive tool panel, dominant scientific canvas, contextual inspector, peer
  result tabs, and a compact status strip.
- Content pages: Long Document — IBM Plex typography and Carbon spacing.
- Marketing pages: not defined by this application.

## Theme

Carbon `g10` is the source of truth. Custom CSS consumes `--cds-*` tokens; it
does not introduce a parallel color system.

## Typography

- Display and body: IBM Plex Sans.
- Scientific values and identifiers: IBM Plex Mono.
- Numeric readouts use tabular figures.

## Spacing

Carbon spacing tokens and the existing 4-point project scale. Page geometry
uses Carbon Grid; the scientific workbench uses a task rail and explicit panel
widths from the supplied visual-architecture brief.

## Motion

- Carbon component motion is preserved.
- Custom motion is limited to immediate press/selection feedback.
- Reduced motion collapses transitions to effectively instant state changes.

## Microinteractions stance

- Silent save and simulation success; visible inline error states.
- `Escape` closes the active tool panel and restores focus to its trigger.
- Re-selecting an active workflow task closes its panel.

## Per-page allowances

- App pages must not use decorative enrichment; the scientific content carries
  the interface.
- React Flow, Plotly, RF symbols, scientific tables, and domain-specific drag
  targets remain custom when Carbon has no equivalent.

## What pages must share

- Carbon `g10`, IBM Plex, square Carbon surfaces, focus treatment, and spacing.
- Components, Canvas, Experiment, and Review as the stable workflow categories.
- Result-first responsive priority and a contextual-only right inspector.

## What pages may differ on

- Available result tabs and scientific controls required by a specific solver.
- Inspector fields required by the selected RF object.
