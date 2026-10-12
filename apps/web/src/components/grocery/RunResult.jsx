import { money, storeName } from '../../lib/shopping'
import { useShoppingRun } from '../../hooks/useShoppingRun'
import { Banner } from '../common/Banner'
import { Button } from '../ui/Button'
import { captionClass, tableClass, tdClass, tfootClass, thClass } from '../ui/table'
import { CartTable } from './CartTable'

const listOf = (items) => items.join(', ')

const headingClass = 'text-xl font-bold tracking-tight'

function PaidOrders({ summary }) {
  const orders = summary.orders ?? []
  const reference = orders[0]?.payment_reference

  return (
    <section className="flex min-w-0 flex-col gap-6">
      <h3 className={`${headingClass}`}>
        Paid: {money(summary.paid_total_cents)} in one payment
      </h3>

      {orders.map((order) => (
        <div key={order.order_id} className="relative max-w-full min-w-0 overflow-x-auto">
          <table className={tableClass}>
            <caption className={captionClass}>
              {storeName(order.store)}
              <span className="font-normal text-mute">, order {order.order_id}</span>
            </caption>
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Product
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Packs
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Price
                </th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.upc}>
                  <th scope="row" className={tdClass}>
                    {line.name}
                  </th>
                  <td className={`${tdClass} text-right`}>{line.quantity}</td>
                  <td className={`${tdClass} text-right`}>{money(line.line_total_cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan="2" className={tfootClass}>
                  {storeName(order.store)} total
                  <span className="block text-sm font-normal text-mute">
                    {order.delivery_fee_cents
                      ? `includes ${money(order.delivery_fee_cents)} delivery`
                      : 'free delivery'}
                  </span>
                </th>
                <td className={`${tfootClass} text-right`}>{money(order.total_cents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}

      {reference ? (
        <p className="text-sm text-mute">
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
      <div className="flex min-w-0 flex-col gap-4">
        <Banner variant="error" title="The run did not finish" compact>
          {run.error}
        </Banner>
        {cart?.items?.length ? (
          <>
            <p>The products it had picked so far are saved in the cart.</p>
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
    <div className="flex min-w-0 flex-col gap-5">
      {paid ? (
        <PaidOrders summary={summary} />
      ) : (
        <Banner variant="warning" title="Nothing was paid" compact>
          {left.length
            ? 'The products the agent picked are saved in the cart below.'
            : 'The agent did not put anything in the cart.'}
        </Banner>
      )}

      {run.error ? (
        <Banner variant="error" compact>
          {run.error}
        </Banner>
      ) : null}

      {outOfSteps ? (
        <Banner variant="warning" compact>
          The agent ran out of steps before it finished, so some items are
          missing. This list is longer than it could get through in one run.
        </Banner>
      ) : null}

      {stoppedEarly ? (
        <Banner variant="warning" compact>
          The agent stopped before it finished, so some items may be missing.
          Run it again to shop for what is left.
        </Banner>
      ) : null}

      {paid && summary.savings_cents > 0 && summary.best_single_store ? (
        <p>
          Splitting the basket across stores saved {money(summary.savings_cents)}{' '}
          over buying it all at {storeName(summary.best_single_store)} (
          {money(summary.best_single_store_total_cents)}).
        </p>
      ) : null}

      {unmatched.length ? (
        <p>
          <strong>Not found in any store:</strong> {listOf(unmatched)}. The
          stores sell a small range, so buy these yourself.
        </p>
      ) : null}

      {left.length ? (
        <section className="flex min-w-0 flex-col gap-4 border-t border-line pt-5">
          <h3 className={headingClass}>
            {paid ? 'Still in the cart, not paid for' : 'In the cart'}
          </h3>
          <CartTable cart={cart} onRemove={removeItem} busy={cartBusy} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {waiting.length ? (
              <Button disabled={cartBusy} onClick={approveAll}>
                Keep all {waiting.length} marked &ldquo;Check this&rdquo;
              </Button>
            ) : null}
            <p className="max-w-[60ch] text-sm text-mute">
              A saved cart can&rsquo;t be paid for on its own yet. Run the agent
              again and it shops for whatever has not been paid for.
            </p>
          </div>
        </section>
      ) : null}
    </div>
  )
}
