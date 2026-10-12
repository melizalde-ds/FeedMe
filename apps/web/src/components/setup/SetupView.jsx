import { CURRENT_WEEK } from '../../lib/constants'
import { isWeekEmpty } from '../../lib/planner'
import { useAccountSetup } from '../../hooks/useAccountSetup'
import { useHousehold } from '../../hooks/useHousehold'
import { useMealPlan } from '../../hooks/useMealPlan'
import { AccountAllergySelector } from '../account/AccountAllergySelector'
import { AccountSaveBar } from '../account/AccountSaveBar'
import { PreferencesForm } from '../household/PreferencesForm'
import { Banner } from '../common/Banner'
import { LoadingState, PLAN_BUILDING } from '../common/LoadingState'
import { SafetyDisclaimer } from '../common/SafetyDisclaimer'
import { MyRecipesSection } from '../recipes/MyRecipesSection'
import { Button, TextButton } from '../ui/Button'

// Setup is the form on the left and what to do with it on the right. The
// right-hand column stays in view while the form scrolls, so building the
// plan is never a scroll away; on a phone it follows the form.
export function SetupView({ onSeePlan }) {
  const { preferences } = useHousehold()
  const { plan, status, error, note, generatePlan, dismissError } = useMealPlan()
  const { resetSetup } = useAccountSetup()

  const loading = status === 'loading'
  const hasPlan = !isWeekEmpty(plan, CURRENT_WEEK)

  return (
    <>
      <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start xl:gap-x-14">
        <section className="min-w-0" aria-labelledby="household-title">
          <h1 className="text-4xl font-extrabold tracking-tight max-sm:text-3xl" id="household-title">
            Your household
          </h1>
          <p className="mt-2 text-mute">
            Allergies first, then everything else we need to build the plan.
          </p>

          <form
            id="setup-form"
            className="mt-7 flex flex-col gap-10"
            onSubmit={(event) => {
              event.preventDefault()
              generatePlan()
            }}
          >
            <AccountAllergySelector />
            <PreferencesForm />
          </form>
        </section>

        <aside
          className="flex flex-col gap-4 max-lg:border-t max-lg:border-line max-lg:pt-8 lg:sticky lg:top-6 lg:border-l lg:border-line lg:pl-8"
          aria-label="Your plan"
        >
          <div>
            <h2 className="text-xl font-bold tracking-tight">
              {hasPlan ? 'Your plan is ready' : 'No plan yet'}
            </h2>
            <p className="mt-1.5 text-mute">
              {hasPlan
                ? note ||
                  `Built for ${preferences.householdSize} ${
                    preferences.householdSize === 1 ? 'person' : 'people'
                  } over ${preferences.planningPeriod} days.`
                : 'Fill in your household and generate a plan. Your setup is saved to your account when you generate, and kept in this browser too.'}
            </p>
          </div>

          {hasPlan ? (
            <Button variant="primary" size="lg" onClick={onSeePlan}>
              See your plan
            </Button>
          ) : null}

          <Button
            type="submit"
            form="setup-form"
            variant={hasPlan ? 'default' : 'primary'}
            size="lg"
            disabled={loading}
          >
            {loading
              ? 'Building your plan…'
              : hasPlan
                ? 'Rebuild my plan'
                : 'Generate meal plan'}
          </Button>

          {loading ? <LoadingState label={PLAN_BUILDING} className="py-0" /> : null}

          {error ? (
            <Banner variant="error" title="We could not build that plan" onDismiss={dismissError} compact>
              {error}
            </Banner>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <AccountSaveBar />
            <TextButton className="self-start text-ui" onClick={resetSetup}>
              Reset to defaults
            </TextButton>
          </div>
        </aside>
      </div>

      <MyRecipesSection />
      <SafetyDisclaimer />
    </>
  )
}
