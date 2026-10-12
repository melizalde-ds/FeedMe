import { useContext } from 'react'
import { HouseholdContext } from '../contexts/contexts'

export function useHousehold() {
  const context = useContext(HouseholdContext)
  if (!context) {
    throw new Error('useHousehold must be used inside a HouseholdProvider')
  }
  return context
}
