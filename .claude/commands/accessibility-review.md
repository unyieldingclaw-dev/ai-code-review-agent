# /accessibility-review

Review changed UI files for WCAG 2.2 AA compliance. Called by `/change-review` Job 8 when UI files are present; also runnable standalone.

## Usage

```
/accessibility-review
/accessibility-review --diff path/to/change.diff
/accessibility-review --base <ref>
/accessibility-review --pr <number>
```

## Step 1: Determine the diff

Same logic as `/change-review` Step 1 — use the same flags if provided. If no diff, stop and tell the user.

## Step 2: Filter to UI files

From the diff, extract only files matching:
- `.html`, `.htm`
- `.jsx`, `.tsx`
- `.vue`, `.svelte`
- `.css`, `.scss`, `.sass`, `.less`
- `.js`/`.ts` when the change touches DOM manipulation, aria attributes, or role assignments

If no UI files are in the diff, report:
> No UI files in this diff. Accessibility review skipped.

## Step 3: Review for WCAG 2.2 AA

For each UI file change, check the following. Use the finding schema below.

### Interactive elements — labelling

- Every `<button>`, `<a>`, `<input>`, `<select>`, `<textarea>` has a visible label, `aria-label`, or `aria-labelledby`
- Icon-only buttons have `aria-label` or `title`
- Form inputs are associated with `<label>` via `for`/`id` or `aria-labelledby`

### Images and non-text content

- `<img>` elements have non-empty `alt` text (or `alt=""` when decorative)
- SVG icons used interactively have `aria-label` or `<title>` inside
- Background images that convey meaning have a text alternative nearby

### Color and contrast

- Color is not the only means of conveying information (errors, status, selection)
- Flag hardcoded color values where contrast ratio cannot be inferred without design context — note uncertainty rather than guessing

### Keyboard navigation

- New modal/dialog components trap focus and restore it on close
- Custom interactive components (`role="button"`, `role="tab"`, etc.) handle `Enter`/`Space` keyboard events
- `tabindex` values: `tabindex="0"` to add to order, `tabindex="-1"` to remove — flag any `tabindex > 0`

### ARIA usage

- `role` attributes are used only when a native HTML element cannot serve the purpose
- `aria-expanded`, `aria-selected`, `aria-checked` are toggled when state changes
- `aria-hidden="true"` is not applied to interactive elements or their ancestors

### Focus visibility

- Focus styles are not removed with `outline: none` or `outline: 0` without a visible replacement
- New components do not suppress `:focus` or `:focus-visible` styles globally

### WCAG 2.2 additions

- Sticky headers, footers or overlays do not fully cover a focused element (2.4.11)
- Drag interactions (sortable lists, sliders, drag-and-drop) also offer a single-pointer alternative (2.5.7)
- Small icon buttons and links: flag targets that appear smaller than 24x24 CSS px without spacing (2.5.8); note uncertainty when size depends on CSS not in the diff
- Login and verification flows allow paste and password-manager autofill, and do not require a cognitive test without an alternative (3.3.8)
- Multi-step forms do not ask again for data entered in an earlier step (3.3.7)

### Dynamic content

- New content injected into the DOM is announced via `aria-live` when appropriate
- Route changes (in SPAs) announce the new page title or focus a landmark

## Step 4: Output findings

Use this schema:

| Field | Description |
|---|---|
| **Domain** | Accessibility |
| **Severity** | Critical (barrier to access) / High (significant friction) / Medium (partial barrier) / Low (best practice) |
| **Location** | `file:line` |
| **Evidence** | The specific element or pattern found |
| **Basis** | `heuristic` (WCAG rule) — cite the criterion (e.g., WCAG 1.1.1, 1.3.1, 2.1.1) |
| **Impact** | Who is affected and how (e.g., "Screen reader users cannot identify this button's purpose") |
| **Recommendation** | Concrete fix with code example when helpful |
| **Blocking** | Yes for Critical/High that prevent access; No otherwise |
| **Confidence** | High / Medium / Low |

### Severity mapping

| Severity | Meaning |
|---|---|
| Critical | Complete barrier — this content or function is inaccessible |
| High | Significant friction — most assistive technology users will struggle |
| Medium | Partial barrier — some users or configurations are affected |
| Low | Best practice gap — no WCAG failure, but improvement recommended |

## Step 5: Report

```markdown
# Accessibility Review

## Findings

| Domain | Severity | Location | Evidence | Basis | Impact | Recommendation | Blocking | Confidence |
|---|---|---|---|---|---|---|---|---|
| Accessibility | ... | ... | ... | WCAG N.N.N | ... | ... | Yes/No | High/Med/Low |

*(If no findings: "No accessibility issues found in UI changes.")*

## Coverage

- **UI files reviewed:** `file1`, `file2`, ...
- **Criteria applied:** WCAG 2.2 AA
- **Note:** Contrast ratio findings require visual verification — flagged items marked Low confidence unless hardcoded values are clearly insufficient.
```

## Final instruction

Stop after displaying the report. Do NOT edit files unless the user explicitly asks.
