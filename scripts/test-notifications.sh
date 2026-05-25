#!/bin/bash
set -e
PHONE="9876543210"
BASE="http://localhost:3000/api/v1"

echo "🧹 Clearing rate limits..."
docker exec chirawa_redis redis-cli --no-auth-warning -a chirawa_redis_dev_password \
  del "otp:rate:phone1h:$PHONE" "otp:rate:phone24h:$PHONE" > /dev/null

curl -s -X POST "$BASE/auth/send-otp" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$PHONE\"}" > /dev/null
sleep 1

OTP=$(docker exec chirawa_redis redis-cli --no-auth-warning -a chirawa_redis_dev_password \
  get "otp:data:$PHONE" | python3 -c "import sys,json; print(json.load(sys.stdin)['code'])")

TOKEN=$(curl -s -X POST "$BASE/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$PHONE\",\"otp\":\"$OTP\"}" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['tokens']['accessToken'])")
echo "✅ Token ready"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 1 — Register FCM device token"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -s -X POST "$BASE/notifications/register-token" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"token":"dev_fcm_token_abc123xyz","platform":"android"}' | python3 -m json.tool

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 2 — Place COD order (triggers notifications)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Add to cart
curl -s -X POST "$BASE/cart/items" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"productId":"7cc6c7bf-fa07-479e-b21b-77bd303a6ee6","quantity":3}' > /dev/null

CART_ID=$(curl -s "$BASE/cart" -H "Authorization: Bearer $TOKEN" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['cartId'])")

ADDRESS_ID=$(curl -s "$BASE/users/me/addresses" -H "Authorization: Bearer $TOKEN" | \
  python3 -c "import sys,json; a=json.load(sys.stdin); print(a[0]['id'] if a else '')")

ORDER=$(curl -s -X POST "$BASE/orders" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"cartId\":\"$CART_ID\",\"addressId\":\"$ADDRESS_ID\",\"paymentMethod\":\"cod\"}")

echo $ORDER | python3 -m json.tool
echo "(Watch server terminal for 📱 [DEV FCM] and 📨 [DEV SMS] messages)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 3 — Get notification history"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
sleep 1
curl -s "$BASE/notifications" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo ""
echo "✅ Notification tests complete!"
