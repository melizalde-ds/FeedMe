import { money, storeName } from '../../lib/shopping'
import { useShoppingRun } from '../../hooks/useShoppingRun'
import { CartTable } from './CartTable'

const listOf = (items) => items.join(', ')

function PaidOrders({ summary }) {
  const orders = summary.orders ?? []
  const reference = orders[0]?.payment_reference

  return (
    <section className="flex flex-col gap-3">
      <h3 className="recipe__heading">
        Paid: {money(summary.paid_total_cents)} in one payment
      </h3>

      {orders.map((order) => (
        <div key={order.order_id} className="table-wrap">
          <table className="data-table">
            <caption className="pb-2 text-left font-semibold text-ink">
              {storeName(order.store)}
              <span className="font-normal text-mute"> · order {order.order_id}</span>
            </caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Packs</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.upc}>
                  <th scope="row">{line.name}</th>
                  <td>{line.quantity}</td>
                  <td>{money(line.line_total_cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan="2">
                  {storeName(order.store)} total
                  <span className="block text-sm font-normal text-mute">
                    {order.delivery_fee_cents
                      ? `includes ${money(order.delivery_fee_cents)} delivery`
                      : 'free delivery'}
                  </span>
                </th>
                <td>{money(order.total_cents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}

      {reference ? (
        <p className="fine-print">
          Stripe sandbox payment reference: {reference}. No real money moved.
        </p>
      ) : null}
    </section>
  )
}

// What the run that just finished did. It reads the same after a reload,
// from the saved order.
export function RunResult() {
  const { run, cartBusy, approveAll, removeItem } = useShoppingRun()
  const { summary, cart } = run

  if (run.phase === 'failed') {
    return (
      <div className="flex flex-col gap-3">
        <p className="alert" role="alert">
          <strong>The run did not finish.</strong> {run.error}
        </p>
        {cart?.items?.length ? (
          <>
            <p className="m-0 text-ink">
              The products it had picked so far are saved in the cart.
            </p>
            <CartTable cart={cart} onRemove={removeItem} busy={cartBusy} />
          </>
        ) : null}
      </div>
    )
  }

  const paid = run.outcome === 'paid' && summary?.orders?.length
  const left = cart?.items ?? []
  const waiting = left.filter((item) => item.status === 'proposed')
  const unmatched = summary?.unmatched ?? []
  // Out of turns is a limit of the agent, so running it again won't help.
  const outOfSteps = run.finishReason === 'step_limit'
  const stoppedEarly = run.finishReason === 'stopped_early'

  return (
    <div className="flex flex-col gap-4">
      {paid ? (
        <PaidOrders summary={summary} />
      ) : (
        <p className="alert alert--soft">
          <strong>Nothing was paid.</strong>{' '}
          {left.length
            ? 'The products the agent picked are saved in the cart below.'
            : 'The agent did not put anything in the cart.'}
        </p>
      )}

      {run.error ? (
        <p className="alert" role="alert">
          {run.error}
        </p>
      ) : null}

      {outOfSteps ? (
        <p className="alert alert--soft">
          The agent ran out of steps before it finished, so some items are
          missing. This list is longer than it could get through in one run.
        </p>
      ) : null}

      {stoppedEarly ? (
        <p className="alert alert--soft">
          The agent stopped before it finished, so some items may be missing.
          Run it again to shop for what is left.
        </p>
      ) : null}

      {paid && summary.savings_cents > 0 && summary.best_single_store ? (
        <p className="m-0 text-ink">
          Splitting the basket across stores saved {money(summary.savings_cents)}{' '}
          over buying it all at {storeName(summary.best_single_store)} (
          {money(summary.best_single_store_total_cents)}).
        </p>
      ) : null}

      {unmatched.length ? (
        <p className="m-0 text-ink">
          <strong>Not found in any store:</strong> {listOf(unmatched)}. The
          stores sell a small range, so buy these yourself.
        </p>
      ) : null}

      {left.length ? (
        <section className="flex flex-col gap-3">
          <h3 className="recipe__heading">
            {paid ? 'Still in the cart, not paid for' : 'In the cart'}
          </h3>
          <CartTable cart={cart} onRemove={removeItem} busy={cartBusy} />
          <div className="flex flex-wrap items-center gap-3">
            {waiting.length ? (
              <button
                type="button"
                className="button"
                disabled={cartBusy}
                onClick={approveAll}
              >
                Keep all {waiting.length} marked &ldquo;Check this&rdquo;
              </button>
            ) : null}
            <p className="fine-print m-0">
              A saved cart can&rsquo;t be paid for on its own yet. Run the agent
              again and it shops for whatever has not been paid for.
            </p>
          </div>
        </section>
      ) : null}
    </div>
  )
}
