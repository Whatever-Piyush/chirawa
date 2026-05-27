import React, { useEffect, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  createBottomTabNavigator,
  type BottomTabBarButtonProps,
} from '@react-navigation/bottom-tabs';
import {
  View,
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useLanguage, useT } from '@chirawa/i18n';
import { Colors, FontSize, Spacing } from '../theme';
import { Text } from '../components/ui';
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

const TAB_ICONS: Record<keyof TabParamList, string> = {
  Home:         '🏠',
  OrderHistory: '📦',
  Profile:      '👤',
};

function TabIcon({ name, focused }: { name: keyof TabParamList; focused: boolean }) {
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
    <Animated.View style={{ transform: [{ scale }] }}>
      <Text
        variant="body"
        style={{ fontSize: 22, lineHeight: 26, opacity: focused ? 1 : 0.55 }}
      >
        {TAB_ICONS[name]}
      </Text>
    </Animated.View>
  );
}

function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text
      variant="caption"
      color={focused ? Colors.primary : Colors.textTertiary}
      weight={focused ? 'bold' : 'regular'}
      style={{ fontSize: FontSize.xs, marginTop: 2 }}
    >
      {label}
    </Text>
  );
}

function TabButton(props: BottomTabBarButtonProps) {
  const { onPress, children, accessibilityLabel, testID } = props;
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    Animated.spring(scale, {
      toValue: 0.9, friction: 8, tension: 300, useNativeDriver: true,
    }).start();
  };
  const pressOut = () => {
    Animated.spring(scale, {
      toValue: 1, friction: 8, tension: 300, useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress as (e: GestureResponderEvent) => void}
      onPressIn={pressIn}
      onPressOut={pressOut}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      testID={testID}
      style={tabStyles.button}
    >
      <Animated.View style={[tabStyles.buttonInner, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  const t = useT();

  const tabLabels: Record<keyof TabParamList, string> = {
    Home:         t('home.tabHome'),
    OrderHistory: t('home.tabOrders'),
    Profile:      t('home.tabProfile'),
  };

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true,
        tabBarButton: (props) => <TabButton {...props} />,
        tabBarIcon:  ({ focused }) => (
          <TabIcon name={route.name as keyof TabParamList} focused={focused} />
        ),
        tabBarLabel: ({ focused }) => (
          <TabLabel label={tabLabels[route.name as keyof TabParamList]} focused={focused} />
        ),
        tabBarActiveTintColor:   Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopWidth:  0,
          height:          56 + insets.bottom,
          paddingBottom:   insets.bottom,
          paddingTop:      Spacing.xs,
          shadowColor:     '#000',
          shadowOpacity:   0.08,
          shadowOffset:    { width: 0, height: -3 },
          shadowRadius:    10,
          elevation:       16,
        },
      })}
    >
      <Tab.Screen name="Home"         component={HomeScreen} />
      <Tab.Screen name="OrderHistory" component={OrderHistoryScreen} />
      <Tab.Screen name="Profile"      component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <Text variant="hero" style={{ fontSize: 32, marginBottom: Spacing.lg }}>🛵</Text>
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
});

const tabStyles = StyleSheet.create({
  button: {
    flex: 1,
    alignItems:     'center',
    justifyContent: 'center',
  },
  buttonInner: {
    alignItems:     'center',
    justifyContent: 'center',
    paddingTop:     Spacing.xs,
  },
});
