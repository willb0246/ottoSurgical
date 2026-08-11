/** Prototype id generator (no uuid dep; sufficient for local sessions/records). */
export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
