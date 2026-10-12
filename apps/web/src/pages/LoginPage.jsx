import { Navigate, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { AuthForm } from '../components/auth/AuthForm'
import { AuthLayout } from '../components/auth/AuthLayout'

export default function LoginPage() {
  const { user, loading, signIn, sessionNotice } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  if (!loading && user) return <Navigate to="/" replace />

  // Set when the app sent the user here, such as after a session ended.
  const notice =
    typeof location.state?.message === 'string' ? location.state.message : sessionNotice

  const submit = async (values) => {
    const result = await signIn(values)
    if (!result.error) navigate('/', { replace: true })
    return result
  }

  return (
    <AuthLayout>
      <AuthForm mode="login" onSubmit={submit} notice={notice} />
    </AuthLayout>
  )
}
