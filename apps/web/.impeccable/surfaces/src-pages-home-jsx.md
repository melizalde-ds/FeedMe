---
version: 1
slug: "src-pages-home-jsx"
primary_target: "src/pages/Home.jsx"
related_targets: ["src/pages/LoginPage.jsx","src/pages/RegisterPage.jsx"]
---

# FeedMe web app: sign-in, Setup, Plan, Grocery

Scope: every screen of `apps/web`. Mode: Operate. The owner chose the "Wall" direction on 2026-10-12 from three live prototypes.

Audience and job: the person who cooks and shops for a household, at a laptop once a week to plan, then back during the week for a recipe or the grocery list. Task: set up the household (allergies first), get a week of meals, swap what they don't want, confirm, then shop.

Constraints: no logic, data or route changes beyond the three defect fixes and the changed-meal marks the owner approved. Tailwind stays. Light and dark both ship. Allergy state is never colour alone. Nothing is invented: a recipe with no photo shows a ruled block.

Unresolved: the live planner and buying agent wait on a working Bedrock key.

## Direction contract

THESIS: The week is a wall of food you can read at a glance and rearrange by pointing. Refuses the category default of a cream page of rounded cards and a table of dropdowns.

OWN-WORLD: A deep aubergine-black ground (off-white in light) where recipe photographs are the only colour. One lime accent for focus, the current step and the primary action. Schibsted Grotesk throughout, 800 for titles. 4:5 photo tiles with a reading shade, 12px corners, hairline dividers, no cards inside cards.

STORY: The visitor sees what the household eats this week, trusts that each meal was checked because every exception is flagged in words, and confirms the week to get a grocery list.

FIRST VIEWPORT: Quiet top bar (FeedMe, Setup, Plan, Grocery, account, theme). "Your meal plan" with the setup in one line. Week switch and three actions. A row of seven day summaries, then the Breakfast rail of seven 4:5 tiles, with Lunch starting below.

FORM: Streaming catalogue wall, a dealt challenger ("pop-culture-shelf-streaming-title-card-wall"), chosen by the owner over the assigned direction. Seed key 4a8b9eca. Signature interaction: the tile in hand grows and names itself while the rest of the wall dims; opening it unfolds the recipe as a shelf under its rail.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
