// How one meal of the plan is named when it is marked as changed: the
// MealPlanProvider sets these, and the Plan view reads them.
export const slotKey = (week, day, slotIndex) => `${week}-${day}-${slotIndex}`
