import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { Colors } from '../theme';

import OtpLoginScreen    from '../screens/auth/OtpLoginScreen';
import VerifyOtpScreen   from '../screens/auth/VerifyOtpScreen';
import SetPinScreen      from '../screens/auth/SetPinScreen';
import OrderQueueScreen  from '../screens/orders/OrderQueueScreen';
import StockScreen       from '../screens/stock/StockScreen';
import SettlementScreen  from '../screens/settlement/SettlementScreen';
import ProfileScreen     from '../screens/profile/ProfileScreen';

export type RootStackParamList = {
  OtpLogin:   undefined;
  VerifyOtp:  { phone: string };
  SetPin:     { token: string };
  MainTabs:   undefined;
};

export type TabParamList = {
  Orders:     undefined;
  Stock:      undefined;
  Settlement: undefined;
  Profile:    undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator<TabParamList>();

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={({ route }) => ({
      headerShown: false,
      tabBarIcon: ({ focused }) => {
        const icons: Record<string, string> = { Orders: '📋', Stock: '📦', Settlement: '💰', Profile: '👤' };
        return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{icons[route.name] ?? '•'}</Text>;
      },
      tabBarActiveTintColor:   Colors.accent,
      tabBarInactiveTintColor: Colors.textMuted,
      tabBarStyle:             { height: 60, paddingBottom: 8 },
    })}>
      <Tab.Screen name="Orders"     component={OrderQueueScreen}  options={{ title: 'ऑर्डर' }} />
      <Tab.Screen name="Stock"      component={StockScreen}        options={{ title: 'स्टॉक' }} />
      <Tab.Screen name="Settlement" component={SettlementScreen}   options={{ title: 'पेमेंट' }} />
      <Tab.Screen name="Profile"    component={ProfileScreen}      options={{ title: 'प्रोफाइल' }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { state } = useAuth();

  if (state.isLoading) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator color={Colors.accent} size="large" />
    </View>;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {state.isAuthenticated && !state.requiresPin ? (
          <Stack.Screen name="MainTabs" component={MainTabs} />
        ) : state.isAuthenticated && state.requiresPin ? (
          <Stack.Screen name="SetPin"
            component={SetPinScreen}
            initialParams={{ token: state.token ?? '' }}
          />
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
