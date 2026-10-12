import { useMemo } from 'react'
import { MEAL_STATUS } from '../lib/constants'
import { findRecipe, slotServings } from '../lib/planner'
import { useHousehold } from './useHousehold'
import { useMealPlan } from './useMealPlan'

const round = (value) => Math.round(value * 100) / 100

// Requirement 5.5: ingredients aggregated across the confirmed week. Leftover
// slots buy nothing. There are no prices here: real ones come from the stores,
// in the buying agent's cart.
export function useGroceryList() {
  const { plan } = useMealPlan()
  const { preferences } = useHousehold()

  return useMemo(() => {
    const week = plan?.confirmedWeek
    const empty = { items: [], mealCount: 0, week: null }

    if (!plan || week === null || week === undefined) return empty

    const merged = new Map()
    let mealCount = 0

    for (const day of plan.weeks[week]) {
      for (const slot of day) {
        if (!slot.recipe || slot.leftover) continue
        if (slot.status === MEAL_STATUS.REJECTED) continue

        const recipe = findRecipe(plan, slot.recipe)
        if (!recipe) continue

        mealCount += 1
        const servings = slotServings(slot, preferences)

        for (const ingredient of recipe.ingredients) {
          const key = `${ingredient.name.toLowerCase()}|${ingredient.unit}`
          const existing = merged.get(key)

          // Planner recipes give names only, so their items carry no amount.
          // A user's own recipe gives one, scaled to the people eating.
          const amount =
            ingredient.quantity == null ? null : ingredient.quantity * servings

          if (existing) {
            existing.usedIn.add(recipe.name)
            if (amount !== null && existing.quantity !== null) {
              existing.quantity = round(existing.quantity + amount)
            }
          } else {
            merged.set(key, {
              key,
              name: ingredient.name,
              unit: amount === null ? '' : ingredient.unit,
              quantity: amount === null ? null : round(amount),
              usedIn: new Set([recipe.name]),
            })
          }
        }
      }
    }

    const items = [...merged.values()]
      .map((item) => ({ ...item, usedIn: [...item.usedIn] }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return { items, mealCount, week }
  }, [plan, preferences])
}
