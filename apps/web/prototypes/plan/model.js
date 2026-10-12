// State for the Plan prototypes. All three directions render from this one
// model, so what differs between them is design only.
//
// The plan is the planner fixture (real rows of the recipe dataset) run
// through the app's own mapping and checks in src/lib. Nothing here talks to
// the server: "Remake the plan" replays the fixture after a short wait.

import { useCallback, useEffect, useMemo, useState } from 'react'
import answer from './meal-options.json'
import {
  CUSTOM_RECIPE_SOURCE,
  MEAL_SLOTS,
  MEAL_STATUS,
  SLOT_LABELS,
  WEEK_DAYS,
  cookingTimeLabel,
} from '../../src/lib/constants.js'
import { allergenConflicts } from '../../src/lib/allergySafety.js'
import { recipeProblems } from '../../src/lib/mealFilters.js'
import { planFromMealOptions } from '../../src/lib/mealOptions.js'
import {
  alternativesFor,
  closestAlternative,
  dayIssues,
  dayNutrition,
  decodeSlotValue,
  emptySlot,
  encodeSlotValue,
  findRecipe,
  isWeekEmpty,
  plannedDayCount,
  slotOptions,
  slotServings,
} from '../../src/lib/planner.js'

export { MEAL_SLOTS, MEAL_STATUS, SLOT_LABELS, WEEK_DAYS }

export const PREFS = {
  householdSize: 3,
  planningPeriod: 5,
  budget: 120,
  cookingTime: 30,
  allergies: ['Tree nuts'],
  dietaryRestrictions: [],
  foodPreferences: 'chicken',
  nutritionGoals: { calories: 2000, protein: 100, carbs: 250, fat: 67 },
}

// Two recipes "the user" wrote, the same two the regression scripts type in.
// The second contains a household allergen, so picking it shows the conflict
// state in every direction.
const OWN_RECIPES = [
  {
    name: 'Sunday Beef Chili',
    slots: ['lunch', 'dinner'],
    cookTimeMinutes: 30,
    allergens: ['Milk'],
    tags: [],
    nutritionPerServing: { calories: 550, protein: 35, carbs: 45, fat: 22.5 },
    nutritionSource: 'Entered by you, not verified',
    ingredients: [
      { name: 'Ground beef', quantity: 0.25, unit: 'lb', cost: 1.63 },
      { name: 'Cheddar cheese', quantity: 2, unit: 'oz', cost: 0.81 },
    ],
    instructions: [
      'Brown the beef.',
      'Add everything else and simmer for 20 minutes.',
      'Top with the cheese.',
    ],
    source: CUSTOM_RECIPE_SOURCE,
    enteredFor: 4,
  },
  {
    name: 'Almond Oat Bowl',
    slots: ['breakfast'],
    cookTimeMinutes: 10,
    allergens: ['Tree nuts'],
    tags: [],
    nutritionPerServing: { calories: 400, protein: 15, carbs: 50, fat: 15 },
    nutritionSource: 'Entered by you, not verified',
    ingredients: [{ name: 'Almonds', quantity: 1, unit: 'oz', cost: 0.75 }],
    instructions: ['Soak the oats.', 'Top with the almonds.'],
    source: CUSTOM_RECIPE_SOURCE,
    enteredFor: 2,
  },
]

function buildPlan() {
  const plan = planFromMealOptions(answer, PREFS, OWN_RECIPES)
  const weeks = plan.weeks
  // Friday dinner is one of the user's own, to show how those read.
  weeks[0][4][2] = { ...emptySlot(), recipe: 'Sunday Beef Chili' }
  return { ...plan, weeks, recipes: [...plan.recipes, ...OWN_RECIPES] }
}

const cloneWeeks = (weeks) =>
  weeks.map((week) => week.map((day) => day.map((slot) => ({ ...slot }))))

export const isOwn = (recipe) => recipe?.source === CUSTOM_RECIPE_SOURCE

// One decimal at most: 27.2, never 27.200000000000003.
export const grams = (value) =>
  value == null ? '—' : `${Math.round(value * 10) / 10}`
export const kcal = (value) =>
  value == null ? '—' : Math.round(value).toLocaleString()
export const percent = (value, goal) =>
  goal ? Math.round((value / goal) * 100) : null

export const setupSummary = () => ({
  people: `${PREFS.householdSize} people`,
  days: `${PREFS.planningPeriod} days`,
  budget: PREFS.budget > 0 ? `$${PREFS.budget} to spend` : 'no spending limit',
  time: cookingTimeLabel(PREFS.cookingTime),
  avoiding: PREFS.allergies,
  diets: PREFS.dietaryRestrictions,
})

