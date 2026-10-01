import AsyncStorage from "@react-native-async-storage/async-storage";

const SKIP_LINK_RING_KEY = "nearby.skipLinkRing";

/** User chose "I'll do this later" on the link-ring onboarding screen. */
export async function getSkipLinkRing(): Promise<boolean> {
  const value = await AsyncStorage.getItem(SKIP_LINK_RING_KEY);
  return value === "1";
}

export async function setSkipLinkRing(skip: boolean): Promise<void> {
  if (skip) {
    await AsyncStorage.setItem(SKIP_LINK_RING_KEY, "1");
  } else {
    await AsyncStorage.removeItem(SKIP_LINK_RING_KEY);
  }
}
