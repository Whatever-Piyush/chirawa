import React, { useMemo } from 'react';
import { Modal, View, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

// Razorpay Standard Checkout rendered inside a WebView. We deliberately avoid
// the native `react-native-razorpay` SDK (no Expo config plugin, build-flaky on
// SDK 54). The checkout.js page is loaded from an inline HTML string; the JS
// `handler` / `modal.ondismiss` callbacks post the result back over the bridge.

export interface RazorpaySuccess {
  razorpayPaymentId: string;
  razorpayOrderId:   string;
  razorpaySignature: string;
}

interface Props {
  visible:         boolean;
  keyId:           string;
  razorpayOrderId: string;
  amountPaise:     number;
  merchantName?:   string;
  description?:    string;
  prefill?:        { name?: string; email?: string; contact?: string };
  themeColor?:     string;
  onSuccess:       (r: RazorpaySuccess) => void;
  onDismiss:       () => void;
  onError:         (message: string) => void;
}

function buildHtml(opts: {
  keyId: string; orderId: string; amountPaise: number;
  name: string; description: string;
  prefill: { name?: string; email?: string; contact?: string };
  themeColor: string;
}): string {
  // JSON.stringify every interpolated value so quotes/specials can't break the
  // surrounding JS or inject anything.
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
</head>
<body style="background:#ffffff;">
  <script>
    function post(msg) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }
    }
    var options = {
      key: ${JSON.stringify(opts.keyId)},
      order_id: ${JSON.stringify(opts.orderId)},
      amount: ${opts.amountPaise},
      currency: "INR",
      name: ${JSON.stringify(opts.name)},
      description: ${JSON.stringify(opts.description)},
      prefill: ${JSON.stringify(opts.prefill)},
      theme: { color: ${JSON.stringify(opts.themeColor)} },
      // UPI only — zero MDR (cards/wallets/netbanking carry a ~2% fee). Hide every
      // other method and surface just the UPI block.
      method: { upi: true, card: false, netbanking: false, wallet: false, paylater: false, emi: false },
      config: {
        display: {
          blocks: {
            upi: { name: "Pay using UPI", instruments: [{ method: "upi" }] }
          },
          sequence: ["block.upi"],
          preferences: { show_default_blocks: false }
        }
      },
      handler: function (response) {
        post({
          type: "success",
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_signature: response.razorpay_signature
        });
      },
      modal: {
        escape: true,
        ondismiss: function () { post({ type: "dismiss" }); }
      }
    };
    try {
      var rzp = new Razorpay(options);
      rzp.on('payment.failed', function (resp) {
        post({ type: "failed", message: (resp && resp.error && resp.error.description) || "Payment fail ho gaya" });
      });
      rzp.open();
    } catch (e) {
      post({ type: "error", message: String(e) });
    }
  </script>
</body>
</html>`;
}

export default function RazorpayCheckout({
  visible, keyId, razorpayOrderId, amountPaise,
  merchantName = 'Chirawa', description = 'Order payment',
  prefill = {}, themeColor = '#FF5A1F',
  onSuccess, onDismiss, onError,
}: Props) {
  const html = useMemo(
    () => buildHtml({
      keyId, orderId: razorpayOrderId, amountPaise,
      name: merchantName, description, prefill, themeColor,
    }),
    [keyId, razorpayOrderId, amountPaise, merchantName, description, prefill, themeColor],
  );

  function handleMessage(event: WebViewMessageEvent) {
    let data: { type?: string; message?: string;
      razorpay_payment_id?: string; razorpay_order_id?: string; razorpay_signature?: string };
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    switch (data.type) {
      case 'success':
        if (data.razorpay_payment_id && data.razorpay_order_id && data.razorpay_signature) {
          onSuccess({
            razorpayPaymentId: data.razorpay_payment_id,
            razorpayOrderId:   data.razorpay_order_id,
            razorpaySignature: data.razorpay_signature,
          });
        } else {
          onError('Payment response adhura mila');
        }
        break;
      case 'dismiss':
        onDismiss();
        break;
      case 'failed':
      case 'error':
        onError(data.message ?? 'Payment fail ho gaya');
        break;
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.container}>
        <WebView
          originWhitelist={['*']}
          source={{ html, baseUrl: 'https://razorpay.com' }}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={themeColor} />
            </View>
          )}
          onError={() => onError('Payment page load nahi hua')}
          // UPI / wallet apps open via non-http schemes (upi:, intent:, tez:);
          // hand those off to the OS instead of trying to load them in-WebView.
          onShouldStartLoadWithRequest={(req) => {
            if (/^https?:\/\//.test(req.url) || req.url.startsWith('about:')) return true;
            Linking.openURL(req.url).catch(() => undefined);
            return false;
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  loading: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center', backgroundColor: '#ffffff',
  },
});
