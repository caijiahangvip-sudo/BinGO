!macro NSIS_HOOK_PREINSTALL
  RMDir /r "$INSTDIR\server"
  RMDir /r "$INSTDIR\binaries"
!macroend
