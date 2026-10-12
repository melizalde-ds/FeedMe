import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { AuthForm } from '../components/auth/AuthForm'
import { AuthLayout } from '../components/auth/AuthLayout'

const CHECK_EMAIL =
  'Your account is created. Confirm your email with the link we sent you, then sign in.'

export default function RegisterPage() {
  const { user, loading, signUp } = useAuth()
  const navigate = useNavigate()
  const [notice, setNotice] = useState(null)

  if (!loading && user) return <Navigate to="/" replace />

  const submit = async (values) => {
    const result = await signUp(values)
    if (result.error) return result
    if (result.needsConfirmation) {
      setNotice(CHECK_EMAIL)
      return result
    }
    navigate('/', { replace: true })
    return result
  }

  return (
    <AuthLayout>
      <AuthForm mode="register" onSubmit={submit} notice={notice} />
    </AuthLayout>
  )
}
