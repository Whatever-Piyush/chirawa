import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { LanguageProvider } from '@chirawa/i18n';
import { AuthProvider } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import ErrorBoundary from './src/components/ErrorBoundary';
import { ToastProvider } from './src/components/ui';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <ToastProvider>
          <LanguageProvider>
            <SafeAreaProvider>
              <AuthProvider>
                <StatusBar style="light" translucent backgroundColor="transparent" />
                <AppNavigator />
              </AuthProvider>
            </SafeAreaProvider>
          </LanguageProvider>
        </ToastProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
