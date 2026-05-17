---
name: Sentra
description: Autonomous B2B cold outreach — from cold list to booked meetings.
colors:
  cream-bg: "#f5f2ee"
  subtle-bg: "#faf8f5"
  blue-cta: "#2563eb"
  blue-cta-hover: "#1d4ed8"
  blue-tint: "#eff6ff"
  ink: "#1a1a1a"
  mid-ink: "#4a4a5a"
  dim-ink: "#9a9a9a"
  border-line: "#e8e3dc"
  border-subtle: "#d4cec7"
  white: "#ffffff"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontStyle: "italic"
    fontWeight: 300
    fontSize: "clamp(2.75rem, 6vw, 4.25rem)"
    lineHeight: 1.05
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "DM Sans, -apple-system, sans-serif"
    fontWeight: 500
    fontSize: "clamp(1.25rem, 2.5vw, 1.75rem)"
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "DM Sans, -apple-system, sans-serif"
    fontWeight: 300
    fontSize: "1rem"
    lineHeight: 1.5
  label:
    fontFamily: "DM Sans, -apple-system, sans-serif"
    fontWeight: 700
    fontSize: "0.625rem"
    letterSpacing: "0.12em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "48px"
  2xl: "96px"
components:
  button-primary:
    backgroundColor: "{colors.blue-cta}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  button-primary-hover:
    backgroundColor: "{colors.blue-cta-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  button-secondary-hover:
    backgroundColor: "{colors.cream-bg}"
  card-base:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.lg}"
    padding: "24px"
  card-featured:
    backgroundColor: "{colors.blue-tint}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design System: Sentra

## 1. Overview

**Creative North Star: "The Quiet Operator"**

Sentra's visual system is built for one reader: the skeptical founder who has
closed three AI-SDR tabs already this week and trusts none of them. The design
does not persuade — it demonstrates. Copy is sparse and specific. Components
are flat and functional. Color is restrained to near-absence except where one
sharp note of blueprint blue closes the argument. Every element earns its place
or gets cut.

The physical scene: a solo founder, mid-morning, quiet office. They are not
looking to be impressed. They are looking to not be deceived. The interface
has one job: make the product feel like it was built by someone who has done
this, not marketed by someone who is selling it.

The aesthetic is warm without being soft. The cream-and-linen field says
"built by a person, not a design committee." The typographic choice — DM Sans
at weight 300 as the backbone, Fraunces italic deployed surgically at editorial
moments — signals precision, not template polish. Motion exists as feedback
only; it never performs.

**Key Characteristics:**
- Tonal depth via layered neutrals (subtle-bg → cream-bg → white), not shadows
- Blueprint blue reserved for actions and proof points, nowhere else
- Fraunces italic used at most once per major section — a scalpel, not a brush
- Every number on the page is specific and verifiable
- Weight 300 carries the body; hierarchy comes from size and spacing

## 2. Colors: The Linen-and-Blueprint Palette

A near-monochromatic warm neutral field interrupted by exactly one cold note.
The blue is not decorative — it marks where the user should act or what the
product has proven.

### Primary
- **Blueprint Blue** (`#2563eb`): Primary CTAs, logo mark, proof-point accents
  within product mockups. Used on ≤15% of any given section. Its contrast
  against the warm field is the sharpest visual moment on the page.
- **Deep Blueprint** (`#1d4ed8`): Hover state on primary buttons only.
  Never used at rest.
- **Blueprint Wash** (`#eff6ff`): Background tint for featured cards and
  highlighted states. The only blue surface that is not a button or link.

### Neutral
- **Chalk** (`#faf8f5`): Page-level background and hero sections. The
  lightest surface; no element sits on it without differentiation.
- **Parchment** (`#f5f2ee`): Alternating section backgrounds, TrustBand,
  footer, hover states. Slightly warmer than Chalk — creates section rhythm
  without introducing a new color.
- **White** (`#ffffff`): Card surfaces, input backgrounds, elevated containers.
- **Unbleached Linen** (`#e8e3dc`): All borders, dividers, separators.
  The structural skeleton of the layout.
- **Soft Linen** (`#d4cec7`): Secondary button border on hover only.
- **Carbon Ink** (`#1a1a1a`): Primary headings and body text. Never `#000`.
- **Ink Mist** (`#4a4a5a`): Secondary text — nav links, supporting copy. The
  slight blue-purple shift prevents muddiness against the warm neutral field.
- **Ash** (`#9a9a9a`): Metadata, disclaimers, label categories. Verify
  contrast (≥4.5:1) on Parchment backgrounds before use in small text.

**The One Signal Rule.** Blueprint Blue appears on actions (buttons, links)
and proof points (specific metrics, outcomes, the "Most popular" badge on the
featured pricing card — that is a proof point, not decoration). Never on
decorative shapes, background fills, ambient glows, or dividers. If the blue
reads as ambience, it is wrong.

**The Warm Ground Rule.** The page base is always warm (Chalk or Parchment).
Blue elements live in this warm field as contrast. Never invert: a dark or blue
background is not part of this palette for the landing register.

