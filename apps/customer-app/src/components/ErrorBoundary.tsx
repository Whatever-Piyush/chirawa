import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, FontSize, MIN_TAP, Radius, Spacing } from '../theme';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message:  string | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message ?? null };
  }

  componentDidCatch(error: Error) {
    if (__DEV__) {
      console.error('[ErrorBoundary]', error);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>😕</Text>
        <Text style={styles.title}>कुछ गड़बड़ हो गई</Text>
        <Text style={styles.sub}>Something went wrong. Please try again.</Text>
        {this.state.message ? (
          <Text style={styles.detail} numberOfLines={3}>{this.state.message}</Text>
        ) : null}
        <TouchableOpacity style={styles.btn} onPress={this.handleRetry} activeOpacity={0.85}>
          <Text style={styles.btnText}>दोबारा कोशिश करें</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
    gap: Spacing.md,
  },
  emoji: { fontSize: 64 },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
  },
  sub: {
    fontSize: FontSize.md,
    color: Colors.textLight,
    textAlign: 'center',
  },
  detail: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: Spacing.sm,
  },
  btn: {
    marginTop: Spacing.lg,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    minHeight: MIN_TAP,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnText: {
    color: Colors.white,
    fontWeight: '800',
    fontSize: FontSize.md,
  },
});