// What a day's Check says: the problems to fix, or that it is fine, plus how
// the day's figures sit against the goals once all three meals are planned.
function dayView(plan, week, day) {
  const issues = dayIssues(plan, week, day, PREFS)
  const nutrition = dayNutrition(plan, week, day)
  const goals = PREFS.nutritionGoals
  const complete = nutrition.filled === MEAL_SLOTS.length

  const notes = []
  if (complete && goals.calories) {
    if (nutrition.calories < goals.calories * 0.8) notes.push('below your calorie goal')
    else if (nutrition.calories > goals.calories * 1.2) notes.push('above your calorie goal')
  }
  if (complete && goals.protein && nutrition.protein < goals.protein * 0.8) {
    notes.push('short on protein')
  }

  return {
    index: day,
    name: WEEK_DAYS[day],
    issues,
    notes,
    filled: nutrition.filled,
    calories: nutrition.calories,
    protein: nutrition.protein,
    status: issues.length ? 'problem' : nutrition.filled ? 'ok' : 'empty',
    slots: plan.weeks[week][day].map((slot, slotIndex) => {
      const recipe = findRecipe(plan, slot.recipe)
      return {
        slot,
        slotIndex,
        day,
        mealType: MEAL_SLOTS[slotIndex],
        label: `${SLOT_LABELS[MEAL_SLOTS[slotIndex]]} on ${WEEK_DAYS[day]}`,
        recipe,
        problems: recipe ? recipeProblems(recipe, PREFS) : [],
        servings: slotServings(slot, PREFS),
      }
    }),
  }
}

function weekSummary(plan, week, days) {
  const planned = plannedDayCount(plan, week)
  const divisor = Math.max(planned, 1)
  let carbs = 0
  let fat = 0
  for (const day of plan.weeks[week]) {
    for (const slot of day) {
      const recipe = findRecipe(plan, slot.recipe)
      carbs += recipe?.nutritionPerServing?.carbs ?? 0
      fat += recipe?.nutritionPerServing?.fat ?? 0
    }
  }
  const total = (key) => days.reduce((sum, day) => sum + day[key], 0)

  return {
    plannedDays: planned,
    filledSlots: total('filled'),
    totalSlots: 7 * MEAL_SLOTS.length,
    calories: Math.round(total('calories') / divisor),
    protein: Math.round(total('protein') / divisor),
    carbs: Math.round(carbs / divisor),
    fat: Math.round(fat / divisor),
    calorieGoal: PREFS.nutritionGoals.calories,
    proteinGoal: PREFS.nutritionGoals.protein,
    problemDays: days.filter((day) => day.issues.length).map((day) => day.name),
  }
}

export function useTheme() {
  const [choice, setChoice] = useState('system')
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const order = ['system', 'light', 'dark']
  const next = order[(order.indexOf(choice) + 1) % order.length]
  const names = { system: 'following your system', light: 'light', dark: 'dark' }

  return {
    choice,
    resolved: choice === 'system' ? (systemDark ? 'dark' : 'light') : choice,
    label: `Theme: ${names[choice]}. Switch to ${names[next]}.`,
    cycle: () => setChoice(next),
  }
}

