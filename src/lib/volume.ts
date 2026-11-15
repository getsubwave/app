import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'subwave.volume.v1';

export async function loadVolumePref(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw == null) return null;
    const v = Number(raw);
    if (!Number.isFinite(v)) return null;
    return Math.min(1, Math.max(0, v));
  } catch {
    return null;
  }
}

export async function saveVolumePref(volume: number): Promise<void> {
  try {
    const v = Math.min(1, Math.max(0, volume));
    await AsyncStorage.setItem(STORAGE_KEY, String(v));
  } catch {
  }
}
