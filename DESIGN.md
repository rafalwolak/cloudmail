---
name: Cloudmail Dashboard
description: A restrained transactional email console for developers.
colors:
  bg: "#101112"
  surface: "#17191b"
  raised: "#202326"
  line: "#363a3f"
  ink: "#f2f3f5"
  muted: "#aeb4bd"
  accent: "#e8ebef"
  focus: "#90bfff"
  button-text: "#141619"
  button-hover: "#d6dbe2"
  field-border: "#515861"
  field-bg: "#131517"
  nav-current: "#292e34"
  status-positive: "#c7dfcb"
  status-negative: "#ffb1b1"
  status-warning: "#f3d294"
  status-pending: "#b3d1ff"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-.025em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "13px"
    fontWeight: 550
    lineHeight: 1.6
    letterSpacing: "normal"
rounded:
  control: "6px"
  button: "7px"
  panel: "8px"
spacing:
  step-4: "4px"
  step-8: "8px"
  step-12: "12px"
  step-16: "16px"
  step-20: "20px"
  step-24: "24px"
  step-32: "32px"
  step-48: "48px"
  step-64: "64px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.button-text}"
    rounded: "{rounded.button}"
    padding: "8px 14px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "8px 14px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.button}"
    padding: "8px 10px"
  input:
    backgroundColor: "{colors.field-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 11px"
  navigation-item:
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  navigation-current:
    backgroundColor: "{colors.nav-current}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  filter-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "0 16px"
  status-label:
    textColor: "{colors.status-positive}"
---

# Design System: Cloudmail Dashboard

## Overview

**Creative North Star: "The Developer Console"**

A professional developer console inspired by the user-selected Resend reference. Restrained charcoal surfaces, neutral borders and near-white primary actions support dense operational work. The visual character is direct, quiet and practical.

This contract describes the implemented dashboard and the authentication views sharing public/dashboard.css. It does not establish a new visual identity for the public landing page. Page strategy lives in .impeccable/surfaces/dashboard.md; product constraints live in PRODUCT.md.

**Key Characteristics:**
- Neutral dark surfaces with tonal separation.
- System UI typography and compact, labeled controls.
- Wide record lists and restrained outline iconography.
- Visible keyboard focus and status text alongside color.

## Colors

The palette is charcoal and near-white; blue marks interaction focus and the selected chart data series; state-specific colors carry operational meaning. Frontmatter values are normative and follow the current stylesheet.

### Primary

- **Near-white action ink** (`ink`): primary action fills, headings and active text.
- **Pale neutral accent** (`accent`): links.
- **Focus blue** (`focus`): keyboard focus outlines, text carets and the selected chart data series.

### Neutral

- **Charcoal canvas** (`bg`), **low surface** (`surface`) and **raised surface** (`raised`): base page, disclosed content and hover/status layers.
- **Slate divider** (`line`): panels, separators and list rows.
- **Cool gray text** (`muted`): supporting copy, inactive navigation and metadata.
- **Field charcoal** (`field-bg`) and **field stroke** (`field-border`): readable form boundaries.
- **Selected slate** (`nav-current`): current navigation item.
- **Dark action text** (`button-text`) and **pale hover** (`button-hover`): primary button contrast and hover.

Positive, negative, warning and pending color roles apply to text status labels. These are semantic states, not additional brand accents. The stylesheet also contains local selection, scrollbar and checkbox colors; they are not a reusable palette scale.

**The Status Text Rule.** Color supports a status label; it never replaces the label or collapses accepted and delivered into one state.

## Typography

The system UI stack is shared by headings, controls and body copy. Code and payloads use `ui-monospace, SFMono-Regular, Consolas, monospace`.

### Hierarchy

- **Headline:** page headings use the frontmatter headline role; mobile headings reduce to (25px).
- **Title:** section headings use the title role; tertiary headings use (16px).
- **Body:** the body role sets the base rhythm; supporting paragraphs are limited to (75ch).
- **Label:** form labels use the label role; record times and breadcrumb metadata use (12px), with finer event/account metadata at (11px).
- **Authentication introduction:** the existing signed-out introduction uses `clamp(40px, 5vw, 64px)`, line-height (1.08) and tracking (-.04em). It is hidden on mobile and does not define dashboard heading scale.

