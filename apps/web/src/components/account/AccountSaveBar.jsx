import { SAVE_UNAVAILABLE_MESSAGE } from '../../lib/accountSetup'
import { useAccountSetup } from '../../hooks/useAccountSetup'
import { ui } from '../ui/styles'

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
  else if (blocked) message = 'Fix the fields marked above before saving.'

  const isProblem = saveStatus === 'error' || (saveStatus === 'idle' && blocked)

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={ui.button}
        disabled={saveStatus === 'saving'}
        onClick={() => saveSetup()}
      >
        Save to my account
      </button>
      {message ? (
        <p
          className={`m-0 text-sm ${isProblem ? 'font-semibold text-bad' : 'text-mute'}`}
          role={isProblem ? 'alert' : 'status'}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
