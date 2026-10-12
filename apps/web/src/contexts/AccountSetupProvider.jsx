import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addAllergy,
  fetchAllergens,
  fetchAllergies,
  fetchNutritionGoals,
  fetchPreferences,
  saveNutritionGoals,
  savePreferences,
} from '../lib/api'
import {
  FALLBACK_ALLERGEN_OPTIONS,
  accountDefaults,
  accountSetupProblems,
  fromServerGoals,
  fromServerPreferences,
  pendingAllergies,
  splitSavedAllergies,
  toServerGoals,
  toServerPreferences,
} from '../lib/accountSetup'
import { useHousehold } from '../hooks/useHousehold'
import { AccountSetupContext } from './contexts'

const NO_SAVED_ALLERGIES = { allergenIds: [], customAllergies: [] }

const unique = (items) => [...new Set(items)]

// Lives inside the signed-in user's HouseholdProvider. The form keeps working
// on local storage as it always did; this provider loads the account's Setup
// into it once, and saves it back when asked. A route that is missing (404)
// or can't be reached leaves the local values in place and says so.
export function AccountSetupProvider({ children }) {
  const { preferences, updatePreferences } = useHousehold()

  const [allergenOptions, setAllergenOptions] = useState(FALLBACK_ALLERGEN_OPTIONS)
  // What the account already has. Null until it has been read.
  const [savedAllergies, setSavedAllergies] = useState(null)
  const [loadStatus, setLoadStatus] = useState('loading')
  // 'idle' | 'saving' | 'saved' | 'unavailable' | 'error'
  const [saveStatus, setSaveStatus] = useState('idle')
  const [saveError, setSaveError] = useState(null)
  const [unavailable, setUnavailable] = useState(false)

  const saved = useMemo(
    () => (savedAllergies ? splitSavedAllergies(savedAllergies) : NO_SAVED_ALLERGIES),
    [savedAllergies],
  )

  // The local allergy fields: what the account has, plus what is ticked here
  // but not saved yet.
  const mergeAllergies = useCallback(
    (list) => {
      const next = splitSavedAllergies(list)
      updatePreferences((current) => ({
        allergenIds: unique([...next.allergenIds, ...(current.allergenIds ?? [])]),
        customAllergies: unique([
          ...next.customAllergies,
          ...(current.customAllergies ?? []),
        ]),
      }))
    },
    [updatePreferences],
  )

  // Load once per sign-in. The provider is remounted for another user.
  const loaded = useRef(false)
  useEffect(() => {
    if (loaded.current) return
    loaded.current = true

    Promise.allSettled([
      fetchAllergens(),
      fetchAllergies(),
      fetchPreferences(),
      fetchNutritionGoals(),
    ]).then(([allergens, allergies, prefs, goals]) => {
      const failed = [allergens, allergies, prefs, goals].filter(
        (result) => result.status === 'rejected',
      )

      if (allergens.status === 'fulfilled' && Array.isArray(allergens.value)) {
        setAllergenOptions(allergens.value)
      }
      if (allergies.status === 'fulfilled' && Array.isArray(allergies.value)) {
        setSavedAllergies(allergies.value)
        mergeAllergies(allergies.value)
      }
      // Null means the account has no row yet: keep what is in the form.
      if (prefs.status === 'fulfilled' && prefs.value) {
        updatePreferences(fromServerPreferences(prefs.value))
      }
      if (goals.status === 'fulfilled' && goals.value) {
        updatePreferences({ nutritionGoals: fromServerGoals(goals.value) })
      }

      setUnavailable(failed.some((result) => result.reason?.kind === 'unavailable'))
      setLoadStatus(failed.length ? 'partial' : 'ready')
    })
  }, [mergeAllergies, updatePreferences])

  // Saves the whole Setup. Resolves to { ok, invalid, allergiesSaved }:
  // `allergiesSaved` is false when an allergy ticked here is not on the
  // account yet, which the planner must not run without.
  const saveSetup = useCallback(
    async (setup = preferences) => {
      if (Object.keys(accountSetupProblems(setup)).length) {
        setSaveStatus('error')
        setSaveError('Fix the fields marked in Setup, then save again.')
        return { ok: false, invalid: true, allergiesSaved: false }
      }

      setSaveStatus('saving')
      setSaveError(null)

      let list = savedAllergies
      let missing = false
      let refused = null

      // Allergies first, one at a time: each answer is the full list, and a
      // custom name may come back stored as a common allergen.
      const pending = pendingAllergies(setup, list ? splitSavedAllergies(list) : NO_SAVED_ALLERGIES)
      const requests = [
        ...pending.allergenIds.map((id) => ({ allergen_id: id })),
        ...pending.customAllergies.map((name) => ({ name })),
      ]
      let allergiesSaved = true
      for (const body of requests) {
        try {
          const answer = await addAllergy(body)
          if (Array.isArray(answer)) list = answer
          if (body.name) {
            // Accepted, maybe under another name: drop the typed one locally.
            updatePreferences((current) => ({
              customAllergies: (current.customAllergies ?? []).filter(
                (name) => name !== body.name,
              ),
            }))
          }
        } catch (error) {
          allergiesSaved = false
          if (error.kind === 'unavailable') missing = true
          else refused ??= error.message
        }
      }
      if (list) {
        setSavedAllergies(list)
        mergeAllergies(list)
      }

      const others = await Promise.allSettled([
        savePreferences(toServerPreferences(setup)),
        saveNutritionGoals(toServerGoals(setup.nutritionGoals)),
      ])
      for (const result of others) {
        if (result.status === 'fulfilled') continue
        if (result.reason?.kind === 'unavailable') missing = true
        else refused ??= result.reason?.message
      }

      setUnavailable(missing)
      if (refused) {
        setSaveStatus('error')
        setSaveError(refused)
      } else if (missing) {
        setSaveStatus('unavailable')
      } else {
        setSaveStatus('saved')
      }

      return { ok: !refused && !missing, invalid: false, allergiesSaved }
    },
    [mergeAllergies, preferences, savedAllergies, updatePreferences],
  )

  // Back to the defaults, except the allergies already on the account, which
  // can't be removed.
  const resetSetup = useCallback(
    () => updatePreferences(accountDefaults(saved)),
    [saved, updatePreferences],
  )

  const value = useMemo(
    () => ({
      allergenOptions,
      saved,
      allergiesKnown: savedAllergies !== null,
      loadStatus,
      saveStatus,
      saveError,
      unavailable,
      problems: accountSetupProblems(preferences),
      saveSetup,
      resetSetup,
    }),
    [
      allergenOptions,
      saved,
      savedAllergies,
      loadStatus,
      saveStatus,
      saveError,
      unavailable,
      preferences,
      saveSetup,
      resetSetup,
    ],
  )

  return (
    <AccountSetupContext.Provider value={value}>
      {children}
    </AccountSetupContext.Provider>
  )
}
