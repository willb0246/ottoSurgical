import { createContext, FC, PropsWithChildren, useCallback, useContext, useMemo } from "react"
import { useMMKVObject, useMMKVString } from "react-native-mmkv"

import { cognitoSignOut } from "@/services/auth/cognitoAuthService"
import type { Specialty } from "@/types/scribe"

export type AuthContextType = {
  isAuthenticated: boolean
  authToken?: string
  authEmail?: string
  /** Cognito `sub` — the `surgeonId` in every wire-contract call (PRD §3.1). */
  surgeonId?: string
  /**
   * The surgical specialties this surgeon practices — set once in Setup >
   * My specialties, applied to every surgery they create. Multi-select
   * (a surgeon can be e.g. both endovascular and open vascular); today the
   * app uses only the first entry for transcription vocabulary selection —
   * combining multiple vocabularies per case is future work.
   */
  specialties: Specialty[]
  setAuthToken: (token?: string) => void
  setAuthEmail: (email: string) => void
  setSurgeonId: (id?: string) => void
  setSpecialties: (specialties: Specialty[]) => void
  logout: () => void
  validationError: string
}

export const AuthContext = createContext<AuthContextType | null>(null)

export interface AuthProviderProps {}

export const AuthProvider: FC<PropsWithChildren<AuthProviderProps>> = ({ children }) => {
  const [authToken, setAuthToken] = useMMKVString("AuthProvider.authToken")
  const [authEmail, setAuthEmail] = useMMKVString("AuthProvider.authEmail")
  const [surgeonId, setSurgeonId] = useMMKVString("AuthProvider.surgeonId")
  const [specialties, setSpecialties] = useMMKVObject<Specialty[]>("AuthProvider.specialties")

  const logout = useCallback(() => {
    cognitoSignOut().catch(() => undefined)
    setAuthToken(undefined)
    setAuthEmail("")
    setSurgeonId(undefined)
  }, [setAuthEmail, setAuthToken, setSurgeonId])

  const validationError = useMemo(() => {
    if (!authEmail || authEmail.length === 0) return "can't be blank"
    if (authEmail.length < 6) return "must be at least 6 characters"
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail)) return "must be a valid email address"
    return ""
  }, [authEmail])

  const value = {
    isAuthenticated: !!authToken,
    authToken,
    authEmail,
    surgeonId,
    specialties: specialties ?? [],
    setAuthToken,
    setAuthEmail,
    setSurgeonId,
    setSpecialties,
    logout,
    validationError,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used within an AuthProvider")
  return context
}