## 3. Typography

**Display Font:** Fraunces (`var(--font-fraunces)`), standard italic style,
weight 300 — loaded via `next/font/google` with `style: ['italic', 'normal']`
(not the Soft Italic optical axis variant). Weights 300–900 available;
landing uses 300 exclusively for display headings.

**Body Font:** DM Sans, weights 300–700 — loaded via Google Fonts CDN

**Label Font:** DM Sans weight 700, uppercase, 0.12em tracking

**Character:** An editorial pairing that refuses the obvious. Fraunces standard
italic at weight 300 reads as handwritten intelligence — confident, unhurried.
DM Sans at 300 underneath keeps everything legible and airy. Neither font is
decorative; both earn their weight.

### Hierarchy
- **Display** (Fraunces italic, 300, clamp(2.75rem, 6vw, 4.25rem), line-height
  1.05, −0.01em): Hero h1s and section h2s where an editorial moment is
  earned. Used maximum once per major section. Not the default heading role.
- **Headline** (DM Sans, 500, clamp(1.25rem, 2.5vw, 1.75rem), line-height
  1.2, −0.01em): Sub-section headings, card titles, feature names. The
  workhorse heading role.
- **Body** (DM Sans, 300, 1rem, line-height 1.5): All body copy. Max 65–75ch
  line length on desktop. Never weight below 300.
- **Label** (DM Sans, 700, 0.625rem, 0.12em tracking, uppercase): Section
  eyebrows above Fraunces headings, TrustBand stat categories. Contrast
  through weight and tracking, not size.
- **Caption** (DM Sans, 400, 0.75rem, line-height 1.4): Disclaimers, pricing
  footnotes, CTA sub-text. Color: Ash (`#9a9a9a`).

**The Fraunces Budget Rule.** Fraunces italic appears at most once per major
visual section. Two Fraunces headings in the same viewport is one too many.
When in doubt, DM Sans headline fills the role.

**The Weight Step Rule.** DM Sans 300 is the default for all non-heading text.
Weight 500 is for headlines and active states. Weight 700 is for labels only.
No weight 400 or 600 as intermediates — the jump from 300 to 500 creates
hierarchy; filling it in collapses it.

## 4. Elevation

Sentra uses tonal layering as the primary depth mechanism. Shadows are rare
and structural, never ambient decoration.

The page surface stack from deepest to highest:
1. **Chalk** (`#faf8f5`) — page ground
2. **Parchment** (`#f5f2ee`) — tonal section breaks
3. **White** (`#ffffff`) — card surfaces
4. **Blueprint Wash** (`#eff6ff`) — featured card distinction

### Shadow Vocabulary
- **Ambient Low** (`0 1px 3px rgba(26,26,26,0.06), 0 1px 2px -1px rgba(26,26,26,0.06)`):
  Default state on cards and primary button. Barely visible; marks elevation
  without announcing it.
- **Ambient Mid** (`0 4px 12px rgba(26,26,26,0.08), 0 2px 4px -2px rgba(26,26,26,0.06)`):
  Hover state on cards and primary button. The state transition is the signal.
- **Header Scroll** (`0 1px 0 rgba(232,227,220,0.8)`): Nav on scroll. A
  border-shadow — separates the fixed header from content without lifting it.
- **Featured** (`0 10px 40px rgba(37,99,235,0.12)`): Featured pricing card
  only. Blue-tinted to reinforce the Blueprint Wash background.

**The Flat-by-Default Rule.** Surfaces are flat at rest; shadows appear only
on hover or scroll state. A shadow visible when nothing is happening is
decoration. Remove it.

**The No-Glow Rule.** No ambient radial gradients for depth. No
`backdrop-filter: blur` except on the scroll-state nav header, where it is
earned by the functional need to separate the fixed element from content.

## 5. Components

### Buttons
Two variants with a pronounced visual gap. Secondary must read as
absence-of-primary-action, not a lighter-weight variant.

- **Shape:** Gently rounded (8px radius). Approachable, not playful.
- **Primary** (`#2563eb`, white text, px-6/py-3, Ambient Low): One per
  section. "Start free trial." Never two primary buttons at equal visual
  weight in the same section.
- **Primary Hover:** Deep Blueprint (`#1d4ed8`), Ambient Mid. 200ms ease-out.
  No scale, no translateY.
- **Secondary** (transparent, Carbon Ink text, Unbleached Linen border,
  px-6/py-3): Hover shifts to Parchment background, Soft Linen border.
- **Focus Ring:** `ring-2 ring-[#2563eb] ring-offset-2` on all interactive
  elements. WCAG AA compliant.
- **Active:** `scale(0.98)`, 150ms. Confirms the press without drama.

### Pills / Announcement Badges
Floating section precursors ("Replace 5 tools with one").

- **Style:** `rounded-full`, white background, Unbleached Linen border, Ink
  Mist text, Ambient Low, 14px DM Sans weight 500.
