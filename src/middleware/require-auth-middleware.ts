import { redirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'

import { authMiddleware } from './auth-middleware'

export const requireAuthMiddleware = createMiddleware()
  .middleware([authMiddleware])
  .server(async ({ next, context }) => {
    if (!context.session) {
      throw redirect({ to: '/login' })
    }

    return next({
      context: {
        session: context.session,
      },
    })
  })
