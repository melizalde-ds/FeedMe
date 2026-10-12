import { useCallback, useMemo, useState } from 'react'
import { CURRENT_WEEK, MEAL_SLOTS, MEAL_STATUS } from '../lib/constants'
import { requestMealOptions } from '../lib/api'
import {
  mergeCustomRecipes,
  withoutCustomRecipes,
} from '../lib/customRecipes'
import { planFromMealOptions } from '../lib/mealOptions'
import { slotKey } from '../lib/slotKey'
import {
  closestAlternative,
  createEmptyPlan,
  emptySlot,
  resyncPlan,
} from '../lib/planner'
import { useAccountSetup } from '../hooks/useAccountSetup'
import { useCustomRecipes } from '../hooks/useCustomRecipes'
import { useHousehold } from '../hooks/useHousehold'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { MealPlanContext } from './contexts'

const DAYS_PER_WEEK = 7

const PLANNER_UNAVAILABLE =
  'The planner is unavailable right now. Try again in a few minutes.'

const NO_RECIPE_FITS =
  'No recipe fits your household’s allergies and diet. Try removing a diet style or a disliked food in Setup, then build the plan again.'

const ALLERGIES_NOT_SAVED =
  'Your new allergies could not be saved to your account, so the planner can’t see them yet. Try again in a moment.'

const SETUP_NOT_SAVED =
  'Your setup could not be saved to your account, and the planner reads it from there. Try again in a moment.'

const cloneWeeks = (weeks) =>
  weeks.map((week) => week.map((day) => day.map((slot) => ({ ...slot }))))

// The meals that differ between two versions of the plan.
function changedSlots(before, after) {
  const keys = []
  after.forEach((week, w) =>
    week.forEach((day, d) =>
      day.forEach((slot, s) => {
        const was = before[w][d][s]
        if (was.recipe !== slot.recipe || was.leftover !== slot.leftover) {
          keys.push(slotKey(w, d, s))
        }
      }),
    ),
  )
  return keys
}

// Only these inputs can make an existing meal unsafe or non-compliant, so only
// these trigger an automatic re-check of the plan. Editing or deleting one of
// the user's own recipes counts: it can take a meal out of the catalog, or
// change what the meal contains.
const safetySignature = (preferences, customRecipes) =>
  JSON.stringify([
    preferences.allergies,
    preferences.dietaryRestrictions,
    preferences.foodPreferences,
    customRecipes.map((recipe) => [
      recipe.name,
      recipe.allergens,
      recipe.tags,
      recipe.slots,
      (recipe.ingredients ?? []).map((ingredient) => ingredient.name),
    ]),
  ])

const listOf = (items, limit = 3) => {
  if (items.length <= limit) return items.join(', ')
  return `${items.slice(0, limit).join(', ')}, and ${items.length - limit} more`
}

function describeResync(changes) {
  const swapped = [
    ...new Map(
      changes
        .filter((change) => change.to)
        .map((change) => [`${change.from}>${change.to}`, change]),
    ).values(),
  ]
  const cleared = [
    ...new Set(changes.filter((change) => !change.to).map((change) => change.from)),
  ]

  const parts = []
  if (swapped.length) {
    parts.push(
      `swapped ${listOf(swapped.map((change) => `${change.from} for ${change.to}`))}`,
    )
  }
  if (cleared.length) {
    parts.push(
      `cleared ${listOf(cleared)} because no compliant replacement was available`,
    )
  }

  return `Your setup or your recipes changed, so we ${parts.join(' and ')}. Check the plan before you shop.`
}

function describePlan(preferences) {
  const avoided = preferences.allergies ?? []
  const people = Math.max(1, Number(preferences.householdSize) || 1)

  return `Plan built for ${people} ${people === 1 ? 'person' : 'people'} over ${
    preferences.planningPeriod
  } days. Every meal avoids ${
    avoided.length ? listOf(avoided, 5) : 'nothing in particular'
  }.`
}

