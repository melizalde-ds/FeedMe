// What the buying agent is asked to shop for, and how its answers are worded.
//
// The agent buys from the recipe collection's own ingredient lists, so it can
// only shop for meals the planner chose: each of those carries the recipe's id.
// A recipe the user wrote has no id there, and is left for the user to buy.

import { CURRENT_WEEK, MEAL_SLOTS, MEAL_STATUS } from './constants.js'
import { findRecipe } from './planner.js'

const DAYS_PER_WEEK = 7

export const SHOPPING_MODES = [
  {
    value: 'manual',
    label: 'Let me check everything',
    detail: 'Every product the agent picks is marked for your review.',
  },
  {
    value: 'auto',
    label: 'Buy it for me',
    detail:
      'Products go straight into the cart. Only the doubtful ones are marked for review: store brands, unsure matches and anything over your budget.',
  },
]

const recipeIdOf = (recipe) =>
  /^\d+$/.test(String(recipe?.recipeId ?? '')) ? Number(recipe.recipeId) : null

// The meals of the confirmed week the agent can shop for, and the names of the
// ones it can't. Leftovers and rejected meals buy nothing.
export function mealsToBuy(plan) {
  const week = plan?.confirmedWeek
  const meals = []
  const ownRecipes = new Set()

  if (week === null || week === undefined) return { meals, ownRecipes: [] }

  plan.weeks[week].forEach((day, dayIndex) => {
    day.forEach((slot, slotIndex) => {
      if (!slot.recipe || slot.leftover) return
      if (slot.status === MEAL_STATUS.REJECTED) return

      const recipe = findRecipe(plan, slot.recipe)
      if (!recipe) return

      const recipeId = recipeIdOf(recipe)
      if (recipeId === null) {
        ownRecipes.add(recipe.name)
        return
      }

      meals.push({
        recipe_id: recipeId,
        day_index: (week - CURRENT_WEEK) * DAYS_PER_WEEK + dayIndex,
        meal_type: MEAL_SLOTS[slotIndex],
      })
    })
  })

  return { meals, ownRecipes: [...ownRecipes] }
}

// Two runs with the same signature shop for the same meals, so the second one
// carries on with the first one's grocery list instead of starting a new one.
export const mealsSignature = (meals) =>
  JSON.stringify(meals.map((meal) => [meal.recipe_id, meal.day_index, meal.meal_type]))

// The Setup budget is in dollars for the plan; the agent takes cents. No
// budget is sent as none, not as zero.
export function budgetCents(preferences) {
  const budget = Number(preferences?.budget) || 0
  return budget > 0 ? Math.round(budget * 100) : null
}

export const money = (cents) => `$${((Number(cents) || 0) / 100).toFixed(2)}`

// 'whole-foods' -> 'Whole Foods'
export const storeName = (slug) =>
  String(slug ?? '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')

export const HOLD_REASONS = {
  store_brand: 'store brand, not the national one',
  out_of_stock_replacement: 'stands in for something cheaper that is out of stock',
  over_budget: 'would go over your budget',
  unsure_match: 'may not be what the recipe means',
  large_quantity: 'more packs than usual',
  unknown_quantity: 'amount not known, one pack assumed',
}

// The one line shown while the agent works, from the tool it just called.
export function statusForTool(name, args = {}) {
  switch (name) {
    case 'list_stores':
      return 'Checking which stores are open…'
    case 'search_list':
      return 'Searching every store for everything on your list…'
    case 'search_products':
      return args.query
        ? `Looking for ${args.query}…`
        : 'Looking for each ingredient in the stores…'
    case 'compare_prices':
      return 'Comparing prices across the stores…'
    case 'plan_basket':
      return 'Working out the cheapest basket…'
    case 'add_to_cart':
      return 'Adding products to the cart…'
    case 'remove_from_cart':
      return 'Taking a product back out of the cart…'
    case 'view_cart':
      return 'Checking the cart…'
    case 'checkout':
      return 'Asking the stores for payment…'
    default:
      return 'Shopping…'
  }
}

// How a finished run ended, from its saved order.
export function orderOutcome(order) {
  switch (order?.status) {
    case 'placed':
      return 'paid'
    case 'unpaid':
      return 'unpaid'
    case 'failed':
    case 'cancelled':
      return 'failed'
    case 'pending':
    case 'shopping':
      return 'running'
    default:
      return 'unknown'
  }
}
