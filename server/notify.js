// Windows desktop notifications from WSL, for reminders that come due while no
// Watson screen is open. The text travels in an environment variable (WSLENV),
// never inside the PowerShell command, so nothing in it can run as code.
import { execFile } from 'node:child_process';

const SCRIPT = `
$t = [Security.SecurityElement]::Escape($env:WATSON_TOAST)
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml("<toast scenario='reminder'><visual><binding template='ToastGeneric'><text>Watson</text><text>$t</text></binding></visual><actions><action content='OK' arguments='ok' activationType='foreground'/></actions></toast>")
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))
`;

/** Resolves true if Windows accepted the notification. */
export function windowsNotify(text) {
  return new Promise((resolve) => {
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      env: { ...process.env, WATSON_TOAST: String(text).slice(0, 500), WSLENV: [process.env.WSLENV, 'WATSON_TOAST'].filter(Boolean).join(':') },
      timeout: 20000,
      windowsHide: true,
    }, (err) => {
      if (err) console.warn('  Windows notification failed:', err.message.split('\n')[0]);
      resolve(!err);
    });
  });
}
