import { useMemo } from 'react'
import { MEAL_SLOTS, WEEK_DAYS } from '../lib/constants'
import {
  dayIssues,
  dayNutrition,
  findRecipe,
  plannedDayCount,
} from '../lib/planner'
import { useHousehold } from './useHousehold'
import { useMealPlan } from './useMealPlan'

// Requirement 5.3: aggregated nutrition for the week on screen, measured
// against the user's goals.
export function usePlanSummary(week) {
  const { plan } = useMealPlan()
  const { preferences } = useHousehold()

  return useMemo(() => {
    const calorieGoal = Number(preferences.nutritionGoals?.calories) || 0
    const proteinGoal = Number(preferences.nutritionGoals?.protein) || 0
    const servings = Math.max(1, Number(preferences.householdSize) || 1)

    const days = plan.weeks[week]
    const plannedDays = plannedDayCount(plan, week)

    let calories = 0
    let protein = 0
    let carbs = 0
    let fat = 0
    let filledSlots = 0
    let savedCount = 0
    const problemDays = []

    days.forEach((day, dayIndex) => {
      const nutrition = dayNutrition(plan, week, dayIndex)
      calories += nutrition.calories
      protein += nutrition.protein
      filledSlots += nutrition.filled

      for (const slot of day) {
        if (slot.saved) savedCount += 1
        const recipe = findRecipe(plan, slot.recipe)
        if (!recipe?.nutritionPerServing) continue
        carbs += recipe.nutritionPerServing.carbs ?? 0
        fat += recipe.nutritionPerServing.fat ?? 0
      }

      if (dayIssues(plan, week, dayIndex, preferences).length) {
        problemDays.push(WEEK_DAYS[dayIndex])
      }
    })

    // Macros are stored per serving, so dividing by the planned days gives one
    // person's daily intake.
    const divisor = Math.max(plannedDays, 1)

    return {
      plannedDays,
      filledSlots,
      totalSlots: days.length * MEAL_SLOTS.length,
      calories: Math.round(calories / divisor),
      protein: Math.round(protein / divisor),
      carbs: Math.round(carbs / divisor),
      fat: Math.round(fat / divisor),
      calorieGoal,
      proteinGoal,
      servings,
      problemDays,
      savedCount,
      warnings: plan.warnings ?? [],
      source: plan.source ?? null,
    }
  }, [plan, preferences, week])
}
