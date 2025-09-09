@echo off
echo === Share Paint - Demarrage de l'application ===

REM Verifier si Node.js est installe
node --version >nul 2>&1
if errorlevel 1 (
    echo Erreur: Node.js n'est pas installe ou n'est pas dans le PATH
    pause
    exit /b 1
)

echo Node.js detecte!

REM Installer les dependances du serveur si necessaire
echo Installation des dependances du serveur...
cd server
if not exist node_modules (
    npm install
)

REM Demarrer le serveur en arriere-plan
echo Demarrage du serveur Socket.IO...
start "Share Paint Server" cmd /c "cd server && npm run dev"

REM Retourner au repertoire racine
cd ..

REM Attendre 5 secondes pour que le serveur demarre
timeout /t 5 /nobreak >nul

REM Demarrer le client
echo Demarrage du client React...
npm run dev

pause
