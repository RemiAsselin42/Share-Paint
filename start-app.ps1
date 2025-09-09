# Script de démarrage pour Share Paint
# Ce script démarre le serveur et le client en parallèle

Write-Host "=== Share Paint - Démarrage de l'application ===" -ForegroundColor Green

# Vérifier si Node.js est installé
try {
    $nodeVersion = node --version
    Write-Host "Node.js version: $nodeVersion" -ForegroundColor Cyan
} catch {
    Write-Host "Erreur: Node.js n'est pas installé ou n'est pas dans le PATH" -ForegroundColor Red
    exit 1
}

# Fonction pour démarrer le serveur
function Start-Server {
    Write-Host "Démarrage du serveur Socket.IO..." -ForegroundColor Yellow
    Set-Location "server"
    
    # Installer les dépendances si nécessaire
    if (!(Test-Path "node_modules")) {
        Write-Host "Installation des dépendances du serveur..." -ForegroundColor Yellow
        npm install
    }
    
    # Démarrer le serveur
    npm run dev
}

# Fonction pour démarrer le client
function Start-Client {
    Write-Host "Démarrage du client React..." -ForegroundColor Yellow
    
    # Attendre que le serveur démarre (2 secondes)
    Start-Sleep -Seconds 2
    
    # Démarrer le client Vite
    npm run dev
}

# Démarrer les deux processus en parallèle
$serverJob = Start-Job -ScriptBlock { 
    Set-Location $using:PWD
    & powershell -Command "& { $(Get-Content 'start-app.ps1' | Select-String -Pattern 'function Start-Server' -A 20 | Select-Object -Skip 1 | Select-Object -SkipLast 1 | ForEach-Object { $_.Line }); Start-Server }"
}

$clientJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD  
    & powershell -Command "& { $(Get-Content 'start-app.ps1' | Select-String -Pattern 'function Start-Client' -A 20 | Select-Object -Skip 1 | Select-Object -SkipLast 1 | ForEach-Object { $_.Line }); Start-Client }"
}

Write-Host "Applications démarrées!" -ForegroundColor Green
Write-Host "- Serveur: http://localhost:3001" -ForegroundColor Cyan
Write-Host "- Client: http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
Write-Host "Appuyez sur Ctrl+C pour arrêter les applications" -ForegroundColor Yellow

# Attendre que l'utilisateur arrête les applications
try {
    Wait-Job $serverJob, $clientJob
} finally {
    # Nettoyer les jobs
    Stop-Job $serverJob, $clientJob -ErrorAction SilentlyContinue
    Remove-Job $serverJob, $clientJob -ErrorAction SilentlyContinue
    Write-Host "Applications arrêtées." -ForegroundColor Red
}
