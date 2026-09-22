---
name: Gateway API Visualizer
description: A compact local workbench for Gateway API compatibility and relationship inspection.
colors:
  surface-canvas: 'oklch(0.97 0.006 210)'
  surface-panel: 'oklch(0.99 0.004 210)'
  surface-subtle: 'oklch(0.94 0.008 210)'
  border-structural: 'oklch(0.85 0.012 210)'
  border-control: 'oklch(0.6 0.02 210)'
  text-primary: 'oklch(0.25 0.015 210)'
  text-secondary: 'oklch(0.46 0.015 210)'
  instrument-cyan: 'oklch(0.45 0.085 210)'
  instrument-cyan-hover: 'oklch(0.39 0.08 210)'
  on-instrument-cyan: 'oklch(0.99 0.004 210)'
  status-success: 'oklch(0.4 0.1 155)'
  status-warning: 'oklch(0.43 0.1 75)'
  status-error: 'oklch(0.46 0.13 25)'
  status-info: 'oklch(0.43 0.075 245)'
  dark-surface-canvas: 'oklch(0.17 0.01 210)'
  dark-surface-panel: 'oklch(0.2 0.01 210)'
  dark-surface-subtle: 'oklch(0.24 0.01 210)'
  dark-border-structural: 'oklch(0.34 0.01 210)'
  dark-border-control: 'oklch(0.62 0.02 210)'
  dark-text-primary: 'oklch(0.93 0.008 210)'
  dark-text-secondary: 'oklch(0.74 0.012 210)'
  dark-instrument-cyan: 'oklch(0.78 0.1 210)'
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: '1.125rem'
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: '-0.01em'
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: '1rem'
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.5
  label-strong:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: '0.8125rem'
    fontWeight: 600
    lineHeight: 1.5
  button:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: '14px'
    fontWeight: 600
    lineHeight: 1.25
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.45
rounded:
  detail: '4px'
  control: '6px'
  pill: '999px'
spacing:
  compact: '4px'
  control: '8px'
  region: '16px'
  canvas: '24px'
components:
  button-primary:
    backgroundColor: '{colors.instrument-cyan}'
    textColor: '{colors.on-instrument-cyan}'
    typography: '{typography.button}'
    rounded: '{rounded.control}'
    padding: '0.4375rem 0.75rem'
    height: '36px'
  button-primary-hover:
    backgroundColor: '{colors.instrument-cyan-hover}'
    textColor: '{colors.on-instrument-cyan}'
    rounded: '{rounded.control}'
  button-outline:
    backgroundColor: 'transparent'
    textColor: '{colors.text-primary}'
    typography: '{typography.button}'
    rounded: '{rounded.control}'
    padding: '0.4375rem 0.75rem'
    height: '36px'
  field:
    backgroundColor: '{colors.surface-panel}'
    textColor: '{colors.text-primary}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    padding: '0.4375rem 0.625rem'
    height: '36px'
  panel:
    backgroundColor: '{colors.surface-panel}'
    textColor: '{colors.text-primary}'
    rounded: '{rounded.control}'
    padding: '1rem'
  status-chip:
    backgroundColor: 'transparent'
    textColor: '{colors.text-secondary}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    padding: '5px 8px'
---

# Design System: Gateway API Visualizer

## 1. Overview

**Creative North Star: "The Field Console"**

Gateway API Visualizer is a technical drafting table for platform engineers. It should feel purpose-built for comparing schemas, editing manifests, and tracing resource relationships: compact, tactile, and exact without becoming visually severe.

The interface uses cool, mist-tinted surfaces, structural one-pixel borders, and a restrained Instrument Cyan accent. Hierarchy comes from alignment, density, labels, and tonal layers. Decoration never competes with the manifest or topology.

**Key Characteristics:**

- Compact engineering-workbench density with 36px controls and 44px mobile targets.
- Flat, bordered regions that read as one coordinated workspace.
- Instrument Cyan reserved for action, focus, selection, and graph semantics.
- Light and dark themes derived from the same cool blue-green neutral axis.
- State communication that always pairs color with text or structure.

**The Working Surface Rule.** Every major region must help inspect, compare, edit, or navigate. If a surface has no operational role, remove it.

