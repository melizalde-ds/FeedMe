import { useGroceryList } from '../../hooks/useGroceryList'
import { useMealPlan } from '../../hooks/useMealPlan'
import { SafetyDisclaimer } from '../common/SafetyDisclaimer'
import { GroceryList } from './GroceryList'

export function GroceryView({ onBackToPlan }) {
  const { plan } = useMealPlan()
  const { items } = useGroceryList()

  const confirmed = plan?.confirmedWeek !== null && plan?.confirmedWeek !== undefined

  return (
    <>
      <h1 className="page-title">Your grocery list</h1>

      <section className="panel">
        <h2 className="panel__title">
          {confirmed ? 'Everything this plan needs' : 'Confirm a week first'}
        </h2>

        {confirmed && items.length ? (
          <GroceryList />
        ) : (
          <>
            <p className="panel__lede">
              The grocery list is built from the week you confirm, so nothing is
              bought for a plan you are still editing. Head back to your plan,
              get the week how you want it, then confirm it.
            </p>
            <button type="button" className="button button--primary button--large" onClick={onBackToPlan}>
              Back to my plan
            </button>
          </>
        )}
      </section>

      <SafetyDisclaimer />
    </>
  )
}
