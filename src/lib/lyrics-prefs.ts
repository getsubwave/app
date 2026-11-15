import AsyncStorage from '@react-native-async-storage/async-storage';
import { clampLyricOffsetMs } from './lyrics';

const SHOWN_KEY = 'subwave.lyrics.shown.v1';
const DEVICE_OFFSET_KEY = 'subwave.lyrics.deviceOffsetMs.v1';

export async function loadLyricsShown(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SHOWN_KEY)) !== '0';
  } catch {
    return true;
  }
}

export async function saveLyricsShown(shown: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(SHOWN_KEY, shown ? '1' : '0');
  } catch {
  }
}

export async function loadLyricsDeviceOffset(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(DEVICE_OFFSET_KEY);
    return raw == null ? 0 : clampLyricOffsetMs(Number(raw));
  } catch {
    return 0;
  }
}

export async function saveLyricsDeviceOffset(offsetMs: number): Promise<void> {
  try {
    if (offsetMs === 0) await AsyncStorage.removeItem(DEVICE_OFFSET_KEY);
    else await AsyncStorage.setItem(DEVICE_OFFSET_KEY, String(offsetMs));
  } catch {
  }
}
