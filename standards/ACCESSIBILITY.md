# Accessibility Requirements (WCAG 2.2 Level AA)

All UI components must conform to WCAG 2.2 Level AA standards.
Treat every item below as a hard requirement, not a suggestion.

## Semantic HTML
- Use native HTML elements for their intended purpose (button, nav, main,
  header, footer, aside, section, article)
- Maintain a logical heading hierarchy (h1 → h2 → h3, no skipped levels)
- Use landmark regions so screen reader users can navigate by section

## ARIA
- Prefer native HTML semantics over ARIA whenever possible
- When native HTML is insufficient (custom widgets, dynamic content),
  apply the correct ARIA roles, states, and properties
- Never use ARIA to override semantics a native element already provides
- Always pair interactive custom elements with the correct role
  (e.g. role="dialog", role="alertdialog", role="tablist")
- Use aria-live regions for dynamic content updates (role="status" for
  polite, role="alert" for assertive)

## Keyboard Navigation
- Every interactive element must be reachable and operable by keyboard alone
- Preserve logical tab order; use tabindex="0" only, avoid positive tabindex
- Implement focus trapping inside modals and dialogs
- Provide skip navigation links ("Skip to main content") at the top of pages

## Focus Indicators
- Never remove the default outline without replacing it with a visible custom
  indicator (minimum 3:1 contrast ratio against adjacent colors)
- Focus state must be clearly distinguishable from the default state

## Color & Contrast
- Normal text: minimum 4.5:1 contrast ratio against its background
- Large text (18pt+ or 14pt bold): minimum 3:1 contrast ratio
- UI components and focus indicators: minimum 3:1 contrast ratio
- Never convey information by color alone — always pair with text or icons

## Forms & Inputs
- Every input must have a programmatically associated label (use for/id or
  aria-label or aria-labelledby — never placeholder as a substitute)
- Required fields must be indicated in text, not color alone
- Error messages must be text-based, descriptive, and associated with the
  input via aria-describedby
- Group related inputs with fieldset and legend

## Images & Media
- Informative images require descriptive alt text
- Decorative images use alt="" so screen readers skip them
- Complex images (charts, graphs) need extended descriptions
- Videos require captions; audio requires transcripts

## Motion & Animation
- Wrap all non-essential animations in a prefers-reduced-motion media query
- No content should flash more than 3 times per second (seizure risk)

## Added in WCAG 2.2
- Focus Not Obscured (2.4.11, AA): a focused element must not be entirely
  hidden by sticky headers, footers, banners or other author-created content
- Dragging Movements (2.5.7, AA): anything done by dragging must also work
  with a single pointer without dragging (e.g. click or tap)
- Target Size (2.5.8, AA): pointer targets are at least 24 by 24 CSS pixels,
  or have enough spacing around them, unless an exception applies
- Consistent Help (3.2.6, A): help mechanisms (contact details, chat, help
  links) appear in the same relative order on every page that has them
- Redundant Entry (3.3.7, A): do not ask for information the user already
  entered in the same process; auto-fill it or let them select it
- Accessible Authentication (3.3.8, AA): login must not depend on a cognitive
  test such as remembering or transcribing a code, unless an alternative,
  a helper (paste, password managers) or an object-recognition option exists
- 4.1.1 Parsing was removed in WCAG 2.2; it is no longer a requirement

## Testing Expectations
- Markup must support validation with screen readers (NVDA, JAWS, VoiceOver)
- Heading structure, landmark regions, and tab order should be logical when
  inspected with an accessibility tree
- Do not rely solely on automated tools — structure code so manual testing
  is straightforward

---

**Version**: 1.1.0
**Last Updated**: November 23, 2026
**Source**: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), W3C Recommendation, edition of 12 December 2024 (checked 2026-11-23)
**Owner**: Personal
