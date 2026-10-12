# Redesign plan

Status: **Direction chosen on 2026-10-12: Wall.** Phase 3 is under way.

## Decisions

| Question | Answer |
|---|---|
| Direction | **Wall** |
| Logo | "FeedMe" set in the new type. The PNG files stay in the repo, unused by the app. |
| Styling | Keep Tailwind. The new tokens live in its theme. |
| Font | Schibsted Grotesk, self-hosted (`@fontsource-variable/schibsted-grotesk`) |
| A meal with no photo | A ruled block with the recipe's name |
| Defects | Fix three: the "Recalculate" trap, the lost "session ended" notice, the stranded Undo. The unrounded protein figure is rounded where it is shown. |
| Changed meals | Stay marked until the "What changed" note is dismissed |
| Live data | The owner restarts the containers with a working Bedrock key. Until then the success paths run from fixtures. |
| Recipe view | Opens as a shelf under its rail, not as a modal |
| Screenshots | Not committed |

The rest of this file is the plan as it stood at the checkpoint.

## See the three directions

```bash
pnpm dev:web
# then open http://localhost:5173/prototypes/plan/
```

The floating pill at the bottom switches direction. Keys: `1` `2` `3` or
`←` `→` to switch, `R` to replay the entrance motion. `?v=2` in the URL opens a
direction directly. Each one follows your system light or dark setting, and the
theme button in its header overrides that.

The prototype is the **Plan** step, the screen the product exists for. It is
not a picture: you can change meals, open a recipe, accept, reject, save,
"Suggest another", use an alternative, clear the week and undo it, switch to
Week 2, confirm the week, and remake the plan. To see the unsafe state, change
Tuesday's breakfast to "Almond Oat Bowl (yours)".

What is real and what is not:

- The plan is the planner fixture (real rows of the recipe dataset) run through
  the app's own code in `src/lib`: the same allergy check, the same day totals,
  the same alternatives.
- "Sunday Beef Chili" and "Almond Oat Bowl" are two recipes I typed in as the
  user would, the same two the regression scripts create.
- "Remake the plan" replays the fixture after 2.6 seconds. It does not call the
  planner.
- "Add your own recipe", "Edit this recipe", "Sign out", Setup and Grocery are
  not built in the prototype. Setup and Grocery show a short note.
- The prototype lives in `apps/web/prototypes/plan/`, outside `src`. Nothing in
  the app imports it and it is not in the production build. It is deleted once a
  direction is chosen.

Screenshots of every state I checked are in `.redesign/prototypes/`.

## What the current design gets wrong

The full critique is in
`apps/web/.impeccable/critique/2026-10-12T07-48-01Z__src-app-tsx.md`. It scores
the current app 23 out of 40 on Nielsen's heuristics. The problems the redesign
must not repeat:

1. **Type that is hard to read.** Headings are a wedding script and notes are a
   handwriting face at 13 to 15px, including the fine print about allergies.
2. **A plan grid made of controls.** 21 dropdowns, 21 number boxes and 21
   buttons, with meal names cut off. On a phone the safety column is off screen.
3. **Two design systems glued together.** Hand-written classes and Tailwind
   strings on the same page: three button families, cards inside cards.
4. **Setup with no order of importance.** A hero every visit, three uneven
   columns, three actions at similar weight.
5. **Grocery that buries the buying agent** under a 61-row list.
6. **The category's default look.** Cream ground, green header, orange accent,
   and a coloured stripe down the side of every notice.

## How the directions were chosen

I used Impeccable's direction exploration, which exists to stop every run
landing on the same safe answer. The steps:

- The product's mechanism in one sentence: a household's allergies and limits
  become a week of meals, each checked three times, then a grocery list an agent
  shops for with one approved payment.
- I listed seven visual worlds the person who cooks and shops already knows,
  ordered by how well each carries that mechanism: (1) the label on the back of
  a food pack, (2) the school lunch menu with its allergen key, (3) the planner
  on the fridge door, (4) supermarket shelf tickets, (5) a recipe card box,
  (6) the till receipt, (7) produce crate labels and fruit stickers.
- Impeccable's seed then assigned one of the seven by dice (number 7) and dealt
  six directions from its catalog to weigh against it.

That gives the three directions below: the one the dice assigned (**Market**),
my own top-ranked candidate (**Label**), and the catalog direction that held up
best against them (**Wall**).

The other five catalog directions and what happened to them:

| Catalog direction | Verdict | What it lent |
|---|---|---|
| Boarding pass and gate board | Competitive, held in reserve | A changed row stays lit until you have seen it. Worth adopting in any direction (see Decisions, item 8). |
| Ryoji Ikeda's data fields | Declined: too cold for a family kitchen | Every figure in tabular numerals on a shared column edge. |
| Wim Crouwel's gridded specimen | Declined: the audience has no tie to it | One grid module shared by every screen. |
| A design annual's plate section | Declined: reads as a portfolio, not a kitchen tool | One family carries headings and captions alike. |
| Factory Records catalogue sleeves | Declined: unlabelled colour codes are unsafe for allergies | A fixed vocabulary of states, used everywhere. |

