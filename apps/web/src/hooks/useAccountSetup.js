import { useContext } from 'react'
import { AccountSetupContext } from '../contexts/contexts'

// The signed-in user's Setup on the server: loading, saving, allergen options.
export function useAccountSetup() {
  return useContext(AccountSetupContext)
}
