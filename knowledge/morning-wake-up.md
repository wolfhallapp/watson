# Morning wake-up on the TV

Set up 2026-10-24 at Horace's request: every morning at **7:00 AM**, his TV turns on and plays a YouTube video to wake him up.

- **TV:** "Big Daddy's TV", a Roku 6 Series 58" in his bedroom. On Wi-Fi at 192.168.1.164 (it can change; the script finds it by name). Wi-Fi MAC d4:f9:21:c9:79:23.
- The other Roku on the network, "TatorTot" (192.168.1.247), is not Horace's.
- **Video:** https://youtu.be/X4nGU4DZUwE (YouTube video ID `X4nGU4DZUwE`).
- **How it works:** the Windows scheduled task "Watson Roku wake-up" runs `scripts/roku-wake.ps1` daily. The script sends a Wi-Fi wake-up packet, waits for the TV, then tells the Roku to open YouTube with that video. The task wakes the PC from sleep and runs late if the PC was off. The log is `data/roku-wake.log`.
- The TV's "Control by mobile apps" setting is **Limited**. That blocks the remote's power button command but still allows launching YouTube, which is why the script uses the Wi-Fi wake-up instead.
- **Change the time:** `scripts\install-roku-wake.ps1 -At 6:30am`. **Turn it off:** `scripts\install-roku-wake.ps1 -Remove`. **Change the video:** edit `$VideoId` in `roku-wake.ps1`.
- Tested 2026-10-24 with the TV already on (it worked). Turning the TV on from standby hasn't been tested yet.
