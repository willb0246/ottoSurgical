import { ComponentProps } from "react"
import { NavigationContainer } from "@react-navigation/native"
import { NativeStackScreenProps } from "@react-navigation/native-stack"

import type { ProcedureType } from "@/types/scribe"

// App Stack Navigator types
export type AppStackParamList = {
  Login: undefined
  ScribeQueue: undefined
  ScribeProcedureSelect: undefined
  ScribeCapture: { sessionId: string; procedureType: ProcedureType }
  ScribeReview: { sessionId: string }
  ScribeExport: { sessionId: string }
}

export type AppStackScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<
  AppStackParamList,
  T
>

export interface NavigationProps
  extends Partial<ComponentProps<typeof NavigationContainer<AppStackParamList>>> {}
