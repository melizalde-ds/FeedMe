export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner']

export const SLOT_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

export const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

// The longest planning period is 14 days, so a plan is at most two weeks.
export const WEEKS_IN_PLAN = 2

// The week a new plan starts in.
export const CURRENT_WEEK = 0

// Requirement 5.3: the same meal must not reappear within this many days.
export const COOL_OFF_DAYS = 2

export const COMMON_ALLERGENS = [
  'Peanuts',
  'Tree nuts',
  'Milk',
  'Eggs',
  'Wheat/Gluten',
  'Soy',
  'Fish',
  'Shellfish',
  'Sesame',
]

export const DIETARY_RESTRICTIONS = [
  'Vegetarian',
  'Vegan',
  'Pescatarian',
  'Halal',
  'Kosher',
  'Low-carb',
  'Dairy-free',
  'Gluten-free',
]

export const COOKING_TIME_OPTIONS = [
  { label: 'Under 15 min', value: 15 },
  { label: 'Under 30 min', value: 30 },
  { label: 'Under 45 min', value: 45 },
  { label: 'Under 60 min', value: 60 },
  { label: 'Any time', value: 0 },
]

export const PLANNING_PERIOD_OPTIONS = [
  { label: '3 days', value: 3 },
  { label: '5 days', value: 5 },
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
]

// Marks a recipe the user typed in themselves, as opposed to one from the
// planner service ('planner').
export const CUSTOM_RECIPE_SOURCE = 'custom'

// Requirement 5.8: a user-submitted recipe carries its own macro values, so we
// record where those numbers came from.
export const DEFAULT_CUSTOM_NUTRITION_SOURCE = 'Entered by you, not verified'

export const MEAL_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
}

export const DEFAULT_PREFERENCES = {
  householdSize: 2,
  allergies: [],
  dietaryRestrictions: [],
  foodPreferences: '',
  nutritionGoals: {
    calories: 2000,
    protein: 100,
  },
  budget: 100,
  cookingTime: 30,
  planningPeriod: 5,
}

export const cookingTimeLabel = (value) =>
  COOKING_TIME_OPTIONS.find((option) => option.value === Number(value))?.label ??
  'Any time'
