# Regression checklist

This file defines "still works" for the redesign. Every line under
[Flows](#flows) is an automated check in `.redesign/scripts/`, and each one
passed against the current design on 2026-10-12 (branch `redesign`, before any
UI change). The redesign is done when the same scripts pass again with
`after` as the phase.

## How to run it

```bash
docker compose up -d --wait     # Supabase and Qdrant
pnpm dev                        # web :5173, API :8000, stores :8100
playwright-cli open http://localhost:5173/

# In this order: each script leaves the state the next one starts from.
.redesign/scripts/run.sh 01-auth.js before      # registers a fresh account
.redesign/scripts/run.sh 02-setup.js before
.redesign/scripts/run.sh 03-plan.js before
.redesign/scripts/run.sh 04-grocery.js before
.redesign/scripts/run.sh 05-session.js before
.redesign/scripts/run.sh 06-states.js before
```

Screenshots go to `.redesign/<phase>/` at 1440px and 390px wide. Results go to
`.redesign/results/<phase>-<script>.json`.

The scripts find elements by role, label and visible text, never by class
name. A redesign that keeps the labels, the roles and the wording passes them
unchanged. Where the redesign changes a control's kind (a dropdown becoming a
picker, say), the script has to change with it, and that change is listed in
the final report.

## What is real and what is played back

