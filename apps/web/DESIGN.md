---
name: FeedMe
description: A week of meals as a wall of photographs, on a ground quiet enough to let the food be the colour.
colors:
  ground: "#0f0e14"
  ground-light: "#f4f4f7"
  raise: "#1a1822"
  raise-light: "#ffffff"
  field: "#121118"
  field-light: "#ffffff"
  line: "#2f2c3c"
  line-light: "#d9d8e2"
  line-strong: "#746f88"
  line-strong-light: "#858294"
  ink: "#f5f2ea"
  ink-light: "#16141d"
  mute: "#aaa5b9"
  mute-light: "#5a5669"
  lime: "#c6f24a"
  on-lime: "#151b00"
  mark-light: "#5a7600"
  danger: "#ff7b6c"
  danger-light: "#b3200f"
  danger-fill: "#c92a17"
  danger-tint: "#37140f"
  danger-tint-light: "#fde9e5"
  warn-tint: "#2c2912"
  warn-tint-light: "#eef4d0"
  ok: "#8fe394"
  ok-light: "#17703a"
  none: "#2b283b"
  on-photo-soft: "#e3dfee"
typography:
  display:
    fontFamily: "'Schibsted Grotesk Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "2.375rem"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.025em"
  title:
    fontFamily: "'Schibsted Grotesk Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 800
    lineHeight: 1.06
    letterSpacing: "-0.025em"
  heading:
    fontFamily: "'Schibsted Grotesk Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  subheading:
    fontFamily: "'Schibsted Grotesk Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  body:
    fontFamily: "'Schibsted Grotesk Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  control:
    fontFamily: "'Schibsted Grotesk Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  note:
    fontFamily: "'Schibsted Grotesk Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  flag:
    fontFamily: "'Schibsted Grotesk Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  flag: "6px"
  control: "10px"
  tile: "12px"
  panel: "16px"
spacing:
  hair: "4px"
  tight: "8px"
  tile-gap: "10px"
  base: "16px"
  section: "24px"
  gutter: "32px"
  part: "40px"
components:
  button:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-primary:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.on-lime}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-primary-light:
    backgroundColor: "{colors.ink-light}"
    textColor: "{colors.lime}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-danger:
    backgroundColor: "{colors.danger-fill}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-large:
    typography: "{typography.subheading}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "48px"
  button-small:
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    height: "42px"
  chip:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.flag}"
    padding: "0 10px"
    height: "28px"
  notice:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "12px 16px"
  notice-warning:
    backgroundColor: "{colors.warn-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "12px 16px"
  notice-error:
    backgroundColor: "{colors.danger-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "12px 16px"
  tile:
    backgroundColor: "{colors.none}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.tile}"
  flag:
    backgroundColor: "rgb(8 7 12 / 0.82)"
    textColor: "#ffffff"
    typography: "{typography.flag}"
    rounded: "{rounded.flag}"
    padding: "2px 8px"
  flag-accepted:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.on-lime}"
    rounded: "{rounded.flag}"
    padding: "2px 8px"
  flag-unsafe:
    backgroundColor: "{colors.danger-fill}"
    textColor: "#ffffff"
    rounded: "{rounded.flag}"
    padding: "2px 8px"
  shelf:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
  dialog:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

# Design System: FeedMe

## Overview

**Creative North Star: "The Wall"**

A week of meals is twenty-one decisions, and the quickest way to take them in is to look at the food. FeedMe lays the week out the way a streaming catalogue lays out its titles: one rail per meal, one tile per day, each tile a photograph of the dish with its name on it. The meal you point at grows and tells you what it is while the rest of the wall steps back. Opening it unfolds the recipe under its own rail, so you never leave the week to read about one meal in it.

Everything that is not the wall stays out of its way. The ground is a deep aubergine-black, or a cool off-white in the light theme. Type is one grotesque. There is one accent, a lime, and it means "here" or "go": the keyboard focus ring, the step you are on, the action that moves you forward. Setup and Grocery have no photographs to show, so they are plain working screens built from the same type, hairlines and controls.