I showed you the directions as live prototypes, as you asked, in place of
Impeccable's own decision page.

## The three directions

### 1. Label

The plan set like the panel on the back of a pack.

**Why it fits FeedMe.** PRODUCT.md's first two principles are "safety before
everything" and "honest numbers", and it requires that allergy information
"look distinct and be easy to understand, and not rely on colour alone". A
household with an allergy already reads one graphic system for exactly this,
several times a day: the nutrition panel and the bold "Contains" line. Label
borrows that system's grammar. The household's setup is stated like an
ingredients line ("Planned for 3 people… **Avoids Tree nuts.**"). The week's
figures are a facts panel with a "% of goal" column. A recipe with only
ingredient names, which is all the planner gives, reads as an ingredients
statement, which is honest about having no amounts.

| | |
|---|---|
| Type | Archivo, one family. Weight and width do the work: 900 at 112 to 118% width for names, 400 for values. Tabular figures. |
| Colour | Paper white and ink black. A black band for the shell. Highlighter yellow for the primary action, the selected meal and warnings. Red for conflicts, green for "OK", always with an icon and words. Dark theme inverts the label. |
| Density | The densest of the three. The whole week, its totals and its percent of goal fit one desktop screen. |
| Layout | A ruled table of days by meals, with the recipe opening in a panel beside it. No modal on desktop. On a phone each day is a block and the recipe covers the screen. |
| Shape | Square corners. Three rule weights (8px, 4px, 1px) group things; there are no cards. |
| Motion | Almost none: 120ms state changes, and a rule that fills while the planner works. |
| Signature | The facts panel, and "Contains" stated like a label. |

**Wins when** the app is a weekly tool and safety has to be the loudest thing on
the page. Changing a meal is one click, in place.
**Costs.** It is the least warm of the three, so the "plain, warm" voice has to
come from the words. Photographs play a small part.

### 2. Market

The colour of produce labels, and the sticker as the mark that says what a meal
is.

**Why it fits FeedMe.** The mood board asks for "clean simple" and the users are
"busy adults and families" who "want the week's meals decided for them… without
the stress of planning". Market is the friendliest reading of that. The week is
seven columns, the way a family calendar shows it. Colour is committed, as
fruit stickers and crate labels are: a cobalt rail, lemon for where you are,
tomato for the main action. The sticker carries the product's states in a form
people know means "this was inspected": Yours, Leftovers, Accepted, Contains
tree nuts. Confirming the week stamps it.

| | |
|---|---|
| Type | Bricolage Grotesque, one family, 800 for headings and 650 for names. |
| Colour | A cool, blue-tinted ground. Cobalt shell, lemon for the current step, tomato for primary actions and conflicts, leaf for "OK". Each meal type has a dot colour beside its name. Dark theme keeps the cobalt rail on a deep indigo ground. |
| Density | Medium. Seven day columns at 1440px; four across below 1240px; one day per block on a phone. |
| Layout | A side rail for Setup, Plan and Grocery. The week as a board of tiles. The recipe in a drawer from the right. |
| Shape | Round: 16px tiles, pill buttons, oval stickers set a few degrees off true. |
| Motion | Springy. Stickers land with a small overshoot, tiles lift, the "confirmed" seal stamps. |
| Signature | The sticker. A meal with nothing to say gets none. |

**Wins when** warmth and approachability matter most, and the week should read
like a calendar.
**Costs.** The lowest density: at seven columns, names wrap to three lines.
Changing a meal takes two clicks (open, then choose). Saturated cobalt is a lot
for a long session, and stickers turn into decoration if they multiply.

### 3. Wall

The week as three rails of recipe photographs.

**Why it fits FeedMe.** Success in PRODUCT.md includes "see the recommended meal
and alternatives, swap meals they don't want", and the third principle is "done
for you, never locked in". Choosing between meals is a browsing job, and
everyone already knows how a streaming catalogue handles that. Breakfast, Lunch
and Dinner are rails. The tile you point at grows and tells you what it is
while the rest steps back. Opening one unfolds the recipe under its rail, with
the alternatives beside it as pictures. It is the only direction that makes
you hungry.

| | |
|---|---|
| Type | Schibsted Grotesk, one family. |
| Colour | A deep neutral ground where the photographs are the colour. One lime accent for focus, the current step and the primary action. The light theme uses an off-white ground with an ink button. |
| Density | Low in text, high in image. Figures for a meal are one hover or one tap away. |
| Layout | A top bar. A row of day summaries, then one rail per meal, aligned to the days. The recipe opens as a shelf under its rail, not as a modal. On a phone the rails scroll sideways. |
| Shape | 12px corners, 4:5 tiles. |
| Motion | Cinematic: 220ms scale and dim on focus, the shelf unfolding. |
| Signature | Focus grows one tile and dims the wall. |

**Wins when** enjoying the food and swapping meals matter most. It is the best
of the three on a phone.
**Costs.** It depends on recipe photographs served from a third party's image
host, and the user's own recipes have none (they get a ruled block). Safety and
nutrition are quieter here than in the other two. Setup and Grocery are forms
and tables, and get little from an image-led world.

