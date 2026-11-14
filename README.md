# Skinwalker-Hunt
SKINWALKER: THE HUNT - UPDATED CLIENT FILES

FILES
- index.html
- style.css
- game.js
- models/deer.glb       (your uploaded low-poly deer/elk model)
- models/wendigo.glb    (your uploaded wendigo model)

RUNNING
1. Keep the folder structure exactly as provided.
2. Upload the folder contents to your static web host, including the models folder.
3. Serve it over HTTPS or localhost. Do not open index.html directly as a file:// URL because ES modules and GLB loading need a web server.
4. Supabase URL and publishable key are already configured in game.js.

SUPABASE EMAIL SUBJECT
The email subject cannot be set from browser JavaScript. In Supabase Dashboard:
Authentication -> Email Templates -> Confirm signup
Set Subject to: Skinwalker Hunt Login Verification
Save the template.

NOTES
- The deer and wendigo are loaded from the supplied GLB assets using Three.js GLTFLoader.
- The wendigo appears locally for the hunter when sanity reaches zero.
- Mobile controls: left virtual joystick, drag the right side of the screen to look, FIRE button.
- This remains a client-side prototype. Supabase Realtime broadcasts and client-side capture checks are not cheat-proof or server-authoritative. Do not use client broadcasts as trusted match results or award persistent stats from them.
- For production multiplayer, move role assignment, dart hit validation, catches, sanity, and round results to a trusted server/Edge Function.
