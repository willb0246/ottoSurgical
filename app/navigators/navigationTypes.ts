import { ComponentProps } from "react"
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs"
import {
  CompositeScreenProps,
  NavigationContainer,
  NavigatorScreenParams,
} from "@react-navigation/native"
import { NativeStackScreenProps } from "@react-navigation/native-stack"

import type { ProcedureType } from "@/types/scribe"

// The "Scribe" tab's stack — today's capture flow, unchanged params.
export type ScribeStackParamList = {
  ScribeQueue: undefined
  ScribeProcedureSelect: undefined
  ScribeCapture: { sessionId: string; procedureType: ProcedureType }
  ScribeReview: { sessionId: string }
  ScribeExport: { sessionId: string }
}

// The "Surgeries" tab's stack — surgeon-managed procedures/templates.
export type SurgeriesStackParamList = {
  SurgeryList: undefined
  /** undefined procedureId => create mode. */
  SurgeryTemplateEditor: {
    procedureId?: string
    procedureOption?: { label: string; description: string }
  }
  Specialties: undefined
}

export type MainTabParamList = {
  ScribeTab: NavigatorScreenParams<ScribeStackParamList>
  /** The center "+" tab is never actually navigated into — its tabPress is
   * intercepted to jump straight to ScribeProcedureSelect instead. */
  NewCaseTab: undefined
  SurgeriesTab: NavigatorScreenParams<SurgeriesStackParamList>
}

// App Stack Navigator types
export type AppStackParamList = {
  Login: undefined
  Main: NavigatorScreenParams<MainTabParamList>
}

export type AppStackScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<
  AppStackParamList,
  T
>

export type ScribeStackScreenProps<T extends keyof ScribeStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<ScribeStackParamList, T>,
  BottomTabScreenProps<MainTabParamList>
>

export type SurgeriesStackScreenProps<T extends keyof SurgeriesStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<SurgeriesStackParamList, T>,
    BottomTabScreenProps<MainTabParamList>
  >

export interface NavigationProps extends Partial<
  ComponentProps<typeof NavigationContainer<AppStackParamList>>
> {}
