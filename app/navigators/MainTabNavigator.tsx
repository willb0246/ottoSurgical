/**
 * The authenticated app's bottom tab bar — first one in this app (previously
 * a single flat stack). Three items: Case History (left), a raised "+"
 * button (center, jumps straight into starting a new case), and Setup
 * (right, where a surgeon manages their own common surgeries/templates).
 *
 * The center tab is a common "elevated action button" pattern — it has no
 * real screen; its tabPress is intercepted (e.preventDefault()) so it never
 * actually switches tabs, it just navigates into ScribeProcedureSelect.
 */
import { ImageStyle, Pressable, ViewStyle } from "react-native"
import { BottomTabBarButtonProps, createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { createNativeStackNavigator } from "@react-navigation/native-stack"

import { Icon } from "@/components/Icon"
import {
  ScribeCaptureScreen,
  ScribeExportScreen,
  ScribeProcedureSelectScreen,
  ScribeQueueScreen,
  ScribeReviewScreen,
} from "@/screens/scribe"
import {
  SpecialtiesScreen,
  SurgeryListScreen,
  SurgeryTemplateEditorScreen,
} from "@/screens/surgeries"
import { useAppTheme } from "@/theme/context"

import type {
  MainTabParamList,
  ScribeStackParamList,
  SurgeriesStackParamList,
} from "./navigationTypes"

const Tab = createBottomTabNavigator<MainTabParamList>()
const ScribeStack = createNativeStackNavigator<ScribeStackParamList>()
const SurgeriesStack = createNativeStackNavigator<SurgeriesStackParamList>()

function ScribeStackNavigator() {
  return (
    <ScribeStack.Navigator screenOptions={{ headerShown: false }} initialRouteName="ScribeQueue">
      <ScribeStack.Screen name="ScribeQueue" component={ScribeQueueScreen} />
      <ScribeStack.Screen name="ScribeProcedureSelect" component={ScribeProcedureSelectScreen} />
      <ScribeStack.Screen
        name="ScribeCapture"
        component={ScribeCaptureScreen}
        options={{ gestureEnabled: false }}
      />
      <ScribeStack.Screen name="ScribeReview" component={ScribeReviewScreen} />
      <ScribeStack.Screen name="ScribeExport" component={ScribeExportScreen} />
    </ScribeStack.Navigator>
  )
}

function SurgeriesStackNavigator() {
  return (
    <SurgeriesStack.Navigator screenOptions={{ headerShown: false }} initialRouteName="SurgeryList">
      <SurgeriesStack.Screen name="SurgeryList" component={SurgeryListScreen} />
      <SurgeriesStack.Screen name="SurgeryTemplateEditor" component={SurgeryTemplateEditorScreen} />
      <SurgeriesStack.Screen name="Specialties" component={SpecialtiesScreen} />
    </SurgeriesStack.Navigator>
  )
}

/** Never actually rendered — tabPress is always intercepted first. */
function NewCasePlaceholder() {
  return null
}

function NewCaseButton({
  onPress,
  onLongPress,
  testID,
  accessibilityState,
}: BottomTabBarButtonProps) {
  const { theme } = useAppTheme()
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      accessibilityState={accessibilityState}
      style={$fabWrapper}
      accessibilityRole="button"
      accessibilityLabel="Start new case"
    >
      <Icon
        icon="x"
        color={theme.colors.palette.neutral100}
        size={28}
        containerStyle={[$fab, { backgroundColor: theme.colors.palette.neutral800 }]}
        style={$fabIcon}
      />
    </Pressable>
  )
}

export function MainTabNavigator() {
  const {
    theme: { colors },
  } = useAppTheme()

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: { backgroundColor: colors.background, height: 64, paddingBottom: 8 },
      }}
    >
      <Tab.Screen
        name="ScribeTab"
        component={ScribeStackNavigator}
        options={{
          title: "Case History",
          tabBarIcon: ({ color, size }) => <Icon icon="menu" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="NewCaseTab"
        component={NewCasePlaceholder}
        options={{
          tabBarButton: (props) => <NewCaseButton {...props} />,
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault()
            navigation.navigate("ScribeTab", { screen: "ScribeProcedureSelect" })
          },
        })}
      />
      <Tab.Screen
        name="SurgeriesTab"
        component={SurgeriesStackNavigator}
        options={{
          title: "Setup",
          tabBarIcon: ({ color, size }) => <Icon icon="settings" color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  )
}

const $fabWrapper: ViewStyle = {
  top: -18,
  flex: 1,
  justifyContent: "center",
  alignItems: "center",
}
const $fab: ViewStyle = {
  width: 56,
  height: 56,
  borderRadius: 28,
  justifyContent: "center",
  alignItems: "center",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.25,
  shadowRadius: 4,
  elevation: 4,
}
const $fabIcon: ImageStyle = { transform: [{ rotate: "45deg" }] }
