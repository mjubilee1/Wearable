import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import type { Voice } from "expo-speech";

const ENABLED_KEY = "nearby.voice-replies.enabled";
const RATE_KEY = "nearby.voice-replies.rate";

export const VOICE_RATES = [0.9, 1, 1.2] as const;
export type VoiceRate = (typeof VOICE_RATES)[number];

export type VoiceSettings = {
  enabled: boolean;
  rate: VoiceRate;
};

const DEFAULTS: VoiceSettings = { enabled: true, rate: 1 };

let cache: VoiceSettings = DEFAULTS;
let loaded = false;
let loadTask: Promise<VoiceSettings> | null = null;
let voiceId: string | null | undefined;
let generation = 0;

type SpeechModule = typeof import("expo-speech");

function speechApi(): SpeechModule | null {
  try {
    return require("expo-speech") as SpeechModule;
  } catch (error) {
    console.warn("Spoken reply unavailable until the next dev build", error);
    return null;
  }
}

function parseRate(value: string | null): VoiceRate {
  if (value === "0.9") return 0.9;
  if (value === "1.2") return 1.2;
  return 1;
}

export function getVoiceSettings(): Promise<VoiceSettings> {
  if (loaded) return Promise.resolve(cache);
  if (!loadTask) {
    loadTask = AsyncStorage.multiGet([ENABLED_KEY, RATE_KEY])
      .then((pairs) => {
        const enabled = pairs[0]?.[1];
        const rate = pairs[1]?.[1];
        cache = {
          enabled: enabled !== "0",
          rate: parseRate(rate ?? null),
        };
        loaded = true;
        return cache;
      })
      .catch((error) => {
        console.warn("Could not read voice reply settings", error);
        loaded = true;
        return cache;
      });
  }
  return loadTask;
}

export async function setVoiceRepliesEnabled(enabled: boolean): Promise<void> {
  await getVoiceSettings();
  cache = { ...cache, enabled };
  await AsyncStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  if (!enabled) await stop();
}

export async function setVoiceRate(rate: VoiceRate): Promise<void> {
  await getVoiceSettings();
  cache = { ...cache, rate };
  await AsyncStorage.setItem(RATE_KEY, String(rate));
}

const NOVELTY =
  /bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|jester|organ|superstar|trinoids|whisper|zarvox|albert|fred|junior|grandma|grandpa/i;
const NATURAL = /^(ava|allison|samantha|zoe|nicky|evan|nathan|karen|daniel|serena|moira|tessa)\b/i;

function scoreVoice(voice: Voice): number {
  const language = voice.language.toLowerCase();
  let score = language === "en-us" || language.startsWith("en-us") ? 4 : 1;
  if (voice.quality === "Enhanced") score += 5;
  if (/premium/i.test(voice.identifier) || /premium/i.test(voice.name)) score += 8;
  if (/enhanced/i.test(voice.identifier)) score += 3;
  if (NATURAL.test(voice.name)) score += 2;
  return score;
}

function pickVoice(voices: Voice[]): string | null {
  const english = voices.filter((voice) => voice.language.toLowerCase().startsWith("en"));
  if (english.length === 0) return null;
  const natural = english.filter((voice) => !NOVELTY.test(voice.name));
  const pool = natural.length > 0 ? natural : english;
  let best = pool[0] ?? null;
  let bestScore = -1;
  for (const voice of pool) {
    const score = scoreVoice(voice);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best?.identifier ?? null;
}

async function englishVoice(Speech: SpeechModule): Promise<string | null> {
  if (voiceId !== undefined) return voiceId;
  try {
    voiceId = pickVoice(await Speech.getAvailableVoicesAsync());
  } catch (error) {
    console.warn("Could not list English voices", error);
    voiceId = null;
  }
  return voiceId;
}

async function nativeStop(Speech: SpeechModule | null): Promise<void> {
  if (!Speech) return;
  try {
    await Speech.stop();
  } catch (error) {
    console.warn("Could not stop the spoken reply", error);
  }
}

/**
 * Playback ignores the silent switch and follows the current route, so
 * Bluetooth headphones play the reply when they are connected.
 * duckOthers lowers other audio. allowBluetoothA2DP only applies to the
 * playAndRecord category; iOS ignores it on playback and already uses A2DP.
 */
async function preparePlayback(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const { setAudioModeAsync, setIsAudioActiveAsync } =
      require("expo-audio") as typeof import("expo-audio");
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
      allowsRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
    if (Platform.OS === "ios") await setIsAudioActiveAsync(true);
  } catch (error) {
    console.warn("Could not set the playback audio session", error);
  }
}

export async function stop(): Promise<void> {
  generation += 1;
  await nativeStop(speechApi());
}

export async function speak(text: string): Promise<void> {
  const settings = await getVoiceSettings();
  const cleaned = text.replace(/\s+/g, " ").trim();
  generation += 1;
  const mine = generation;
  const Speech = speechApi();
  await nativeStop(Speech);
  if (mine !== generation || !settings.enabled || !cleaned || !Speech) return;
  await preparePlayback();
  if (mine !== generation) return;
  const voice = await englishVoice(Speech);
  if (mine !== generation) return;
  Speech.speak(cleaned, {
    language: "en-US",
    pitch: 1,
    rate: settings.rate,
    volume: 1,
    ...(Platform.OS === "ios" ? { useApplicationAudioSession: true as const } : {}),
    ...(voice ? { voice } : {}),
  });
}
