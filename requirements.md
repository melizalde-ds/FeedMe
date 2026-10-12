# Meal Planner Product Requirements

## 1. Product Overview

### 1.1 Purpose

The product helps households create practical, personalized meal plans by combining:

- Food preferences and dietary restrictions
- Household allergies
- Disliked ingredients
- Nutrition goals
- Budget
- Prep time
- Grocery-list generation

The product should provide more value than a generic recipe generator by turning these inputs into a usable meal plan and grocery workflow.

### 1.2 Mission and value proposition

FeedMe's mission is to make sure everyone in a household can eat safely and enjoy their food, whatever their allergies, diet, or budget.

For busy adults and families, FeedMe provides ease and healthy living by making weekly, custom meal plans and buying the ingredients for them.

- **Health and ease**: To help busy people and families eat well every day, without the stress of planning.
- **Safe for everyone at the table**: To make sure everyone in a household can eat safely and enjoy their food, whatever their allergies, diet, or budget.
- **Time back**: To give busy families their time back by turning healthy eating into a plan that's done for you.

**Vision**: An AI meal-planning assistant that knows what users can eat, what they enjoy, what they need nutritionally, and what they can afford. It creates personalized plans they can easily adjust.

**Core flow**: Set Preferences → Generate Meal Plan → Review Meals → Replace Meals → Save Preferences.

**What sets FeedMe apart**: An AI can generate a recipe on its own. FeedMe's value is putting Budget, Nutrition, Prep Time, and Preferences into the same plan, with a Grocery List generated from it.

### 1.3 Hackathon priority

The primary objective is to complete and demonstrate the meal-planning experience. The product is not being sold as part of the hackathon. Business and monetization work is secondary to a working meal plan.

## 2. Users and Use Cases

### 2.1 Primary users

The primary users are households planning meals for multiple people. A household may have shared preferences, dietary restrictions, nutrition goals, allergies, disliked ingredients, budget constraints, and limited prep time.

### 2.2 Core use cases

Users should be able to:

1. Enter household size and meal-planning preferences.
2. Name everything that must stay out of their meals — allergens and disliked ingredients alike — in one place, and dietary restrictions alongside it.
3. Set nutrition goals, budget, prep-time preferences, and the days to plan for.
4. Generate a personalized meal plan.
5. Review the recommended meals and alternatives.
6. Accept, reject, save, or replace meals.
7. Edit preferences and regenerate the plan.
8. Submit their own recipes, with their own ingredients, prices and macro
   values, and have those recipes planned alongside the generated ones.
9. View the ingredients and grocery list needed for the plan.

## 3. MVP Scope

### 3.1 Essential

These features are required for a working demo and must ship first:

- Personalized meal-plan generation for breakfast, lunch, and dinner
- A single strict list of things the household cannot have, covering allergens and disliked ingredients with the same per-ingredient precision, plus dietary-restriction support
- A visible, staged progress state while a plan is being built, because generation takes long enough that an unexplained wait reads as a broken page
- Calorie and macro goal support
- User preferences input (household size, preference and household setup form, and the days to plan for)
- Meal viewing and selection, including a best-fit recommendation with alternatives, recipe details, and ingredient quantities
- Meal variety, with a cool-off period so the same meal isn't repeated too soon in the plan
- User-submitted recipes: a user can add a recipe of their own, with its ingredients, quantities, prices and macro values, and have it planned, swapped in, and bought for like any other recipe
- Grocery list generation
- A simple, usable demo interface

### 3.2 High

These features round out the core flow and should ship if time allows after Essential is complete:

- Replace disliked meals
- Ingredient swaps inside a single recipe: substituting one blocked ingredient rather than discarding the whole meal, and telling the user what was substituted
- Edit preferences and regenerate the plan
- Budget setting
- Save preferences (basic preference persistence)
- Checkout and payment for the grocery list via Stripe
- User accounts (sign-up/login), so preferences, recipes, and meal plans persist to an account rather than only local storage

### 3.3 Optional

