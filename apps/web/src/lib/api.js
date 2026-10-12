import { endpoints } from './config.js'
import { apiFetch, apiStream } from './http.js'

// Calls to the FastAPI backend. Paths live in config.js, the fetch helper and
// the 'unavailable' / 'invalid' error kinds in http.js. Every route needs the
// signed-in user's bearer token except GET /api/allergens.
//
// POST /api/meal-options         { plan_days, meal_types } -> MealOptions
// GET  /api/preferences          -> null | Preferences
// PUT  /api/preferences          Preferences -> Preferences
// GET  /api/allergens            -> [{ id, label }]
// GET  /api/allergies            -> [{ allergen, label, kind }]
// POST /api/allergies            { allergen_id } or { name } -> the full list
// GET  /api/nutrition-goals      -> null | { calories, protein_g, carbs_g, fat_g }
// PUT  /api/nutrition-goals      the same object -> the same object
// POST /api/shopping-runs        { meals, household_size, budget_cents, mode,
//                                  remember } -> a stream of run events
// POST /api/grocery-lists/{id}/shopping-runs   { mode, remember } -> the same
// GET  /api/grocery-lists/{id}/cart            -> CartView
// POST /api/grocery-lists/{id}/cart/approve    -> CartView
// DELETE /api/grocery-lists/{id}/cart/items/{store}/{upc}
// GET  /api/auto-buy             -> { auto_buy }
// PUT  /api/auto-buy             { auto_buy } -> { auto_buy }
// GET  /api/orders/{id}          -> the run's order, with its summary
//
// The answer of POST /api/meal-options is turned into a plan in mealOptions.js;
// the run events are read in hooks/useShoppingRun.js.

// The planner takes 25 to 35 seconds, so it gets far more than the default.
const PLANNER_TIMEOUT_MS = 90_000

export const requestMealOptions = ({ planDays, mealTypes }) =>
  apiFetch(endpoints.mealOptions, {
    method: 'POST',
    body: { plan_days: planDays, meal_types: mealTypes },
    timeoutMs: PLANNER_TIMEOUT_MS,
  })

export const fetchAllergens = () => apiFetch(endpoints.allergens)
export const fetchAllergies = () => apiFetch(endpoints.allergies)

// Allergies are add-only: there is no route to remove one.
export const addAllergy = (allergy) =>
  apiFetch(endpoints.allergies, { method: 'POST', body: allergy })

export const fetchPreferences = () => apiFetch(endpoints.preferences)
export const savePreferences = (preferences) =>
  apiFetch(endpoints.preferences, { method: 'PUT', body: preferences })

export const fetchNutritionGoals = () => apiFetch(endpoints.nutritionGoals)
export const saveNutritionGoals = (goals) =>
  apiFetch(endpoints.nutritionGoals, { method: 'PUT', body: goals })

// Saves the chosen recipes as a plan with its grocery list and starts the
// buying agent on it. `onEvent` gets each event of the run as it happens; the
// promise resolves when the run's stream ends.
export const startShoppingRun = (
  { meals, householdSize, budgetCents, mode, remember },
  { onEvent, signal } = {},
) =>
  apiStream(endpoints.shoppingRuns, {
    body: {
      meals,
      household_size: householdSize,
      budget_cents: budgetCents,
      mode,
      remember: Boolean(remember),
    },
    onEvent,
    signal,
  })

// Another run on a list that already exists. It shops only for what an
// earlier run has not paid for.
export const continueShoppingRun = (
  listId,
  { mode, remember },
  { onEvent, signal } = {},
) =>
  apiStream(endpoints.listShoppingRuns(listId), {
    body: { mode, remember: Boolean(remember) },
    onEvent,
    signal,
  })

export const fetchCart = (listId) => apiFetch(endpoints.cart(listId))
export const approveCart = (listId) =>
  apiFetch(endpoints.approveCart(listId), { method: 'POST' })
export const removeCartItem = (listId, store, upc) =>
  apiFetch(endpoints.cartItem(listId, store, upc), { method: 'DELETE' })

export const fetchAutoBuy = () => apiFetch(endpoints.autoBuy)
export const saveAutoBuy = (autoBuy) =>
  apiFetch(endpoints.autoBuy, { method: 'PUT', body: { auto_buy: autoBuy } })

export const fetchOrder = (orderId) => apiFetch(endpoints.order(orderId))