- **Indicator dot:** 6px, `bg-amber-400` with `animate-pulse`. The only amber
  element on the landing; the only persistent animation allowed in a
  non-reduced-motion hero. Do not replicate this pattern elsewhere.

### Cards
- **Corner Style:** Softly rounded (12px). Larger than buttons — establishes
  visual hierarchy between interactive and structural elements.
- **Background:** White on Chalk or Parchment.
- **Shadow:** Ambient Low at rest, Ambient Mid on hover.
- **Border:** Unbleached Linen (`#e8e3dc`), 1px.
- **Internal Padding:** 24px standard, 16px on mobile.
- **Featured Variant:** Blueprint Wash background, Blueprint Blue border,
  Featured shadow. Used for the "Most popular" pricing card only. Not a
  general-purpose highlight treatment.

### Navigation Header
Must not compete with content below it.

- **Default (top):** Transparent, no border, no shadow.
- **Scroll state (>12px):** Chalk at 90% opacity, `backdrop-blur-md`, 1px
  bottom border (Unbleached Linen at 80%), Header Scroll shadow. 300ms
  ease-out.
- **Nav links:** 14px DM Sans, Ink Mist default, Carbon Ink on hover,
  Parchment background on hover — `rounded-md px-3 py-2`.
- **Logo mark:** 28×28px Blueprint Blue `rounded-md`, "S" in white 700.
  "Sentra" wordmark in DM Sans 600, Carbon Ink.

### TrustBand (Signature Component)
A horizontal fact grid functioning as a tonal pause between sections.

- **Background:** Parchment at 70% opacity — a wash, not a hard block.
- **Border:** `border-y` only (Unbleached Linen). No card, no shadow,
  no hover state, no CTA.
- **Grid:** 4 columns on desktop, 2×2 on mobile. Internal columns separated
  by `border-l`.
- **Stat label:** 10px DM Sans 700, uppercase, 0.12em tracking, Ash.
- **Stat value:** 16px DM Sans 600, Carbon Ink.
- **Stat sub:** 12px DM Sans 400, Ash.
- No animation, no interaction. A fact block, not a feature.

### Section Eyebrow
- **Style:** 10px DM Sans 700, uppercase, 0.18em tracking, Blueprint Blue
  (`#2563eb`). Margin-bottom 20px before the heading.
- Standard pattern for landing sections L2–L4 (pricing, features, FAQ,
  how-it-works). Optional only where the heading is self-evident without it.

## 6. Do's and Don'ts

### Do:
- **Do** use Fraunces italic at most once per visual section. A Fraunces
  heading alone carries more weight than one competing with another.
- **Do** write specific numbers: "$149/mo", "Days, not weeks", "5,000
  prospects sourced." Vague claims are invisible; specific claims are
  memorable.
- **Do** keep Blueprint Blue for two roles only: actions (buttons, links) and
  proof points (specific metrics, verified outcomes, featured-plan badge).
- **Do** use the Chalk → Parchment → White tonal stack to create section
  rhythm without adding new colors.
- **Do** respect `useReducedMotion` on all Framer Motion components.
  Entrances and transitions are enhancements, not requirements.
- **Do** verify Ash (`#9a9a9a`) contrast before using it on body-size text
  against Parchment backgrounds. It passes AA for large text only on the
  lighter surfaces.

### Don't:
- **Don't** use B2B Rocket / Outreach / Salesloft patterns: glowing AI orbs,
  vague superlatives ("Skyrocket your pipeline"), demo gates, enterprise
  photography grids.
- **Don't** use Artisan / 11x patterns: anthropomorphized AI agents, purple
  gradients, "hire our AI" framing, animated particle backgrounds.
- **Don't** use Apollo / generic SaaS patterns: dashboard screenshot as hero,
  feature list as hero, pricing tables that require a legend to read.
- **Don't** use Lemlist-style over-polish: warm-orange illustration style,
  startup-template spacing, mascot-adjacent visuals.
- **Don't** use Stripe-lookalike minimalism: cream + serif italic without
  differentiation, oversized padding with near-empty content density.
- **Don't** use Linear-mimicry: cold dark mode, high-contrast monochrome,
  precision aesthetics without warmth.
- **Don't** use gradient text (`background-clip: text` with a gradient).
  Single solid color on all type, always.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored
  accent stripe on cards, callouts, or list items. Use full borders or
  background tints instead.
- **Don't** use grain or noise textures above 0.05 opacity. Subtle texture
  (0.02–0.03) is acceptable for warmth; anything more becomes AI-slop ambient.
- **Don't** introduce a dark-mode variant on the landing. The warm cream field
  is structural to the brand register. Dark mode belongs in the app.
- **Don't** use animation as ambient decoration: no auto-playing backgrounds,
  no persistent pulsing outside the hero announcement dot, no particle effects.
  Every motion is a response to state or a one-time entrance.
- **Don't** add a third typeface. The Fraunces + DM Sans pairing is closed.
- **Don't** use gradient background fills as section ambience. The palette has
  no gradients in the landing register.
