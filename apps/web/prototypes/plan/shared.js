// Copy and behaviour the three directions share. Nothing here has a look.
import { useEffect, useRef } from 'react'
import { isOwn } from './model.js'

export const ACCOUNT_EMAIL = 'you@example.com'

export const PLAN_BUILDING =
  'Saving your setup, then choosing meals and checking each one against your allergies and diet. This takes about half a minute.'

export const PLANNER_NOTE =
  'Chosen by the FeedMe planner and checked against your allergies and diet. Nutrition is per serving as the recipe gives it, an estimate that is not verified. The recipe has no amounts or prices.'

export const OWN_NOTE =
  'Your own recipe. The nutrition, allergens and prices are the values you entered and have not been verified.'

export const SAFETY = [
  'Nutrition figures are estimates, as the recipes give them. They are not medical data.',
  'Allergy filtering is a starting point, not a guarantee. Read every product label yourself, including for ingredient substitutions.',
  'Nothing here is medical or dietary advice. Confirm anything safety-critical with a qualified professional.',
]

export const HOW_TO = [
  'Pick a recipe or a Leftovers option for any meal. Leftovers come from a meal cooked earlier in the plan.',
  'Each meal is planned for your household. Open a meal to cook it for a different number of people.',
  '“Remake the plan” asks the planner for new meals for the whole planning period. It takes about half a minute.',
  'Change an allergy or diet in Setup and unsafe meals are swapped automatically, with a note telling you what moved.',
  'Your own recipes show up wherever they fit, marked “yours”.',
]

export const mealMeta = (recipe) => {
  if (!recipe) return ''
  const nutrition = recipe.nutritionPerServing
  return [
    recipe.cookTimeMinutes == null ? null : `${recipe.cookTimeMinutes} min`,
    nutrition?.calories == null ? null : `${Math.round(nutrition.calories)} kcal`,
  ]
    .filter(Boolean)
    .join(' · ')
}

export const mealName = (cell) =>
  !cell.recipe ? null : cell.slot.leftover ? `Leftovers: ${cell.recipe.name}` : cell.recipe.name

// A recipe view that opens beside or over the plan: focus moves into it,
// Escape closes it, and focus goes back to the meal it was opened from.
export function useRecipeFocus(open, onClose) {
  const panel = useRef(null)
  const opener = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    opener.current = document.activeElement
    panel.current?.focus({ preventScroll: true })
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
    }
  }, [open, onClose])

  return panel
}

export const recipeNote = (recipe) => (isOwn(recipe) ? OWN_NOTE : PLANNER_NOTE)

export const nutritionHeading = (recipe) =>
  `Nutrition per serving (${isOwn(recipe) ? 'yours' : 'estimated'})`
