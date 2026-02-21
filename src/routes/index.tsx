import { Link, createFileRoute } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl p-6">
      <Card className="mt-20">
        <CardHeader>
          <CardTitle className="text-3xl tracking-tight">
            Fantasy Trader
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This is a test home page for auth flow validation.
          </p>
          <div className="flex items-center gap-2">
            <Button asChild>
              <Link to="/login">Continue as guest</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/dashboard">Try app route</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
