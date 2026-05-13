import { Tabs } from 'expo-router'
import { TabBar } from '../../components/navigation/TabBar'

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={() => <TabBar />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="schedule" />
      <Tabs.Screen name="bookings" />
      <Tabs.Screen name="index" />
      <Tabs.Screen name="studio" />
      <Tabs.Screen name="profile" />
    </Tabs>
  )
}
