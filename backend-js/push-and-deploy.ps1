# OGFX Backend - GitHub Push + Railway Deploy Script
# Run this in PowerShell

Write-Host "ðŸš€ OGFX GitHub + Railway Deployment" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host ""

# Configuration
$backendPath = "C:\Users\ansh\OneDrive\Desktop\ogfx\backend-js"
$githubRepo = Read-Host "Enter your GitHub username"
$repoName = "ogfx-backend"
$fullRepoUrl = "https://github.com/$githubRepo/$repoName.git"

Set-Location $backendPath
Write-Host "âœ“ Working in: $backendPath" -ForegroundColor Green
Write-Host ""

# Step 1: Check if git is initialized
try {
    $null = git status 2>&1
    Write-Host "âœ“ Git repository found" -ForegroundColor Green
} catch {
    Write-Host "ðŸ“¦ Initializing Git repository..." -ForegroundColor Cyan
    git init
    git branch -M main
    Write-Host "âœ“ Git initialized" -ForegroundColor Green
}

Write-Host ""
Write-Host "ðŸ“¤ Preparing files for GitHub..." -ForegroundColor Cyan

# Remove sensitive files from tracking (just in case)
git rm --cached .env 2>$null
git rm --cached .env.local 2>$null
git rm --cached .env.production 2>$null

# Add all files
git add .

# Commit
$commitMsg = Read-Host "Enter commit message (or press Enter for 'Railway deployment ready')"
if ([string]::IsNullOrWhiteSpace($commitMsg)) {
    $commitMsg = "Railway deployment ready"
}
git commit -m "$commitMsg"
Write-Host "âœ“ Committed: $commitMsg" -ForegroundColor Green

Write-Host ""
Write-Host "ðŸ”— Linking to GitHub..." -ForegroundColor Cyan

# Check if remote exists
try {
    $remote = git remote get-url origin 2>&1
    Write-Host "âœ“ Remote already set: $remote" -ForegroundColor Green
} catch {
    Write-Host "Adding GitHub remote..." -ForegroundColor Yellow
    git remote add origin $fullRepoUrl
    Write-Host "âœ“ Remote added: $fullRepoUrl" -ForegroundColor Green
}

Write-Host ""
Write-Host "ðŸ“¤ Pushing to GitHub..." -ForegroundColor Cyan
Write-Host "Repository: $fullRepoUrl" -ForegroundColor Gray

# Push to GitHub
try {
    git push -u origin main
    Write-Host "âœ… Successfully pushed to GitHub!" -ForegroundColor Green
    Write-Host "ðŸŒ URL: $fullRepoUrl" -ForegroundColor Cyan
} catch {
    Write-Host ""
    Write-Host "âš  First-time push requires GitHub setup" -ForegroundColor Yellow
    Write-Host "" -ForegroundColor White
    Write-Host "If you haven't created the repo yet:" -ForegroundColor Yellow
    Write-Host "1. Go to https://github.com/new" -ForegroundColor Cyan
    Write-Host "2. Name it: ogfx-backend" -ForegroundColor Cyan
    Write-Host "3. Make it Public or Private" -ForegroundColor Cyan
    Write-Host "4. Do NOT initialize with README" -ForegroundColor Cyan
    Write-Host "5. Click 'Create repository'" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Then run this script again." -ForegroundColor Yellow
    Read-Host -Prompt "Press Enter after creating the GitHub repo"
    
    # Try push again
    git push -u origin main
}

Write-Host ""
Write-Host "ðŸš‚ Now deploying to Railway..." -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

# Check railway CLI
try {
    $railwayVersion = railway --version 2>&1
    Write-Host "âœ“ Railway CLI: $railwayVersion" -ForegroundColor Green
} catch {
    Write-Host "ðŸ“¦ Installing Railway CLI..." -ForegroundColor Yellow
    npm install -g @railway/cli
}

# Link to railway project
try {
    $null = railway status 2>&1
    Write-Host "âœ“ Linked to Railway project" -ForegroundColor Green
} catch {
    Write-Host "ðŸ”— Linking to Railway..." -ForegroundColor Yellow
    railway link
}

Write-Host ""
Write-Host "ðŸ“¦ Setting Environment Variables..." -ForegroundColor Cyan

# Environment variables
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
    Write-Host "  Setting $($var.Key)..." -ForegroundColor Gray
    $null = railway variables set "$($var.Key)=$($var.Value)" 2>&1
}

Write-Host "âœ“ Environment variables set" -ForegroundColor Green

Write-Host ""
Write-Host "ðŸš€ Deploying to Railway..." -ForegroundColor Green
railway up

Write-Host ""
Write-Host "âœ… DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green

try {
    $domain = railway domain 2>&1
    Write-Host "ðŸŒ Live API URL: $domain" -ForegroundColor Green
    Write-Host ""
    Write-Host "Test your API:" -ForegroundColor Cyan
    Write-Host "  Health: $domain/health" -ForegroundColor Gray
    Write-Host "  Docs:   $domain/docs" -ForegroundColor Gray
} catch {
    Write-Host "ðŸŒ Check Railway dashboard for your URL" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "ðŸ“ Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Update frontend .env.local with your Railway URL" -ForegroundColor White
Write-Host "  2. Add TELEGRAM_BOT_TOKEN to Railway variables (optional)" -ForegroundColor White
Write-Host "  3. Deploy frontend to Vercel" -ForegroundColor White
Write-Host ""
Write-Host "ðŸ’¡ To add Telegram bot later:" -ForegroundColor Gray
Write-Host "  railway variables set TELEGRAM_BOT_TOKEN=your_token" -ForegroundColor Gray
Write-Host ""

Read-Host -Prompt "Press Enter to exit"

