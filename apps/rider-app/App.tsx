import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from '@chirawa/i18n';
import { AuthProvider } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import NotificationsBootstrap from './src/components/NotificationsBootstrap';

export default function App() {
  return (
    <LanguageProvider>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" backgroundColor="#27AE60" />
          <NotificationsBootstrap />
          <AppNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </LanguageProvider>
  );
}
