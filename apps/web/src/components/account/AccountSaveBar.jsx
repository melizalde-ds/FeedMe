import { SAVE_UNAVAILABLE_MESSAGE } from '../../lib/accountSetup'
import { useAccountSetup } from '../../hooks/useAccountSetup'
import { Button } from '../ui/Button'

// Saves a signed-in user's Setup to the account, and says how that went.
// Generating a plan saves it too.
export function AccountSaveBar() {
  const { saveSetup, saveStatus, saveError, unavailable, problems } = useAccountSetup()
  const blocked = Object.keys(problems).length > 0

  let message = null
  if (saveStatus === 'saving') message = 'Saving to your account…'
  else if (saveStatus === 'saved') message = 'Saved to your account.'
  else if (saveStatus === 'error') message = saveError
  else if (saveStatus === 'unavailable' || unavailable) message = SAVE_UNAVAILABLE_MESSAGE
  else if (blocked) message = 'Fix the marked fields before saving.'

  const isProblem = saveStatus === 'error' || (saveStatus === 'idle' && blocked)

  return (
    <div>
      <Button className="w-full" disabled={saveStatus === 'saving'} onClick={() => saveSetup()}>
        Save to my account
      </Button>
      {message ? (
        <p
          className={`mt-2 text-sm ${isProblem ? 'font-semibold text-danger' : 'text-mute'}`}
          role={isProblem ? 'alert' : 'status'}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
