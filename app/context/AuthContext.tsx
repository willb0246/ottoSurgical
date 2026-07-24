import { createContext, FC, PropsWithChildren, useCallback, useContext, useMemo } from "react"
import { useMMKVString } from "react-native-mmkv"

import { cognitoSignOut } from "@/services/auth/cognitoAuthService"

export type AuthContextType = {
  isAuthenticated: boolean
  authToken?: string
  authEmail?: string
  /** Cognito `sub` — the `surgeonId` in every wire-contract call (PRD §3.1). */
  surgeonId?: string
  setAuthToken: (token?: string) => void
  setAuthEmail: (email: string) => void
  setSurgeonId: (id?: string) => void
  logout: () => void
  validationError: string
}

export const AuthContext = createContext<AuthContextType | null>(null)

export interface AuthProviderProps {}

export const AuthProvider: FC<PropsWithChildren<AuthProviderProps>> = ({ children }) => {
  const [authToken, setAuthToken] = useMMKVString("AuthProvider.authToken")
  const [authEmail, setAuthEmail] = useMMKVString("AuthProvider.authEmail")
  const [surgeonId, setSurgeonId] = useMMKVString("AuthProvider.surgeonId")

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
    setAuthToken,
    setAuthEmail,
    setSurgeonId,
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
