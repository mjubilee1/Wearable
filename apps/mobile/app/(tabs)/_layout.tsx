import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text, type ColorValue } from "react-native";
import { ConnectorSetupPrompt } from "@/components/ConnectorSetupPrompt";
import { PendantProvider } from "@/components/PendantSession";
import { colors } from "@/lib/theme";

const TAB_ICONS = {
  activity: { outline: "mic-outline", filled: "mic" },
  messages: { outline: "chatbubble-outline", filled: "chatbubble" },
  connectors: { outline: "git-network-outline", filled: "git-network" },
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
      initialRouteName="activity"
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
      <Tabs.Screen
        name="activity"
        options={{
          title: "Talk",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="activity" color={color} focused={focused} />
          ),
          tabBarLabel: ({ focused }) => (
            <TabLabel label="Talk" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="messages" color={color} focused={focused} />
          ),
          tabBarLabel: ({ focused }) => (
            <TabLabel label="Messages" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="connectors"
        options={{
          title: "Connectors",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="connectors" color={color} focused={focused} />
          ),
          tabBarLabel: ({ focused }) => (
            <TabLabel label="Connectors" focused={focused} />
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
    <ConnectorSetupPrompt />
    </PendantProvider>
  );
}
