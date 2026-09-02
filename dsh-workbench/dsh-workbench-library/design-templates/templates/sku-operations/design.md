---
version: 1.0
name: SKU-operations-workbench-layout
description: An adaptive operational-workbench design system. It fixes visual hierarchy, component behavior, data-safety rules, and responsive layout, while an evidence-bound model decides the dashboard storyline, page count, page purposes, and content modules from the available data and the user's question. It intentionally excludes business copy, values, and color tokens.
---

# SKU Operations Workbench — Design Contract

## 1. Product posture

- **Purpose:** one working surface that can monitor, diagnose, explore, plan, simulate, or coordinate, according to the question the data can actually answer.
- **Density:** compact and data-first; every section is scannable before users begin interacting.
- **Hierarchy:** context → model-selected key findings → evidence → exploration or decision action → data trust.
- **Shell:** a centered application canvas with a wide desktop maximum, generous side gutters, and a fixed floating assistant entry point.

## 2. Page anatomy

```text
Application canvas
├─ Header
│  ├─ Model-generated title + one-line decision question
│  ├─ Scope, freshness and trust metadata
│  └─ Navigation only when the model has created multiple pages
├─ Contextual filter strip
├─ Model-generated workspace (one or more pages)
│  └─ Ordered modules chosen from the component library
├─ Source/freshness footer
└─ Floating AI assistant
```

### Layout rules

- Desktop content uses a max-width canvas, centered with consistent horizontal padding.
- Header aligns title metadata to the start and navigation to the end; wrap to two rows when needed.
- The KPI strip is optional and uses a responsive 3–6 column grid. It appears only when the model has distinct, source-backed headline metrics.
- A primary page may begin with an asymmetric two-column layout when the selected story needs a main narrative chart and a supporting diagnostic. It must not be used as a default decoration.
- Tables, simulators, and process flows occupy full-width cards only when their input data and decision purpose are present.
- Use one outer card per analytic or operational task; do not nest visually identical cards excessively.

### Navigation and state

### Model-generated workspace navigation

- Create one page when a single coherent story answers the question. Create 2–5 pages only when the story has separate tasks that would otherwise overload one page.
- Page names are generated from the user question and evidence, not from a fixed list.
- Each page must have one explicit reader question and one primary decision or exploration task.
- Only one tab panel is visible at a time; selected tab has a strong selected state and all others remain quiet.
- Preserve filters, model-produced state and user edits while switching pages.
- Do not emit empty placeholder tabs. Suppress a page when its required evidence is unavailable.

## 3. Storyline planning contract

The model is responsible for semantics and narrative order; the design system is responsible for rendering the approved plan consistently.

### 3.1 Inputs the model must use

```text
User goal and intended decision
Dataset profile: grain, coverage, freshness, fields, quality risks
Verified metric definitions / semantic evidence when available
Current filters and access constraints
Available interaction capabilities: filter, drill-down, editable assumption, scenario calculation, task handoff
```

### 3.2 Required model output: `storylinePlan`

```text
storylinePlan:
  title: reader-facing title derived from the decision question
  primaryQuestion: what the dashboard should help decide or understand
  narrative: ordered evidence-backed findings, not generic headings
  pages:
    - id
      title
      readerQuestion
      purpose: overview | diagnostic | exploration | planning | monitoring | coordination
      modules:
        - componentType
          question
          metric / dimensions / filters
          evidenceSourceIds
          source-backed calculation or data binding
          interactionContract
      inclusionReason: why this page is necessary for the story
  omittedCapabilities:
    - capability and reason it cannot be supported by the available data
  assumptionsAndRisks:
    - explicit, reviewable assumptions
```

### 3.3 Evidence gate

- Every displayed metric, finding, risk label, recommendation and page title must trace to a source field, approved metric definition, or an explicitly labeled user assumption.
- The model may infer a candidate storyline, but it must not invent a KPI, threshold, target, owner, financial value, process stage, or causal explanation.
- If a conclusion is weak, show it as a hypothesis with its supporting evidence and a verification path; do not present it as fact.
- When data lacks a required capability, list it in `omittedCapabilities` instead of rendering an empty simulation, pipeline or action list.
- The build step consumes only a reviewed/confirmed `storylinePlan`; raw model prose cannot directly create executable calculations or writeback actions.

