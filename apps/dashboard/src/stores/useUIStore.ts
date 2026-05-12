import { create } from 'zustand'

interface UIState {
  sidebarOpen: boolean
  toggleSidebar: () => void
  activeModal: string | null
  setModal: (modal: string | null) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  activeModal: null,
  setModal: (modal) => set({ activeModal: modal }),
}))
