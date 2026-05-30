import React from 'react';
import { NavigationContainer, type NavigatorScreenParams } from '@react-navigation/native';
import { navigationRef } from './ref';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '@chirawa/i18n';
import { Colors, Spacing } from '../theme';
import { Text, DotsLoader } from '../components/ui';
import LanguagePickerScreen from '../screens/LanguagePickerScreen';
import CustomTabBar from './CustomTabBar';
import { CartProvider } from '../context/CartContext';
import CartDockPill from '../components/CartDockPill';

// Auth Screens
import OtpLoginScreen   from '../screens/auth/OtpLoginScreen';
import VerifyOtpScreen  from '../screens/auth/VerifyOtpScreen';

// Main Screens
import HomeScreen       from '../screens/home/HomeScreen';
import ShopDetailScreen from '../screens/shop/ShopDetailScreen';
import CartScreen       from '../screens/cart/CartScreen';
import CheckoutScreen   from '../screens/orders/CheckoutScreen';
import OrderTrackingScreen  from '../screens/orders/OrderTrackingScreen';
import OrderHistoryScreen   from '../screens/orders/OrderHistoryScreen';
import CategoriesScreen     from '../screens/categories/CategoriesScreen';
import CategoryProductsScreen from '../screens/categories/CategoryProductsScreen';
import ChirawaSpecialScreen from '../screens/categories/ChirawaSpecialScreen';
import ProfileScreen    from '../screens/profile/ProfileScreen';
import AddressListScreen from '../screens/profile/AddressListScreen';
import SearchScreen     from '../screens/search/SearchScreen';

export type RootStackParamList = {
  // Auth
  OtpLogin:   undefined;
  VerifyOtp:  { phone: string };
  // Main
  MainTabs:   NavigatorScreenParams<TabParamList> | undefined;
  Search:     undefined;
  ShopDetail: { shopId: string; shopName: string };
  CategoryProducts: { category: string };
  Cart:       undefined;
  Checkout:   undefined;
  OrderTracking: { orderId: string };
  AddressList: undefined;
};

// Visible tabs: Home · Order Again · Categories · Special. Profile is a real
// tab too (so navigate('MainTabs', { screen: 'Profile' }) from the header keeps
// working) but CustomTabBar hides it from the bar — it's reached via the Home
// header avatar. The "OrderHistory" route name is kept (vs renaming to
// "OrderAgain") so notification deep-links and Profile→orders nav stay intact;
// only its label/icon read "Order Again".
export type TabParamList = {
  Home:         undefined;
  OrderHistory: undefined;
  Categories:   undefined;
  Special:      undefined;
  Profile:      undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator<TabParamList>();

function MainTabs() {
  // The cart pill is a sibling of the Tab.Navigator so it floats above every
  // tab. pointerEvents on its wrapper let touches pass through everywhere
  // except the pill itself.
  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <CustomTabBar {...props} />}
      >
        <Tab.Screen name="Home"         component={HomeScreen} />
        <Tab.Screen name="OrderHistory" component={OrderHistoryScreen} />
        <Tab.Screen name="Categories"   component={CategoriesScreen} />
        <Tab.Screen name="Special"      component={ChirawaSpecialScreen} />
        <Tab.Screen name="Profile"      component={ProfileScreen} />
      </Tab.Navigator>
      <CartDockPill />
    </View>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <Text variant="hero" style={{ fontSize: 32, marginBottom: Spacing.lg }}>🛵</Text>
      <DotsLoader color={Colors.primary} size={10} />
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
    <NavigationContainer ref={navigationRef}>
      <CartProvider>
      <Stack.Navigator screenOptions={{
        headerShown:       false,
        headerStyle:       { backgroundColor: Colors.white },
        statusBarColor:    Colors.primary as never,
        statusBarStyle:    'light' as never,
        animation:         'slide_from_right',
        animationDuration: 220,
      }}>
        {state.isAuthenticated ? (
          <>
            <Stack.Screen name="MainTabs"      component={MainTabs} />
            <Stack.Screen name="Search"        component={SearchScreen} options={{ headerShown: false }} />
            <Stack.Screen name="ShopDetail"    component={ShopDetailScreen} />
            <Stack.Screen name="CategoryProducts" component={CategoryProductsScreen}
              options={{ headerShown: true, headerTintColor: Colors.primary }} />
            <Stack.Screen name="Cart"          component={CartScreen}
              options={{ headerShown: true, headerTitle: 'Cart', headerTintColor: Colors.primary }} />
            <Stack.Screen name="Checkout"      component={CheckoutScreen}
              options={{ headerShown: true, headerTitle: 'Checkout', headerTintColor: Colors.primary }} />
            <Stack.Screen name="OrderTracking" component={OrderTrackingScreen}
              options={{ headerShown: true, headerTitle: 'Order Track', headerTintColor: Colors.primary }} />
            <Stack.Screen name="AddressList"   component={AddressListScreen}
              options={{ headerShown: true, headerTitle: 'My Addresses', headerTintColor: Colors.primary }} />
          </>
        ) : (
          <>
            <Stack.Screen name="OtpLogin"  component={OtpLoginScreen} />
            <Stack.Screen name="VerifyOtp" component={VerifyOtpScreen} />
          </>
        )}
      </Stack.Navigator>
      </CartProvider>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: Colors.background,
  },
});
