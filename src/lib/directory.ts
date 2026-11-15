import Constants from 'expo-constants';
import { readDirectory } from './directory-read';
import { featuredStation } from './station';

export interface DirectoryStation {
  slug: string;
  name: string;
  url: string;
  location?: string;
  country?: string;
  operator?: string;
  genre?: string;
  description?: string;
  featured?: boolean;
  submitted?: string;
}

export function directoryUrl(): string {
  const extra = Constants.expoConfig?.extra as { directoryUrl?: string } | undefined;
  return (extra?.directoryUrl || featuredStation().url).replace(/\/+$/, '');
}

export function fetchDirectory(signal?: AbortSignal): Promise<DirectoryStation[]> {
  return readDirectory(() => `${directoryUrl()}/stations.json`, signal);
}
