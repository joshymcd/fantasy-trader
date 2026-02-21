import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate({ from: '/login' })
  const { data: session, isPending } = authClient.useSession()

  const handleGuestLogin = async () => {
    await authClient.signIn.anonymous()
    await navigate({ to: '/dashboard' })
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md p-6">
      <Card className="mt-20">
        <CardHeader>
          <CardTitle className="text-2xl tracking-tight">Guest Login</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Anonymous auth only for now while testing.
          </p>
          {session ? (
            <Button
              className="w-full"
              onClick={() => navigate({ to: '/dashboard' })}
            >
              Continue to app
            </Button>
          ) : (
            <Button
              className="w-full"
              disabled={isPending}
              onClick={handleGuestLogin}
            >
              Continue anonymously
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
