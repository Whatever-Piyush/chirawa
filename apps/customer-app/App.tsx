import 'react-native-gesture-handler';
import React from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import { LanguageProvider } from '@chirawa/i18n';
import { AuthProvider } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import ErrorBoundary from './src/components/ErrorBoundary';
import NotificationsBootstrap from './src/components/NotificationsBootstrap';
import { ToastProvider } from './src/components/ui';
import { FlyToCartProvider } from './src/components/cart/FlyToCart';
import { Colors } from './src/theme';
import { ThemeProvider } from './src/theme/ThemeContext';

export default function App() {
  // Gate the tree on Poppins so every <Text> renders with the brand font
  // on first paint — avoids the "System → Poppins" flash. The four weights
  // 400/500/600/700 cover regular/medium/semibold/bold; heavier weights fall
  // back to 700 via poppinsFamily() in the theme.
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  if (!fontsLoaded) {
    // Native Expo splash stays visible while we resolve fonts. A blank cream
    // view here is the safety net in case the splash dismisses early.
    return <View style={{ flex: 1, backgroundColor: Colors.background }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <ThemeProvider>
            <ToastProvider>
              <LanguageProvider>
                <AuthProvider>
                  <FlyToCartProvider>
                    <StatusBar style="light" translucent backgroundColor="transparent" />
                    <NotificationsBootstrap />
                    <AppNavigator />
                  </FlyToCartProvider>
                </AuthProvider>
              </LanguageProvider>
            </ToastProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
