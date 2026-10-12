import logo from '../../assets/pic-logo.png'
import { CURRENT_WEEK } from '../../lib/constants'
import { isWeekEmpty } from '../../lib/planner'
import { useAccountSetup } from '../../hooks/useAccountSetup'
import { useHousehold } from '../../hooks/useHousehold'
import { useMealPlan } from '../../hooks/useMealPlan'
import { AccountAllergySelector } from '../account/AccountAllergySelector'
import { AccountSaveBar } from '../account/AccountSaveBar'
import { PreferencesForm } from '../household/PreferencesForm'
import { Banner } from '../common/Banner'
import { PlanBuildingState } from '../common/LoadingState'
import { SafetyDisclaimer } from '../common/SafetyDisclaimer'
import { MyRecipesSection } from '../recipes/MyRecipesSection'

export function SetupView({ onSeePlan }) {
  const { preferences } = useHousehold()
  const { plan, status, error, note, generatePlan, dismissError } = useMealPlan()
  const { resetSetup } = useAccountSetup()

  const loading = status === 'loading'
  const hasPlan = !isWeekEmpty(plan, CURRENT_WEEK)

  return (
    <>
      <section className="hero">
        <img
          className="hero__logo"
          src={logo}
          alt="FeedMe"
          width="879"
          height="742"
        />
        <h1 className="hero__title">Weekly meals your whole table can eat</h1>
        <p className="hero__lede">
          Tell us the allergies, the budget, and how long you have to cook. We
          plan breakfast, lunch and dinner for everyone, then turn it into a
          grocery list.
        </p>
      </section>

      <section className="panel" aria-labelledby="household-title">
        <h2 className="panel__title" id="household-title">
          Your household
        </h2>
        <p className="panel__lede">
          Allergies first, then everything else we need to build the plan.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            generatePlan()
          }}
        >
          <AccountAllergySelector />
          <PreferencesForm />
          <AccountSaveBar />

          <div className="panel__actions">
            <button
              type="submit"
              className="button button--primary button--large"
              disabled={loading}
            >
              {loading
                ? 'Building your plan…'
                : hasPlan
                  ? 'Rebuild my plan'
                  : 'Generate meal plan'}
            </button>
            <button
              type="button"
              className="button button--large"
              onClick={resetSetup}
            >
              Reset to defaults
            </button>
          </div>
        </form>
      </section>

      {error ? (
        <Banner variant="error" title="We could not build that plan" onDismiss={dismissError}>
          {error}
        </Banner>
      ) : null}

      {loading ? <PlanBuildingState /> : null}

      <section className="panel panel--next">
        {hasPlan ? (
          <>
            <h2 className="panel__title">Your plan is ready</h2>
            <p className="panel__lede">
              {note ||
                `Built for ${preferences.householdSize} ${
                  preferences.householdSize === 1 ? 'person' : 'people'
                } over ${preferences.planningPeriod} days.`}
            </p>
            <button
              type="button"
              className="button button--primary button--large"
              onClick={onSeePlan}
            >
              See your plan
            </button>
          </>
        ) : (
          <>
            <h2 className="panel__title">No plan yet</h2>
            <p className="panel__lede">
              Fill in your household above and generate a plan. Your setup is
              saved to your account when you generate, and kept in this browser
              too.
            </p>
          </>
        )}
      </section>

      <MyRecipesSection />
      <SafetyDisclaimer />
    </>
  )
}
