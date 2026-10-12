# Product

<!-- impeccable:product-schema 1 -->

> Written without an interview, as the owner asked. Every fact comes from
> `requirements.md` (sections 1 and 4), `mood-board.png`, `docs/backend.md` or
> the brief for the `foundation/auth-and-planner` branch. Lines marked
> *(inferred)* are my reading of those sources, not something the owner
> confirmed.

## Platform

web

## Users

- **Busy adults and families planning meals for a household.** The household
  may have shared preferences, diets, allergies, nutrition goals, a budget and
  little time to cook. They want the week's meals decided for them, safely,
  without the stress of planning (requirements 1.2, 2.1).
- **Everyone signs in** with email and password. Every recipe and every plan
  comes from the server, which answers signed-in users only, so there is no
  guest mode. Setup is saved to the account; the plan and the user's own
  recipes stay in that user's browser storage.
- The person using it is usually the one who cooks and shops for the household,
  sitting down once a week to plan, then coming back during the week to check a
  recipe or the grocery list. *(inferred)*

## Product Purpose

FeedMe turns a household's allergies, diet, tastes, nutrition goals, budget and
cooking time into a weekly plan of breakfasts, lunches and dinners, with a
grocery list built from it.

Mission: to make sure everyone in a household can eat safely and enjoy their
food, whatever their allergies, diet or budget.

Success means a user can enter their household, generate a plan sized for it,
see the recommended meal and alternatives, swap meals they don't want, add
their own recipes, and get a grocery list, then find it all again after a
refresh (requirements section 8).

## Positioning

A chatbot can write a recipe. FeedMe puts budget, nutrition, cooking time and
preferences into one plan and turns it into a grocery list. Every planned meal
is checked against the household's allergies and diet on the server, and
checked again in the browser before it is shown.

## Operating Context

- Core flow: Set Preferences → Generate Meal Plan → Review Meals → Replace
  Meals → Save Preferences (requirements 1.2).
- The app has three steps: **Setup** (allergies first, then the rest of the
  household), **Plan** (the week grid, with alternatives for each meal and a
  summary of nutrition) and **Grocery** (the list from the confirmed week, and
  the buying agent that shops for it).
- The planner takes 25 to 35 seconds to answer. The wait has to say what is
  happening.
- If the planner is unavailable, the app says so and asks the user to try
  again. There is no sample plan and no made-up data anywhere.
- It is used in a current desktop browser for the hackathon demo. Mobile is
  later scope, but the layout must still work at phone width. *(inferred)*

## Capabilities and Constraints

- Allergies apply to the whole household. They come first in Setup because
  they are the most important safety input.
- **Allergies saved to an account can be added but not removed.** The database
  enforces this, and the UI has to say so next to the control.
- Diets are a fixed list (vegetarian, vegan, pescatarian, halal, kosher,
  low-carb, dairy-free, gluten-free). For account holders, liked and disliked
  foods are lists of short terms (2 to 40 characters, at most 4 words; letters,
  digits, spaces, `'`, `&` and `-`).
- Nutrition goals are daily calories plus protein, carbs and fat. The database
  rejects goals under 1200 kcal, and goals whose macros (4/4/9 kcal per gram)
  are more than 10% off the calorie target.
- Planner recipes come with ingredient names only: no amounts and no prices.
  The product never makes up an amount, a price or a nutrition figure.
- Users can submit their own recipes, with their own amounts, prices and
  macros. These are shown as entered and marked as not verified. They stay in
  browser storage for now.
- Prices are real or absent. Planner recipes have none, so the plan shows no
  cost estimate; the first prices the user sees are the stores' own, in the
  buying agent's cart. The Setup budget is the agent's spending limit.
- The buying agent shops for the planner's recipes only. It buys one pack of
  each ingredient, and pays with one Stripe sandbox payment approved in the
  Link app.
- Out of scope for now: social sign-in, password reset, an order history
  screen, paying for a saved cart without a new run, and browsing or
  publishing other people's plans.
- Undecided: saving plans and own recipes to the account, and account deletion
  in the UI.

## Brand Commitments

- Name: **FeedMe**. Logo files are in `apps/web/src/assets/` (`text-logo.png`,
  `pic-logo.png`, `text-pic-logo.png`).
- Value proposition, as written on the mood board: "For adults and families
  who are busy, FeedMe provides ease and healthy living by making weekly
  custom meal plans and buying them for you."
- Mood board notes: "Plan for just you or a whole family", "Custom to your
  diet and preferences", "Gives weekly plans and recipes", "Clean simple".
- Voice: plain, warm and direct, with no jargon. Errors tell the user what
  happened and what to do next. *(inferred from the existing copy)*

## Evidence on Hand

- `mood-board.png`: brand and logo mood board, value proposition, mission
  statements.
- `requirements.md`: the full product requirements and the MVP tiers.
- There are no testimonials, user numbers, press or pricing. Don't make any up.

## Product Principles

1. **Safety before everything.** Allergies come first, are never relaxed to
   widen choice, and every conflict is shown, never hidden.
2. **Honest numbers.** Estimates are labelled as estimates, the user's own
   numbers as theirs, and a missing figure stays missing.
3. **Done for you, never locked in.** The plan arrives ready, and every meal
   can still be swapped, edited or regenerated.
4. **Nothing made up.** No sample recipes, no invented people, no estimated
   prices. What is on screen came from the planner, the stores or the user.
5. **One clear flow over many features.** Setup, Plan, Grocery.

## Accessibility & Inclusion

- Forms and controls have clear labels and visible keyboard focus
  (requirements 7.3).
- Allergy information must look distinct and be easy to understand, and must
  not rely on colour alone.
- The app follows the system light or dark setting, and the user can override
  it.
- Nutrition and allergy information is not medical advice, and the product
  says so.
