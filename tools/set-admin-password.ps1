$ErrorActionPreference = 'Stop'
$securePassword = Read-Host '새 관리자 비밀번호 (영어+숫자 8자리, 화면에 표시되지 않음)' -AsSecureString
$plainPassword = [System.Net.NetworkCredential]::new('', $securePassword).Password
try {
  $passwordInput = @{ password = $plainPassword } | ConvertTo-Json -Compress
  Write-Host '아래 해시를 Vercel Production의 ADMIN_PASSWORD_HASH 값으로 저장하세요. 비밀번호 자체는 저장하지 마세요.'
  $passwordInput | & node (Join-Path $PSScriptRoot 'hash-password.mjs')
} finally {
  $plainPassword = $null
  $passwordInput = $null
  $securePassword.Dispose()
}
