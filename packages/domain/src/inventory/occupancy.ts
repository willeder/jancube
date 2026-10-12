/** Day-level indicator for the C-02 calendar: ○ available, △ few left, ✕ full. */
export type OccupancyLevel = 'available' | 'few' | 'full'

/**
 * Coarse day indicator from room-minutes. The exact bookability of a time is decided on C-03 with the
 * allocation check; this is only a hint for choosing a date.
 */
export function occupancyLevel(capacityMinutes: number, bookedMinutes: number): OccupancyLevel {
  if (capacityMinutes <= 0) return 'full'
  const free = Math.max(0, capacityMinutes - bookedMinutes) / capacityMinutes
  if (free <= 0) return 'full'
  return free < 0.3 ? 'few' : 'available'
}
