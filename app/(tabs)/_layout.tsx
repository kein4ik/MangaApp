import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';

import { colors } from '@/theme/colors';

type TabIconProps = {
  focused: boolean;
  active: keyof typeof Ionicons.glyphMap;
  inactive: keyof typeof Ionicons.glyphMap;
  color: ColorValue;
};

function TabIcon({ focused, active, inactive, color }: TabIconProps) {
  return <Ionicons name={focused ? active : inactive} size={22} color={color} />;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        // Each screen renders its own header/brand, so hide the default nav bar
        // (it showed a redundant "Home"/"Updates"/etc. title at the top).
        headerShown: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.bgElevated,
          borderTopWidth: 0,
          elevation: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon focused={focused} active="home" inactive="home-outline" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="updates"
        options={{
          title: 'Updates',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon
              focused={focused}
              active="notifications"
              inactive="notifications-outline"
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon focused={focused} active="search" inactive="search-outline" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="sources"
        options={{
          title: 'Sources',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon focused={focused} active="globe" inactive="globe-outline" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon focused={focused} active="library" inactive="library-outline" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
