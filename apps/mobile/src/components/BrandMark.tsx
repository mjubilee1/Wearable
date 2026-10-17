import { Pressable, Text, type StyleProp, type TextStyle } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";

export function BrandMark({
  style,
  label = "Nearby",
}: {
  style?: StyleProp<TextStyle>;
  label?: string;
}) {
  const { user } = useAuth();
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="link"
      hitSlop={8}
      onPress={() => {
        if (user) router.replace("/(tabs)/activity");
      }}
    >
      <Text style={style}>{label}</Text>
    </Pressable>
  );
}
