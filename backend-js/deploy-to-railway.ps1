# OGFX Backend Railway Deployment Script
# Run this in PowerShell as Administrator

Write-Host "ðŸš€ OGFX Railway Deployment Script" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green

# Check if railway CLI is installed
try {
    $railwayVersion = railway --version
    Write-Host "âœ“ Railway CLI found: $railwayVersion" -ForegroundColor Green
} catch {
    Write-Host "âš  Railway CLI not found. Installing..." -ForegroundColor Yellow
    npm install -g @railway/cli
}

# Navigate to backend directory
$backendPath = "C:\Users\ansh\OneDrive\Desktop\ogfx\backend-js"
Set-Location $backendPath
Write-Host "âœ“ Working directory: $backendPath" -ForegroundColor Green

# Check if already linked to railway
try {
    $projectInfo = railway status 2>&1
    Write-Host "âœ“ Project linked to Railway" -ForegroundColor Green
} catch {
    Write-Host "âš  Project not linked. Running railway link..." -ForegroundColor Yellow
    railway link
}

Write-Host ""
Write-Host "ðŸ“¦ Setting Environment Variables..." -ForegroundColor Cyan

# Set all environment variables
$envVars = @{
    "NODE_ENV" = "production"
    "PORT" = "3001"
    "HOST" = "0.0.0.0"
    "LOG_LEVEL" = "info"
    "DATABASE_URL" = "postgresql://postgres.iwvgdaswmxzxgnptgghb:[YOUR_DB_PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres"
    "DIRECT_URL" = "postgresql://postgres.iwvgdaswmxzxgnptgghb:[YOUR_DB_PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
    "SUPABASE_URL" = "https://iwvgdaswmxzxgnptgghb.supabase.co"
    "SUPABASE_KEY" = "sb_publishable_eDlFrkEY0d9FHiJu6VWfeQ_QGinxII9"
    "JWT_SECRET" = "your-super-secret-jwt-key-min-32-chars-long"
    "CORS_ORIGIN" = "*"
    "API_URL" = "https://ogfx-production.up.railway.app"
    "WS_URL" = "wss://ogfx-production.up.railway.app/ws"
    "BINANCE_API_URL" = "https://api.binance.com"
    "SIGNAL_INTERVAL_SECONDS" = "10"
    "MAX_DAILY_SIGNALS" = "10"
    "MIN_CONFIDENCE" = "60"
}

foreach ($var in $envVars.GetEnumerator()) {
    Write-Host "Setting $($var.Key)..." -ForegroundColor Gray
    $null = railway variables set "$($var.Key)=$($var.Value)" 2>&1
}

Write-Host ""
Write-Host "âœ“ All environment variables set!" -ForegroundColor Green
Write-Host ""
Write-Host "ðŸš€ Deploying to Railway..." -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan

# Deploy
railway up

Write-Host ""
Write-Host "âœ… Deployment Complete!" -ForegroundColor Green
Write-Host ""

# Get domain
try {
    $domain = railway domain 2>&1
    Write-Host "ðŸŒ Your API URL: $domain" -ForegroundColor Green
    Write-Host ""
    Write-Host "Test endpoints:" -ForegroundColor Cyan
    Write-Host "  Health: $domain/health" -ForegroundColor Gray
    Write-Host "  Docs: $domain/docs" -ForegroundColor Gray
} catch {
    Write-Host "âš  Could not get domain automatically" -ForegroundColor Yellow
    Write-Host "Check Railway dashboard for your URL" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "ðŸ“ Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Update frontend .env.local with your Railway URL" -ForegroundColor White
Write-Host "  2. Add TELEGRAM_BOT_TOKEN if you have a bot" -ForegroundColor White
Write-Host "  3. Deploy frontend to Vercel" -ForegroundColor White
Write-Host ""

Read-Host -Prompt "Press Enter to exit"

