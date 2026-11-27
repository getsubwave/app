import type { ActiveShow, SchedulePersona, ScheduleShow } from './types';

export function personaBlurbs(persona: SchedulePersona | null | undefined): string[] {
  if (!persona) return [];
  return [persona.tagline, persona.soul].map((v) => (v || '').trim()).filter(Boolean);
}

export function showBlurb(
  show: { description?: string | null; topic?: string | null } | null | undefined,
): string {
  const description = typeof show?.description === 'string' ? show.description.trim() : '';
  if (description) return description;
  return typeof show?.topic === 'string' ? show.topic.trim() : '';
}

export function onNowShow(
  activeShow: ActiveShow | null | undefined,
  slotShow: ScheduleShow | null | undefined,
  shows: ScheduleShow[] | null | undefined,
): ScheduleShow | null {
  const name = activeShow?.name;
  if (!name) return null;
  if (slotShow?.name === name) return slotShow;
  return (shows || []).find((s) => s.name === name) ?? null;
}

export function personaById(
  personas: SchedulePersona[] | null | undefined,
  id: string | null | undefined,
): SchedulePersona | null {
  if (!id) return null;
  return (personas || []).find((p) => p.id === id) ?? null;
}
