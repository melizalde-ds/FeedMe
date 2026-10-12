import { useGroceryList } from '../../hooks/useGroceryList'
import { useHousehold } from '../../hooks/useHousehold'
import { useMealPlan } from '../../hooks/useMealPlan'
import { SafetyDisclaimer } from '../common/SafetyDisclaimer'
import { Button } from '../ui/Button'
import { BuyPanel } from './BuyPanel'
import { GroceryList } from './GroceryList'

// The list on one side and the agent that shops for it on the other, so
// neither is a scroll away from the other. On a phone the agent comes first:
// it is the thing to act on, and the list is the reference.
export function GroceryView({ onBackToPlan }) {
  const { plan } = useMealPlan()
  const { items, mealCount, week } = useGroceryList()
  const { preferences } = useHousehold()

  const confirmed = plan?.confirmedWeek !== null && plan?.confirmedWeek !== undefined

  return (
    <>
      <h1 className="text-4xl font-extrabold tracking-tight max-sm:text-3xl">Your grocery list</h1>

      {confirmed && items.length ? (
        <>
          <p className="mt-2 max-w-[58ch] text-mute">
            Built from the {mealCount} {mealCount === 1 ? 'meal' : 'meals'} you
            confirmed in Week {week + 1}, for your household of{' '}
            {preferences.householdSize}. Leftover slots buy nothing extra.
          </p>

          <div className="mt-8 grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
            <GroceryList />
            <BuyPanel />
          </div>
        </>
      ) : (
        <section className="mt-6">
          <h2 className="text-xl font-bold tracking-tight">
            {confirmed ? 'Everything this plan needs' : 'Confirm a week first'}
          </h2>
          <p className="mt-2 max-w-[60ch] text-mute">
            The grocery list is built from the week you confirm, so nothing is
            bought for a plan you are still editing. Head back to your plan,
            get the week how you want it, then confirm it.
          </p>
          <Button variant="primary" size="lg" className="mt-5" onClick={onBackToPlan}>
            Back to my plan
          </Button>
        </section>
      )}

      <SafetyDisclaimer />
    </>
  )
}
