import React from 'react';
import {
  NavigationContainer,
  DefaultTheme as NavDefaultTheme,
  type NavigatorScreenParams,
  type LinkingOptions,
} from '@react-navigation/native';
import { navigationRef } from './ref';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '@chirawa/i18n';
import { Colors, Spacing } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { Text, DotsLoader } from '../components/ui';
import LanguagePickerScreen from '../screens/LanguagePickerScreen';
import CustomTabBar from './CustomTabBar';
import { CartProvider } from '../context/CartContext';
import CartDockPill from '../components/CartDockPill';

// Auth Screens
import OtpLoginScreen from '../screens/auth/OtpLoginScreen';
import VerifyOtpScreen from '../screens/auth/VerifyOtpScreen';
import SetupProfileScreen from '../screens/auth/SetupProfileScreen'; // 🔴 NEW: Imported Setup Profile

// Main Screens
import HomeScreen from '../screens/home/HomeScreen';
import ShopDetailScreen from '../screens/shop/ShopDetailScreen';
import CheckoutScreen from '../screens/orders/CheckoutScreen';
import OrderTrackingScreen from '../screens/orders/OrderTrackingScreen';
import OrderHistoryScreen from '../screens/orders/OrderHistoryScreen';
import CategoriesScreen from '../screens/categories/CategoriesScreen';
import CategoryProductsScreen from '../screens/categories/CategoryProductsScreen';
import ChirawaSpecialScreen from '../screens/categories/ChirawaSpecialScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import AddressListScreen from '../screens/profile/AddressListScreen';
import AddressMapScreen from '../screens/profile/AddressMapScreen';
import AccountPrivacyScreen from '../screens/profile/AccountPrivacyScreen';
import ProductDetailScreen from '../screens/product/ProductDetailScreen';
import SearchScreen from '../screens/search/SearchScreen';
import ShareAddressScreen from '../screens/profile/ShareAddressScreen';
import ReceiveAddressScreen from '../screens/profile/ReceiveAddressScreen';
import OrderPlacedScreen from '../screens/orders/OrderPlacedScreen';

export type RootStackParamList = {
  // Auth
  OtpLogin: undefined;
  VerifyOtp: { phone: string };
  SetupProfile: undefined; // 🔴 NEW: Added to routing params
  // Main
  MainTabs: NavigatorScreenParams<TabParamList> | undefined;
  Search: undefined;
  EditProfile: undefined;
  AccountPrivacy: undefined;
  ShopDetail: { shopId: string; shopName: string };
  ProductDetail: { productId: string };
  CategoryProducts: { category: string };
  Checkout: undefined;
  OrderTracking: { orderId: string };
  OrderPlaced: { orderId: string };
  AddressList: undefined;
  AddressMap: undefined;
  // Address-sharing deep links (bringly://share-address, bringly://receive-address)
  ShareAddress: { from?: string; phone?: string } | undefined;
  ReceiveAddress: { payload?: string } | undefined;
};

// Maps incoming deep links to screens. A bringly:// custom scheme works in the
// dev/standalone build (app.json "scheme"); https prefixes are listed for when
// universal-link hosting is added on the domain later.
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['bringly://', 'https://bringly.in', 'https://www.bringly.in'],
  config: {
    screens: {
      ShareAddress:   'share-address',
      ReceiveAddress: 'receive-address',
    },
  },
};

// Visible tabs: Home · Order Again · Categories · Special. Profile is a real
// tab too (so navigate('MainTabs', { screen: 'Profile' }) from the header keeps
// working) but CustomTabBar hides it from the bar — it's reached via the Home
// header avatar. The "OrderHistory" route name is kept (vs renaming to
// "OrderAgain") so notification deep-links and Profile→orders nav stay intact;
// only its label/icon read "Order Again".
export type TabParamList = {
  Home: undefined;
  OrderHistory: undefined;
  Categories: undefined;
  Special: undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

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
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="OrderHistory" component={OrderHistoryScreen} />
        <Tab.Screen name="Categories" component={CategoriesScreen} />
        <Tab.Screen name="Special" component={ChirawaSpecialScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
      <CartDockPill />
    </View>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <Text variant="hero" style={{ fontSize: 32, marginBottom: Spacing.lg }}>
        🛵
      </Text>
      <DotsLoader color={Colors.primary} size={10} />
    </View>
  );
}