### 3.4 Module-selection rules

| Capability | Include only when | Do not include when |
|---|---|---|
| KPI strip | 3–6 distinct headline measures answer the primary question | metrics are redundant, undefined or lack a clear baseline |
| Trend | a valid time/period field and comparable metric exist | data is a single snapshot or periods are not comparable |
| Breakdown / ranking | a dimension can explain scale, change or risk | categories have no decision relevance |
| Detail matrix | users need to locate, compare or edit item-level entities | aggregated data cannot safely support row-level action |
| Scenario simulation | controllable inputs, formulae and constraints are explicitly provided or confirmed | price, capacity, target, lead-time or other required inputs are missing |
| Process pipeline | source fields represent ordered, measurable process stages | stage mapping is inferred only from names or has no evidence |
| Action list | an actionable condition, owner/routing rule and evidence are available | the dashboard can describe but cannot responsibly prescribe action |

The component library below describes how a selected module behaves. It does not require every module on every dashboard.

## 4. Reusable components

### Global metric strip

Each metric card contains:

```text
short label
primary tabular number
comparison / allocation / threshold note
optional thin progress or utilization bar
```

- Use tabular numerals for all operational values.
- Keep labels visually quieter than values.
- Progress bars show bounded utilization or completion only; do not use them as decorative charts.
- Status change must have both a semantic status label and a directional/value cue.

### Section card

- Header: title, optional compact badge, optional secondary description.
- Body: one primary visualization, table, workflow, or simulator.
- Card spacing: compact internal padding; consistent vertical separation between sibling cards.
- Empty state: explain what data/selection is missing and retain the section header.

### Toolbar and filters

- Use a single compact toolbar above an operational table.
- Controls can include categorical filters, a risk/status filter, free-text search, sorting, and named presets.
- Reserve flexible empty space between filters and secondary actions so the action cluster stays right aligned on wide screens.
- Every filter has a visible label; selected conditions update the table count and all dependent calculations.
- A reset control restores baseline assumptions and filters separately; label them unambiguously.

### Dense operational table

- Allow horizontal scrolling rather than collapsing critical columns.
- Sticky header remains visible while scanning a long table.
- First descriptive column is left aligned; measures are right aligned.
- Use tabular numerals, compact row height, subtle dividers, and a quiet hover state.
- A selected row has a persistent selected state distinct from hover.
- Include a compact metadata line below the primary item name when the row needs a second identifier.
- Editable cells are visibly input controls, not disguised text; constrain width and align their text with peer measures.
- Risk or health is represented as an icon/dot plus text, never color alone.

### Detail drawer

- Expand below the selected row/table rather than navigating away.
- Reveal a concise selected-item header, a compact historical comparison graphic, and a legend.
- The drawer opens from a row click but ignores clicks on inline input fields.
- Only one selected row is active at a time.

### Simulation cards (conditional)

- Render only for a confirmed planning/scenario page.
- Place 3 scenario summary cards in a single row on desktop when three distinct scenario outcomes exist; otherwise use the count required by the plan.
- Each card has label, calculated value, short method note, and optional bounded utilization bar.
- State variants are structural, not decorative: normal, attention, risk, and healthy.
- Simulation inputs live in the model-selected control module; the simulation page is a consequence view, not a duplicate form.

### Process pipeline (conditional)

- Represent a sequential workflow as equal-width stage nodes in reading order.
- Each node has: ordinal/step label, stage name, primary value, and concise status note.
- A stage needing intervention receives a distinct attention state.
- Keep pipeline node content to three text levels; deeper evidence belongs in a detail view.

### Floating assistant