The product's promises shape the details. Allergies are a safety input, so they get the one heavy outline in the app and every unsafe meal is flagged in words. Numbers are the recipes' own or the user's own, so a missing figure is a dash and a recipe with no photograph is a ruled block, never a stand-in picture.

This system rejects the look it replaced: a cream page, a green header, an orange accent, script headings and handwriting notes, cards inside cards, and a plan made of sixty-three form controls.

**Key Characteristics:**

- Recipe photographs are the only colour that is not a state or the accent.
- One family, Schibsted Grotesk, from 12px flags to the 38px page title.
- Hairlines and space group things. There is one raised surface, never a card in a card.
- Every state is said in words with an icon. Colour only reinforces it.
- Light and dark are equals: every colour token carries both values.
- Motion is rare and short, and it is always a transform or a fade.

## Colors

A near-neutral ground with a faint aubergine cast, one lime accent, and three state colours. The photographs supply the rest.

### Primary

- **Ripe Lime** (`lime`, with `on-lime` text): the accent. On the dark ground it fills the primary button, rings the focused control and the meal in hand, and underlines the current step. On the light ground lime cannot carry text or a 3:1 edge, so it inverts: the primary button turns ink with lime lettering, and the underline and tick boxes use **Deep Lime** (`mark-light`).

### Secondary

- **Tomato** (`danger`, `danger-light` for text; `danger-fill` behind white text; `danger-tint` behind a notice): conflicts and failures. An unsafe meal's flag and ring, a destructive confirmation, an error notice, a field error.
- **Leaf** (`ok`, `ok-light`): the small tick beside "OK", "In the cart" and a note about a change that went through. Text and icons only, never a fill.
- **Lime Wash** (`warn-tint`, `warn-tint-light`): the background of a "Heads up" notice. A caution, quieter than Tomato.

### Neutral

