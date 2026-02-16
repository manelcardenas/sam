#!/bin/bash
# Create a test user and get a valid Cognito token
# Usage: ./create_test_user.sh [email] [password]

set -e

EMAIL="${1:-test@example.com}"
PASSWORD="${2:-TestPass123!}"

# Load Cognito config from .env
source "$(dirname "$0")/../../.env"

if [ -z "$COGNITO_USER_POOL_ID" ] || [ -z "$COGNITO_CLIENT_ID" ]; then
    echo "❌ Error: COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID must be set in .env"
    exit 1
fi

echo "📝 Creating user: $EMAIL"

# Sign up user
aws cognito-idp sign-up \
    --client-id "$COGNITO_CLIENT_ID" \
    --username "$EMAIL" \
    --password "$PASSWORD" \
    --user-attributes Name=email,Value="$EMAIL" \
    --region "$AWS_REGION" 2>/dev/null || echo "User may already exist"

# Confirm user (skip email verification)
echo "✅ Confirming user (skipping email verification)..."
aws cognito-idp admin-confirm-sign-up \
    --user-pool-id "$COGNITO_USER_POOL_ID" \
    --username "$EMAIL" \
    --region "$AWS_REGION"

# Get token
echo "🔑 Getting token..."
RESPONSE=$(aws cognito-idp initiate-auth \
    --client-id "$COGNITO_CLIENT_ID" \
    --auth-flow USER_PASSWORD_AUTH \
    --auth-parameters USERNAME="$EMAIL",PASSWORD="$PASSWORD" \
    --region "$AWS_REGION")

TOKEN=$(echo "$RESPONSE" | jq -r '.AuthenticationResult.IdToken')

echo ""
echo "✅ Success! User created and token generated:"
echo ""
echo "📧 Email: $EMAIL"
echo "🔐 Password: $PASSWORD"
echo ""
echo "🔑 ID Token (valid for 1 hour):"
echo "$TOKEN"
echo ""
echo "📋 Test with curl:"
echo "curl http://localhost:9000/recipes -H \"Authorization: Bearer $TOKEN\""
