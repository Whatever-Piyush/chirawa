#!/bin/bash

# 1. Configuration: Maximum kitni baar Claude ko try karne dena hai (taaki bill na fate)
MAX_ITERATIONS=3
CURRENT_ITERATION=1

# 2. Success Criteria: Wo command jiske pass hone par hum manenge ki bug fix ho gaya
# Tum ise badal sakte ho, jaise: "pnpm run test" ya "node scripts/test-realtime.mjs"
TEST_COMMAND="pnpm tsc --noEmit" 

echo "🚀 Starting Ralph Loop..."
echo "Target Command: $TEST_COMMAND"

while [ $CURRENT_ITERATION -le $MAX_ITERATIONS ]; do
    echo "------------------------------------------------"
    echo "🔄 Iteration $CURRENT_ITERATION of $MAX_ITERATIONS"
    
    # Run the test command and capture both normal output and errors
    echo "⏳ Running tests..."
    TEST_OUTPUT=$(eval $TEST_COMMAND 2>&1)
    TEST_EXIT_CODE=$?

    # 3. Success Check
    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo "✅ SUCCESS! All tests passed. Claude did its job."
        exit 0
    fi

    # 4. Failure Handling: Feed the error back to Claude Code
    echo "❌ Tests failed. Feeding errors back to Claude..."
    
    # Claude Code CLI command. We pass the exact error log back to it.
    claude "The command '$TEST_COMMAND' failed. Fix the codebase so this command passes. Do not stop until you think it is fixed. Here is the error output you need to fix: 
    
    $TEST_OUTPUT"

    CURRENT_ITERATION=$((CURRENT_ITERATION + 1))
done

echo "🛑 Max iterations ($MAX_ITERATIONS) reached! Claude couldn't fix it. Check manually."
exit 1