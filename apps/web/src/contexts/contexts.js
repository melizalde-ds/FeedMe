import { createContext } from 'react'

// Kept apart from the providers so those files export components only, which
// is what Vite's fast refresh needs.
export const HouseholdContext = createContext(null)
export const MealPlanContext = createContext(null)

// The user's own recipes are stored apart from the plan so they survive a
// regenerate, which replaces the plan's catalog wholesale.
export const CustomRecipeContext = createContext(null)

// Who is signed in, and the sign-in actions.
export const AuthContext = createContext(null)

// The buying agent's run for the confirmed week: starting it, following it
// live, and its result.
export const ShoppingRunContext = createContext(null)

// The signed-in user's Setup on the server: loading, saving, allergen options.
export const AccountSetupContext = createContext(null)
