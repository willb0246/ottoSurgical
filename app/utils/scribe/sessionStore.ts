/**
 * Local capture-session store (MMKV).
 *
 * The prototype keeps sessions + their recorded utterance files on-device.
 * Backend upload/generation (Transcribe + Claude) is deferred — this is the
 * source of truth for the audio-capture demo so a case is never lost across
 * backgrounding or app restart (PRD §7 reliability).
 */
import { MMKV } from "react-native-mmkv"

import type { ProcedureType } from "@/types/scribe"

const storage = new MMKV({ id: "scribe-sessions" })
const KEY = "sessions"

export interface RecordedSegment {
  segmentId: string
  uri: string
  durationMs: number
  sampleRate: number
  startedAt: string
  endReason: string
}

export interface StoredSession {
  sessionId: string
  procedureType: ProcedureType
  /** Snapshot of the procedure's label at case start, for history display even if later renamed. */
  procedureLabel: string
  /** Surgeon-given case title, e.g. patient initials or room number. */
  title?: string
  startedAt: string
  endedAt?: string
  /** Route telemetry captured at session start (HQ vs HFP, sample rate). */
  route?: {
    portType: string
    sampleRate: number
    highQuality: boolean
    isBluetooth: boolean
  }
  segments: RecordedSegment[]
}

function readAll(): StoredSession[] {
  const raw = storage.getString(KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as StoredSession[]
  } catch {
    return []
  }
}

function writeAll(sessions: StoredSession[]): void {
  storage.set(KEY, JSON.stringify(sessions))
}

export function listSessions(): StoredSession[] {
  // Newest first.
  return readAll().sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export function getSession(sessionId: string): StoredSession | undefined {
  return readAll().find((s) => s.sessionId === sessionId)
}

export function createSession(session: StoredSession): void {
  const all = readAll().filter((s) => s.sessionId !== session.sessionId)
  all.push(session)
  writeAll(all)
}

export function updateSession(sessionId: string, patch: Partial<StoredSession>): void {
  const all = readAll()
  const idx = all.findIndex((s) => s.sessionId === sessionId)
  if (idx === -1) return
  all[idx] = { ...all[idx], ...patch }
  writeAll(all)
}

export function addSegment(sessionId: string, segment: RecordedSegment): void {
  const all = readAll()
  const idx = all.findIndex((s) => s.sessionId === sessionId)
  if (idx === -1) return
  all[idx] = { ...all[idx], segments: [...all[idx].segments, segment] }
  writeAll(all)
}
