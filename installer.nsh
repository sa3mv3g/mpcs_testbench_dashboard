!macro customInstall
  DetailPrint "Enabling Windows NTP Server feature..."
  
  ; Set NTP Server to Enabled
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\NtpServer" "Enabled" 1
  
  ; Set AnnounceFlags to 5
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Services\W32Time\Config" "AnnounceFlags" 5
  
  ; Ensure the W32Time service starts automatically
  nsExec::ExecToLog 'sc config w32time start= auto'
  
  ; Restart the W32Time service to apply changes
  nsExec::ExecToLog 'cmd.exe /C net stop w32time'
  nsExec::ExecToLog 'cmd.exe /C net start w32time'
  
!macroend
