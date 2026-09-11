ASPIRANT TEST AI — Play Store App Preparation

Current website origin:
https://ai-test-website.onrender.com

No custom domain is required. The Render HTTPS subdomain can be used for the PWA/TWA app.

This package adds:
- manifest.webmanifest
- service worker
- 192x192 and 512x512 app icons
- PWA meta tags/service worker registration
- MIME support for PNG and webmanifest files
- existing AdSense verification code retained

Next packaging stage:
1. Upload these updated files to the existing GitHub repository.
2. Wait for Render auto-deploy.
3. Verify https://ai-test-website.onrender.com/manifest.webmanifest opens.
4. Package the URL as a Trusted Web Activity (TWA) / Android App Bundle.
5. Use package id: com.aspirant.testai (can be changed before first Play Console app creation).
6. After Play App Signing is created, add the Play SHA-256 certificate fingerprint to
   https://ai-test-website.onrender.com/.well-known/assetlinks.json
   so the TWA becomes fully verified/fullscreen.

Important: Keep the Render service URL stable. If the service/subdomain is deleted or changed,
the app will need to be updated to point to the new origin.
