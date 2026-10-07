import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hapticTap } from '@/lib/haptics';
import { useUpdatesSnapshot } from '@/components/useUpdatesSnapshot';
import { colors, radius, spacing } from '@/theme/colors';

type TabIconProps = {
  focused: boolean;
  active: keyof typeof Ionicons.glyphMap;
  inactive: keyof typeof Ionicons.glyphMap;
  color: ColorValue;
};

/** Filled icon on a soft accent pill when active — clearer than colour alone. */
function TabIcon({ focused, active, inactive, color }: TabIconProps) {
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <Ionicons name={focused ? active : inactive} size={22} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    minWidth: 52,
    height: 28,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: { backgroundColor: 'rgba(255,122,48,0.16)' },
});

export default function TabsLayout() {
  // The app is edge-to-edge (app.json), so the Android system navigation bar
  // (back/home/recents, or the gesture pill) draws OVER the app. React
  // Navigation normally adds the bottom inset to the tab bar itself, but a
  // hardcoded height/paddingBottom overrides that and the system bar covers
  // the tabs — so the inset has to be added back in explicitly here.
  const insets = useSafeAreaInsets();
  const updates = useUpdatesSnapshot();
  const unread = updates?.items.reduce((sum, item) => sum + item.unread, 0) ?? 0;
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
          // A hairline separates the bar from dark content behind it; without
          // it the bar blended into the page on OLED screens.
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          elevation: 0,
          height: 72 + insets.bottom,
          paddingTop: 6,
          paddingBottom: 8 + insets.bottom,
        },
        tabBarLabelStyle: { fontSize: 11, lineHeight: 15, fontWeight: '600', flexShrink: 0 },
        tabBarItemStyle: { paddingTop: 2 },
      }}
      screenListeners={{ tabPress: () => hapticTap() }}
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
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, color: '#1A0E06', fontSize: 10, fontWeight: '700', marginTop: -5, marginLeft: 8 },
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
            <TabIcon focused={focused} active="compass" inactive="compass-outline" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="sources"
        options={{
          href: null,
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
      <Tabs.Screen
        name="preferences"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon focused={focused} active="options" inactive="options-outline" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