- Importing a recipe from a URL or a photo instead of typing it in
- Publishing a user's own recipes to the shared feed, separately from publishing a whole plan
- Preferred grocery stores
- Fridge-based meal suggestions
- Saving favorite recipes and meal plans to an account
- User-published meal plans
- Browse and save weekly plans published by other users
- Be able to add a meal plan to your calendar
- Browse plans day-by-day in addition to week-by-week, and add a single day from someone else's plan to your own calendar instead of only a full week
- A match score shown on browsed plans, estimating fit against the viewing user's own household size, budget, allergies, diet, and prep-time settings
- An automated "fit to budget" action that swaps higher-cost meals for lower-cost alternatives until the plan is back within budget
- A record of days already eaten, kept and shown separately from the days still ahead
- An undo for the most recent plan change (e.g. after copying in a browsed plan)

### 3.4 Later

- Subscriptions
- Alexa integration

### 3.5 Further future scope

The following are not part of the priority tiers above and would only be considered well beyond MVP:

- Separate meals for picky eaters or individual household members
- Repurchase history, purchase history, receipts, and templates
- Social proof and recommendation ranking based on likes or purchases
- Store price comparisons and store locations or map pins
- Mobile interfaces

Separate meals for individual household members are specifically deferred because they substantially increase planning and safety complexity.

The MVP should prioritize one clear meal-planning flow over a large number of secondary sections.

## 4. User Experience Requirements

### 4.1 Onboarding and navigation

- The initial setup should be brief and focused on information needed to generate a plan.
- What the household cannot have should appear first, because it is the highest-priority safety input.
- Other preferences should appear in a separate section after it.
- Allergens and disliked ingredients belong in one section, because the user is answering one question: what can we not eat? The allergens shall still be grouped and labelled on their own inside that section, so the entries where being wrong is a safety problem remain identifiable.
- The initial experience may be a single scrolling page.
- If navigation becomes multi-section, the product may provide an optional tour and contextual hints for non-obvious features.
- Any action that takes more than a few seconds — plan generation above all — shall show a progress state that says what is being done, rather than leaving the previous screen's state on display. The product shall not report "no plan" while a plan is being built.

### 4.2 Main product sections

The product may be organized around the following sections:

