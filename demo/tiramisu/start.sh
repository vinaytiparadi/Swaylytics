#!/bin/bash

echo "Starting DeepAnalyze Tiramisu Frontend"
echo "========================================"

# Ensure logs directory exists
mkdir -p logs

TIRAMISU_PORT=${TIRAMISU_PORT:-3000}

# Kill existing process on port
if lsof -i :"$TIRAMISU_PORT" -t > /dev/null 2>&1; then
    echo "Port $TIRAMISU_PORT is in use. Killing..."
    kill -9 $(lsof -i :"$TIRAMISU_PORT" -t) 2>/dev/null
fi

echo ""
echo "Starting Tiramisu frontend..."
nohup npm run dev -- -p "$TIRAMISU_PORT" > logs/tiramisu.log 2>&1 &
TIRAMISU_PID=$!
echo $TIRAMISU_PID > logs/tiramisu.pid
echo "Tiramisu PID: $TIRAMISU_PID"
echo ""
echo "Service URL:"
echo "  Tiramisu: http://localhost:$TIRAMISU_PORT"
echo ""
echo "Log file:"
echo "  Tiramisu: logs/tiramisu.log"
echo ""
echo "Stop: kill \$(cat logs/tiramisu.pid)"