## 2. Colors

Instrument Cyan works over cool neutral layers like an annotation mark on a technical drawing. The palette is restrained: neutrals carry the interface, while semantic colors communicate state.

### Primary

- **Instrument Cyan** (`oklch(0.45 0.085 210)`): The sole interactive accent for primary actions, focus rings, current selection, links, and relationship-graph emphasis.
- **Deep Instrument Cyan** (`oklch(0.39 0.08 210)`): Hover treatment for primary actions in the light theme.
- **Panel Ink** (`oklch(0.25 0.015 210)`): Primary text on light surfaces.

### Secondary

- **Drafting Annotation** (`oklch(0.46 0.015 210)`): Secondary labels, captions, helper copy, and inactive metadata.

### Tertiary

- **Status Green** (`oklch(0.4 0.1 155)`): Successful compatibility and ready states.
- **Status Amber** (`oklch(0.43 0.1 75)`): Warnings and selected graph resources.
- **Status Red** (`oklch(0.46 0.13 25)`): Errors, incompatible fields, and missing-reference findings.
- **Status Blue** (`oklch(0.43 0.075 245)`): Informational state that is not an action.

### Neutral

- **Mist Canvas** (`oklch(0.97 0.006 210)`): Page and graph-canvas ground.
- **Paper Panel** (`oklch(0.99 0.004 210)`): Primary toolbar, editor, table, and detail surfaces.
- **Rule Gray** (`oklch(0.85 0.012 210)`): Structural borders and dividers.
- **Night Canvas** (`oklch(0.17 0.01 210)`): Dark-theme page ground.
- **Night Panel** (`oklch(0.2 0.01 210)`): Dark-theme raised tonal surface.
- **Night Rule** (`oklch(0.34 0.01 210)`): Dark-theme structural borders.
- **Control Rule** (`oklch(0.6 0.02 210)`): Input and outline-button boundaries, distinct from decorative panel borders. Dark mode uses `dark-border-control`. These boundaries maintain at least 3:1 against adjacent surfaces.

**The Instrument Mark Rule.** Instrument Cyan is functional, not decorative. Never use it as a large background wash or ornamental stripe.

**The Shared Axis Rule.** Light and dark themes stay on the same 210-degree blue-green hue axis so switching themes preserves identity and semantic hierarchy.

## 3. Typography

**Display Font:** System sans stack
**Body Font:** System sans stack
**Label/Mono Font:** Native monospace stack for build identifiers, YAML, and exact technical values

**Character:** Familiar platform typography keeps the tool fast and trustworthy. Weight and scale create hierarchy; the system never introduces a display typeface or ornamental lettering.

The root size follows the browser preference (100%, normally 16px); body copy is 0.875rem. Do not shrink the root to 14px, which would turn 0.75rem labels into 10.5px text. The editor's light-theme number token uses `#087448` to meet 4.5:1 against both its normal and current-line surfaces.

### Hierarchy

- **Headline** (600, 1.125rem, 1.5): Product title in the application header only.
- **Title** (600, 1rem, 1.5): Region names and audit headings.
- **Body** (400, 0.875rem, 1.5): Controls, findings, descriptions, and general interface text. Prose stays below 70ch where space allows.
- **Label** (400, 0.75rem, 1.5): Form labels, eyebrows, captions, and metadata.
- **Label strong** (600, 0.8125rem, 1.5): Table headers and resource-detail labels.
- **Mono** (400, 0.75rem, 1.45): Version/build identifiers, resource data, and source values that benefit from character alignment.
  **The Native Instrument Rule.** Use the system sans stack for all interface controls and data labels. Monospace is reserved for exact machine-readable values, never for decorative atmosphere.

## 4. Elevation

The system is flat by default. Depth comes from cool tonal layering and one-pixel borders. The shipped audit, editor, topology, summary, table, and details regions do not use elevation shadows, so the workbench reads as one coordinated surface.

**The Flat Workbench Rule.** Audit, manifest, topology, summary, table, and details regions are bordered, not floated. Elevation shadows are not part of the live workbench system.

## 5. Components

Components are tactile and compact: consistent 6px corners, one-pixel borders, explicit hover and focus states, and predictable dimensions.

### Buttons

