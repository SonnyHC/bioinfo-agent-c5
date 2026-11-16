Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "x64.nsh"
Name "BioInfoBuddy"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\BioInfoBuddy"
RequestExecutionLevel user
SetCompressor zlib
CRCCheck on
SetDatablockOptimize off
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "BioInfoBuddy"
VIAddVersionKey /LANG=1033 "FileDescription" "BioInfoBuddy Setup"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "BioInfoBuddy contributors"
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\app\BioInfoBuddy.exe"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\BioInfoBuddy"

!macro initInstaller
  SetShellVarContext current
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\BioInfoBuddySetup") p.r0 ?e'
  Pop $1
  ${If} $1 = 183
    MessageBox MB_OK "BioInfoBuddy 安装程序正在运行。" /SD IDOK
    Abort
  ${EndIf}
!macroend

Function .onInit
  !insertmacro initInstaller
  ${IfNot} ${AtLeastWin10}
  ${OrIfNot} ${RunningX64}
    MessageBox MB_OK "BioInfoBuddy 需要 64 位 Windows 10 或更新版本。" /SD IDOK
    Abort
  ${EndIf}
FunctionEnd

Function un.onInit
  !insertmacro initInstaller
FunctionEnd

Section
  SetRegView 64
  SetOutPath "$INSTDIR"
  ; Recover from an interrupted switch before preparing the next version.
  IfFileExists "$INSTDIR\app\BioInfoBuddy.exe" ready
  IfFileExists "$INSTDIR\.previous\BioInfoBuddy.exe" 0 ready
  Rename "$INSTDIR\.previous" "$INSTDIR\app"
ready:
  RMDir /r "$INSTDIR\.previous"
  RMDir /r "$INSTDIR\.incoming"
  ClearErrors
  SetOutPath "$INSTDIR\.incoming"
  File /r "${PAYLOAD}\*"
  IfErrors installFailed
  SetOutPath "$INSTDIR"
  IfFileExists "$INSTDIR\app\BioInfoBuddy.exe" 0 activate
  ClearErrors
  Rename "$INSTDIR\app" "$INSTDIR\.previous"
  IfErrors installFailed
activate:
  ClearErrors
  Rename "$INSTDIR\.incoming" "$INSTDIR\app"
  IfErrors rollback
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\BioInfoBuddy.lnk" "$INSTDIR\app\BioInfoBuddy.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "BioInfoBuddy"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "BioInfoBuddy"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\app\BioInfoBuddy.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" ${SIZE_KB}
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  RMDir /r "$INSTDIR\.previous"
  Goto done
rollback:
  Rename "$INSTDIR\.previous" "$INSTDIR\app"
installFailed:
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\.incoming"
  MessageBox MB_ICONSTOP "请关闭 BioInfoBuddy，检查可用空间，再重新运行安装程序。" /SD IDOK
  SetErrorLevel 1
  Abort
done:
SectionEnd

Section "Uninstall"
  SetRegView 64
  SetOutPath "$TEMP"
  ClearErrors
  RMDir /r "$INSTDIR\app"
  IfErrors 0 removed
  MessageBox MB_ICONSTOP "请关闭 BioInfoBuddy 后再次卸载。" /SD IDOK
  SetErrorLevel 1
  Abort
removed:
  RMDir /r "$INSTDIR\.incoming"
  RMDir /r "$INSTDIR\.previous"
  Delete "$SMPROGRAMS\BioInfoBuddy.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
