import { Link } from '@tanstack/react-router'

import BetterAuthHeader from '../integrations/better-auth/header-user.tsx'

import { useState } from 'react'
import { LayoutDashboard, Menu, Settings2, X } from 'lucide-react'

export default function Header() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <header className="flex items-center border-b border-border/70 bg-card px-4 py-3">
        <button
          onClick={() => setIsOpen(true)}
          className="rounded-lg p-2 transition-colors hover:bg-muted"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <h1 className="ml-3 text-lg font-semibold tracking-tight">
          <Link to="/dashboard">Fantasy Trader</Link>
        </h1>
      </header>

      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-80 transform flex-col border-r border-border/70 bg-card shadow-2xl transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-border/70 p-4">
          <h2 className="text-xl font-semibold">Navigation</h2>
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-lg p-2 transition-colors hover:bg-muted"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          <Link
            to="/dashboard"
            onClick={() => setIsOpen(false)}
            className="mb-2 flex items-center gap-3 rounded-lg p-3 transition-colors hover:bg-muted"
            activeProps={{
              className:
                'mb-2 flex items-center gap-3 rounded-lg bg-emerald-100 p-3 text-emerald-900 transition-colors hover:bg-emerald-100',
            }}
          >
            <LayoutDashboard size={18} />
            <span className="font-medium">Dashboard</span>
          </Link>

          <Link
            to="/backend"
            onClick={() => setIsOpen(false)}
            className="mb-2 flex items-center gap-3 rounded-lg p-3 transition-colors hover:bg-muted"
            activeProps={{
              className:
                'mb-2 flex items-center gap-3 rounded-lg bg-emerald-100 p-3 text-emerald-900 transition-colors hover:bg-emerald-100',
            }}
          >
            <Settings2 size={18} />
            <span className="font-medium">Backend Console</span>
          </Link>
        </nav>

        <div className="flex flex-col gap-2 border-t border-border/70 bg-muted/20 p-4">
          <BetterAuthHeader />
        </div>
      </aside>
    </>
  )
}
