import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text, type ColorValue } from "react-native";
import { PendantProvider } from "@/components/PendantSession";
import { colors } from "@/lib/theme";

const TAB_ICONS = {
  nearby: { outline: "compass-outline", filled: "compass" },
  explore: { outline: "map-outline", filled: "map" },
  patterns: { outline: "stats-chart-outline", filled: "stats-chart" },
  profile: { outline: "person-outline", filled: "person" },
} as const;

function TabIcon({
  name,
  color,
  focused,
}: {
  name: keyof typeof TAB_ICONS;
  color: ColorValue;
  focused: boolean;
}) {
  const icon = TAB_ICONS[name];
  return (
    <Ionicons
      name={focused ? icon.filled : icon.outline}
      size={22}
      color={color}
    />
  );
}

function TabLabel({
  label,
  focused,
}: {
  label: string;
  focused: boolean;
}) {
  return (
    <Text
      style={{
        fontSize: 11,
        fontWeight: "600",
        color: focused ? colors.teal : colors.muted,
      }}
    >
      {label}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <PendantProvider>
      <Tabs
        initialRouteName="nearby"
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.teal,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: {
            backgroundColor: "rgba(255,255,255,0.95)",
            borderTopColor: colors.border,
          },
        }}
      >
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen name="connections" options={{ href: null }} />
        <Tabs.Screen name="activity" options={{ href: null }} />
        <Tabs.Screen name="messages" options={{ href: null }} />
        <Tabs.Screen name="connectors" options={{ href: null }} />
        <Tabs.Screen
          name="nearby"
          options={{
            title: "Discover",
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="nearby" color={color} focused={focused} />
            ),
            tabBarLabel: ({ focused }) => (
              <TabLabel label="Discover" focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="explore"
          options={{
            title: "Explore",
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="explore" color={color} focused={focused} />
            ),
            tabBarLabel: ({ focused }) => (
              <TabLabel label="Explore" focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="patterns"
          options={{
            title: "Patterns",
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="patterns" color={color} focused={focused} />
            ),
            tabBarLabel: ({ focused }) => (
              <TabLabel label="Patterns" focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="profile" color={color} focused={focused} />
            ),
            tabBarLabel: ({ focused }) => (
              <TabLabel label="Profile" focused={focused} />
            ),
          }}
        />
      </Tabs>
    </PendantProvider>
  );
}
