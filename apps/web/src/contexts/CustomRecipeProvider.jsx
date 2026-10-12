import { useCallback, useMemo } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { CustomRecipeContext } from './contexts'

// Requirement 5.7: the recipes a user writes persist across a refresh in this
// browser, independently of any plan. They are kept out of the plan's own
// storage so regenerating a plan never discards them. Each account has its own
// key; the parent remounts this provider when the user changes.
export function CustomRecipeProvider({ children, storageKey }) {
  const [customRecipes, setCustomRecipes] = useLocalStorage(storageKey, [])

  // Every name the user's own recipes already use, minus the recipe being
  // edited. A plan slot stores a recipe by name, so names have to stay unique;
  // the form adds the names of the plan's other recipes.
  const takenNames = useCallback(
    (exceptName = null) =>
      customRecipes
        .map((recipe) => recipe.name)
        .filter((name) => name !== exceptName),
    [customRecipes],
  )

  const saveRecipe = useCallback(
    (recipe, previousName = null) => {
      const now = new Date().toISOString()

      setCustomRecipes((current) => {
        const index = current.findIndex(
          (item) => item.name === (previousName ?? recipe.name),
        )

        if (index === -1) {
          return [...current, { ...recipe, createdAt: now, updatedAt: now }]
        }

        const next = [...current]
        next[index] = {
          ...recipe,
          createdAt: current[index].createdAt ?? now,
          updatedAt: now,
        }
        return next
      })
    },
    [setCustomRecipes],
  )

  const deleteRecipe = useCallback(
    (name) =>
      setCustomRecipes((current) =>
        current.filter((recipe) => recipe.name !== name),
      ),
    [setCustomRecipes],
  )

  const findCustomRecipe = useCallback(
    (name) => customRecipes.find((recipe) => recipe.name === name) ?? null,
    [customRecipes],
  )

  const value = useMemo(
    () => ({
      customRecipes,
      takenNames,
      saveRecipe,
      deleteRecipe,
      findCustomRecipe,
    }),
    [customRecipes, takenNames, saveRecipe, deleteRecipe, findCustomRecipe],
  )

  return (
    <CustomRecipeContext.Provider value={value}>
      {children}
    </CustomRecipeContext.Provider>
  )
}