export function usePlanModel() {
  const [plan, setPlan] = useState(buildPlan)
  const [week, setWeekIndex] = useState(0)
  const [view, setView] = useState('plan')
  const [status, setStatus] = useState('idle')
  const [note, setNote] = useState(null)
  const [selected, setSelected] = useState(null)

  const days = useMemo(
    () => WEEK_DAYS.map((_, day) => dayView(plan, week, day)),
    [plan, week],
  )
  const summary = useMemo(() => weekSummary(plan, week, days), [plan, week, days])

  const say = (text, undo = null) => setNote({ text, undo })
  // Stable, because the recipe views hang their focus handling on it.
  const close = useCallback(() => setSelected(null), [])

  const editSlot = useCallback((day, slotIndex, change) => {
    setPlan((current) => {
      const weeks = cloneWeeks(current.weeks)
      change(weeks, weeks[week][day][slotIndex])
      return { ...current, weeks }
    })
  }, [week])

  // Mirrors MealPlanProvider.setSlot: a changed dinner carries tomorrow's
  // leftovers with it.
  const setSlot = (day, slotIndex, value) => {
    const { recipe, leftover } = decodeSlotValue(value)
    setPlan((current) => {
      const weeks = cloneWeeks(current.weeks)
      const target = weeks[week][day][slotIndex]
      const previous = target.recipe
      weeks[week][day][slotIndex] = {
        ...emptySlot(),
        recipe: recipe ?? null,
        leftover: Boolean(recipe) && Boolean(leftover),
        servings: target.servings,
      }
      if (slotIndex === 2 && day < 6) {
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
    setNote(null)
  }

  const suggestAnother = (day, slotIndex) => {
    const slot = plan.weeks[week][day][slotIndex]
    if (!slot.recipe) return
    const used = plan.weeks[week]
      .flat()
      .filter((cell) => cell.recipe && !cell.leftover)
      .map((cell) => cell.recipe)
    const alternative = closestAlternative(plan, slot.recipe, slotIndex, PREFS, used)
    if (!alternative) {
      say(`No other ${MEAL_SLOTS[slotIndex]} option fits your allergies and diet. Build the plan again for new ones.`)
      return
    }
    editSlot(day, slotIndex, (weeks) => {
      weeks[week][day][slotIndex] = {
        ...weeks[week][day][slotIndex],
        recipe: alternative.name,
        leftover: false,
        status: MEAL_STATUS.PENDING,
        saved: false,
      }
    })
    say(`Swapped ${slot.recipe} for ${alternative.name}.`)
  }

  const clearWeek = () => {
    const before = cloneWeeks(plan.weeks)
    setPlan((current) => {
      const weeks = cloneWeeks(current.weeks)
      weeks[week] = weeks[week].map(() => MEAL_SLOTS.map(() => emptySlot()))
      return {
        ...current,
        weeks,
        confirmedWeek: current.confirmedWeek === week ? null : current.confirmedWeek,
      }
    })
    setSelected(null)
    say(`Week ${week + 1} was cleared.`, {
      label: `Undo the change to Week ${week + 1}`,
      run: () => {
        setPlan((current) => ({ ...current, weeks: before }))
        say(`Week ${week + 1} is back the way it was.`)
      },
    })
  }

  const confirmWeek = () => {
    setPlan((current) => {
      const weeks = cloneWeeks(current.weeks)
      weeks[week] = weeks[week].map((day) =>
        day.map((slot) =>
          slot.recipe && slot.status === MEAL_STATUS.PENDING
            ? { ...slot, status: MEAL_STATUS.ACCEPTED }
            : slot,
        ),
      )
      return { ...current, weeks, confirmedWeek: week }
    })
    say(`Week ${week + 1} is confirmed. Your grocery list is ready in the Grocery step.`)
  }

  const remake = () => {
    if (status === 'loading') return
    setStatus('loading')
    setNote(null)
    setSelected(null)
    window.setTimeout(() => {
      setPlan(buildPlan())
      setWeekIndex(0)
      setStatus('idle')
      say(`Plan built for ${PREFS.householdSize} people over ${PREFS.planningPeriod} days. Every meal avoids ${PREFS.allergies.join(', ')}.`)
    }, 2600)
  }

  // Everything a recipe view needs about the selected meal.
  const detail = useMemo(() => {
    if (!selected) return null
    const cell = days[selected.day].slots[selected.slotIndex]
    const { options, leftovers } = slotOptions(plan, week, selected.day, selected.slotIndex, PREFS)
    return {
      ...cell,
      value: encodeSlotValue(cell.slot.recipe, cell.slot.leftover),
      options,
      leftovers,
      conflicts: cell.recipe ? allergenConflicts(cell.recipe, PREFS.allergies) : [],
      alternatives: cell.recipe
        ? alternativesFor(plan, cell.recipe.name, selected.slotIndex, PREFS)
        : [],
      dayName: WEEK_DAYS[selected.day],
    }
  }, [days, plan, selected, week])

  return {
    plan,
    week,
    view,
    status,
    note,
    days,
    summary,
    selected,
    detail,
    loading: status === 'loading',
    empty: isWeekEmpty(plan, week),
    confirmed: plan.confirmedWeek === week,
    groceryReady: plan.confirmedWeek !== null && plan.confirmedWeek !== undefined,
    warnings: plan.warnings ?? [],
    weekNote: (index) =>
      isWeekEmpty(plan, index) ? 'not planned' : index === 0 ? 'this week' : 'next week',
    optionsFor: (day, slotIndex) => ({
      ...slotOptions(plan, week, day, slotIndex, PREFS),
      value: encodeSlotValue(
        plan.weeks[week][day][slotIndex].recipe,
        plan.weeks[week][day][slotIndex].leftover,
      ),
    }),
    setView,
    setWeek: (index) => {
      setWeekIndex(index)
      setSelected(null)
      setNote(null)
    },
    select: (day, slotIndex) => setSelected({ day, slotIndex }),
    close,
    dismissNote: () => setNote(null),
    setSlot,
    setServings: (day, slotIndex, value) =>
      editSlot(day, slotIndex, (_, slot) => {
        slot.servings = value === '' ? null : Number(value)
      }),
    accept: (day, slotIndex) =>
      editSlot(day, slotIndex, (_, slot) => {
        slot.status = MEAL_STATUS.ACCEPTED
      }),
    reject: (day, slotIndex) =>
      editSlot(day, slotIndex, (_, slot) => {
        slot.status = MEAL_STATUS.REJECTED
      }),
    toggleSaved: (day, slotIndex) =>
      editSlot(day, slotIndex, (_, slot) => {
        slot.saved = !slot.saved
      }),
    useAlternative: (day, slotIndex, name) =>
      setSlot(day, slotIndex, encodeSlotValue(name, false)),
    suggestAnother,
    clearWeek,
    confirmWeek,
    remake,
  }
}
