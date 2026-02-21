import { Outlet, createFileRoute } from '@tanstack/react-router'

import Header from '@/components/Header'
import { requireAuthMiddleware } from '@/middleware/require-auth-middleware'

export const Route = createFileRoute('/_app')({
  ssr: 'data-only',
  component: AppLayout,
  server: {
    middleware: [requireAuthMiddleware],
  },
})

function AppLayout() {
  return (
    <>
      <Header />
      <Outlet />
    </>
  )
}