// The plan is kept under the signed-in user's own key; the parent remounts
// this provider when the user changes.
export function MealPlanProvider({ children, storageKey }) {
  const { preferences } = useHousehold()
  const { customRecipes } = useCustomRecipes()
  const account = useAccountSetup()
  // There is always a plan object, so the screens never have to ask whether
  // one exists. An untouched plan is simply one with every week empty.
  const [storedPlan, setStoredPlan] = useLocalStorage(storageKey, createEmptyPlan)

  // Requirement 5.8: the user's own recipes are layered over whatever catalog
  // the plan was built with, so a recipe submitted after the plan exists is
  // immediately offered for every slot without rebuilding anything. They are
  // stripped again on the way back to storage, so the recipe book stays the one
  // place they live and an edit or a delete is never shadowed by a stale copy.
  const plan = useMemo(
    () => ({
      ...storedPlan,
      recipes: mergeCustomRecipes(storedPlan.recipes, customRecipes),
    }),
    [storedPlan, customRecipes],
  )

  const setPlan = useCallback(
    (next) =>
      setStoredPlan((current) => {
        const withCustom = {
          ...current,
          recipes: mergeCustomRecipes(current.recipes, customRecipes),
        }
        const resolved = typeof next === 'function' ? next(withCustom) : next
        if (!resolved) return current
        return { ...resolved, recipes: withoutCustomRecipes(resolved.recipes) }
      }),
    [customRecipes, setStoredPlan],
  )

  const [currentWeek, setCurrentWeek] = useState(CURRENT_WEEK)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [note, setNote] = useState('')
  // The meals the last change touched, as slotKey()s, so the Plan view can
  // keep them marked until the note about that change is dismissed.
  const [highlight, setHighlight] = useState(null)
  const [undoSnapshot, setUndoSnapshot] = useState(null)
  // Alternatives are chosen from the plan's own catalog, so no slot waits.
  const busySlot = null

  const clearTransient = useCallback(() => {
    setNote('')
    setHighlight(null)
    setUndoSnapshot(null)
  }, [])

  // Requirement 5.3: a safety-relevant preference change re-checks the plan and
  // swaps anything that is no longer allowed. This is React's documented
  // adjust-state-during-render pattern rather than an effect, so the corrected
  // plan is part of the same render the new preferences arrive in.
  const [lastSignature, setLastSignature] = useState(() =>
    safetySignature(preferences, customRecipes),
  )
  const signature = safetySignature(preferences, customRecipes)

  if (signature !== lastSignature) {
    setLastSignature(signature)

    const result = resyncPlan(plan, preferences)
    if (result.changes.length) {
      setPlan(result.plan)
      setNote(describeResync(result.changes))
      setHighlight(changedSlots(plan.weeks, result.plan.weeks))
      setUndoSnapshot(null)
    }
  }

  // Saves Setup, then asks the planner, which reads the saved Setup on the
  // server and takes about half a minute. Every call is a fresh run: meals the
  // household was shown in the last two weeks are left out, so building again
  // gives different ones.
  const generatePlan = useCallback(async () => {
    setStatus('loading')
    setError(null)
    clearTransient()

    const saved = await account.saveSetup()

    if (saved.invalid) {
      setError('Fix the fields marked in Setup, then build the plan again.')
      setStatus('error')
      return
    }
    if (!saved.allergiesSaved) {
      setError(ALLERGIES_NOT_SAVED)
      setStatus('error')
      return
    }
    if (!saved.ok) {
      setError(SETUP_NOT_SAVED)
      setStatus('error')
      return
    }

    try {
      const answer = await requestMealOptions({
        planDays: Number(preferences.planningPeriod) || DAYS_PER_WEEK,
        mealTypes: MEAL_SLOTS,
      })
      setPlan(planFromMealOptions(answer, preferences, customRecipes))
      setCurrentWeek(CURRENT_WEEK)
      setNote(describePlan(preferences))
      setStatus('ready')
    } catch (requestError) {
      if (requestError.status === 422) setError(NO_RECIPE_FITS)
      else if (requestError.kind === 'unavailable') setError(PLANNER_UNAVAILABLE)
      else setError(requestError.message)
      setStatus('error')
    }
  }, [account, clearTransient, customRecipes, preferences, setPlan])

  const clearWeek = useCallback(
    (week) => {
      if (!plan) return

      const weeks = cloneWeeks(plan.weeks)
      setUndoSnapshot({ week, days: weeks[week] })
      weeks[week] = weeks[week].map(() => MEAL_SLOTS.map(() => emptySlot()))

      setPlan({
        ...plan,
        weeks,
        confirmedWeek: plan.confirmedWeek === week ? null : plan.confirmedWeek,
      })
      setHighlight(null)
      setNote(`Week ${week + 1} was cleared.`)
    },
    [plan, setPlan],
  )

  const setSlot = useCallback(
    (week, day, slotIndex, { recipe, leftover }) => {
      setPlan((current) => {
        if (!current) return current

        const weeks = cloneWeeks(current.weeks)
        const target = weeks[week][day][slotIndex]
        const previous = target.recipe

        weeks[week][day][slotIndex] = {
          ...emptySlot(),
          recipe: recipe ?? null,
          leftover: Boolean(recipe) && Boolean(leftover),
          servings: target.servings,
        }

        // Changing a dinner should carry tomorrow's leftovers with it rather
        // than leaving a slot pointing at a meal nobody cooked.
        if (slotIndex === 2 && day < DAYS_PER_WEEK - 1) {
          const next = weeks[week][day + 1][1]
          const cooked = Boolean(recipe) && !leftover

          if (previous && next.leftover && next.recipe === previous) {
            next.recipe = cooked ? recipe : null
            next.leftover = cooked
          } else if (!next.recipe && cooked) {
            next.recipe = recipe
            next.leftover = true
          }
        }

        return { ...current, weeks }
      })

      clearTransient()
    },
    [clearTransient, setPlan],
  )

  // Requirement 5.8: a slot stores a recipe by name, so renaming one of the
  // user's own recipes has to carry every slot that was holding it. Without
  // this the plan would be left pointing at a name nothing answers to.
  const renameSlotRecipe = useCallback(
    (from, to) => {
      if (!from || !to || from === to) return

      setPlan((current) => {
        if (!current) return current

        const weeks = cloneWeeks(current.weeks)
        for (const week of weeks) {
          for (const day of week) {
            for (const slot of day) {
              if (slot.recipe === from) slot.recipe = to
            }
          }
        }

        return { ...current, weeks }
      })
    },
    [setPlan],
  )

  const setSlotServings = useCallback(
    (week, day, slotIndex, value) => {
      setPlan((current) => {
        if (!current) return current
        const weeks = cloneWeeks(current.weeks)
        weeks[week][day][slotIndex].servings = value === '' ? null : Number(value)
        return { ...current, weeks }
      })
    },
    [setPlan],
  )

  const updateSlot = useCallback(
    (week, day, slotIndex, updater) =>
      setPlan((current) => {
        if (!current) return current
        const weeks = cloneWeeks(current.weeks)
        weeks[week][day][slotIndex] = updater(weeks[week][day][slotIndex])
        return { ...current, weeks }
      }),
    [setPlan],
  )

  const acceptSlot = useCallback(
    (week, day, slotIndex) =>
      updateSlot(week, day, slotIndex, (slot) => ({
        ...slot,
        status: MEAL_STATUS.ACCEPTED,
      })),
    [updateSlot],
  )

  const rejectSlot = useCallback(
    (week, day, slotIndex) =>
      updateSlot(week, day, slotIndex, (slot) => ({
        ...slot,
        status: MEAL_STATUS.REJECTED,
      })),
    [updateSlot],
  )

  const toggleSavedSlot = useCallback(
    (week, day, slotIndex) =>
      updateSlot(week, day, slotIndex, (slot) => ({
        ...slot,
        saved: !slot.saved,
      })),
    [updateSlot],
  )

  // Requirement 5.4: replace one meal without building the plan again. The
  // choice comes from the plan's own catalog: the planner's other options for
  // that meal type, and the user's own recipes.
  const requestAlternative = useCallback(
    (week, day, slotIndex) => {
      const slot = plan.weeks[week][day][slotIndex]
      if (!slot.recipe) return

      const slotName = MEAL_SLOTS[slotIndex]
      setError(null)

      const excludeNames = plan.weeks[week]
        .flatMap((cells) => cells)
        .filter((cell) => cell.recipe && !cell.leftover)
        .map((cell) => cell.recipe)

      const alternative = closestAlternative(
        plan,
        slot.recipe,
        slotIndex,
        preferences,
        excludeNames,
      )

      if (!alternative) {
        setError(
          `No other ${slotName} option fits your allergies and diet. Build the plan again for new ones.`,
        )
        return
      }

      setPlan((state) => {
        if (!state) return state
        const weeks = cloneWeeks(state.weeks)
        weeks[week][day][slotIndex] = {
          ...weeks[week][day][slotIndex],
          recipe: alternative.name,
          leftover: false,
          status: MEAL_STATUS.PENDING,
          saved: false,
        }
        return { ...state, weeks }
      })
      setNote(`Swapped ${slot.recipe} for ${alternative.name}.`)
      setHighlight([slotKey(week, day, slotIndex)])
    },
    [plan, preferences, setPlan],
  )

  // The grocery step works from the week the user has confirmed, so confirming
  // is what unlocks it.
  const confirmWeek = useCallback(
    (week) => {
      if (!plan) return

      const weeks = cloneWeeks(plan.weeks)
      weeks[week] = weeks[week].map((day) =>
        day.map((slot) =>
          slot.recipe && slot.status === MEAL_STATUS.PENDING
            ? { ...slot, status: MEAL_STATUS.ACCEPTED }
            : slot,
        ),
      )

      setPlan({ ...plan, weeks, confirmedWeek: week })
      setNote(
        `Week ${week + 1} is confirmed. Your grocery list is ready in the Grocery step.`,
      )
      setHighlight(null)
    },
    [plan, setPlan],
  )

  const undo = useCallback(() => {
    if (!undoSnapshot) return

    setPlan((current) => {
      if (!current) return current
      const weeks = cloneWeeks(current.weeks)
      weeks[undoSnapshot.week] = undoSnapshot.days
      return { ...current, weeks }
    })

    setCurrentWeek(undoSnapshot.week)
    setNote(`Week ${undoSnapshot.week + 1} is back the way it was.`)
    setHighlight(null)
    setUndoSnapshot(null)
  }, [setPlan, undoSnapshot])

  const dismissError = useCallback(() => setError(null), [])
  const dismissNote = useCallback(() => {
    setNote('')
    setHighlight(null)
  }, [])

  // The buying agent's last run for this plan: its order, its grocery list
  // and the meals it shopped for. Kept on the plan so a new plan starts clean.
  const recordShoppingRun = useCallback(
    (shopping) => setPlan((current) => ({ ...current, shopping })),
    [setPlan],
  )

  const goToWeek = useCallback((week) => {
    setCurrentWeek(week)
    setNote('')
    setHighlight(null)
  }, [])

  const value = useMemo(
    () => ({
      plan,
      currentWeek,
      status,
      error,
      note,
      highlight,
      busySlot,
      canUndo: Boolean(undoSnapshot),
      undoWeek: undoSnapshot?.week ?? null,
      generatePlan,
      clearWeek,
      setSlot,
      setSlotServings,
      renameSlotRecipe,
      acceptSlot,
      rejectSlot,
      toggleSavedSlot,
      requestAlternative,
      confirmWeek,
      recordShoppingRun,
      undo,
      dismissError,
      dismissNote,
      goToWeek,
    }),
    [
      plan,
      currentWeek,
      status,
      error,
      note,
      highlight,
      busySlot,
      undoSnapshot,
      generatePlan,
      clearWeek,
      setSlot,
      setSlotServings,
      renameSlotRecipe,
      acceptSlot,
      rejectSlot,
      toggleSavedSlot,
      requestAlternative,
      confirmWeek,
      recordShoppingRun,
      undo,
      dismissError,
      dismissNote,
      goToWeek,
    ],
  )

  return (
    <MealPlanContext.Provider value={value}>{children}</MealPlanContext.Provider>
  )
}
