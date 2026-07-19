!macro NSIS_HOOK_PREINSTALL
  RMDir /r "$INSTDIR\server"
  RMDir /r "$INSTDIR\binaries"
!macroend

; Allow the user to pick which BinGO folder to uninstall.
; Defaults to the registered $INSTDIR; the user can browse to a legacy
; install location (e.g. %LOCALAPPDATA%\BinGO) to clean it up instead.
!macro NSIS_HOOK_PREUNINSTALL
  Push $0
  nsDialogs::SelectFolderDialog "选择要卸载的 BinGO 目录（可浏览选择旧版本所在位置）" "$INSTDIR"
  Pop $0
  ${If} $0 != "error"
  ${AndIf} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
  Pop $0
!macroend