- Household
- Menu
- Grocery
- Recipe
- My recipes (the user's own submitted recipes)
- Ingredients, including estimated cost
- Plan summary/stats, showing aggregated nutrition intake and cost across the plan

The final navigation and visual design should remain simple enough for the hackathon demo.

### 4.3 Meal recommendations

- The product should show one best-fit meal as the headline recommendation.
- Alternatives should be available for users who reject the recommendation.
- Users should be able to continue editing preferences and regenerating meals until they are satisfied with the plan.
- Saved or liked meals may later be used as recommendation signals.

## 5. Functional Requirements

### 5.1 Household and preferences

- The system shall collect household size.
- The system shall plan each meal for the household's number of servings.
- The system shall collect food preferences, dietary restrictions, the things the household cannot have, nutrition goals, budget, prep-time preferences, and the days the plan should cover.
- Allergens and disliked ingredients shall be collected as one list. Every entry on it is followed strictly: nothing on the list appears in a planned meal, whatever the reason it is there.
- Entries shall be offered as a standard, selectable list — the common allergens plus commonly disliked ingredients — with a free-text field for anything not on it. Each entry names one ingredient or allergen, so it can be matched against a recipe's ingredient list rather than inferred from prose.
- The list applies to the whole household.
- An entry's reason changes how it is matched, not whether it is enforced. A standard allergen is matched against the ingredients it hides in as well as its own name, and a recipe that declares it is blocked even when the scan cannot see it. Any other entry is matched against the ingredient names and the dish name, allowing for plurals.
- The product shall never present the list as a medical guarantee (section 5.2), and shall keep the allergens on it identifiable so the user can see which entries carry safety weight.
- The user shall choose the days to plan for on a calendar, selecting individual dates, rather than choosing from preset plan lengths. The days picked need not be consecutive, and the current date shall be identifiable on the calendar without needing a label on it.
- The calendar shall page forward by month with no fixed horizon, so a user can plan a day in any upcoming month rather than only within the current one.
- A date that has already passed shall not be selectable, because a plan cannot be shopped for after the fact.
- The calendar's day cells shall be uniform in size and shape, and the grid shall not change shape as the user pages between months.
- The plan length and the per-day share of the budget shall be derived from the number of days picked, so there is one source of truth for both.
- Dietary restrictions should be offered as a standard, selectable list (e.g. vegetarian, vegan, pescatarian, halal, kosher, low-carb, dairy-free, gluten-free) rather than free text, so meals can be filtered reliably.
- Food preferences (foods a user loves) may additionally be collected as free text to bias recommendations, separate from the structured diet and avoid selections. The structured list is the mechanism for ruling an ingredient out; free text is a nudge.
- The per-meal time limit shall be labelled as prep time in the interface, and prep time shall be the term used wherever that limit or a recipe's own time estimate is shown.
- The system shall allow a user to override the household serving count for an individual meal (e.g. a smaller lunch), defaulting to the household size when left unset.
- The system shall allow users to edit these values after initial setup.
- The recipes available to a household shall include both the system's recipes and any the user has submitted themselves (section 5.8).
- The system should offer a way to reset preferences back to defaults.
- Location should be obtained from the incoming request rather than entered manually, if location is needed.

### 5.2 Allergy and dietary safety

- Allergies shall apply to the whole household by default.
- If one household member has an allergy, generated meals shall be allergy-friendly for the entire household by default.
- The system shall offer a standard list of common allergens (e.g. peanuts, tree nuts, milk, eggs, wheat/gluten, soy, fish, shellfish, sesame) as selectable options, within the single avoid list of section 5.1, plus a free-text field for adding anything not on it.
- Combining allergens and dislikes into one list shall not weaken the allergen checks. The allergen keyword matching, the declared-allergen rule, and the substitution rules below apply to allergen entries exactly as they would if the list held nothing else.
- The product may allow a user to remove an allergy flag when the user intentionally accepts responsibility for preparing a separate meal.
- Individual allergy profiles and separate meals are outside the MVP.
- Ingredient substitutions must not be treated as safe merely because they were suggested by the AI. A substitution offered against an allergy shall come from a curated list of known-safe replacements, not from generated text.
- A substitution shall only be attempted where every blocking ingredient can be named. An allergen a household reacts to that is declared on a recipe but not visible in its ingredient list (hidden in a sauce, a dressing or a marinade) shall not be substituted away, and the recipe shall stay excluded.
- A recipe that has been substituted shall be re-checked against the full allergy, diet and dislike gate before it is offered. If any conflict remains, the substitution shall be discarded and the recipe excluded. No meal is planned on the strength of a substitution alone.
- Removing an ingredient shall not add a dietary claim. A recipe whose dairy was substituted out shall not be relabelled dairy-free.
- A user-submitted recipe shall be scanned for allergens from its ingredient names, and whatever that scan finds shall be flagged on the recipe in addition to whatever the user declared. A user must not be able to make a recipe appear allergen-free by leaving allergens unticked.
- The product must communicate that nutrition and allergy information is not medical advice and should be checked by the user.

### 5.3 Meal-plan generation

- The system shall generate a plan using the user's preferences, household size, restrictions, avoid list, goals, budget, prep-time constraints, and the days the user picked on the calendar.
- The system shall plan only the days the user picked and shall leave every other day untouched, including the days in between a non-consecutive selection.
- A plan shall be held and addressed by calendar date, not by a position in a fixed window, so there is no limit on how far ahead it can reach and no empty structure for days the user did not pick.
- The MVP shall generate breakfast, lunch, and dinner meals for the household plan.
- Generated meals should include at least a name, meal type, servings, ingredients, quantities, preparation instructions, and an estimated prep time.
- The plan should expose nutrition and cost estimates when those values are available.
- After a plan is generated, the system shall show a summary/stats section aggregating the plan's nutrition intake (e.g. calories, macros) and total cost against the user's goals and budget.
- Meal generation shall draw on user-submitted recipes as well as the system's own, subject to the same allergy, diet, prep-time and budget filters.
- The system shall return alternatives when a user rejects a meal.
- The system shall enforce a cool-off period between repeats of the same meal, so the same meal does not reappear within a set number of calendar days of the plan.
- Where a recipe is blocked only by ingredients that can be named and substituted, the system may plan it with those ingredients swapped (section 5.2) rather than discarding it. A recipe that fits as written shall be preferred over one that needs a substitution.
- A leftover meal shall only be planned on the calendar day immediately after the meal it reheats, so a gap in the selected days does not produce a leftover with nothing behind it.
- The product may support assigning a meal slot as "leftovers" of a dinner cooked earlier in the plan, to reduce cooking effort and grocery cost; a leftover slot must reference a meal that was actually cooked earlier in that plan, and should be flagged if the source meal is later removed or changed.
- The system shall let a user regenerate or clear the whole plan, or clear a single day, without disturbing the other days.
- The plan shall be shown as one row per planned day, in date order, with no week to select between. Each row shall be labelled with its calendar date first and then the day of the week, and today's row shall be identifiable.
- Each planned day should show a clear status (safe/OK vs. a problem to fix, such as an allergy conflict, a diet mismatch, a disliked ingredient, an avoided food, a broken leftover reference, or an invalid serving count) alongside that day's aggregated nutrition.
- If a user changes an allergy, a disliked ingredient, a diet, or other safety-relevant preference after a plan exists, the system shall automatically re-check existing planned meals and swap any that are no longer safe or compliant, and shall tell the user what was changed and why.

### 5.4 Feedback and meal replacement

- Users shall be able to accept or reject a meal; accepting a meal confirms it for the plan.
- Users shall be able to save or heart a meal.
- Users shall be able to request an alternative.
- Users shall be able to assign one of their own submitted recipes to any meal slot it fits, in the same way they would choose one of the system's recipes.
- The product should support replacing an individual meal without requiring the entire plan to be regenerated, if technically feasible for the MVP.
- Where a meal is kept and one of its ingredients is substituted instead, the product shall disclose the substitution in plain language naming what was removed and what replaced it, in the form "We swapped [ingredient] for [replacement]". The disclosure shall be visible wherever the meal is reviewed and wherever its ingredients are acted on, including the grocery list.
- A substituted ingredient shall be the one that appears in the recipe's ingredient list and in the grocery list, so the user buys what the plan actually assumes.
- The MVP should support single-meal regeneration, whole-plan regeneration, and clearing one day.
- The product may offer an automated "fit to budget" action that swaps higher-cost meals for lower-cost alternatives until the plan is back within budget, and should tell the user what was swapped and on which days.
- The product should offer an undo for the most recent plan-changing action (e.g. a swap, a copy-in from a browsed plan, or a fit-to-budget pass).
- Feedback should be available for future ranking, including most-liked or most-purchased meals, and may include accept, reject, or custom feedback.
- Social proof and ranking are intentionally out of scope for the demo.

### 5.5 Grocery workflow

- The system should aggregate ingredients from the days the user has confirmed into a grocery list, and shall not build one from a plan the user is still editing.
- The grocery list should account for required quantities and household servings.
- Cost estimates may be shown per ingredient or for the overall plan.
- The MVP shall support checkout and payment for the grocery list using Stripe.
- Payment handling must use Stripe-hosted checkout or Stripe Elements so that card data never touches the backend directly.
- Store price comparison and location pins are outside the core MVP.

### 5.6 Social discovery (optional)

- If implemented, the product may let users browse meal plans published by other users, split into day-by-day plans and week-by-week plans.
- Browsed plans should be ranked or scored against the viewing user's own household size, budget, allergies, diet, disliked ingredients, and prep-time settings, so the closest matches surface first.
- A user should be able to view a browsed plan's recipes before committing to it, then add either the full run of days or a single day to their own plan by choosing the calendar date it starts on. Days of the week are not a way to place a plan whose days are calendar dates.
- The dates a copied plan lands on shall join the days the user has picked, so copied days are part of the plan rather than days it does not cover.
- Before committing, the product shall show which calendar dates the copied plan will occupy.
- Meals copied in from a browsed plan must still be checked against the viewing user's own allergies and diet, and swapped automatically if unsafe or non-compliant.
- Users should be able to publish their own plan to the shared feed.
- This feature is optional for the MVP; if it ships, it still depends on the cold-start problem of having enough published plans, which the team should address (e.g. seeding sample plans) before relying on it in a demo.

### 5.7 Data persistence and accounts

- The MVP should persist preferences and selected meals across a browser refresh, via local storage, independent of login.
- The product shall support user accounts, so a user can save recipes, save meal plans, and mark favorites, and have that data persist across devices.
- Account holders shall be able to publish a meal plan and save or browse meal plans published by other users.
- Accounts require server-side persistence beyond local storage (e.g., Firebase or a database); the specific backend is still to be decided.
- Users must be able to delete their account and associated data.
- User-submitted data sent to the AI provider should be limited to preferences, dietary restrictions, disliked ingredients, and the dates being planned, and should be discarded after the plan is finalized for the demo.

### 5.8 User-submitted recipes

- Users shall be able to submit their own recipes, and those recipes shall be usable everywhere a system recipe is: assigned to a meal slot, chosen by the generator, offered as an alternative, and costed into the grocery list.
- A submitted recipe shall require, at minimum: a name, the meals it can fill (breakfast, lunch, and/or dinner), how many servings it makes, an estimated prep time, calories and protein, at least one ingredient with an amount, and at least one preparation step. Carbs, fat, ingredient units and ingredient prices are optional.
- Validation of a submitted recipe shall be at least as strict as the validation applied to an AI-generated recipe, because both end up in the same plan, grocery list and nutrition totals.
- A user shall enter amounts, prices and macros for the whole recipe as they cook it, and the system shall divide them by the number of servings it makes, so a meal can be scaled to any number of people.
- Recipe names shall be unique across the recipes available to a household, and renaming a submitted recipe shall carry any meal slot already holding it.
- Users shall be able to view, edit and delete their own recipes. Deleting or editing a recipe that is already in a plan shall trigger the same automatic re-check as a preference change (section 5.3): affected meals are swapped and the user is told what changed and why.
- Macro and price values on a submitted recipe are the user's own and shall be displayed as entered by the user and unverified, never presented as system estimates (section 6).
- A user's dietary tags on their own recipe are a claim, not a verified fact, and the system shall warn when the ingredients contradict a tag (e.g. a recipe marked dairy-free whose ingredients read as containing milk).
- The system shall warn when a submitted recipe conflicts with the household's own allergies or diet, and shall exclude it from generated plans for as long as that conflict stands, rather than silently planning it.
- The system shall not substitute ingredients inside a user's own recipe. The ingredients, prices and macro values on it are the user's, so a conflicting own recipe is reported to the user rather than rewritten.
- Submitted recipes shall persist across a browser refresh, independently of any plan, so regenerating a plan never discards them. Account holders' recipes shall persist to the account (section 5.7).
- Submitted recipes shall be sent to the AI planner as candidates, so a generated plan can place them. The planner must not overwrite a user's macro or price values with its own estimates.

## 6. Nutrition and Cost Requirements

- Nutrition values must be labeled as estimates unless they come from a verified data source.
- Serving sizes must be reflected in nutrition and cost calculations.
- The system should identify the source or calculation method for nutrition values, including distinguishing values a user entered for their own recipe from values the system estimated.
- Budget is a hard MVP constraint for meal selection, not just an estimate shown to users.
- The system should explain when a plan cannot satisfy all requested constraints.
- Nutrition and cost estimates should rely on macro values and should be treated as approximate rather than medical or exact commercial data.
- A recipe detail view should show, at minimum: name, per-serving nutrition (calories, protein), prep time, estimated cost, flagged allergens, ingredient list, any ingredient substitutions, and step-by-step directions, with a visible note that the recipe is a sample/unverified and that allergen and nutrition data should be checked by the user.
- Where an ingredient has been substituted, the cost shall follow the substitution. Nutrition values shall be presented as the original recipe's estimate unless the substitution's own values are known, and the difference shall be stated rather than implied.
- A user-submitted recipe with no ingredient prices would read as free against the budget, so the system should tell the user that rather than quietly undercounting the plan's cost.

Nutrition accuracy and allergy-safe substitutions are high-priority risks because incorrect output could affect user safety.

## 7. Technical Requirements

### 7.1 Proposed stack

- Frontend: React with TypeScript
- Backend: FastAPI
- Persistence for MVP: browser local storage for guests, plus server-side persistence (backend/database TBD) for account data
- AI generation: ChatGPT via API
- Payments: Stripe
- Demo deployment: team member laptop with secrets stored in a local .env file

FastAPI is preferred because meal-planning logic may later be reused by mobile or Alexa interfaces. Mixing React, Streamlit, Svelte, and Blazor is out of scope; Streamlit is only a fallback if a simpler prototype is required.

### 7.2 AI integration

- AI output should use a strict structured JSON schema rather than unvalidated free-form text.
- The backend should validate generated meals before returning them to the frontend.
- Invalid, incomplete, unsafe, or unavailable AI responses must produce an explicit user-facing error.
- User-submitted recipes passed to the AI planner must be validated on return exactly as generated recipes are, and a planner response that alters a user's own macro or price values must be rejected rather than displayed.
- API keys and other secrets must remain server-side and must not be committed to the repository.
- The application should have a demo fallback or sample data path if the AI service is unavailable.
- Meal-generation safety checks should gate ingredient substitutions against allergy constraints and the system should not suggest unsafe substitutions. The gate shall run on the frontend as well as the backend, because a substitution shown to the user is the one they will cook.

### 7.3 Accessibility and compatibility

- The primary demo flow should work in a current desktop browser.
- Forms and controls should have clear labels and usable keyboard focus states.
- Safety-critical allergy information should be visually distinct and understandable, including inside the combined list of things the household cannot have.
- Long-running work should report progress accessibly, so a screen-reader user is told that a plan is being built rather than left on a stale state.

## 8. Success Criteria

The MVP is ready for demonstration when a test user can:

1. Enter a household size, everything the household cannot have, restrictions, preferences, goals, budget, and the days to plan for, picking those days on a calendar that reaches past the current month.
2. Generate a plan covering exactly those days — including days that are not consecutive — containing meals sized for the household, and see progress while it is being built rather than a "no plan" message.
3. Read the plan as one row per day, in date order, labelled by date, with today identifiable.
4. Identify the recommended meal and available alternatives.
5. Reject or replace at least one meal.
6. Submit a recipe of their own, with its ingredients and macro values, and then place it in the plan and see it in the grocery list.
6. Add something to the list of things they cannot have and see either the meals containing it replaced, or that one ingredient swapped out with the swap stated in plain language.
7. Copy a plan from the shared feed onto a date of their choosing.
8. Confirm the plan, then view the resulting grocery list.
9. Check out and pay for the grocery list via Stripe.
10. Refresh the browser and retain the relevant preferences, submitted recipes, and selections.
11. Understand that nutrition and allergy information requires verification, which numbers are their own, and which ingredients were substituted.

The team should test the flow against the existing user personas, including cases involving allergies, disliked ingredients, budget constraints, household size, non-consecutive planning days, days several months ahead, and meal regeneration.

## 9. Delivery Plan

1. Confirm the MVP boundary and technical stack.
2. Define the main screens and data model.
3. Build the preference and household form, with the single list of things the household cannot have first, then the calendar day picker.
4. Implement structured AI meal generation and validation.
5. Display the plan, alternatives, recipes, and grocery list.
6. Add the user's own recipe submission, with validation and allergen scanning.
7. Add meal replacement, ingredient substitution with its disclosure, feedback, and local persistence.
8. Test the core personas and safety-related edge cases.
9. Polish the UI and prepare the demo.
10. Add optional features only after the success criteria are met.