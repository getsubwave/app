import { useWindowDimensions } from 'react-native';
import { isWide } from '@/lib/layout';

export function useWideLayout(): boolean {
  const { width } = useWindowDimensions();
  return isWide(width);
}