- **Aubergine Black** (`ground`) and **Cool Paper** (`ground-light`): the page.
- **Raised** (`raise`, `raise-light`): the one surface above the page. The recipe shelf, a dialog, a default button, a plain notice.
- **Field** (`field`, `field-light`): the inside of an input.
- **Hairline** (`line`, `line-light`): dividers and the edge of a button. Decorative contrast only.
- **Strong Hairline** (`line-strong`, `line-strong-light`): the edge of anything you type or tick into. It passes 3:1 against the field in both themes.
- **Ink** (`ink`, `ink-light`) and **Muted Ink** (`mute`, `mute-light`): text. Muted ink is for metadata and hints and passes 4.5:1 on the ground and on Raised.
- **No Photo** (`none`): the base of the ruled block. It stays dark in both themes, because it stands where a photograph would.
- **Photo Text** (white, and `on-photo-soft` for a meal's details and a quiet flag): text on a photograph sits on the photo's own shade, so it is the same in both themes.

### Named Rules

**The Photographs Are The Colour Rule.** No surface, heading or icon is coloured for decoration. If a screen has no photographs, it is neutral, and that is correct.

**The One Accent Rule.** Lime means "here" or "go". It is never used for emphasis in text, for a second kind of button, or for a chart.

**The Paired Token Rule.** Every colour is declared once as `light-dark(light, dark)`. A value is never set for one theme alone, which is how the old system's two dark themes drifted apart.

**The Say It In Words Rule.** A state is an icon and words first. "Contains Tree nuts" on a red flag reads the same in greyscale.

## Typography

**Family:** Schibsted Grotesk Variable, self-hosted, with `'Segoe UI', system-ui, sans-serif` behind it.

**Character:** A news grotesque with some bite in its heavy weights. It is plain enough for a form label and has enough presence at 800 to title a page with no second face.

### Hierarchy

- **Display** (800, 2.375rem, 1.02, tracking -0.025em): the one title of a page, "Your meal plan". 2rem on a phone.
- **Title** (800, 2rem, 1.06): the name of the recipe in the shelf, the sign-in heading. 1.625rem on a phone.
- **Heading** (700, 1.375rem, 1.15): a part of a page or a form. "Allergies", "Happy with this week?".
- **Subheading** (700, 1.125rem, 1.3): a rail's name, a recipe in the recipe book, a large button.
- **Body** (400, 0.9375rem, 1.5): everything read as a sentence, and a meal's name on its tile at 700. Prose is held to 56 to 60ch.
- **Control** (600, 0.875rem, 1.4): field labels, small buttons, chips.
- **Note** (400, 0.8125rem, 1.4): hints and metadata, in Muted Ink.
- **Flag** (700, 0.75rem, 1.5): words on a photograph, column heads, day verdicts.

The wordmark is "FeedMe" at 900 and 1.625rem with -0.05em tracking. It is type, not an image.

### Named Rules

**The One Family Rule.** No second typeface, no italics for voice, no monospace for figures. Hierarchy comes from weight and from the eight sizes above.

**The Proportional Figures Rule.** `tabular-nums` is not used. In this face it widens full stops and commas as well as digits, so "$21.17" breaks apart. Figures are right-aligned in their columns.

## Layout

One centred column up to 1560px, with a 32px gutter (16px on a phone) and a header that is a single bar with a hairline under it. Pages do not share a grid: each takes the shape of its job.

- **Sign in**: what the app does on the left, the form on the right, 26rem wide. They stack on a phone, form first.
- **Setup**: the form on the left and a 19rem column on the right that holds the plan's status and the actions. That column is sticky, so "Generate meal plan" is never a scroll away. On a phone it follows the form.
- **Plan**: the wall. A 7rem column of rail names, then seven equal columns of tiles 10px apart. Below 1024px the grid would make tiles too narrow to read, so each rail becomes a row that scrolls sideways with 150px tiles, and each tile carries its day.
- **Grocery**: the list in a 24rem column on the left, the buying agent in the rest. On a wide screen the list keeps to the height of the window and scrolls inside it. On a phone the agent comes first.

Parts of a page are separated by a hairline and 24 to 40px. Within a part, related things sit 8 to 16px apart.

**The Lg Is The Wall's Breakpoint Rule.** 1024px is the one width where layout changes shape. Smaller adjustments (a title one size down, buttons stacking) happen at 640px and 768px.

## Elevation & Depth

Flat. Depth is a change of surface from the ground to Raised, with a hairline around it. Two shadows exist, and each belongs to one thing.

### Shadow Vocabulary

- **Pop** (`0 18px 30px -12px rgb(0 0 0 / 0.8)`): under the meal in hand, with its 3px lime ring. It lifts one tile off a wall of photographs.
- **Overlay** (`0 24px 60px -20px rgb(0 0 0 / 0.55), 0 2px 8px rgb(0 0 0 / 0.2)`): under a dialog, over a backdrop of the photo shade at 62%.

### Named Rules

**The One Raised Surface Rule.** Nothing raised sits on something raised. A notice inside the shelf uses a tint, not another panel.

## Shapes

Softly squared. Four radii, each tied to a size of thing: flags and chips (6px), controls (10px), tiles and notices (12px), the shelf and dialogs (16px). Tiles are always 4:5, portrait, like a poster. Nothing is a pill and nothing is a circle except the loading dot.

**The Heavy Outline Rule.** The Allergies block in Setup has a 2px Ink outline. Nothing else in the app does. It is the safety input, and it must not look like the fields around it.

## Components

### Buttons

Squared with 10px corners, 600 weight, 40px tall (32px small, 48px large; 44px and 40px for a finger).

- **Primary:** lime with dark text on the dark ground; ink with lime text on the light one. One per view: "Generate meal plan", "Confirm this week", "Shop for these groceries".
- **Default:** Raised with a hairline. The hairline turns Ink on hover. A pressed toggle ("Saved") inverts to Ink on ground.
- **Quiet:** no surface until hover. For the gentle way out: "Delete" before it asks.
- **Danger:** Tomato fill with white text, only for the confirming click: "Yes, delete".
- **Text button:** reads as a link, with a 2px lime underline. "Edit setup", "Dismiss".
- **Every button** presses to 97% over 160ms.

### Chips

A 28px tag with 6px corners on Raised. An unsaved term is a button with a small cross that removes it. A saved allergen is fixed, and carries a lock.

### Inputs / Fields

42px tall, 10px corners, Field background, Strong Hairline edge that turns Ink on hover and Tomato when invalid. The label sits above at Control size. A hint sits below in Muted Ink, and an error replaces it in Tomato at 600. Tick boxes and radio buttons are the browser's own, tinted lime, with the whole label as the target.

### Notices

One component for everything the app has to tell you. Plain (Raised, Leaf tick): something changed. Warning (Lime Wash, alert mark): heads up. Error (Tomato tint with a 1px Tomato ring, alert mark): something failed. The title is bold and ends in a full stop, the message follows on the same line, and "Dismiss" sits at the right. It eases in over 200ms.

### Navigation

A bar: the wordmark, then Setup, Plan and Grocery as text buttons. The current one sits on Raised with a 3px lime underline. Grocery says "confirm a week first" until there is a confirmed week. On a phone the three steps take a row of their own.

### The Photo Tile

The signature. A 4:5 button filled by the recipe's photograph, with a shade rising from the bottom (95% to 0% of the photo shade over the lower 70%) and the meal's name in white 700 on it.

- **At rest:** the name only. Time, calories and protein are tucked below the edge.
- **In hand** (hover with a real pointer, keyboard focus, or its recipe open): grows 5%, takes a 3px lime ring and the Pop shadow, and slides its details into view, over 200ms. The other tiles drop to 55%.
- **Flags:** at most one word about the meal, top left: "Contains Tree nuts" (Tomato, with a matching ring on the tile), "Changed" (white), "Rejected", "Leftovers", "Yours", "Accepted" (lime). A meal with nothing to say has none.
- **No photograph:** the ruled block, diagonal hairlines on No Photo.
- **Empty:** a Strong Hairline outline with a plus and "Choose a meal".
- **Touch and reduced motion:** nothing grows and the details are always showing.

### The Recipe Shelf

Opens under the rail of the meal it belongs to, as part of the page. Raised, 16px corners, unfolding downward over 280ms. Three columns on a wide screen: the photograph at 4:5, the recipe, and the alternatives as small tiles with "Use this". Focus moves into it when it opens, Escape closes it, and focus returns to the meal.

### Dialogs

Only for what needs the whole screen's attention: writing a recipe, confirming a shopping run. A native dialog on Raised with the Overlay shadow, rising 12px over 220ms.

### Tables

Hairlines only. Column heads in Note size at 600 over a Strong Hairline, rows over a Hairline, totals in bold with no rule. Money and counts are right-aligned.

## Do's and Don'ts

### Do:

- **Do** let photographs carry the colour, and leave a screen without them neutral.
- **Do** declare every colour as a light and dark pair.
- **Do** say a state in words with an icon, and use colour to reinforce it.
- **Do** keep the 2px Ink outline for the Allergies block alone.
- **Do** group with hairlines and space, and use Raised once per view.
- **Do** show a missing figure as a dash and a missing photograph as the ruled block.
- **Do** keep prose to 56 to 60ch.
- **Do** gate hover motion to real pointers, and keep the fades when motion is reduced.

### Don't:

- **Don't** add a second accent, a second typeface, or a tinted panel for decoration.
- **Don't** put a card inside a card, or a coloured stripe down the side of a notice.
- **Don't** use a script or handwriting face anywhere. Safety text is the text most worth reading.
- **Don't** use lime for text on the light ground.
- **Don't** use `tabular-nums` with this face.
- **Don't** put a stock or placeholder photograph where a recipe has none.
- **Don't** open a dialog for something that can unfold in place.
- **Don't** animate navigation, form input, or the plan's figures.
- **Don't** animate width, height, margin or `max-height`.
