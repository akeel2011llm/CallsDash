# Channels: voice, website chat, WhatsApp, Instagram

Admin, client, **Channels** (`/admin/clients/<id>/channels`) is the one place to connect a clinic. Each section shows its status and the exact values to copy.

Channels, Server settings lists which keys are set (never their values) and prints the Google service account email to share calendars with. Each doctor on the client page has a **Test** button that asks Google for that calendar.

## 1. ElevenLabs receptionist (all channels share it)

Set `ELEVENLABS_API_KEY`, `NEXT_PUBLIC_SITE_URL`, `AGENT_TOOLS_SECRET` in Vercel. Press **Sync to ElevenLabs**. It:

- creates (first time) or updates the clinic's agent: prompt sections, behaviour, voice, languages (English, Arabic), temperature;
- uploads the clinic's knowledge as a text document and attaches it;
- creates the shared booking tools (availability, book, find, cancel, reschedule, take message, hand off to staff) pointing at `/api/agent-tools/*`;
- sends the allowed websites to the widget allow-list.

Safe to run again; run it after any change. Failures are stored and shown on the page, and a half-created knowledge document is removed.

**Conversation-start webhook**: in ElevenLabs, Agents, Settings, set the "conversation initiation client data" webhook to `https://<host>/api/webhooks/elevenlabs/init` with header `X-Webhook-Secret: <ELEVENLABS_INIT_SECRET or AGENT_TOOLS_SECRET>`. The agent then knows today's date, whether the clinic is open, today's hours, the caller's number and the channel before it speaks.

**Post-call webhook**: `/api/webhooks/elevenlabs` with `ELEVENLABS_WEBHOOK_SECRET` (conversations, recordings metadata, credits).

## 2. Website widget

Snippet is on the Channels page. The page's domain must be in the clinic's allowed websites. The widget passes the dynamic variables from `/api/widget/config`.

## 3. WhatsApp

1. In ElevenLabs (Agents, WhatsApp) add the clinic's WhatsApp Business number and choose its agent. That is what makes the agent answer chats.
2. In Meta WhatsApp Manager create a **utility** template for booking confirmation (the Channels page shows the exact wording and variables) and wait for approval.
3. In CallsDash enter the phone number ID, display number, template name and language, set status Live.
4. A booking made through the agent now sends the confirmation (after the response, so the caller is never kept waiting). **Send a test confirmation** checks the whole path to your own number.

Patients who message first can be answered inside the 24 hour window; the confirmation template covers messages the clinic starts.

## 4. Instagram DMs

Instagram has no direct ElevenLabs integration, so CallsDash bridges it: Meta sends the DM to CallsDash, CallsDash sends it to an ElevenLabs **custom channel** agent, ElevenLabs answers on CallsDash's reply webhook, and CallsDash sends the answer through the Instagram Graph API. Voice notes are transcribed with ElevenLabs speech to text first. A patient who writes again within 12 hours continues the same conversation.

1. Create a Meta developer app with Instagram messaging; connect the clinic's professional Instagram account.
2. Set `META_APP_SECRET` and `META_VERIFY_TOKEN` in Vercel.
3. In Meta webhooks, callback URL = `https://<host>/api/webhooks/instagram`, verify token = `META_VERIFY_TOKEN`, subscribe to `messages`.
4. In ElevenLabs create a custom channel for the clinic's agent; give it the reply URL shown on the Channels page (`/api/webhooks/instagram/reply/<slug>`).
5. On the Channels page paste: Instagram account ID, username, the ElevenLabs inbound URL, the access token, and the two secrets from ElevenLabs. Secrets are stored in a separate table that the browser can never read and are never shown again.

## 5. Phone

Needs a phone number (Twilio or a SIP trunk from a Bahrain provider) imported in ElevenLabs and assigned to the clinic's agent. Record it on the Channels page. Until then the agent takes callback requests.

## Verify on a real account

The ElevenLabs request shapes below were written from the public documentation and tested against fakes only. Check them on the first real sync and message, and send the error text if one differs:

- agent create/update body (language presets, `data_collection`), workspace tool and knowledge-base endpoints;
- the conversation-start webhook response format;
- WhatsApp template send call;
- custom channel inbound `async_message` request and the reply signature (`ElevenLabs-Signature`, `t=<time>,v0=<HMAC-SHA256 of "time.body">`);
- Instagram Graph send endpoint host and permissions for the connected account.
