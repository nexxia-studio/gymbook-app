import { Dumbbell } from 'lucide-react'

function App() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-6 flex items-center justify-center gap-3">
          <Dumbbell className="h-10 w-10 text-accent" />
          {/* TODO: i18n */}
          <h1 className="font-display text-5xl font-black uppercase tracking-tight text-dark">
            GymBook Dashboard
          </h1>
        </div>
        {/* TODO: i18n */}
        <p className="text-lg text-dark/60">
          Sprint 1 — en construction
        </p>
        <div className="mx-auto mt-6 h-1 w-24 rounded-full bg-accent" />
      </div>
    </div>
  )
}

export default App
