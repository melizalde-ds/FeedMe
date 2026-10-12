import { useState } from 'react'
import { Navigate } from 'react-router'
import { CURRENT_WEEK } from '../lib/constants'
import { accountDefaults } from '../lib/accountSetup'
import { isWeekEmpty } from '../lib/planner'
import {
  accountPlanKey,
  accountPreferencesKey,
  accountRecipesKey,
} from '../lib/storageKeys'
import { AccountSetupProvider } from '../contexts/AccountSetupProvider'
import { CustomRecipeProvider } from '../contexts/CustomRecipeProvider'
import { HouseholdProvider } from '../contexts/HouseholdProvider'
import { MealPlanProvider } from '../contexts/MealPlanProvider'
import { ShoppingRunProvider } from '../contexts/ShoppingRunProvider'
import { useAuth } from '../hooks/useAuth'
import { useMealPlan } from '../hooks/useMealPlan'
import { AppHeader } from '../components/common/AppHeader'
import { LoadingState } from '../components/common/LoadingState'
import { SetupView } from '../components/setup/SetupView'
import { PlanView } from '../components/plan/PlanView'
import { GroceryView } from '../components/grocery/GroceryView'

// Built once: HouseholdProvider memoizes against it.
const ACCOUNT_DEFAULTS = accountDefaults()

function Shell() {
  const { plan } = useMealPlan()
  const [view, setView] = useState('setup')

  const groceryReady = plan.confirmedWeek !== null && plan.confirmedWeek !== undefined
  const hasPlan = !isWeekEmpty(plan, CURRENT_WEEK)

  // The plan step is only meaningful once something has been planned.
  const current = view === 'plan' && !hasPlan ? 'setup' : view

  return (
    <div className="min-h-screen">
      <AppHeader view={current} onNavigate={setView} groceryReady={groceryReady} />

      <main className="mx-auto max-w-[1560px] px-4 pt-6 pb-24 sm:px-8 sm:pt-8" id="main">
        {current === 'setup' ? (
          <SetupView onSeePlan={() => setView('plan')} />
        ) : null}

        {current === 'plan' ? (
          <PlanView
            onEditSetup={() => setView('setup')}
            onGoToGrocery={() => setView('grocery')}
          />
        ) : null}

        {current === 'grocery' ? (
          <GroceryView onBackToPlan={() => setView('plan')} />
        ) : null}
      </main>
    </div>
  )
}

// A user's Setup, plan and own recipes live under their own storage keys.
// Setup also syncs with the account; the plan and the recipes stay in this
// browser.
function AccountApp({ userId }) {
  return (
    <HouseholdProvider
      storageKey={accountPreferencesKey(userId)}
      defaults={ACCOUNT_DEFAULTS}
    >
      <AccountSetupProvider>
        {/* The recipe book sits above the plan because the plan's catalog is
            layered on top of the user's own recipes. */}
        <CustomRecipeProvider storageKey={accountRecipesKey(userId)}>
          <MealPlanProvider storageKey={accountPlanKey(userId)}>
            <ShoppingRunProvider>
              <Shell />
            </ShoppingRunProvider>
          </MealPlanProvider>
        </CustomRecipeProvider>
      </AccountSetupProvider>
    </HouseholdProvider>
  )
}

// FeedMe needs an account: every recipe and every plan comes from the server,
// which answers signed-in users only.
export default function Home() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingState label="Loading FeedMe…" />
  if (!user) return <Navigate to="/login" replace />

  // Keyed so signing in as someone else starts every provider afresh.
  return <AccountApp key={user.id} userId={user.id} />
}
