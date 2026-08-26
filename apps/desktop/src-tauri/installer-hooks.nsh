!macro NSIS_HOOK_PREINSTALL
  ExecWait 'taskkill /F /IM dictado-local.exe'
  ExecWait 'taskkill /F /IM comu.exe'
  IfFileExists "$LOCALAPPDATA\Dictado local\uninstall.exe" 0 +2
  ExecWait '"$LOCALAPPDATA\Dictado local\uninstall.exe" /S'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Exec '"$INSTDIR\comu.exe"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ExecWait 'taskkill /F /IM comu.exe'
!macroend
