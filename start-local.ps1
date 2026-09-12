if (-not $env:VITAMIN_ADMIN_PASSWORD) {
  $env:VITAMIN_ADMIN_PASSWORD = Read-Host "请设置本次后台登录密码"
}
if (-not $env:VITAMIN_SESSION_SECRET) {
  $env:VITAMIN_SESSION_SECRET = [guid]::NewGuid().ToString() + [guid]::NewGuid().ToString()
}
Write-Host "正在启动： http://localhost:3000"
node server.js
