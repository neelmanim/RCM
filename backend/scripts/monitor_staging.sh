#!/bin/bash
# Monitor staging endpoints for 5 minutes — checks every 30 seconds
STAGING_URL="https://rcm-crm-staging.onrender.com"
PROD_URL="https://api.rcm.rcm.ai"
DURATION=300  # 5 minutes
INTERVAL=30
END_TIME=$(($(date +%s) + DURATION))
ROUND=1

echo "============================================="
echo "  RCM Staging Monitor — $(date)"
echo "  Duration: ${DURATION}s | Interval: ${INTERVAL}s"
echo "============================================="

while [ $(date +%s) -lt $END_TIME ]; do
    echo ""
    echo "── Round $ROUND | $(date '+%H:%M:%S') ──────────────────────"
    
    # Health check
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$STAGING_URL/api/health")
    echo "  [STAGING] /api/health          → $STATUS"
    
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$PROD_URL/api/health")
    echo "  [PROD]    /api/health          → $STATUS"
    
    # Check key endpoints on staging (no auth needed for health, auth needed for others)
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$STAGING_URL/api/pods")
    echo "  [STAGING] /api/pods            → $STATUS"
    
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$STAGING_URL/api/admin/users")
    echo "  [STAGING] /api/admin/users     → $STATUS"
    
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$STAGING_URL/api/admin/leads/upload-logs")
    echo "  [STAGING] /api/admin/leads/upload-logs → $STATUS"
    
    # Check the 404 that appeared in the screenshot — upload-batch-metrics/{id}/leads
    RESP=$(curl -s --max-time 10 "$STAGING_URL/api/admin/leads/upload-batch-metrics/test-id/leads?page=1&per_page=15")
    echo "  [STAGING] batch-metrics/test-id/leads → $(echo $RESP | head -c 100)"
    
    # Check response times
    TIME=$(curl -s -o /dev/null -w "%{time_total}" --max-time 10 "$STAGING_URL/api/health")
    echo "  [STAGING] Health response time: ${TIME}s"
    
    TIME=$(curl -s -o /dev/null -w "%{time_total}" --max-time 10 "$PROD_URL/api/health")
    echo "  [PROD]    Health response time: ${TIME}s"
    
    ROUND=$((ROUND + 1))
    
    REMAINING=$(( END_TIME - $(date +%s) ))
    if [ $REMAINING -gt 0 ]; then
        echo "  ⏳ ${REMAINING}s remaining..."
        sleep $INTERVAL
    fi
done

echo ""
echo "============================================="
echo "  Monitor complete — $(date)"
echo "============================================="