- **Shape:** Compact rectangular controls with gently rounded corners (6px); icon-only controls are circular.
- **Primary:** Instrument Cyan fill, high-contrast panel text, 36px minimum height, and compact horizontal padding.
- **Hover / Focus:** Hover deepens the accent or adds a structural border; focus uses a 2px Instrument Cyan outline with 2px offset. Transitions last 160ms and change color or opacity only.
- **Secondary / Ghost / Tertiary:** Outline buttons use a transparent fill and structural border. Ghost buttons remain transparent until hover. Disabled controls retain shape and text but use 55% opacity.

### Chips

- **Style:** Fully rounded, compact labels with a one-pixel structural border and 5px by 8px padding.
- **State:** Status chips pair semantic color with explicit text. Neutral metadata chips remain secondary in contrast.

### Cards / Containers

- **Corner Style:** Consistent 6px corners; nested code detail may use 4px.
- **Background:** Paper Panel or Night Panel, selected according to theme.
- **Depth Strategy:** Flat by default; use tonal layering and structural borders rather than elevation.
- **Border:** One-pixel Rule Gray or Night Rule on structural regions.
- **Internal Padding:** 12px to 16px for toolbars and summaries; 24px only for centered empty states.

### Inputs / Fields

- **Style:** Panel background, one-pixel Control Rule border, 6px corners, 36px minimum height, and inherited system typography. At widths up to 640px, shared controls use 44px minimum height.
- **Focus:** A 2px Instrument Cyan outline with 2px offset. Hover strengthens the border to Drafting Annotation.
- **Error / Disabled:** Errors use Status Red plus textual explanation. Disabled fields use 55% opacity and a not-allowed cursor.

### Navigation

- The application uses a shallow top header rather than persistent navigation. Product title and build identity remain left-aligned; theme control stays right-aligned. Mobile layouts preserve both without introducing a menu.
- A keyboard-visible skip link transfers focus to the main workbench. The manifest editor lets Tab move focus by default; F1 exposes editor commands. Resource inspection transfers focus to its heading and restores the initiating control when closed.

### Audit Target

- The audit target is a first-class toolbar. It keeps the exact Gateway API release, channel, and load state visible. Version switching uses a standard select and preserves editor state.

### Work Regions

- Manifest and relationship regions share border, radius, header rhythm, and tonal treatment. At narrower widths they stack in task order. The relationship canvas retains at least 320px below its controls, and the editor retains at least 240px even with diagnostics expanded. Details become a third column only when the viewport can support it.

### Data Tables

- Tables use 13px text, structural row dividers, secondary headers, and a subtle neutral hover fill. Route cells use 0.625rem padding. Horizontal overflow stays inside labelled, keyboard-focusable table regions. Resource-name buttons provide inspection without turning table rows into nonstandard controls.

**The Familiar Control Rule.** Use native buttons, inputs, selects, summaries, and tables with consistent styling. Never invent a novel interaction where a standard control already communicates the behavior.

## 6. Do's and Don'ts

### Do:

- **Do** keep the audit target, exact release, channel, and current status visible.
- **Do** preserve the 6px control and region radius, 36px desktop controls, and 44px mobile targets.
- **Do** use one-pixel structural borders and tonal layers as the default depth cue.
- **Do** pair success, warning, error, and selection color with explicit text or shape.
- **Do** retain full keyboard operation, visible focus, reduced-motion behavior, and responsive stacking without page-level horizontal overflow.
- **Do** keep editor and topology central, with details and release support disclosed progressively.

### Don't:

- **Don't** use marketing layouts, hero metrics, decorative effects, glassmorphism, gradients, emoji headings, nested cards, or oversized introductions.
- **Don't** use color without semantic purpose or spread Instrument Cyan across inactive surfaces.
- **Don't** use a border-left or border-right greater than 1px as a colored accent on cards, list items, callouts, or alerts.
- **Don't** use gradient text, decorative blur, ornamental motion, or orchestrated page-load sequences.
- **Don't** present parent-reference coverage as successful attachment, CRD compatibility as Kubernetes admission, or catalogued features as controller support.
- **Don't** introduce display fonts, custom scrollbars, non-standard form controls, or inconsistent component vocabulary.