The API key for Amazon Bedrock in `.env` is refused ("Authentication failed:
Please make sure your API Key is valid"), so on this machine the planner can't
embed recipes or build a plan, and the buying agent can't run.

| Part | Source in the baseline |
|---|---|
| Sign-in, registration, sign-out | Real (local Supabase) |
| Setup: load, save, allergies, goals | Real (FastAPI and Postgres) |
| Planner failing | Real: the server's own `503` |
| Planner succeeding | Played back from `.redesign/fixtures/meal-options.json` |
| Buying agent refusing to start | Real: the server's own `404` ("No recipe with id …") |
| Buying agent running, paid, unpaid, failed | Played back from `.redesign/fixtures/shopping.json` |
| Server errors in `06-states.js` | Played back (`503`, `400`, `422`, an unreadable answer) |

Nothing in the fixtures is invented. The recipes are rows of
`data/recipes_clean.parquet` (`make_fixture.py`), and the products and prices
are the mock stores' own seed catalog (`make_shopping_fixture.py`). The
fixtures are served by Playwright route mocks, and for the run's event stream
by a `fetch` wrapper installed in the test page. No app code knows about them.

Not exercised, because this machine can't reach them:

- The sign-in pages with no anon key ("sign-in is not configured"). The key is
  read at build time.
- Registration with email confirmation on ("Confirm your email with the link
  we sent you"). The local stack confirms automatically.
- The first "Loading FeedMe…" screen, which is on screen for a few
  milliseconds.

These three have no script. They are checked by reading the code in Phase 4,
and the report says so.

## Routes

| Route | What it shows |
|---|---|
| `/login` | Sign-in form. A signed-in user is sent to `/`. |
| `/register` | Create-account form. A signed-in user is sent to `/`. |
| `/` | The app, for signed-in users. Anyone else is sent to `/login`. |
| anything else | Sent to `/`. |

`/` holds three steps that share one URL: **Setup**, **Plan** and **Grocery**.
The step is React state, so a reload always opens Setup.

## States each screen can be in

**Sign in and register**: empty; field errors after a blur or a submit;
submitting (button reads "Signing in…" or "Creating your account…", fields
disabled); server error as an alert; a notice above the form (session ended,
or check your email); sign-in not configured.

**Setup**
- Allergies: loading the saved ones; none ticked; ticked and unsaved; saved
  and locked ("saved, can't be removed"); another-allergen error; unsaved
  custom allergen as a removable chip; saved custom allergen as a fixed chip.
- Household, diet, tastes, goals: field errors (people out of range, calories
  under 1200, macros more than 10% off the target); term-list errors (too
  short, duplicate, already in the other list, too many).
- Save bar: idle; saving; saved; refused with the server's message;
  unavailable; blocked by a field error.
- Plan request: idle ("Generate meal plan"); waiting ("Building your plan…",
  with the half-minute explanation); failed, as a dismissible error banner
  with one of six messages; done ("Your plan is ready", button becomes
  "Rebuild my plan").
- Next-step panel: "No plan yet" or "Your plan is ready".
- Your recipes: empty; cards; a card whose recipe the plan will not use;
  delete asking for confirmation; a status line after save, update or delete.
- Safety disclaimer, always.

**Plan**
- Summary of the setup, with "Edit setup".
- Waiting for a remake; error banner; "Heads up" warnings from the plan;
  "What changed" note, with or without an Undo button.
- Week tabs: "this week", "next week", "not planned".
- A week with meals: five summary figures, the grid of 7 days by 3 meals, the
  Check column (OK, a problem in red, or "Nothing planned", plus the day's
  calories and protein against the goals), the confirm bar (unconfirmed,
  confirmed, or blocked by a problem day).
- A week with no meals: "Nothing planned for this week".
- Each meal: empty; a recipe; leftovers; a meal the dropdown no longer offers;
  an option flagged with its problem; a people count that overrides the
  household size.
- Recipe dialog: a planner recipe (names only, no amounts or prices) or the
  user's own (amounts and costs); accepted, rejected, saved; alternatives or
  "no other option fits"; "Do not cook this as planned" when it conflicts.
- Recipe form dialog: new or editing; field errors after a submit;
  allergens found in the ingredients (ticked and locked); "Worth checking"
  warnings; the per-serving summary once the numbers are valid.

**Grocery**
- No confirmed week: "Confirm a week first".
- The list: items with amounts (the user's recipes) and without (the
  planner's), and the note that explains the dashes.
- Buying agent: nothing to shop for (every meal is the user's own); the
  recipes it won't shop for; the two modes, with "Buy it for me" unavailable
  when there is no budget; asking before a run; running (status line, note,
  payment approval, cart with no Remove buttons); could not start; paid
  (orders per store, reference, saving, items not found, what is left in the
  cart); nothing paid (stopped early or out of steps); failed (with the cart
  it had saved); still running on the server; loading the last run; meals
  changed since the last run; runs start without asking ("Ask me first").

## Flows

88 automated checks, grouped below; some lines cover more than one. All 88 passed against the current design.

### Sign in and register (`01-auth.js`)

- [x] Signed out, `/` goes to `/login`
- [x] An unknown route ends at `/login`
- [x] Sign in with nothing typed shows "Enter your email address." and "Enter
      your password.", and sets `aria-invalid`
- [x] Wrong credentials show an alert: "That email and password don't match an
      account. Check them and try again."
- [x] "Create an account" goes to `/register`
- [x] Register with a bad email and a short password shows both field errors
- [x] The theme button cycles light, dark, system and sets `data-theme`
- [x] Registering creates the account and opens Setup
- [x] "Sign out" returns to `/login`
- [x] Signing in opens Setup
- [x] Signed in, `/login` goes to `/`
- [x] Keyboard: Tab goes logo, theme, email, password, submit, the other
      form's link

### Setup (`02-setup.js`)

- [x] With no plan, the Plan tab stays on Setup
- [x] The Grocery tab says "confirm a week first" and opens the empty Grocery
      page, whose button comes back
- [x] Ticking an allergy updates "Every meal avoids: …" and says it is unsaved
- [x] An unsaved allergy can be unticked
- [x] A one-letter custom allergen is refused: "Use at least 2 characters."
- [x] Enter adds a custom allergen; its chip removes it
- [x] 0 people is refused ("Enter between 1 and 20 people."); 3 updates the
      hint to "3 servings"
- [x] Planning period can be changed
- [x] A diet can be ticked and unticked
- [x] A liked food is added; a duplicate is refused
- [x] A liked food can't also be avoided
- [x] A term chip removes its term
- [x] 1000 kcal is refused: "Use at least 1200 kcal a day."
- [x] Macros more than 10% off the target are flagged, and the save bar says
      to fix the fields
- [x] "Recalculate carbs and fat" clears the macro problem
- [x] Budget and time per meal can be changed
- [x] "Save to my account" ends on "Saved to your account."
- [x] After a reload the saved allergy is ticked and locked, and the setup is
      still there
- [x] Generating against the real planner shows the waiting text, disables the
      button, then shows "The planner is unavailable right now. Try again in a
      few minutes." in a banner that can be dismissed
- [x] The recipe form refuses an empty save with 7 alerts
- [x] Escape closes the dialog
- [x] A recipe saves; "Cheddar cheese" ticks and locks Milk; the per-serving
      line appears; the section reports "Saved Sunday Chili. …"
- [x] "View" opens the recipe scaled to the household, with amounts and costs
- [x] "Edit" renames the recipe
- [x] "Delete" asks first, and "Keep it" cancels
- [x] Generating (fixture) shows the waiting text, then "Your plan is ready"
      and "Rebuild my plan"
- [x] "See your plan" opens Plan

### Plan (`03-plan.js`)

- [x] The plan survives a reload, and the Plan tab opens it
- [x] A recipe the browser's allergy check rejects is left out, with a "Heads
      up" that names it
- [x] The week summary shows five figures
- [x] The grid has 7 days by 3 meals, with a Check column
- [x] A meal can be changed from its dropdown
- [x] Changing a dinner fills the next day's empty lunch with its leftovers
- [x] The people box overrides the household size for that meal
- [x] A planner recipe shows nutrition, ingredient names, directions, and the
      note that it has no amounts or prices
- [x] Accept, Reject and Save change their buttons' state
- [x] "Use this" swaps in an alternative and closes the dialog
- [x] "Suggest another" swaps the meal and leaves a "What changed" note
- [x] Clicking the backdrop closes the dialog
- [x] "What changed" can be dismissed
- [x] The user's recipe is offered where it fits, marked "(yours)"
- [x] Its recipe view has amounts and costs, and "Edit this recipe" opens the
      form
- [x] A recipe containing a household allergen is flagged in the form, in the
      dropdown, in the Check column and in the recipe dialog, and it blocks
      "Confirm this week" until it is swapped out
- [x] Week 2 reads "not planned" and shows the empty state, whose "Edit setup"
      opens Setup
- [x] "Remake the plan" shows the waiting state and builds a new plan
- [x] Clearing Week 1 leaves no plan, so the app shows Setup ("No plan yet")
- [x] A 14-day plan fills Week 2, labelled "next week"
- [x] "Clear this week" on Week 2 offers Undo, and Undo restores it
- [x] "Confirm this week" confirms it, says so, and removes "confirm a week
      first" from the Grocery tab
- [x] Keyboard: Tab moves through the grid with a visible 3px focus ring
- [x] "Go to grocery list" opens Grocery

### Grocery and the buying agent (`04-grocery.js`)

- [x] The list is built from the confirmed week: 61 items, the user's recipe
      with amounts ("Ground beef 0.75 lb"), the planner's with a dash
- [x] The panel names the recipes the agent won't shop for, and offers both
      modes
- [x] With no budget, "Buy it for me" is disabled and says why
- [x] Starting a run asks first; "Not now" and Escape cancel
- [x] A run against the real server is refused, and the refusal is shown in a
      banner
- [x] A run shows its status line, its note, the cart per store and the
      payment to approve, with a link; the modes and the button are disabled;
      there are no Remove buttons. The request carries the mode, `remember`,
      the meals, the budget in cents and the household size
- [x] The run keeps going while the user visits Plan and comes back
- [x] Once paid: the total, one table per store, the payment reference, the
      saving over one store, what was not found, and what is still in the cart
- [x] "Do this every time" is remembered; "Ask me first" turns it off
- [x] "Keep all 2 marked" approves them; "Remove" takes a product out
- [x] After a reload the last run is read back from its order
- [x] A run that paid nothing says so, with the reason (stopped early, or out
      of steps)
- [x] A failed run shows its error and the cart it had saved
- [x] A run still going on the server shows "The agent is still shopping."
- [x] After the meals change, the panel says the earlier run was for different
      meals
- [x] Avoiding a food in Setup swaps the meals that use it, with a note
- [x] "Reset to defaults" restores the defaults and keeps the saved allergy
      locked

### Session and server errors (`05-session.js`, `06-states.js`)

- [x] A `401` from the API signs the user out and lands on `/login`
- [x] Signing in again brings back the setup and the plan
- [x] Save with the server down: "Saving to your account is not available
      right now. …"
- [x] Generating while the setup can't be saved: "Your setup could not be
      saved to your account, and the planner reads it from there. …"
- [x] A save the server refuses shows the server's message as an alert
- [x] `422` from the planner: "No recipe fits your household's allergies and
      diet. …"
- [x] An answer the app can't read: "The planner answered with something we
      could not read."
- [x] With the account unreachable, Setup still opens from the browser's copy

## Checks

| Check | Command | Baseline |
|---|---|---|
| Lint | `pnpm lint` (oxlint) | Passes, no warnings |
| Types and build | `pnpm build` (`tsc -b`, then `vite build`) | Passes. One warning: the JS chunk is 588 kB, over Vite's 500 kB notice |

The web app has no unit tests. The API and storefront have pytest suites,
which the redesign does not touch and which were not run.

## Console errors in the baseline

All are the browser logging a failed request that the page then handles. There
were no JavaScript errors or React warnings.

| Where | Message | Cause |
|---|---|---|
| `/login` | `400` | The wrong-password check |
| Setup | `503` | The real planner, with Bedrock unreachable |
| Grocery | `404` | The real buying agent: the recipes are not in Qdrant |
| Session check | `401`, and `403` from `/auth/v1/logout` | The played-back `401`. The app signs out once per failed request, and the extra sign-outs are refused |
| Error-state checks | `503`, `400`, `422` | Played back on purpose |

## Defects found in the current app

These exist today. They are not part of the redesign's brief, and all four sit in
logic the brief says not to change. They are listed here so the
redesign neither hides nor "fixes" them by accident. Each needs a decision.

1. **"Recalculate carbs and fat" can make the form impossible to submit.** The
   carbs field has `step="5"`. Recalculating for 2400 kcal writes 313 g, which
   the browser's own validation rejects, so "Generate meal plan" does nothing
   but show a tooltip on a field that may be off screen. The app's own check
   says the numbers are fine. `NutritionGoalsFields.jsx`, `step: 5`.
2. **The "session ended" notice is sometimes lost.** After a `401` the app
   lands on `/login`, but the notice was missing in 1 of 4 tries in one run
   and 4 of 4 in another. The redirect carries the message, the sign-in page
   sees a user who is not signed out yet and bounces to `/`, and the second
   redirect to `/login` carries nothing. `AuthProvider.jsx`, `LoginPage.jsx`.
3. **Clearing Week 1 strands its Undo.** With a one-week plan, "Clear this
   week" leaves no plan, so the app shows Setup with "No plan yet". The note
   and its Undo button are on the Plan step, which is now unreachable. The
   next plan then opens on Plan with no "Your plan is ready" step, because
   the app is still on Plan underneath. `Home.jsx`, `Shell`.
4. **Unrounded protein in the Check column.** A day's protein can read
   "27.200000000000003 g". `planner.js`, `dayNutrition`.