export default function AppNavigator() {
  const { state } = useAuth();
  const { hasChosen } = useLanguage();
  const { colors, scheme } = useTheme();

  if (hasChosen === null) {
    return <View style={{ flex: 1, backgroundColor: Colors.primary }} />;
  }

  if (hasChosen === false) {
    return <LanguagePickerScreen />;
  }

  if (state.isLoading) return <LoadingScreen />;

  // Root scene background follows the active scheme so screen edges / transitions
  // and any not-yet-migrated screens sit on the correct backdrop.
  const navTheme = {
    ...NavDefaultTheme,
    dark: scheme === 'dark',
    colors: {
      ...NavDefaultTheme.colors,
      background: colors.background,
      card: colors.surface,
      text: colors.textPrimary,
      border: colors.border,
      primary: colors.primary,
    },
  };

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking}>
      <CartProvider>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            headerStyle: { backgroundColor: colors.surface },
            headerTitleStyle: { color: colors.textPrimary },
            headerTintColor: colors.primary,
            contentStyle: { backgroundColor: colors.background },
            statusBarColor: Colors.primary as never,
            statusBarStyle: 'light' as never,
            animation: 'slide_from_right',
            animationDuration: 220,
          }}
        >
          {state.isAuthenticated ? (
            // 🔴 THE INTERCEPTOR LOGIC
            !state.name ? (
              <Stack.Screen name="SetupProfile" component={SetupProfileScreen} />
            ) : (
              <>
                <Stack.Screen name="MainTabs" component={MainTabs} />
                <Stack.Screen
                  name="Search"
                  component={SearchScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen name="EditProfile" component={SetupProfileScreen} />
                <Stack.Screen
                  name="AccountPrivacy"
                  component={AccountPrivacyScreen}
                  options={{ headerShown: true, headerTitle: 'Account & Privacy' }}
                />
                <Stack.Screen name="ShopDetail" component={ShopDetailScreen} />
                <Stack.Screen name="ProductDetail" component={ProductDetailScreen} />
                <Stack.Screen
                  name="CategoryProducts"
                  component={CategoryProductsScreen}
                  options={{ headerShown: true, headerTintColor: Colors.primary }}
                />
                <Stack.Screen
                  name="Checkout"
                  component={CheckoutScreen}
                  options={{
                    headerShown: true,
                    headerTitle: 'Checkout',
                    headerTintColor: Colors.primary,
                  }}
                />
                <Stack.Screen
                  name="OrderTracking"
                  component={OrderTrackingScreen}
                  options={{
                    headerShown: true,
                    headerTitle: 'Order Track',
                    headerTintColor: Colors.primary,
                  }}
                />
                <Stack.Screen
                  name="AddressList"
                  component={AddressListScreen}
                  options={{
                    headerShown: true,
                    headerTitle: 'My Addresses',
                    headerTintColor: Colors.primary,
                  }}
                />
                <Stack.Screen
                  name="AddressMap"
                  component={AddressMapScreen}
                  options={{
                    headerShown: true,
                    headerTitle: 'Pin your address',
                    headerTintColor: Colors.primary,
                  }}
                />
                <Stack.Screen name="ShareAddress" component={ShareAddressScreen} />
                <Stack.Screen name="ReceiveAddress" component={ReceiveAddressScreen} />
                <Stack.Screen
                  name="OrderPlaced"
                  component={OrderPlacedScreen}
                  options={{ gestureEnabled: false, animation: 'fade' }}
                />
              </>
            )
          ) : (
            <>
              <Stack.Screen name="OtpLogin" component={OtpLoginScreen} />
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
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});
