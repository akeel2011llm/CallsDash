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

Phones play a call's voice quietly while the microphone is on (iPhone Safari switches to its in-call audio level), and
ElevenLabs' embedded widget has no volume control. If a client reports a quiet voice, the fix is to talk through our own
console built on `@elevenlabs/client` (output gain plus a limiter); it was built and tested once and is in git history
(PR #18) if it is needed again.

**Try the assistant** (top of the admin client page and of the clinic's Home page, `components/TryAssistant.tsx`) runs the
clinic's live agent inside the dashboard: the same floating widget visitors get, plus a written chat (`@elevenlabs/client`,
text only) like WhatsApp or Instagram. Both use the real knowledge base, calendar and booking tools, so test bookings are
real bookings and conversations use credits. The widget only runs on this app's own address after a Sync has added it to
the agent's allow-list; the panel says so, and offers **Update the assistant** (Sync) to the admin when the agent is behind.

## 3. WhatsApp

WhatsApp does two jobs for a clinic. A patient who writes to the clinic's number chats with the assistant (this runs inside ElevenLabs). And after every booking or move, CallsDash sends the patient a **confirmation with all the booking details** (clinic, doctor, service, date, time, address with map link, clinic phone, booking reference) through ElevenLabs' outbound message call. Both use the same business number, imported once in ElevenLabs. What the message looks like and when it is sent is in `docs/bookings.md`; this section is the setup.

The Channels page (WhatsApp card, "Set up WhatsApp step by step") shows the steps below with this clinic's own names, the exact message text with **Copy** buttons, the example value for every variable, a preview of the message with the clinic's real address, and a test button. Steps already done show a green tick in the card's list and the steps fold away.

**Part 1: connect the number in ElevenLabs** (checked against ElevenLabs' WhatsApp documentation, 2026-10-22)
1. The number must not be in use in the WhatsApp Business app on a phone or with another WhatsApp provider; remove it there first if it is.
2. ElevenLabs, Agents, WhatsApp (`elevenlabs.io/app/agents/whatsapp`), **Import account**. In Meta's window choose (or create) the business account and the number and allow ElevenLabs.
3. Open the imported account, under "Assign an agent" choose the client's agent (named `CallsDash: <client name>`) and check that "Enable messaging" is on. Without an agent, a patient's reply is ignored.
4. Menu next to the account, **Copy phone number ID**. Paste it on the Channels page ("WhatsApp phone number ID") and set the status to Live.
5. In WhatsApp Manager, Overview, **Add payment method**: Meta bills each template message delivered (not from CallsDash credits). Without it template messages are not delivered.

**Part 2: create the message template in Meta's WhatsApp Manager** (`business.facebook.com/latest/whatsapp_manager/message_templates`)
1. **Create template**, category **Utility**, name `appointment_confirmation` (or the name chosen on the Channels page), the language of the text.
2. Set "Type of variable" to **Name** (not Number): the text uses `{{name}}`, `{{clinic}}`, `{{doctor}}`, `{{service}}`, `{{date}}`, `{{time}}`, `{{address}}`, `{{phone}}`, `{{reference}}`.
3. Paste the text from the Channels page into the Body, type the example values it lists, submit. Meta usually answers in minutes or hours, up to 24 hours. Wait for **Active**.
4. A second language is a second template with the same name and the other language ("English" and "Arabic", codes `en` and `ar`). The patient's confirmation is sent in their language when the clinic has a template in it, otherwise in the main language.
5. On the Channels page tick the languages created, fill in the clinic's address (English and Arabic), Google Maps link and phone, Save, then **Send a test confirmation** to your own number and reply to it.

Meta rejects a body that starts or ends with a variable and one with too many variables for its length. The wording on the Channels page starts and ends with fixed text; if Meta still rejects it for the length, add a sentence of your own at the end of the body.

**Wording.** "All details" (template `appointment_confirmation`, 9 variables) is the default. A clinic that saved a template before it existed has the earlier "Short" wording (`booking_confirmation`: name, clinic, doctor, time) and keeps it until an admin switches; the full wording needs a template under a new name, and saving the same name is refused.

**How it is sent.** After the booking is saved, `after()` calls `POST /v1/convai/whatsapp/outbound-message` with the phone number ID, the patient's WhatsApp id (digits with country code; 8 digits means Bahrain), the template name and language, `template_params` (body parameters with `parameter_name`) and the agent id plus dynamic variables (today's date, opening hours, the patient's number, channel `whatsapp`), so the assistant can answer the patient's reply. ElevenLabs answers with a conversation id once WhatsApp accepted the message; the booking records "Sent". Meta can still decline later (for example the number is not on WhatsApp) and that is not reported back. A refusal is recorded on the booking with the reason and a hint, in the activity log, and once as an alert. A confirmation the patient never answers is not stored as a conversation and costs no credits.

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
- WhatsApp: ElevenLabs' outbound message call and the named-variable `template_params` shape follow ElevenLabs' documentation (2026-10-22) but were tested against fakes only; check the first real test confirmation. Not confirmed anywhere: the exact button names in Meta's WhatsApp Manager (sources disagree: "Create template", "Type of variable", "Submit for review"), how many variables Meta accepts for the length of a Utility template, and whether Meta accepts a Google Maps link inside the address value (leave the link field empty if it does not);
- the "Powered by" line: sent as `platform_settings.widget.disable_banner`; ElevenLabs does not say whether a plan is needed, so after pressing "Update the assistant" open the website widget and look. A refusal shows as a warning on the Channels page and never loses the widget;
- custom channel inbound `async_message` request and the reply signature (`ElevenLabs-Signature`, `t=<time>,v0=<HMAC-SHA256 of "time.body">`);
- Instagram Graph send endpoint host and permissions for the connected account.

## Duplicating a client

Client page > *Duplicate client* (`/admin/clients/[id]/duplicate`, `lib/client-copy.ts`) makes a new client from an existing one under a new name, website and package.

Copied: look and wording (colours, font, pattern, welcome and tagline, report footer), opening hours, closed days, alert rules, permissions, retention, low-balance rule, the assistant's instructions and studio options, and optionally the doctors (name, specialty, weekly hours) and the knowledge base. The old clinic's name (English and Arabic, any case) is replaced by the new name in all copied text.

Never copied: bookings, conversations, patients, customers, wallet and credits (the new client gets the first month of the package picked, like any new client), sign-ins, the contract, the ElevenLabs agent (the copy has none until Create or *Use another ElevenLabs agent*), Google calendar ids and doctor leave, WhatsApp, Instagram and phone settings, secrets, the logo, cover image and support contacts.

Why: a client is found by its ElevenLabs agent id, its Instagram account id and its website, so two clients sharing any of them would receive each other's calls, messages and widget traffic; a shared Google calendar mixes two clinics' bookings. If anything fails while copying, the half-made client is deleted.

## Guides you can fold, hide and bring back

A setup guide or a list of precautions is a `Guide` (`components/Guide.tsx`): folded by default, with an x that hides it for that person only (stored per person in `app_settings` as `guides.hidden.<user id>`). **Settings** (in the menu of the admin, clinic and doctor portals; on a phone, open the menu with the bottom bar's *More* or the top-left button) lists the hidden guides with *Show again* and *Show all guides again*, and has the person's password form. The logo and name at the top left of every portal open that portal's home page. To make another guide hideable, add its id and title key to `GUIDES` in `lib/guides.ts` and wrap it in `<Guide id="...">`. Today: the precautions after copying a client (`copy`) and the WhatsApp setup steps on Channels (`whatsapp`).
