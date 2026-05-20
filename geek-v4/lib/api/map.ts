import { supabase } from '../supabase';

export type MapLocation = {
  id: string;
  name: string;
  description: string | null;
  lat: number;
  lng: number;
  address: string | null;
  tag_name: string | null;
  category: string;
  rating: number | null;
  event_date: string | null;
  kind: 'event' | 'spot';
};

export async function fetchEventLocations(): Promise<MapLocation[]> {
  const { data } = await supabase
    .from('events')
    .select('id, title, description, lat, lng, location, tag_name, event_date')
    .gte('event_date', new Date().toISOString().slice(0, 10))
    .not('lat', 'is', null)
    .order('event_date', { ascending: true });
  return ((data ?? []) as Array<{ id: string; title: string; description: string | null; lat: number; lng: number; location: string | null; tag_name: string | null; event_date: string }>)
    .map((e) => ({
      id: e.id,
      name: e.title,
      description: e.description,
      lat: e.lat,
      lng: e.lng,
      address: e.location,
      tag_name: e.tag_name,
      category: 'event',
      rating: null,
      event_date: e.event_date,
      kind: 'event' as const,
    }));
}

export async function fetchTourismSpots(): Promise<MapLocation[]> {
  const { data } = await supabase
    .from('tourism_spots')
    .select('*')
    .order('rating', { ascending: false });
  return ((data ?? []) as Array<{ id: string; name: string; description: string | null; lat: number; lng: number; address: string | null; tag_name: string | null; category: string; rating: number | null }>)
    .map((s) => ({ ...s, event_date: null, kind: 'spot' as const }));
}

// ハバーシン距離 (km)
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