## Layout

Desktop uses a sticky sidebar (232px) beside a flexible main column. The sidebar fills the viewport height and scrolls independently when needed. The breadcrumb header is at least (64px) high. Page content fills the available width up to (1720px), with horizontal padding `clamp(20px, 3vw, 48px)` and vertical padding (36px) above and (64px) below.

Record lists span their content area. Ordinary non-search forms are capped at (800px); the compose form uses a wider maximum of (960px). Compose fields use two columns with a (24px) gap. Filters wrap with flexible fields rather than forcing horizontal overflow.

At (1100px) and below, email record summaries become two-line metadata layouts and the overview becomes one column. At (760px) and below, the sidebar becomes a sticky top navigation disclosure; the menu shows links in two columns. Content padding becomes (28px 20px 48px), record metadata stacks, compose fields become one column and metric tiles retain two columns. The authentication view changes from a two-column layout capped at (1200px) to one workspace column with its introduction hidden.

## Elevation & Depth

The console is flat at rest. Borders and tonal layers distinguish navigation, disclosures and record details. The sole floating status surface uses `0 8px 24px #0005`; it sits at the bottom right. The sticky mobile navigation remains above page content. Do not treat the status shadow as a general card effect.

Hover transitions change background and text color over (120ms) with `ease-out`, only when reduced motion is not requested. Keyboard focus uses a (2px) focus-colored outline offset by (4px).

## Shapes

Controls and navigation use restrained corners: the control radius for fields and links, the button radius for actions and workspace identity, and the panel radius for filters, empty states and notices. Lists rely on bottom dividers rather than independent floating cards. Empty states use a dashed border; record details have square outer corners within the list.

## Components

### Buttons

Near-white primary actions use dark text, weight (600), minimum height (40px), and the frontmatter padding/radius. Secondary actions use a low surface and a divider-colored stroke; their hover uses the raised surface. Text actions use muted text and transparent backgrounds, gaining the raised surface on hover. Disabled buttons use opacity (.55) and a not-allowed cursor. All retain the common keyboard focus outline.

### Inputs / Fields

Dark inset fields have a visible stroke, compact padding, minimum height (40px), and persistent labels. Placeholders use muted text at full opacity. Textareas resize vertically. Checkboxes remain native controls with a (20px) box; they are not decorative switches.

### Navigation

Links have a minimum height of (42px), a (12px) icon/text gap and (18px) outline icons. Active links combine selected slate, bright text and weight (600), with `aria-current="page"`. The mobile Menu button exposes its expanded state; Escape closes the disclosure and returns focus to that button.

### Containers and Disclosures

Filter panels use the low surface, a thin divider border and panel corners. Editor disclosures use an outlined container with horizontal padding (20px). Metrics share one bordered, clipped container with flexible columns of at least (140px); each metric sits on the low surface with padding (20px), reduced to (16px) on mobile. The mobile grid retains two columns. Avoid treating these containers as promotional cards.

### Data Charts and Tables

Time-series charts use a single focus-blue line against divider-colored gridlines. A labeled selector changes the displayed series; a text summary and a disclosed table provide exact values. Tables use divider-separated rows, a low-surface header and tabular numerals. Their labeled scroll region supports keyboard access and a maximum height of (480px).

### Email Records and Status Labels

A record summary displays subject, recipient, status, time and an expansion marker. Native details disclose content on demand. Status remains plain text with semantic color, not a pill or badge. Long addresses and payloads wrap; preformatted message content is scrollable with a maximum height (480px). Maintain meaningful empty, loading and request-error text.

## Do's and Don'ts

### Do:
- Do reuse the dashboard color roles and visible focus treatment.
- Do keep record lists flexible and forms compact.
- Do pair status color with explicit text and preserve the distinction between accepted and delivered.
- Do retain direct page URLs, active navigation and the mobile menu disclosure.

### Don't:
- Don't apply this dashboard contract to the landing page without an explicit decision.
- Don't replace labeled operational controls with icon-only actions.
- Don't add decorative shadows, gradients or animated movement to the flat console surfaces.
- Don't expose internal design documentation as public application content.
