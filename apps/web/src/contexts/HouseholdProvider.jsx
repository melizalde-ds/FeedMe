import { useCallback, useMemo } from 'react'
import { withDerivedFields } from '../lib/accountSetup'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { HouseholdContext } from './contexts'

// The signed-in user's Setup, kept under their own key with the account's
// defaults (accountSetup.js). The parent remounts this provider when the user
// changes, because the key is read once.
export function HouseholdProvider({ children, storageKey, defaults }) {
  const [stored, setStored] = useLocalStorage(storageKey, defaults)

  // Merge against the defaults so a stored payload from an older build still
  // has every field the form expects. The derived fields (the allergy labels
  // and the food text) are rebuilt here.
  const preferences = useMemo(
    () =>
      withDerivedFields({
        ...defaults,
        ...stored,
        nutritionGoals: {
          ...defaults.nutritionGoals,
          ...stored?.nutritionGoals,
        },
      }),
    [defaults, stored],
  )

  const setPreference = useCallback(
    (key, value) => setStored((current) => ({ ...current, [key]: value })),
    [setStored],
  )

  const setNutritionGoal = useCallback(
    (key, value) =>
      setStored((current) => ({
        ...current,
        nutritionGoals: { ...current.nutritionGoals, [key]: value },
      })),
    [setStored],
  )

  const toggleListValue = useCallback(
    (key, value) =>
      setStored((current) => {
        const list = current[key] ?? []
        return {
          ...current,
          [key]: list.includes(value)
            ? list.filter((item) => item !== value)
            : [...list, value],
        }
      }),
    [setStored],
  )

  const toggleRestriction = useCallback(
    (restriction) => toggleListValue('dietaryRestrictions', restriction),
    [toggleListValue],
  )

  const resetPreferences = useCallback(
    () => setStored(defaults),
    [defaults, setStored],
  )

  // Replaces several fields at once: Setup loads whole groups of fields from
  // the server.
  const updatePreferences = useCallback(
    (patch) =>
      setStored((current) => ({
        ...current,
        ...(typeof patch === 'function' ? patch(current) : patch),
      })),
    [setStored],
  )

  const value = useMemo(
    () => ({
      preferences,
      setPreference,
      setNutritionGoal,
      toggleRestriction,
      resetPreferences,
      updatePreferences,
    }),
    [
      preferences,
      setPreference,
      setNutritionGoal,
      toggleRestriction,
      resetPreferences,
      updatePreferences,
    ],
  )

  return (
    <HouseholdContext.Provider value={value}>
      {children}
    </HouseholdContext.Provider>
  )
}
