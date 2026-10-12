import { useContext } from 'react'
import { ShoppingRunContext } from '../contexts/contexts'

export function useShoppingRun() {
  const context = useContext(ShoppingRunContext)
  if (!context) {
    throw new Error('useShoppingRun must be used inside a ShoppingRunProvider')
  }
  return context
}