- Floating action button stays fixed at the lower-right corner and opens a compact panel from the same anchor.
- Panel contains: header with controls, scrollable message history, horizontally scrolling quick prompts, and an expanding composer.
- The panel must fit inside viewport bounds and close without losing user-edited dashboard state.
- Assistant responses may expose mini key-value rows and action chips; dashboard changes require an explicit visible action/result.

## 5. Interaction model

```text
Filter / search / sort (when selected by the plan)
  → recompute all modules within the declared scope

Inline adjustment (only on a confirmed planning page)
  → recompute declared formulae and risk signal
  → refresh declared scenario outcomes

Row selection (when a detail matrix is selected)
  → mark one row selected
  → open/update the inline detail drawer

Preset (only when a reviewed scenario definition exists)
  → apply a named, inspectable assumption set
  → refresh declared scenario outputs

Page switch
  → reveal another model-planned task view without discarding state
```

### Calculation and state rules

- Keep immutable baseline data separate from in-session editable state.
- Recalculate derived metrics immediately after an input changes; avoid a separate “calculate” button for local calculations.
- Clearly distinguish baseline, recommended, user-edited, and simulated values.
- Do not write changes back to source data unless the page exposes an explicit governed save/approval action.
- Random or placeholder calculations are not permitted; repeated renders must be deterministic for the same source, confirmed plan and edits.
- Use a generated action only when the plan supplies a source-backed trigger, target object, evidence and allowed next step.

## 6. Visualization grammar

- **Trend:** grouped vertical bars over a fixed time axis; reserve one mark type per compared series and show a compact legend.
- **Execution status:** horizontal progress bars sorted in process/time order, with a direct percentage/value label.
- **Allocation / concentration:** compact horizontal comparison bars with a right-aligned exact value.
- **Distribution:** use stacked or grouped bars only when the composition meaning is clear from the legend.
- **Historical detail:** miniature paired-column chart within the detail drawer; one pair per period.
- Every chart has a title, unit/context note, legend when multiple series exist, and a no-data state.

## 7. Typography and spacing

### Type hierarchy

| Element | Size / weight guidance | Behavior |
|---|---:|---|
| Page title | 22px / 700 | compact, no oversized hero treatment |
| Section title | 15px / 600 | title and optional badge share one baseline |
| KPI value | 24px / 700 | tabular numerals; primary visual anchor |
| Simulation value | 22px / 700 | tabular numerals |
| Table body | 12–13px / regular | compact and scan-friendly |
| Label / caption | 10–12px / medium | restrained, optionally uppercase for system labels |
| Helper / description | 11–13px / regular | one or two lines maximum |

### Spacing and shape

- Application padding: compact on desktop, reduced on small screens.
- Section/card gap: approximately one standard spacing unit larger than internal card gap.
- Card padding: compact enough for dense information, with a clear header/body rhythm.
- Use a small radius family: control < standard card < floating panel.
- Reserve pill radii for badges, tags, and quick prompts only.
- Shadows are low-elevation separation cues; borders do most of the structural work.

## 8. Responsive behavior

- **Above 1100px:** five KPI columns; asymmetric two-column overview; three simulation cards; five-stage pipeline.
- **Below 1100px:** KPI strip becomes two columns; overview stacks; remaining wide modules keep their internal meaning and use horizontal scrolling where required.
- **Small screens:** title and tabs wrap; toolbars wrap in reading order; tables scroll horizontally; assistant panel uses viewport-constrained width and height.
- Never hide the current selection, editable inputs, risk text, freshness metadata, or reset action merely to fit a smaller screen.

## 9. Accessibility and quality requirements

- Tabs use `tablist` semantics, expose the selected state, and work by keyboard.
- All icon-only controls have accessible names.
- Do not convey risk, selection, or success with color alone.
- Inputs have labels, valid keyboard focus, and sensible step/min/max constraints.
- Sticky table headers retain readable contrast and do not obscure focused elements.
- Tooltips and hover states supplement rather than replace visible labels and values.
- Generated content must escape source values before inserting them into the DOM.
- All client-side computations should use source-backed, deterministic rules and disclose whether changes are preview-only or persisted.
