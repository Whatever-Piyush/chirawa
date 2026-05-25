#!/bin/bash
set -e

PHONE="9876543210"
PRODUCT_ID="7cc6c7bf-fa07-479e-b21b-77bd303a6ee6"
BASE="http://localhost:3000/api/v1"

echo "🧹 Clearing rate limits..."
docker exec chirawa_redis redis-cli --no-auth-warning -a chirawa_redis_dev_password \
  del "otp:rate:phone1h:$PHONE" "otp:rate:phone24h:$PHONE" "otp:rate:ip1h:127.0.0.1" > /dev/null

echo "📱 Sending OTP..."
curl -s -X POST "$BASE/auth/send-otp" \
  -H "Content-Type: application/json" \
  -d "{\"phone\": \"$PHONE\"}" > /dev/null
sleep 1

OTP=$(docker exec chirawa_redis redis-cli --no-auth-warning -a chirawa_redis_dev_password \
  get "otp:data:$PHONE" | python3 -c "import sys,json; print(json.load(sys.stdin)['code'])")
echo "🔐 OTP: $OTP"

TOKEN=$(curl -s -X POST "$BASE/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d "{\"phone\": \"$PHONE\", \"otp\": \"$OTP\"}" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['tokens']['accessToken'])")
echo "✅ Token: ${TOKEN:0:40}..."

# Get or create address
ADDR_COUNT=$(curl -s "$BASE/users/me/addresses" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")

if [ "$ADDR_COUNT" = "0" ]; then
  echo "📍 Creating address..."
  ADDRESS_ID=$(curl -s -X POST "$BASE/users/me/addresses" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"street":"Near Bus Stand","landmark":"Lala Petrol Pump ke samne","locality":"Main Bazar","pincode":"333026","lat":28.2312,"lng":75.6432,"isDefault":true}' | \
    python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
else
  ADDRESS_ID=$(curl -s "$BASE/users/me/addresses" \
    -H "Authorization: Bearer $TOKEN" | \
    python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
fi
echo "📍 Address ID: $ADDRESS_ID"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 1 — Add to cart + Place UPI order"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

curl -s -X POST "$BASE/cart/items" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"productId\": \"$PRODUCT_ID\", \"quantity\": 2}" > /dev/null

CART_ID=$(curl -s "$BASE/cart" -H "Authorization: Bearer $TOKEN" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['cartId'])")
echo "🛒 Cart ID: $CART_ID"

ORDER=$(curl -s -X POST "$BASE/orders" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"cartId\":\"$CART_ID\",\"addressId\":\"$ADDRESS_ID\",\"paymentMethod\":\"upi\"}")

ORDER_ID=$(echo $ORDER | python3 -c "import sys,json; print(json.load(sys.stdin)['orderId'])")
RAZORPAY_ORDER_ID=$(echo $ORDER | python3 -c "import sys,json; print(json.load(sys.stdin)['razorpayOrderId'])")
AMOUNT=$(echo $ORDER | python3 -c "import sys,json; print(json.load(sys.stdin)['amountPaise'])")

echo "📦 Order ID: $ORDER_ID"
echo "💳 Razorpay Order ID: $RAZORPAY_ORDER_ID"
echo "💰 Amount: ₹$(python3 -c "print($AMOUNT/100)")"
echo $ORDER | python3 -m json.tool

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 2 — Simulate Razorpay webhook"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

WEBHOOK_BODY=$(python3 -c "
import json, time
print(json.dumps({
  'id': 'evt_test_' + str(int(time.time())),
  'event': 'payment.captured',
  'payload': {'payment': {'entity': {
    'id': 'pay_test_$(date +%s)',
    'order_id': '$RAZORPAY_ORDER_ID',
    'method': 'upi',
    'amount': $AMOUNT,
    'status': 'captured'
  }}}
}))
")

WEBHOOK_RESULT=$(curl -s -X POST "$BASE/payments/webhook/razorpay" \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: dev_skip" \
  -d "$WEBHOOK_BODY")
echo $WEBHOOK_RESULT | python3 -m json.tool

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 3 — Verify order status = paid"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

STATUS=$(curl -s "$BASE/orders/$ORDER_ID" \
  -H "Authorization: Bearer $TOKEN" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
echo "Order status: $STATUS"

if [ "$STATUS" = "paid" ]; then
  echo "✅ ALL TESTS PASSED — Payment flow working end to end!"
else
  echo "❌ FAILED — Status is '$STATUS', expected 'paid'"
  exit 1
fi
