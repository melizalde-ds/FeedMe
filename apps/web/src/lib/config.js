// The only module that reads import.meta.env. Everything else imports from
// here, so a deployment changes one file's inputs and nothing else.

const env = import.meta.env

// Empty means same origin: in development the Vite proxy sends /api to the
// FastAPI server on :8000.
export const apiUrl = (env.VITE_API_URL ?? '').replace(/\/+$/, '')

export const supabaseUrl = env.VITE_SUPABASE_URL || 'http://localhost:54321'

// Public by design. In development it is read from the repo root .env
// (vite.config.ts); without it the sign-in pages say sign-in is not configured.
export const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || ''

export const authConfigured = Boolean(supabaseAnonKey)

// Every backend path the app calls. No path string appears anywhere else.
// Functions take the path parameters and encode them.
export const endpoints = {
  mealOptions: '/api/meal-options',
  // Not called yet: reads a saved set of options again by its session id.
  mealOptionsSession: (sessionId) =>
    `/api/meal-options/${encodeURIComponent(sessionId)}`,
  preferences: '/api/preferences',
  allergens: '/api/allergens',
  allergies: '/api/allergies',
  nutritionGoals: '/api/nutrition-goals',
  // The buying agent. The first saves the chosen recipes as a plan with its
  // grocery list and starts a run on it; the second starts another run on a
  // list that already exists, for what is still unbought.
  shoppingRuns: '/api/shopping-runs',
  listShoppingRuns: (listId) =>
    `/api/grocery-lists/${encodeURIComponent(listId)}/shopping-runs`,
  cart: (listId) => `/api/grocery-lists/${encodeURIComponent(listId)}/cart`,
  approveCart: (listId) =>
    `/api/grocery-lists/${encodeURIComponent(listId)}/cart/approve`,
  cartItem: (listId, store, upc) =>
    `/api/grocery-lists/${encodeURIComponent(listId)}/cart/items/${encodeURIComponent(
      store,
    )}/${encodeURIComponent(upc)}`,
  autoBuy: '/api/auto-buy',
  order: (orderId) => `/api/orders/${encodeURIComponent(orderId)}`,
}
