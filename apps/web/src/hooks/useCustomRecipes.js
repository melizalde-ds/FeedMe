import { useContext } from 'react'
import { CustomRecipeContext } from '../contexts/contexts'

export function useCustomRecipes() {
  const context = useContext(CustomRecipeContext)
  if (!context) {
    throw new Error(
      'useCustomRecipes must be used inside a CustomRecipeProvider',
    )
  }
  return context
}
