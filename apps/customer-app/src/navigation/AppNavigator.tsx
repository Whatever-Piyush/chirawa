import React, { useEffect, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, ActivityIndicator, Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '@chirawa/i18n';
import { Colors } from '../theme';
import LanguagePickerScreen from '../screens/LanguagePickerScreen';

// Auth Screens
import OtpLoginScreen   from '../screens/auth/OtpLoginScreen';
import VerifyOtpScreen  from '../screens/auth/VerifyOtpScreen';

// Main Screens
import HomeScreen       from '../screens/home/HomeScreen';
import ShopDetailScreen from '../screens/shop/ShopDetailScreen';
import CartScreen       from '../screens/cart/CartScreen';
import CheckoutScreen   from '../screens/orders/CheckoutScreen';
import OrderTrackingScreen from '../screens/orders/OrderTrackingScreen';
import OrderHistoryScreen  from '../screens/orders/OrderHistoryScreen';
import ProfileScreen    from '../screens/profile/ProfileScreen';

export type RootStackParamList = {
  // Auth
  OtpLogin:   undefined;
  VerifyOtp:  { phone: string };
  // Main
  MainTabs:   undefined;
  ShopDetail: { shopId: string; shopName: string };
  Cart:       undefined;
  Checkout:   undefined;
  OrderTracking: { orderId: string };
};

export type TabParamList = {
  Home:         undefined;
  OrderHistory: undefined;
  Profile:      undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator<TabParamList>();

const TAB_ICONS: Record<string, string> = {
  Home: '🏠', OrderHistory: '📦', Profile: '👤',
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const scale = useRef(new Animated.Value(focused ? 1.1 : 1)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue:         focused ? 1.1 : 1,
      friction:        6,
      tension:         180,
      useNativeDriver: true,
    }).start();
  }, [focused, scale]);

  return (
    <Animated.Text
      style={[
        tabStyles.icon,
        { opacity: focused ? 1 : 0.45, transform: [{ scale }] },
      ]}
    >
      {TAB_ICONS[name] ?? '•'}
    </Animated.Text>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown:     false,
        tabBarIcon:      ({ focused }) => <TabIcon name={route.name} focused={focused} />,
        tabBarActiveTintColor:   Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopWidth:  0,
          height:          60 + insets.bottom,
          paddingBottom:   insets.bottom,
          paddingTop:      6,
          elevation:       20,
          shadowColor:     '#000',
          shadowOffset:    { width: 0, height: -4 },
          shadowOpacity:   0.1,
          shadowRadius:    20,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      })}
    >
      <Tab.Screen name="Home"         component={HomeScreen}         options={{ title: 'होम' }} />
      <Tab.Screen name="OrderHistory" component={OrderHistoryScreen} options={{ title: 'ऑर्डर' }} />
      <Tab.Screen name="Profile"      component={ProfileScreen}      options={{ title: 'प्रोफाइल' }} />
    </Tab.Navigator>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <Text style={styles.loadingEmoji}>🛵</Text>
      <ActivityIndicator color={Colors.primary} size="large" />
    </View>
  );
}

export default function AppNavigator() {
  const { state } = useAuth();
  const { hasChosen } = useLanguage();

  if (hasChosen === null) {
    return <View style={{ flex: 1, backgroundColor: Colors.primary }} />;
  }

  if (hasChosen === false) {
    return <LanguagePickerScreen />;
  }

  if (state.isLoading) return <LoadingScreen />;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{
        headerShown:      false,
        headerStyle:      { backgroundColor: Colors.white },
        statusBarColor:   Colors.primary as never,
        statusBarStyle:   'light' as never,
      }}>
        {state.isAuthenticated ? (
          <>
            <Stack.Screen name="MainTabs"      component={MainTabs} />
            <Stack.Screen name="ShopDetail"    component={ShopDetailScreen} />
            <Stack.Screen name="Cart"          component={CartScreen}
              options={{ headerShown: true, headerTitle: 'Cart', headerTintColor: Colors.primary }} />
            <Stack.Screen name="Checkout"      component={CheckoutScreen}
              options={{ headerShown: true, headerTitle: 'Checkout', headerTintColor: Colors.primary }} />
            <Stack.Screen name="OrderTracking" component={OrderTrackingScreen}
              options={{ headerShown: true, headerTitle: 'Order Track', headerTintColor: Colors.primary }} />
          </>
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

const styles = StyleSheet.create({
  loading: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: Colors.background,
  },
  loadingEmoji: { fontSize: 32, marginBottom: 16 },
});

const tabStyles = StyleSheet.create({
  icon: {
    fontSize: 22,
    lineHeight: 26,
  },
});
