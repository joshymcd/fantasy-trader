import { drizzle } from 'drizzle-orm/node-postgres'

import * as authSchema from './auth-schema'
import * as appSchema from './schema'

const schema = { ...authSchema, ...appSchema }

if (!process.env.DATABASE_URL) {
    console.error('[DB] DATABASE_URL environment variable is not set!')
    throw new Error('DATABASE_URL environment variable is required')
}

export const db = drizzle(process.env.DATABASE_URL, {
    schema,
    casing: 'snake_case'
})
