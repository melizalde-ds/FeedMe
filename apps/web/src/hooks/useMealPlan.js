import { useContext } from 'react'
import { MealPlanContext } from '../contexts/contexts'

export function useMealPlan() {
  const context = useContext(MealPlanContext)
  if (!context) {
    throw new Error('useMealPlan must be used inside a MealPlanProvider')
  }
  return context
}
