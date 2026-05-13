import { create } from 'zustand'

interface UIState {
  activeTab: string
  bottomSheetOpen: boolean
  setActiveTab: (tab: string) => void
  setBottomSheet: (open: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  activeTab: 'index',
  bottomSheetOpen: false,
  setActiveTab: (tab) => set({ activeTab: tab }),
  setBottomSheet: (open) => set({ bottomSheetOpen: open }),
}))
