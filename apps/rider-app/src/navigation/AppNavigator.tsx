import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '@chirawa/i18n';
import { Colors } from '../theme';
import LanguagePickerScreen from '../screens/LanguagePickerScreen';

import OtpLoginScreen    from '../screens/auth/OtpLoginScreen';
import VerifyOtpScreen   from '../screens/auth/VerifyOtpScreen';
import SetPinScreen      from '../screens/auth/SetPinScreen';
import HomeScreen        from '../screens/home/HomeScreen';
import DeliveryScreen    from '../screens/delivery/DeliveryScreen';
import EarningsScreen    from '../screens/earnings/EarningsScreen';
import ProfileScreen     from '../screens/profile/ProfileScreen';

export type RootStackParamList = {
  OtpLogin:  undefined;
  VerifyOtp: { phone: string };
  SetPin:    { token: string };
  MainTabs:  undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={({ route }) => ({
      headerShown: false,
      tabBarIcon: ({ focused }) => {
        const icons: Record<string, string> = { Home: '🏠', Delivery: '🚴', Earnings: '💰', Profile: '👤' };
        return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{icons[route.name] ?? '•'}</Text>;
      },
      tabBarActiveTintColor:   Colors.primary,
      tabBarInactiveTintColor: Colors.textMuted,
      tabBarStyle:             { height: 60, paddingBottom: 8 },
    })}>
      <Tab.Screen name="Home"     component={HomeScreen}     options={{ title: 'होम' }} />
      <Tab.Screen name="Delivery" component={DeliveryScreen} options={{ title: 'डिलीवरी' }} />
      <Tab.Screen name="Earnings" component={EarningsScreen} options={{ title: 'कमाई' }} />
      <Tab.Screen name="Profile"  component={ProfileScreen}  options={{ title: 'प्रोफाइल' }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { state } = useAuth();
  const { hasChosen } = useLanguage();

  if (hasChosen === null) {
    return <View style={{ flex: 1, backgroundColor: '#FF3E6C' }} />;
  }

  if (hasChosen === false) {
    return <LanguagePickerScreen />;
  }

  if (state.isLoading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color={Colors.primary} size="large" /></View>;
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {state.isAuthenticated && !state.requiresPin ? (
          <Stack.Screen name="MainTabs" component={MainTabs} />
        ) : state.isAuthenticated && state.requiresPin ? (
          <Stack.Screen name="SetPin" component={SetPinScreen} initialParams={{ token: state.token ?? '' }} />
        ) : (
          <>
            <Stack.Screen name="OtpLogin"  component={OtpLoginScreen} />
            <Stack.Screen name="VerifyOtp" component={VerifyOtpScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