### Side by side

| | Label | Market | Wall |
|---|---|---|---|
| Axis | Typographic, dense | Colourful, friendly | Image-led |
| Shell | Black band on top | Cobalt rail on the left | Quiet top bar |
| The week | Ruled table | Board of day columns | Rails of photographs |
| A recipe opens | In a panel beside the week | In a drawer | In a shelf under its rail |
| Change a meal | 1 click, in place | 2 clicks | 2 clicks |
| Safety reads as | A label's "Contains" line | A sticker | A flag on the tile |
| Best theme | Light | Light | Dark |
| Main risk | Feels stark | Low density | Leans on third-party photos |

## What I would build for each

The system is the same shape whichever direction wins. Only its values change.

**Tokens** (light and dark): ground, surface, ink, muted ink, hairline, the
shell colour, the primary action, and four states (danger, warning, success,
selected), each with a text colour that passes 4.5:1 on it. A type scale of
seven fixed sizes at a 1.2 ratio. A 4px spacing scale. Radii, two shadows and
three motion tokens (a duration and an easing each for state, entrance and
emphasis), with a reduced-motion override.

**Shared components**: button (primary, default, quiet, danger; three sizes;
loading), text button, icon button, input, number input, select, textarea,
checkbox, radio, field (label, hint, error), term list with removable chips,
segmented control, notice (status, warning, error; dismissible; with an
action), dialog and side panel, data table, figure row, loading states,
empty state, and the app shell with its theme button.

**Per direction**: Label adds the facts panel and the statement line. Market
adds the sticker and the seal. Wall adds the photo tile, the rail and the shelf.

## Page order for Phase 4

1. **Sign in and register.** Two small forms that prove the tokens, the fields
   and the error states before anything large depends on them.
2. **Setup.** Every form control and every validation message. Allergies
   first, as now, with the "can be added but not removed" rule beside the
   control.
3. **Plan**, with the recipe view and the recipe form.
4. **Grocery** and the buying agent, with its eleven states.
5. **Clean-up**: delete `index.css`, `styles/tailwind.css`, `ui/styles.js`, the
   three script and serif fonts, and any component nothing uses.

After each page: lint and build, the page's regression scripts, screenshots at
1440px and 390px in light and dark, the console, keyboard focus, and a commit.

## Libraries

**None needed.** The app has two dozen components, and native elements cover
them: `<dialog>`, `<select>`, `<details>`. Motion in all three directions is
CSS.

Two things I would ask before adding:

- **Fonts.** The prototypes load one family from Google Fonts, the way the app
  loads its three today. Self-hosting it means one new package
  (`@fontsource-variable/<family>`).
- **`motion`** (Framer Motion), only if Phase 5 finds something CSS cannot do
  well, such as a meal sliding to a new place when it is swapped.

## Decisions I need from you

1. **The direction.** Label, Market or Wall. Or ask for another round: safer
   (more conventional), bolder, or a mix, such as Label's structure with Wall's
   photographs.
2. **The logo.** All three prototypes set "FeedMe" in type. The existing logo
   files are orange bubble letters with a green outline, and PRODUCT.md lists
   them as a brand commitment. Keep them, or let the name be set in the new
   type?
3. **Styling approach.** I recommend plain CSS with one token file and one
   stylesheet per component, and removing Tailwind (two dev dependencies).
   The alternative is to keep Tailwind and move the new tokens into its theme.
4. **Fonts**: Google Fonts link as today, or self-hosted (one install).
5. **The recipe view.** In every direction the recipe stops being a centred
   modal on desktop. The regression scripts change where they open it, and the
   final report will list each change.
6. **The four defects found in Phase 1** (`regression-checklist.md`, last
   section). All four are in logic you told me not to touch, so I will leave
   each one as it is unless you say otherwise:
   - "Recalculate carbs and fat" can write a value the form then refuses to
     submit.
   - The "session ended" notice is sometimes lost on the way to `/login`.
   - Clearing Week 1 leaves its Undo out of reach.
   - A day's protein can read "27.200000000000003 g". The new UI rounds
     figures where it shows them, which hides this one without touching the
     logic.
7. **The Bedrock key.** The key in `.env` is refused, so the planner and the
   buying agent cannot run on this machine. I can keep working from fixtures.
   If you want the redesign checked against a live plan before the final
   report, the key needs replacing.
8. **Changed meals that stay marked.** Borrowed from the gate-board direction:
   after a swap, the meals that changed keep a mark until you dismiss the note.
   The plan state already has a `highlight` field that nothing sets. Using it
   means a small change in `MealPlanProvider`, so I am asking first.
9. **Screenshots.** `.redesign/before/` is 21 MB, so I left it and
   `.redesign/after/` out of git. Say so if you want them committed.

## What does not change

Routes, data fetching, API calls, the context providers, form validation, and
everything in `src/lib`, `src/hooks` and `src/contexts`. Every string the user
reads stays unless a layout change makes it wrong, and each such change will be
listed.
