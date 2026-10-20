# Using www.callsdash.com

One address serves everyone. People sign in at `https://www.callsdash.com/login` with the email and password the CallsDash
administrator gave them at onboarding. The app reads their profile and sends them on:

- an admin goes to `/admin`
- a client goes to `/app` (their own portal, with their own branding)
- anyone already signed in who opens `/login` or `/` is sent straight to their portal
- a client who types `/admin` is sent back to `/app`; nobody can open a portal without signing in

A client can also have a branded sign-in page at `https://www.callsdash.com/login?c=<client slug>` (logo, colours, cover image, tagline).

## Set-up steps (no code change)

1. **Vercel**: project calls-dash, Settings, Domains: add `www.callsdash.com` and `callsdash.com` (set the bare domain to redirect to `www`). Add the DNS records Vercel shows at the domain registrar.
2. **Supabase**: Authentication, URL Configuration: set *Site URL* to `https://www.callsdash.com` and add `https://www.callsdash.com/**` to *Redirect URLs*. Keep the `calls-dash.vercel.app` entry while testing.
3. Sign in once at the new address to confirm the cookie is set for the new host (people already signed in at `calls-dash.vercel.app` must sign in again there).
4. Website widget: clients' embed snippets use the CallsDash address, so update the `src` of `widget.js` in the snippet shown on each client's Website page after the switch (the old address keeps working while Vercel serves it).

## Installing as an app (PWA)

On a phone or computer the browser offers *Install app* (the portal menu also shows an *Install app* button; on iPhone it shows how to use Share, Add to Home Screen).
The installed app opens full screen, carries the client's name and colour, and shows an offline page when there is no connection.
It never stores pages or data from a signed-in session offline.
